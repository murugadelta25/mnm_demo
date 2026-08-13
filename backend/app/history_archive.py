"""
Historical data archive — move old rows to a LAN MySQL DB and federate reads.

Live IPC DB keeps recent data (default: last 60 days / ~2 months).
Older rows are copied to ARCHIVE_DATABASE_URL (or site_config.history_archive),
then deleted from live so dashboards stay fast.

Frontend date ranges that span both windows are merged from live + archive.
"""
from __future__ import annotations

import json
import os
import re
from datetime import date, timedelta
from typing import Any, Optional
from urllib.parse import quote_plus

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from .models import (
    OEEEntry,
    ProductionPlan,
    WorkOrder,
    SessionLocal,
    engine as live_engine,
    now_ist,
)

DEFAULT_HISTORY_ARCHIVE = {
    "enabled": False,
    "retention_days": 60,  # default for high-growth tables (~2 months)
    "interval_days": 1,
    "host": "",
    "port": 3306,
    "user": "",
    "password": "",
    "database": "eap_pms_archive",
    "last_run_at": None,
    "last_run_result": None,
    "batch_size": 500,
    "tables": {},  # per-table overrides: { name: {enabled, retention_days} }
}

# Catalog of archivable tables. High-growth defaults ON @ 60 days; low-growth OFF @ 90 days.
TABLE_CATALOG = {
    "oee_entries": {
        "label": "OEE Entries",
        "tier": "high",
        "default_enabled": True,
        "default_retention_days": 60,
        "date_column": "entry_date",
        "special": None,
        "description": "Manual / calculated OEE shift entries — grows with every machine & shift.",
    },
    "oee_defect_log": {
        "label": "OEE Defect Log",
        "tier": "high",
        "default_enabled": True,
        "default_retention_days": 60,
        "date_column": None,
        "special": "oee_defect_parent",
        "depends_on": "oee_entries",
        "description": "QC defect adjustments linked to OEE entries (archived with parent date).",
    },
    "machine_kpi_log": {
        "label": "Machine KPI Log",
        "tier": "high",
        "default_enabled": True,
        "default_retention_days": 60,
        "date_column": "entry_date",
        "special": None,
        "description": "Per-shift KPI snapshots used for historic analysis.",
    },
    "machine_status_log": {
        "label": "Machine Status Log",
        "tier": "high",
        "default_enabled": True,
        "default_retention_days": 60,
        "date_column": "changed_at",
        "special": None,
        "description": "High-frequency running/idle/down status changes — largest grower.",
    },
    "email_logs": {
        "label": "Email Logs",
        "tier": "high",
        "default_enabled": True,
        "default_retention_days": 60,
        "date_column": "sent_at",
        "special": None,
        "description": "Outbound email send history.",
    },
    "deviation_alert_log": {
        "label": "Deviation Alert Log",
        "tier": "low",
        "default_enabled": False,
        "default_retention_days": 90,
        "date_column": "sent_at",
        "special": None,
        "description": "Deviation / alarm alert emails sent.",
    },
    "operator_loss_logs": {
        "label": "Operator Loss Logs",
        "tier": "low",
        "default_enabled": False,
        "default_retention_days": 90,
        "date_column": "entry_date",
        "special": None,
        "description": "TPM / 16-loss sessions from the operator app.",
    },
    "attendance_records": {
        "label": "Attendance Records",
        "tier": "low",
        "default_enabled": False,
        "default_retention_days": 90,
        "date_column": "entry_date",
        "special": None,
        "description": "Operator punch in/out attendance.",
    },
    "operator_sessions": {
        "label": "Operator Sessions",
        "tier": "low",
        "default_enabled": False,
        "default_retention_days": 90,
        "date_column": "started_at",
        "special": None,
        "description": "Tablet / mobile operator login sessions.",
    },
    "machine_allocations": {
        "label": "Machine Allocations",
        "tier": "low",
        "default_enabled": False,
        "default_retention_days": 90,
        "date_column": "entry_date",
        "special": None,
        "description": "Operator-to-machine assignment history.",
    },
    "breakdown_tickets": {
        "label": "Breakdown Tickets",
        "tier": "low",
        "default_enabled": False,
        "default_retention_days": 90,
        "date_column": "created_at",
        "special": None,
        "description": "Maintenance breakdown tickets (resolved history).",
    },
    "qc_inspection_reports": {
        "label": "QC Inspection Reports",
        "tier": "low",
        "default_enabled": False,
        "default_retention_days": 90,
        "date_column": "inspection_date",
        "special": None,
        "description": "QC inspection sheet submissions.",
    },
    "tool_events": {
        "label": "Tool Events",
        "tier": "low",
        "default_enabled": False,
        "default_retention_days": 90,
        "date_column": "created_at",
        "special": None,
        "description": "Tool issue / return / scrap events.",
    },
    "tool_alerts": {
        "label": "Tool Alerts",
        "tier": "low",
        "default_enabled": False,
        "default_retention_days": 90,
        "date_column": "created_at",
        "special": None,
        "description": "Tool life / stock alerts.",
    },
    "model_change_requests": {
        "label": "Model Change Requests",
        "tier": "low",
        "default_enabled": False,
        "default_retention_days": 90,
        "date_column": "created_at",
        "special": None,
        "description": "Model / setting change request history.",
    },
}

RETENTION_PRESETS = [
    {"days": 60, "label": "2 months (60 days)"},
    {"days": 90, "label": "3 months (90 days)"},
    {"days": 120, "label": "4 months (120 days)"},
    {"days": 180, "label": "6 months (180 days)"},
]

# Backward-compatible alias used by older helpers
ARCHIVE_TABLES = [
    (name, meta.get("date_column"))
    for name, meta in TABLE_CATALOG.items()
    if meta.get("default_enabled")
]

_archive_engine = None
_ArchiveSession = None
_archive_engine_url = None


def _get_site_history_cfg(db: Optional[Session] = None) -> dict:
    close = False
    if db is None:
        db = SessionLocal()
        close = True
    try:
        from .models import SiteConfig

        row = db.query(SiteConfig).first()
        if not row:
            return dict(DEFAULT_HISTORY_ARCHIVE)
        cfg = json.loads(row.config_json or "{}")
        return {**DEFAULT_HISTORY_ARCHIVE, **(cfg.get("history_archive") or {})}
    except Exception:
        return dict(DEFAULT_HISTORY_ARCHIVE)
    finally:
        if close:
            db.close()


def _save_site_history_cfg(db: Session, hist_cfg: dict) -> None:
    from .models import SiteConfig

    row = db.query(SiteConfig).first()
    if row:
        cfg = json.loads(row.config_json or "{}")
    else:
        cfg = {}
        row = SiteConfig(config_json="{}")
        db.add(row)
    cfg["history_archive"] = hist_cfg
    row.config_json = json.dumps(cfg)
    db.commit()


def build_archive_url(cfg: Optional[dict] = None) -> Optional[str]:
    """Resolve archive DB URL: env wins, else site_config credentials."""
    env_url = (os.getenv("ARCHIVE_DATABASE_URL") or "").strip()
    if env_url:
        return env_url
    cfg = cfg or _get_site_history_cfg()
    host = (cfg.get("host") or "").strip()
    database = (cfg.get("database") or "").strip()
    user = (cfg.get("user") or "").strip()
    if not host or not database or not user:
        return None
    password = quote_plus(str(cfg.get("password") or ""))
    port = int(cfg.get("port") or 3306)
    return f"mysql+pymysql://{quote_plus(user)}:{password}@{host}:{port}/{database}"


def get_archive_engine(cfg: Optional[dict] = None, *, force_refresh: bool = False):
    global _archive_engine, _ArchiveSession, _archive_engine_url
    url = build_archive_url(cfg)
    if not url:
        return None
    if force_refresh or _archive_engine is None or _archive_engine_url != url:
        if _archive_engine is not None:
            try:
                _archive_engine.dispose()
            except Exception:
                pass
        _archive_engine = create_engine(
            url,
            pool_pre_ping=True,
            pool_recycle=3600,
            connect_args={"connect_timeout": 5},
        )
        _ArchiveSession = sessionmaker(autocommit=False, autoflush=False, bind=_archive_engine)
        _archive_engine_url = url
    return _archive_engine


def get_archive_session(cfg: Optional[dict] = None) -> Optional[Session]:
    eng = get_archive_engine(cfg)
    if eng is None or _ArchiveSession is None:
        return None
    return _ArchiveSession()


def hot_cutoff_date(cfg: Optional[dict] = None, retention_days: Optional[int] = None) -> date:
    cfg = cfg or _get_site_history_cfg()
    days = int(retention_days if retention_days is not None else (cfg.get("retention_days") or 60))
    days = max(30, min(days, 3650))
    return (now_ist().date() - timedelta(days=days))


def resolve_table_settings(cfg: Optional[dict] = None) -> list[dict]:
    """Merge TABLE_CATALOG defaults with site_config.history_archive.tables overrides."""
    cfg = cfg or _get_site_history_cfg()
    overrides = cfg.get("tables") if isinstance(cfg.get("tables"), dict) else {}
    global_ret = int(cfg.get("retention_days") or 60)
    out: list[dict] = []
    for name, meta in TABLE_CATALOG.items():
        ov = overrides.get(name) if isinstance(overrides.get(name), dict) else {}
        enabled = bool(ov["enabled"]) if "enabled" in ov else bool(meta["default_enabled"])
        if ov.get("retention_days"):
            ret = int(ov["retention_days"])
        elif meta.get("tier") == "high":
            ret = global_ret
        else:
            ret = int(meta.get("default_retention_days") or 90)
        ret = max(30, min(ret, 3650))
        cutoff = hot_cutoff_date(cfg, retention_days=ret)
        out.append({
            "name": name,
            "label": meta["label"],
            "tier": meta["tier"],
            "enabled": enabled,
            "retention_days": ret,
            "hot_cutoff_date": cutoff.isoformat(),
            "date_column": meta.get("date_column"),
            "special": meta.get("special"),
            "depends_on": meta.get("depends_on"),
            "description": meta.get("description") or "",
            "default_enabled": bool(meta["default_enabled"]),
        })
    return out


def _live_table_exists(conn, table: str) -> bool:
    try:
        n = conn.execute(
            text(
                "SELECT COUNT(*) FROM information_schema.tables "
                "WHERE table_schema = DATABASE() AND table_name = :t"
            ),
            {"t": table},
        ).scalar()
        return bool(n)
    except Exception:
        return False


def _count_archive_rows(arch_conn, table: str) -> Optional[int]:
    try:
        exists = arch_conn.execute(
            text(
                "SELECT COUNT(*) FROM information_schema.tables "
                "WHERE table_schema = DATABASE() AND table_name = :t"
            ),
            {"t": table},
        ).scalar()
        if not exists:
            return None
        return int(arch_conn.execute(text(f"SELECT COUNT(*) FROM `{table}`")).scalar() or 0)
    except Exception:
        return None


def _count_live_eligible(live_conn, table: str, date_col: Optional[str], cutoff: date, special: Optional[str]) -> int:
    try:
        if not _live_table_exists(live_conn, table):
            return 0
        if special == "oee_defect_parent":
            return int(
                live_conn.execute(
                    text(
                        "SELECT COUNT(*) FROM oee_defect_log d "
                        "INNER JOIN oee_entries e ON e.id = d.oee_entry_id "
                        "WHERE e.entry_date < :cutoff"
                    ),
                    {"cutoff": cutoff},
                ).scalar()
                or 0
            )
        if not date_col:
            return 0
        return int(
            live_conn.execute(
                text(f"SELECT COUNT(*) FROM `{table}` WHERE `{date_col}` < :cutoff"),
                {"cutoff": cutoff},
            ).scalar()
            or 0
        )
    except Exception:
        return 0


def build_tables_inventory(cfg: dict, *, reachable: bool) -> list[dict]:
    """Per-table archive status for the Database Management UI."""
    settings = resolve_table_settings(cfg)
    last_tables = ((cfg.get("last_run_result") or {}).get("tables") or [])
    moved_map = {
        r.get("table"): r
        for r in last_tables
        if isinstance(r, dict) and r.get("table")
    }

    arch_counts: dict[str, Optional[int]] = {}
    live_eligible: dict[str, int] = {}
    if reachable:
        try:
            eng = get_archive_engine(cfg)
            if eng is not None:
                with eng.connect() as arch_conn, live_engine.connect() as live_conn:
                    for t in settings:
                        arch_counts[t["name"]] = _count_archive_rows(arch_conn, t["name"])
                        cutoff = date.fromisoformat(t["hot_cutoff_date"])
                        live_eligible[t["name"]] = _count_live_eligible(
                            live_conn,
                            t["name"],
                            t.get("date_column"),
                            cutoff,
                            t.get("special"),
                        )
        except Exception:
            pass

    inventory = []
    for t in settings:
        name = t["name"]
        arch_count = arch_counts.get(name)
        moved_info = moved_map.get(name) or {}
        last_moved = int(moved_info.get("moved") or 0)
        has_archive_data = arch_count is not None and arch_count > 0
        schema_ready = arch_count is not None

        if not t["enabled"]:
            status = "not_selected"
            status_label = "Not selected"
        elif has_archive_data:
            status = "archived"
            status_label = "Already archived"
        else:
            status = "pending"
            status_label = "Selected — awaiting first move"

        inventory.append({
            **t,
            "archive_row_count": arch_count if arch_count is not None else 0,
            "schema_ready": schema_ready,
            "live_eligible_rows": live_eligible.get(name, 0),
            "last_moved": last_moved,
            "status": status,
            "status_label": status_label,
        })
    return inventory


def public_history_status(db: Optional[Session] = None) -> dict:
    cfg = _get_site_history_cfg(db)
    url = build_archive_url(cfg)
    reachable = False
    err = None
    if url:
        try:
            eng = get_archive_engine(cfg, force_refresh=True)
            with eng.connect() as conn:
                conn.execute(text("SELECT 1"))
            reachable = True
        except Exception as e:
            err = str(e)[:240]

    tables = build_tables_inventory(cfg, reachable=reachable)
    archived = [t for t in tables if t["status"] == "archived"]
    pending = [t for t in tables if t["status"] == "pending"]
    remaining = [t for t in tables if t["status"] == "not_selected"]

    return {
        "enabled": bool(cfg.get("enabled")),
        "retention_days": int(cfg.get("retention_days") or 60),
        "interval_days": int(cfg.get("interval_days") or 1),
        "host": cfg.get("host") or "",
        "port": int(cfg.get("port") or 3306),
        "user": cfg.get("user") or "",
        "password_set": bool(cfg.get("password") or os.getenv("ARCHIVE_DATABASE_URL")),
        "database": cfg.get("database") or "eap_pms_archive",
        "using_env_url": bool((os.getenv("ARCHIVE_DATABASE_URL") or "").strip()),
        "configured": bool(url),
        "reachable": reachable,
        "error": err,
        "hot_cutoff_date": hot_cutoff_date(cfg).isoformat(),
        "last_run_at": cfg.get("last_run_at"),
        "last_run_result": cfg.get("last_run_result"),
        "retention_presets": RETENTION_PRESETS,
        "tables": tables,
        "summary": {
            "archived_count": len(archived),
            "pending_count": len(pending),
            "remaining_count": len(remaining),
            "enabled_count": len([t for t in tables if t["enabled"]]),
            "archived_tables": [t["name"] for t in archived],
            "pending_tables": [t["name"] for t in pending],
            "remaining_tables": [t["name"] for t in remaining],
        },
    }


def _strip_fk_constraints(ddl: str) -> str:
    """Archive DB should not depend on live FK targets (machines/users may differ)."""
    ddl = re.sub(
        r",\s*CONSTRAINT\s+`[^`]+`\s+FOREIGN KEY\s*\([^)]+\)\s*REFERENCES\s+`[^`]+`\s*\([^)]+\)[^,)]*",
        "",
        ddl,
        flags=re.IGNORECASE,
    )
    ddl = re.sub(
        r",\s*FOREIGN KEY\s*\([^)]+\)\s*REFERENCES\s+`[^`]+`\s*\([^)]+\)[^,)]*",
        "",
        ddl,
        flags=re.IGNORECASE,
    )
    return ddl


def ensure_archive_schema(cfg: Optional[dict] = None) -> dict:
    """Create archive database (if missing) and mirror catalog tables from live."""
    cfg = cfg or _get_site_history_cfg()
    url = build_archive_url(cfg)
    if not url:
        raise RuntimeError(
            "Archive DB not configured. Set host/user/database in Database Management "
            "or ARCHIVE_DATABASE_URL in backend/.env"
        )

    host = (cfg.get("host") or "").strip()
    if host and not (os.getenv("ARCHIVE_DATABASE_URL") or "").strip():
        user = quote_plus(str(cfg.get("user") or ""))
        password = quote_plus(str(cfg.get("password") or ""))
        port = int(cfg.get("port") or 3306)
        dbname = str(cfg.get("database") or "eap_pms_archive")
        server_url = f"mysql+pymysql://{user}:{password}@{host}:{port}/"
        srv = create_engine(server_url, pool_pre_ping=True)
        try:
            with srv.begin() as conn:
                conn.execute(
                    text(
                        f"CREATE DATABASE IF NOT EXISTS `{dbname}` "
                        "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                    )
                )
        finally:
            srv.dispose()

    eng = get_archive_engine(cfg, force_refresh=True)
    created = []
    skipped = []
    # Create all catalog tables so enabling a low-growth table later needs no re-test
    table_names = list(TABLE_CATALOG.keys())
    with live_engine.connect() as live_conn, eng.begin() as arch_conn:
        for table in table_names:
            if not _live_table_exists(live_conn, table):
                skipped.append(table)
                continue
            exists = arch_conn.execute(
                text(
                    "SELECT COUNT(*) FROM information_schema.tables "
                    "WHERE table_schema = DATABASE() AND table_name = :t"
                ),
                {"t": table},
            ).scalar()
            if exists:
                continue
            row = live_conn.execute(text(f"SHOW CREATE TABLE `{table}`")).fetchone()
            if not row:
                skipped.append(table)
                continue
            ddl = _strip_fk_constraints(row[1])
            ddl = re.sub(
                r"^CREATE TABLE",
                "CREATE TABLE IF NOT EXISTS",
                ddl,
                count=1,
                flags=re.IGNORECASE,
            )
            arch_conn.execute(text(ddl))
            created.append(table)
    return {
        "ok": True,
        "created_tables": created,
        "skipped_missing_on_live": skipped,
        "database": cfg.get("database"),
    }


def _column_names(conn, table: str) -> list[str]:
    rows = conn.execute(text(f"SHOW COLUMNS FROM `{table}`")).fetchall()
    cols = []
    for r in rows:
        extra = (r[5] or "").lower() if len(r) > 5 else ""
        if "generated" in extra or "virtual" in extra:
            continue
        cols.append(r[0])
    return cols


def _archive_table_by_date(live_conn, arch_conn, table: str, date_col: str, cutoff, batch_size: int) -> dict:
    moved = 0
    cols = _column_names(live_conn, table)
    if not cols or "id" not in cols:
        return {"table": table, "moved": 0, "error": "no columns"}
    col_list = ", ".join(f"`{c}`" for c in cols)
    placeholders = ", ".join(f":{c}" for c in cols)

    while True:
        rows = live_conn.execute(
            text(
                f"SELECT {col_list} FROM `{table}` "
                f"WHERE `{date_col}` < :cutoff "
                f"ORDER BY `{date_col}`, id LIMIT :lim"
            ),
            {"cutoff": cutoff, "lim": batch_size},
        ).mappings().all()
        if not rows:
            break
        ids = []
        for row in rows:
            params = {c: row[c] for c in cols}
            arch_conn.execute(
                text(f"INSERT IGNORE INTO `{table}` ({col_list}) VALUES ({placeholders})"),
                params,
            )
            ids.append(int(row["id"]))
        arch_conn.commit()
        id_csv = ",".join(str(i) for i in ids)
        live_conn.execute(text(f"DELETE FROM `{table}` WHERE id IN ({id_csv})"))
        live_conn.commit()
        moved += len(ids)
        if len(rows) < batch_size:
            break
    return {"table": table, "moved": moved}


def _archive_oee_defect_for_old_entries(live_conn, arch_conn, cutoff: date, batch_size: int) -> dict:
    moved = 0
    cols = _column_names(live_conn, "oee_defect_log")
    if not cols:
        return {"table": "oee_defect_log", "moved": 0}
    col_list = ", ".join(f"`{c}`" for c in cols)
    placeholders = ", ".join(f":{c}" for c in cols)

    while True:
        rows = live_conn.execute(
            text(
                "SELECT d.* FROM oee_defect_log d "
                "INNER JOIN oee_entries e ON e.id = d.oee_entry_id "
                "WHERE e.entry_date < :cutoff "
                "ORDER BY d.id LIMIT :lim"
            ),
            {"cutoff": cutoff, "lim": batch_size},
        ).mappings().all()
        if not rows:
            break
        ids = []
        for row in rows:
            params = {c: row[c] for c in cols}
            arch_conn.execute(
                text(f"INSERT IGNORE INTO oee_defect_log ({col_list}) VALUES ({placeholders})"),
                params,
            )
            ids.append(int(row["id"]))
        arch_conn.commit()
        id_csv = ",".join(str(i) for i in ids)
        live_conn.execute(text(f"DELETE FROM oee_defect_log WHERE id IN ({id_csv})"))
        live_conn.commit()
        moved += len(ids)
        if len(rows) < batch_size:
            break
    return {"table": "oee_defect_log", "moved": moved}


def run_history_archive(db: Optional[Session] = None, *, triggered_by: str = "scheduled") -> dict:
    """Copy rows older than each table's retention window to archive DB, then delete from live."""
    close = False
    if db is None:
        db = SessionLocal()
        close = True
    cfg = _get_site_history_cfg(db)
    table_settings = resolve_table_settings(cfg)
    enabled = [t for t in table_settings if t["enabled"]]
    batch_size = int(cfg.get("batch_size") or 500)
    started = now_ist().isoformat(timespec="seconds")
    # Global cutoff kept for API compatibility (high-growth / default retention)
    cutoff = hot_cutoff_date(cfg)

    try:
        ensure_archive_schema(cfg)
        eng = get_archive_engine(cfg)
        results = []
        with live_engine.connect() as live_conn, eng.connect() as arch_conn:
            # Parent-linked defect rows first (uses oee_entries retention when both enabled)
            defect_cfg = next((t for t in enabled if t["name"] == "oee_defect_log"), None)
            oee_cfg = next((t for t in enabled if t["name"] == "oee_entries"), None)
            if defect_cfg:
                defect_ret = (oee_cfg or defect_cfg)["retention_days"]
                defect_cutoff = hot_cutoff_date(cfg, retention_days=defect_ret)
                try:
                    r = _archive_oee_defect_for_old_entries(
                        live_conn, arch_conn, defect_cutoff, batch_size
                    )
                    r["retention_days"] = defect_ret
                    r["cutoff_date"] = defect_cutoff.isoformat()
                    results.append(r)
                except Exception as table_exc:
                    results.append({
                        "table": "oee_defect_log",
                        "moved": 0,
                        "error": str(table_exc)[:200],
                    })

            for t in enabled:
                if t["name"] == "oee_defect_log":
                    continue
                date_col = t.get("date_column")
                if not date_col:
                    results.append({"table": t["name"], "moved": 0, "error": "no date column"})
                    continue
                try:
                    t_cutoff = hot_cutoff_date(cfg, retention_days=t["retention_days"])
                    r = _archive_table_by_date(
                        live_conn, arch_conn, t["name"], date_col, t_cutoff, batch_size
                    )
                    r["retention_days"] = t["retention_days"]
                    r["cutoff_date"] = t_cutoff.isoformat()
                    results.append(r)
                except Exception as table_exc:
                    results.append({
                        "table": t["name"],
                        "moved": 0,
                        "error": str(table_exc)[:200],
                    })

        total = sum(r.get("moved", 0) for r in results)
        summary = {
            "ok": True,
            "triggered_by": triggered_by,
            "cutoff_date": cutoff.isoformat(),
            "retention_days": int(cfg.get("retention_days") or 60),
            "moved_total": total,
            "tables": results,
            "enabled_tables": [t["name"] for t in enabled],
            "started_at": started,
            "finished_at": now_ist().isoformat(timespec="seconds"),
        }
        cfg["last_run_at"] = summary["finished_at"]
        cfg["last_run_result"] = summary
        _save_site_history_cfg(db, cfg)
        print(f"[HistoryArchive] Moved {total} row(s) from {len(enabled)} table(s) → archive DB")
        return summary
    except Exception as exc:
        err = {
            "ok": False,
            "triggered_by": triggered_by,
            "cutoff_date": cutoff.isoformat(),
            "error": str(exc)[:500],
            "started_at": started,
            "finished_at": now_ist().isoformat(timespec="seconds"),
        }
        cfg["last_run_at"] = err["finished_at"]
        cfg["last_run_result"] = err
        try:
            _save_site_history_cfg(db, cfg)
        except Exception:
            pass
        print(f"[HistoryArchive] FAILED: {exc}")
        raise
    finally:
        if close:
            db.close()


def _resolve_query_dates(
    entry_date: Optional[date],
    date_from: Optional[date],
    date_to: Optional[date],
    month: Optional[int],
    year: Optional[int],
) -> tuple[Optional[date], Optional[date]]:
    if entry_date:
        return entry_date, entry_date
    d_from, d_to = date_from, date_to
    if month and year:
        from calendar import monthrange

        d_from = date(year, month, 1)
        d_to = date(year, month, monthrange(year, month)[1])
    return d_from, d_to


def split_live_archive_ranges(
    date_from: Optional[date],
    date_to: Optional[date],
    cfg: Optional[dict] = None,
) -> dict:
    cfg = cfg or _get_site_history_cfg()
    oee_setting = next(
        (t for t in resolve_table_settings(cfg) if t["name"] == "oee_entries"),
        None,
    )
    cutoff = hot_cutoff_date(
        cfg,
        retention_days=(oee_setting["retention_days"] if oee_setting else None),
    )
    archive_on = (
        bool(cfg.get("enabled"))
        and bool(build_archive_url(cfg))
        and (oee_setting is None or oee_setting.get("enabled", True))
    )

    if not archive_on:
        return {
            "use_live": True,
            "use_archive": False,
            "cutoff": cutoff,
            "live_from": date_from,
            "live_to": date_to,
            "archive_from": None,
            "archive_to": None,
        }

    if date_from is None and date_to is None:
        return {
            "use_live": True,
            "use_archive": False,
            "cutoff": cutoff,
            "live_from": None,
            "live_to": None,
            "archive_from": None,
            "archive_to": None,
        }

    d_from = date_from or date(1970, 1, 1)
    d_to = date_to or date(9999, 12, 31)
    use_archive = d_from < cutoff
    use_live = d_to >= cutoff
    return {
        "use_live": use_live,
        "use_archive": use_archive,
        "cutoff": cutoff,
        "live_from": max(d_from, cutoff) if use_live else None,
        "live_to": d_to if use_live else None,
        "archive_from": d_from if use_archive else None,
        "archive_to": min(d_to, cutoff - timedelta(days=1)) if use_archive else None,
    }


def _apply_oee_filters(q, *, shift, station_no, machine_id, term, date_from, date_to, entry_date, month, year):
    from sqlalchemy import extract, or_

    if shift:
        q = q.filter(OEEEntry.shift == shift)
    if entry_date:
        q = q.filter(OEEEntry.entry_date == entry_date)
    if date_from:
        q = q.filter(OEEEntry.entry_date >= date_from)
    if date_to:
        q = q.filter(OEEEntry.entry_date <= date_to)
    if month:
        q = q.filter(extract("month", OEEEntry.entry_date) == month)
    if year:
        q = q.filter(extract("year", OEEEntry.entry_date) == year)
    if station_no:
        q = q.filter(OEEEntry.station_no == station_no)
    if machine_id:
        q = q.filter(OEEEntry.machine_id == machine_id)
    if term:
        like = f"%{term}%"
        q = q.filter(
            or_(
                OEEEntry.current_operation.like(like),
                OEEEntry.model_variant.like(like),
            )
        )
    return q


def _entries_to_dicts(db: Session, entries: list, source: str) -> list[dict]:
    dates = {e.entry_date for e in entries}
    plan_wo = {}
    try:
        plans = []
        if dates:
            plans = db.query(ProductionPlan).filter(ProductionPlan.plan_date.in_(dates)).all()
        wo_ids = {p.work_order_id for p in plans if p.work_order_id}
        wo_map = {}
        if wo_ids:
            wos = db.query(WorkOrder).filter(WorkOrder.id.in_(wo_ids)).all()
            wo_map = {w.id: w.work_order_no for w in wos}
        for p in plans:
            key = (p.machine_id, str(p.plan_date), p.shift, p.current_operation)
            if p.work_order_id and p.work_order_id in wo_map:
                plan_wo[key] = wo_map[p.work_order_id]
    except Exception:
        # Archive DB may not have production_plans / work_orders — OEE rows still return
        plan_wo = {}
    result = []
    for e in entries:
        d = {c.name: getattr(e, c.name) for c in e.__table__.columns}
        key = (e.machine_id, str(e.entry_date), e.shift, e.current_operation)
        d["work_order_no"] = plan_wo.get(key, "—")
        d["source"] = "manual"
        d["data_tier"] = source  # live | archive
        result.append(d)
    return result


def query_oee_entries_federated(
    live_db: Session,
    *,
    shift: Optional[str] = None,
    entry_date: Optional[date] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    month: Optional[int] = None,
    year: Optional[int] = None,
    station_no: Optional[int] = None,
    machine_id: Optional[int] = None,
    term: str = "",
) -> tuple[list[dict], dict]:
    cfg = _get_site_history_cfg(live_db)
    d_from, d_to = _resolve_query_dates(entry_date, date_from, date_to, month, year)
    # Prefer resolved calendar bounds over month/year extract when both set
    use_month = None if (d_from and d_to and month and year) else month
    use_year = None if (d_from and d_to and month and year) else year
    ranges = split_live_archive_ranges(d_from, d_to, cfg)
    meta = {
        "hot_cutoff_date": ranges["cutoff"].isoformat(),
        "sources": [],
        "archive_enabled": bool(cfg.get("enabled")) and bool(build_archive_url(cfg)),
    }
    rows: list[dict] = []

    def _fetch(db: Session, **bounds) -> list:
        q = db.query(OEEEntry)
        q = _apply_oee_filters(
            q,
            shift=shift,
            station_no=station_no,
            machine_id=machine_id,
            term=term,
            **bounds,
        )
        return q.order_by(OEEEntry.entry_date.desc(), OEEEntry.shift).all()

    need_live = ranges["use_live"]
    need_arch = ranges["use_archive"]
    if entry_date is not None:
        need_live = entry_date >= ranges["cutoff"] or not need_arch
        need_arch = entry_date < ranges["cutoff"] and bool(cfg.get("enabled")) and bool(build_archive_url(cfg))

    if need_live:
        if entry_date is not None:
            live_entries = _fetch(
                live_db,
                date_from=None,
                date_to=None,
                entry_date=entry_date,
                month=None,
                year=None,
            )
        else:
            live_entries = _fetch(
                live_db,
                date_from=ranges["live_from"],
                date_to=ranges["live_to"],
                entry_date=None,
                month=use_month,
                year=use_year,
            )
        rows.extend(_entries_to_dicts(live_db, live_entries, "live"))
        meta["sources"].append("live")

    if need_arch:
        arch_db = None
        try:
            arch_db = get_archive_session(cfg)
            if arch_db is not None:
                if entry_date is not None:
                    arch_entries = _fetch(
                        arch_db,
                        date_from=None,
                        date_to=None,
                        entry_date=entry_date,
                        month=None,
                        year=None,
                    )
                else:
                    arch_entries = _fetch(
                        arch_db,
                        date_from=ranges["archive_from"],
                        date_to=ranges["archive_to"],
                        entry_date=None,
                        month=None,
                        year=None,
                    )
                rows.extend(_entries_to_dicts(arch_db, arch_entries, "archive"))
                meta["sources"].append("archive")
        except Exception as exc:
            print(f"[Archive] OEE federation skipped (unreachable archive DB): {exc}")
        finally:
            if arch_db is not None:
                try:
                    arch_db.close()
                except Exception:
                    pass

    by_id: dict[Any, dict] = {}
    for r in rows:
        rid = r.get("id")
        prev = by_id.get(rid)
        if prev and prev.get("data_tier") == "live":
            continue
        by_id[rid] = r
    merged = list(by_id.values())
    merged.sort(key=lambda x: (str(x.get("entry_date") or ""), x.get("shift") or ""), reverse=True)
    return merged, meta


def summarize_oee_dicts(entries: list[dict]) -> dict:
    if not entries:
        return {
            "avg_ar": 0,
            "avg_pr": 0,
            "avg_qr": 0,
            "avg_oee": 0,
            "total_actual": 0,
            "total_accp": 0,
            "total_defect": 0,
            "count": 0,
        }
    n = len(entries)
    return {
        "avg_ar": round(sum(float(e.get("ar") or 0) for e in entries) / n, 2),
        "avg_pr": round(sum(float(e.get("pr") or 0) for e in entries) / n, 2),
        "avg_qr": round(sum(float(e.get("qr") or 0) for e in entries) / n, 2),
        "avg_oee": round(sum(float(e.get("oee") or 0) for e in entries) / n, 2),
        "total_actual": sum(int(e.get("actual_qty") or 0) for e in entries),
        "total_accp": sum(int(e.get("accp_qty") or 0) for e in entries),
        "total_defect": sum(int(e.get("defect_qty") or 0) for e in entries),
        "count": n,
    }
