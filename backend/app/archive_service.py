"""
Database backup & archive service.

Primary method : mysqldump / mysql CLI  (full-fidelity SQL dump)
Fallback       : SQLAlchemy row-level JSON export (portable, always works)

Backups are stored under  <project>/backups/  with timestamped filenames.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import shutil
import subprocess
import threading
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import unquote, urlparse

from sqlalchemy import text
from sqlalchemy.orm import Session

from .models import SessionLocal, SiteConfig, engine
from .upload_limits import MAX_BACKUP_BYTES

BACKUP_DIR = Path(__file__).resolve().parent.parent / "backups"
BACKUP_DIR.mkdir(parents=True, exist_ok=True)
_DB_CONFIG_PATH = Path(__file__).resolve().parent.parent.parent / "database" / "db.config.json"
_BACKUP_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+\.(sql|json)\.gz$")
_ZIP_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+\.zip$")
_GZIP_MAGIC = b"\x1f\x8b"
_MAX_META_BYTES = 64 * 1024
_MAX_ZIP_MEMBERS = 8
_SITE_INSERT_RE = re.compile(
    r"INSERT INTO `site_config`[^;]*?VALUES\s*\(\s*\d+\s*,\s*'((?:\\.|[^'\\])*)'",
    re.IGNORECASE | re.DOTALL,
)
_restore_lock = threading.Lock()
_restore_state = {
    "active": False,
    "done": False,
    "filename": None,
    "pct": 0,
    "phase": "",
    "error": None,
    "result": None,
}


class RestoreNeedsConfirmation(Exception):
    """Live site config differs from backup; caller must confirm before restore."""

    def __init__(self, preview: dict):
        self.preview = preview
        super().__init__("CONFIG_DIFFERS")

TABLES_TO_BACKUP = [
    "stations", "machines", "users", "site_config",
    "parts", "part_documents", "part_document_history", "part_qc_parameters",
    "tool_stocks", "tool_events", "tool_alerts",
    "work_orders", "production_plans", "oee_entries", "oee_defect_log",
    "model_change_requests", "breakdown_tickets",
    "machine_status_log", "machine_kpi_log",
    "deviation_alert_log", "deviation_escalation_cases",
    "email_groups", "email_recipients", "email_schedules",
    "email_smtp_config", "email_logs",
    "qc_inspection_reports",
]


def _parse_db_url() -> dict:
    """Extract host, port, user, password, dbname from DATABASE_URL / db.config.json.

    Passwords in DATABASE_URL are URL-encoded by DbConfig.ps1 (EscapeDataString).
    They must be unquoted before passing to mysqldump — SQLAlchemy does this
    automatically, but urlparse alone does not.
    """
    # Prefer plain credentials from db.config.json when available
    if _DB_CONFIG_PATH.exists():
        try:
            with open(_DB_CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            if cfg.get("database") and cfg.get("password") is not None:
                return {
                    "host": cfg.get("host") or "localhost",
                    "port": int(cfg.get("port") or 3306),
                    "user": cfg.get("user") or "root",
                    "password": str(cfg.get("password") or ""),
                    "database": str(cfg["database"]),
                }
        except Exception:
            pass

    raw = os.getenv("DATABASE_URL", "")
    if not raw:
        raise RuntimeError("DATABASE_URL not set")
    parsed = urlparse(raw.replace("mysql+pymysql://", "mysql://"))
    return {
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 3306,
        "user": unquote(parsed.username or "root"),
        "password": unquote(parsed.password or ""),
        "database": (parsed.path or "").lstrip("/"),
    }


def _mysqldump_available() -> bool:
    try:
        subprocess.run(
            ["mysqldump", "--version"],
            capture_output=True, timeout=5,
        )
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _mysql_available() -> bool:
    try:
        subprocess.run(
            ["mysql", "--version"],
            capture_output=True, timeout=5,
        )
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def create_backup(method: str = "auto", triggered_by: str = "manual") -> dict:
    """
    Create a database backup.

    method: "auto" (try mysqldump first, then json), "sql", "json"
    triggered_by: "manual" | "scheduled"
    Returns metadata dict about the created backup.
    """
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    if method == "auto":
        if _mysqldump_available():
            try:
                return _backup_sql(ts, triggered_by)
            except Exception as exc:
                print(f"[Archive] mysqldump failed, falling back to JSON: {exc}")
                return _backup_json(ts, triggered_by)
        return _backup_json(ts, triggered_by)

    if method == "sql":
        return _backup_sql(ts, triggered_by)
    return _backup_json(ts, triggered_by)


def _write_mysql_defaults(db_info: dict) -> Path:
    """Write a temporary my.cnf so password is not passed on the command line."""
    import tempfile
    # Use 127.0.0.1 instead of localhost to force TCP (avoids Unix socket auth issues)
    host = db_info["host"]
    if host in ("localhost", "::1"):
        host = "127.0.0.1"
    fd, path = tempfile.mkstemp(prefix="pms_mysql_", suffix=".cnf")
    os.close(fd)
    content = (
        "[client]\n"
        f"host={host}\n"
        f"port={db_info['port']}\n"
        f"user={db_info['user']}\n"
        f"password={db_info['password']}\n"
    )
    Path(path).write_text(content, encoding="utf-8")
    return Path(path)


def _backup_sql(ts: str, triggered_by: str) -> dict:
    """Full mysqldump → gzipped .sql.gz file."""
    db_info = _parse_db_url()
    filename = f"pms_backup_{ts}.sql.gz"
    filepath = BACKUP_DIR / filename
    defaults_file = _write_mysql_defaults(db_info)

    try:
        cmd = [
            "mysqldump",
            f"--defaults-extra-file={defaults_file}",
            "--single-transaction",
            "--routines",
            "--triggers",
            "--add-drop-table",
            db_info["database"],
        ]

        proc = subprocess.run(cmd, capture_output=True, timeout=300)
        if proc.returncode != 0:
            raise RuntimeError(f"mysqldump failed: {proc.stderr.decode('utf-8', errors='replace')}")

        with gzip.open(filepath, "wb") as f:
            f.write(proc.stdout)
    finally:
        try:
            defaults_file.unlink(missing_ok=True)
        except Exception:
            pass

    meta = _build_meta(filename, filepath, "sql", triggered_by)
    _write_meta(filename, meta)
    return meta


def _backup_json(ts: str, triggered_by: str) -> dict:
    """SQLAlchemy-based JSON export of all tables → gzipped .json.gz file."""
    filename = f"pms_backup_{ts}.json.gz"
    filepath = BACKUP_DIR / filename

    db: Session = SessionLocal()
    try:
        data: dict[str, list] = {}
        for table in TABLES_TO_BACKUP:
            try:
                rows = db.execute(text(f"SELECT * FROM `{table}`")).mappings().all()
                data[table] = [_row_to_dict(r) for r in rows]
            except Exception:
                data[table] = []

        with gzip.open(filepath, "wt", encoding="utf-8") as f:
            json.dump(data, f, default=str, ensure_ascii=False)
    finally:
        db.close()

    meta = _build_meta(filename, filepath, "json", triggered_by)
    _write_meta(filename, meta)
    return meta


def _row_to_dict(row) -> dict:
    d = dict(row)
    for k, v in d.items():
        if isinstance(v, (datetime,)):
            d[k] = v.isoformat()
        elif isinstance(v, bytes):
            d[k] = v.decode("utf-8", errors="replace")
    return d


def _build_meta(filename: str, filepath: Path, method: str, triggered_by: str) -> dict:
    size_bytes = filepath.stat().st_size
    return {
        "filename": filename,
        "meta_filename": f"{filename}.meta.json",
        "method": method,
        "triggered_by": triggered_by,
        "created_at": datetime.now().isoformat(),
        "size_bytes": size_bytes,
        "size_display": _human_size(size_bytes),
    }


def _write_meta(filename: str, meta: dict):
    meta_path = BACKUP_DIR / f"{filename}.meta.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, default=str)


def _human_size(b: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} TB"


def list_backups() -> list[dict]:
    """List all available backups, newest first."""
    backups = []
    for meta_file in sorted(BACKUP_DIR.glob("*.meta.json"), reverse=True):
        try:
            with open(meta_file, "r", encoding="utf-8") as f:
                meta = json.load(f)
            backup_file = BACKUP_DIR / meta["filename"]
            if backup_file.exists():
                meta["size_bytes"] = backup_file.stat().st_size
                meta["size_display"] = _human_size(meta["size_bytes"])
                backups.append(meta)
        except Exception:
            continue
    return backups


def safe_backup_filename(filename: str) -> Optional[str]:
    """Return a basename that is a PMS dump, or None if unsafe/invalid."""
    name = Path(str(filename or "")).name.lower()
    if not _BACKUP_NAME_RE.fullmatch(name):
        return None
    try:
        (BACKUP_DIR / name).resolve().relative_to(BACKUP_DIR.resolve())
    except ValueError:
        return None
    return name


def unique_backup_name(filename: str) -> str:
    """Keep the original dump name when free; otherwise append _imported_<ts>."""
    name = safe_backup_filename(filename)
    if not name:
        raise ValueError("Upload a PMS backup file ending in .sql.gz or .json.gz")
    dest = BACKUP_DIR / name
    meta = BACKUP_DIR / f"{name}.meta.json"
    if not dest.exists() and not meta.exists():
        return name
    if name.endswith(".sql.gz"):
        stem, suffix = name[:-7], ".sql.gz"
    else:
        stem, suffix = name[:-8], ".json.gz"
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    candidate = f"{stem}_imported_{ts}{suffix}"
    n = 1
    while (BACKUP_DIR / candidate).exists() or (BACKUP_DIR / f"{candidate}.meta.json").exists():
        candidate = f"{stem}_imported_{ts}_{n}{suffix}"
        n += 1
    return candidate


def validate_backup_payload(filepath: Path, method: str) -> None:
    """Reject non-gzip or non-dump uploads before they appear in Backup History."""
    with filepath.open("rb") as fh:
        magic = fh.read(2)
    if magic != _GZIP_MAGIC:
        raise ValueError("File is not a gzip-compressed PMS backup")
    try:
        with gzip.open(filepath, "rb") as gz:
            sample = gz.read(4096)
    except Exception as exc:
        raise ValueError("File is not a valid gzip-compressed PMS backup") from exc
    if not sample:
        raise ValueError("Backup file is empty")
    text = sample.decode("utf-8", errors="replace").lstrip()
    if method == "json":
        if not text.startswith("{"):
            raise ValueError("JSON backup must start with '{'")
        return
    upper = text.upper()
    if not any(tok in upper for tok in ("CREATE TABLE", "INSERT INTO", "DROP TABLE", "MYSQLDUMP", "--")):
        raise ValueError("SQL backup content is not a valid dump")


def register_backup_file(filename: str, method: str, triggered_by: str) -> dict:
    """Write sidecar metadata so an on-disk dump appears in Backup History."""
    name = safe_backup_filename(filename)
    if not name:
        raise ValueError("Invalid backup filename")
    filepath = BACKUP_DIR / name
    if not filepath.exists():
        raise FileNotFoundError(f"Backup file not found: {name}")
    meta = _build_meta(name, filepath, method, triggered_by)
    _write_meta(name, meta)
    return meta


def safe_meta_filename(filename: str) -> Optional[str]:
    """Return basename for a dump sidecar, or None if unsafe/invalid."""
    name = Path(str(filename or "")).name.lower()
    if not name.endswith(".meta.json"):
        return None
    dump = safe_backup_filename(name[:-10])
    if not dump:
        return None
    return f"{dump}.meta.json"


def classify_backup_upload_name(filename: str) -> Optional[str]:
    """Classify an upload as dump, meta, or zip."""
    name = Path(str(filename or "")).name.lower()
    if safe_meta_filename(name):
        return "meta"
    if safe_backup_filename(name):
        return "dump"
    if _ZIP_NAME_RE.fullmatch(name):
        return "zip"
    return None


def _dump_method(name: str) -> str:
    return "sql" if name.endswith(".sql.gz") else "json"


def _bundle_zip_name(dump_name: str) -> str:
    if dump_name.endswith(".sql.gz"):
        return f"{dump_name[:-7]}.zip"
    if dump_name.endswith(".json.gz"):
        return f"{dump_name[:-8]}.zip"
    return f"{dump_name}.zip"


def _parse_uploaded_meta(raw: bytes, dump_name: str, method: str) -> dict:
    if len(raw) > _MAX_META_BYTES:
        raise ValueError("Metadata file is too large")
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise ValueError("Metadata file is not valid JSON") from exc
    if not isinstance(data, dict):
        raise ValueError("Metadata file must be a JSON object")
    created_at = data.get("created_at")
    if not isinstance(created_at, str) or not created_at.strip():
        created_at = datetime.now().isoformat()
    src_method = str(data.get("method") or method).lower()
    if src_method not in ("sql", "json"):
        src_method = method
    if src_method != method:
        raise ValueError(
            f"Metadata method '{src_method}' does not match dump type '{method}'"
        )
    filepath = BACKUP_DIR / dump_name
    size_bytes = filepath.stat().st_size if filepath.exists() else 0
    return {
        "filename": dump_name,
        "meta_filename": f"{dump_name}.meta.json",
        "method": method,
        "triggered_by": "uploaded",
        "created_at": created_at.strip(),
        "size_bytes": size_bytes,
        "size_display": _human_size(size_bytes),
    }


def _zip_member_basename(info: zipfile.ZipInfo) -> str:
    raw = (info.filename or "").replace("\\", "/")
    parts = [p for p in raw.split("/") if p and p != "."]
    if not parts or ".." in parts:
        raise ValueError("Zip contains an unsafe path")
    return parts[-1].lower()


def _extract_backup_zip(zip_path: Path) -> list[tuple[str, Path]]:
    extracted: list[tuple[str, Path]] = []
    try:
        with zipfile.ZipFile(zip_path) as zf:
            infos = [item for item in zf.infolist() if not item.is_dir()]
            if not infos:
                raise ValueError("Zip is empty")
            if len(infos) > _MAX_ZIP_MEMBERS:
                raise ValueError("Zip has too many files")
            for info in infos:
                name = _zip_member_basename(info)
                kind = classify_backup_upload_name(name)
                if kind not in ("dump", "meta"):
                    continue
                limit = _MAX_META_BYTES if kind == "meta" else MAX_BACKUP_BYTES
                if info.file_size > limit:
                    raise ValueError(f"Zip member {name} is too large")
                target = BACKUP_DIR / f".extract_{uuid.uuid4().hex}_{name}"
                copied = 0
                with zf.open(info, "r") as src, target.open("wb") as dest:
                    while True:
                        chunk = src.read(64 * 1024)
                        if not chunk:
                            break
                        copied += len(chunk)
                        if copied > limit:
                            raise ValueError(f"Zip member {name} is too large")
                        dest.write(chunk)
                extracted.append((name, target))
    except zipfile.BadZipFile as exc:
        for _, path in extracted:
            path.unlink(missing_ok=True)
        raise ValueError("File is not a valid zip backup bundle") from exc
    except Exception:
        for _, path in extracted:
            path.unlink(missing_ok=True)
        raise
    if not any(classify_backup_upload_name(name) == "dump" for name, _ in extracted):
        for _, path in extracted:
            path.unlink(missing_ok=True)
        raise ValueError("Zip must contain a .sql.gz or .json.gz dump")
    return extracted


def _attach_uploaded_meta(meta_name: str, meta_path: Path) -> dict:
    meta_basename = Path(meta_name).name.lower()
    dump_name = (
        safe_backup_filename(meta_basename[:-10])
        if meta_basename.endswith(".meta.json")
        else None
    )
    if not dump_name:
        raise ValueError("Metadata file name must match a .sql.gz or .json.gz dump")
    fp = get_backup_path(dump_name)
    if not fp:
        raise ValueError(
            f"Dump '{dump_name}' is not in Backup History. "
            "Upload the .sql.gz / .json.gz first, or select both files together."
        )
    method = _dump_method(fp.name)
    meta = _parse_uploaded_meta(meta_path.read_bytes(), fp.name, method)
    _write_meta(fp.name, meta)
    return meta


def import_uploaded_backup_files(items: list[tuple[str, Path]]) -> dict:
    """Import dump, optional sidecar meta, and/or a zip bundle into Backup History."""
    leftovers: set[Path] = {path for _, path in items}
    extracted_paths: list[Path] = []
    dumps: list[tuple[str, Path]] = []
    metas: list[tuple[str, Path]] = []
    try:
        for original, path in items:
            kind = classify_backup_upload_name(original)
            if kind == "zip":
                for inner_name, inner_path in _extract_backup_zip(path):
                    extracted_paths.append(inner_path)
                    leftovers.add(inner_path)
                    inner_kind = classify_backup_upload_name(inner_name)
                    if inner_kind == "dump":
                        dumps.append((inner_name, inner_path))
                    elif inner_kind == "meta":
                        metas.append((inner_name, inner_path))
            elif kind == "dump":
                dumps.append((original, path))
            elif kind == "meta":
                metas.append((original, path))
            else:
                raise ValueError(
                    "Upload a .sql.gz / .json.gz dump, its .meta.json sidecar, "
                    "or a zip containing both"
                )

        if len(dumps) > 1:
            raise ValueError("Upload one dump (or one zip) at a time")
        if len(metas) > 1:
            raise ValueError("Upload at most one .meta.json with the dump")
        if not dumps:
            if not metas:
                raise ValueError(
                    "Upload a PMS backup ending in .sql.gz, .json.gz, or .zip"
                )
            return _attach_uploaded_meta(metas[0][0], metas[0][1])

        original_name, dump_path = dumps[0]
        stored_name = unique_backup_name(original_name)
        method = _dump_method(stored_name)
        validate_backup_payload(dump_path, method)
        dest = BACKUP_DIR / stored_name
        shutil.move(str(dump_path), str(dest))
        leftovers.discard(dump_path)
        if metas:
            meta = _parse_uploaded_meta(metas[0][1].read_bytes(), stored_name, method)
            _write_meta(stored_name, meta)
            return meta
        return register_backup_file(stored_name, method, "uploaded")
    finally:
        for path in leftovers | set(extracted_paths):
            if path.exists() and path.name.startswith("."):
                path.unlink(missing_ok=True)


def unlink_quietly(path: Path) -> None:
    """Best-effort delete; Windows may still have the download handle open."""
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        pass


def build_backup_bundle(filename: str) -> tuple[Path, str]:
    """Zip dump + .meta.json for IPC-to-IPC transfer."""
    fp = get_backup_path(filename)
    if not fp:
        raise FileNotFoundError(f"Backup file not found: {filename}")
    meta_fp = BACKUP_DIR / f"{fp.name}.meta.json"
    if not meta_fp.exists():
        register_backup_file(fp.name, _dump_method(fp.name), "manual")
    bundle_name = _bundle_zip_name(fp.name)
    tmp = BACKUP_DIR / f".bundle_{uuid.uuid4().hex}_{bundle_name}"
    try:
        with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_STORED) as zf:
            zf.write(fp, arcname=fp.name)
            zf.write(meta_fp, arcname=meta_fp.name)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    return tmp, bundle_name


def get_backup_path(filename: str) -> Optional[Path]:
    """Return full path if backup file exists."""
    name = safe_backup_filename(filename)
    if not name:
        return None
    fp = BACKUP_DIR / name
    if fp.exists() and fp.is_file():
        return fp
    return None


def delete_backup(filename: str) -> bool:
    """Delete a backup and its metadata."""
    name = safe_backup_filename(filename)
    if not name:
        return False
    fp = BACKUP_DIR / name
    meta_fp = BACKUP_DIR / f"{name}.meta.json"
    deleted = False
    if fp.exists():
        fp.unlink()
        deleted = True
    if meta_fp.exists():
        meta_fp.unlink()
        deleted = True
    return deleted


def get_restore_progress() -> dict:
    with _restore_lock:
        return dict(_restore_state)


def _set_restore_progress(**kwargs) -> None:
    with _restore_lock:
        _restore_state.update(kwargs)


def _parse_cfg(raw) -> dict:
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        data = json.loads(raw)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _config_fingerprint(cfg: dict) -> dict:
    factory = cfg.get("factory") if isinstance(cfg.get("factory"), dict) else {}
    factories = factory.get("factories") if isinstance(factory.get("factories"), list) else []
    shifts = cfg.get("shifts") if isinstance(cfg.get("shifts"), list) else []
    hist = cfg.get("history_archive") if isinstance(cfg.get("history_archive"), dict) else {}
    dc = cfg.get("data_capture") if isinstance(cfg.get("data_capture"), dict) else {}
    return {
        "siteTitle": str(factory.get("siteTitle") or ""),
        "factories": [
            str(f.get("name") or f.get("id") or "")
            for f in factories if isinstance(f, dict)
        ],
        "shifts": [
            {
                "id": s.get("id"),
                "name": s.get("name"),
                "start": s.get("start"),
                "end": s.get("end"),
                "enabled": bool(s.get("enabled", True)),
            }
            for s in shifts if isinstance(s, dict)
        ],
        "dataCaptureMode": str(dc.get("mode") or "auto"),
        "historyArchiveEnabled": bool(hist.get("enabled")),
        "historyArchiveHost": str(hist.get("host") or ""),
    }


def _sql_unescape(value: str) -> str:
    return (
        value.replace("\\\\", "\\")
        .replace("\\'", "'")
        .replace('\\"', '"')
        .replace("\\n", "\n")
        .replace("\\r", "\r")
        .replace("\\t", "\t")
        .replace("''", "'")
    )


def _extract_site_config_from_sql_gz(filepath: Path) -> Optional[dict]:
    buf = ""
    with gzip.open(filepath, "rt", encoding="utf-8", errors="replace") as fh:
        while True:
            chunk = fh.read(256 * 1024)
            if not chunk:
                break
            buf += chunk
            match = _SITE_INSERT_RE.search(buf)
            if match:
                try:
                    return _parse_cfg(_sql_unescape(match.group(1)))
                except Exception:
                    return None
            if len(buf) > 2 * 1024 * 1024:
                buf = buf[-512 * 1024:]
    return None


def _extract_site_config_from_json_gz(filepath: Path) -> Optional[dict]:
    with gzip.open(filepath, "rt", encoding="utf-8") as fh:
        data = json.load(fh)
    rows = data.get("site_config") if isinstance(data, dict) else None
    if not rows:
        return None
    raw = rows[0].get("config_json") if isinstance(rows[0], dict) else None
    return _parse_cfg(raw)


def _live_config_fingerprint() -> dict:
    db = SessionLocal()
    try:
        row = db.query(SiteConfig).first()
        return _config_fingerprint(_parse_cfg(row.config_json if row else None))
    except Exception:
        return _config_fingerprint({})
    finally:
        db.close()


def _diff_config_messages(live: dict, backup: dict) -> list[str]:
    changes = []
    if (live.get("siteTitle") or "") != (backup.get("siteTitle") or ""):
        changes.append(
            f"Site title: '{live.get('siteTitle') or '—'}' → '{backup.get('siteTitle') or '—'}'"
        )
    if live.get("factories") != backup.get("factories"):
        changes.append(
            f"Factories: {', '.join(live.get('factories') or []) or '—'} → "
            f"{', '.join(backup.get('factories') or []) or '—'}"
        )
    if live.get("shifts") != backup.get("shifts"):
        live_shifts = ", ".join(
            f"{s.get('id')} {s.get('start')}-{s.get('end')}"
            for s in (live.get("shifts") or [])
        ) or "—"
        bak_shifts = ", ".join(
            f"{s.get('id')} {s.get('start')}-{s.get('end')}"
            for s in (backup.get("shifts") or [])
        ) or "—"
        changes.append(f"Shifts: {live_shifts} → {bak_shifts}")
    if (live.get("dataCaptureMode") or "auto") != (backup.get("dataCaptureMode") or "auto"):
        changes.append(
            f"Data capture: {live.get('dataCaptureMode')} → {backup.get('dataCaptureMode')}"
        )
    if live.get("historyArchiveEnabled") != backup.get("historyArchiveEnabled") or (
        live.get("historyArchiveHost") != backup.get("historyArchiveHost")
    ):
        changes.append(
            "History archive host/settings differ (live archive config will be replaced)"
        )
    return changes


def preview_restore(filename: str) -> dict:
    """Compare live site config with the backup without changing the database."""
    fp = get_backup_path(filename)
    if not fp:
        raise FileNotFoundError(f"Backup file not found: {filename}")
    method = "sql" if fp.name.endswith(".sql.gz") else "json"
    live_fp = _live_config_fingerprint()
    backup_cfg = None
    warning = None
    try:
        if method == "sql":
            backup_cfg = _extract_site_config_from_sql_gz(fp)
        else:
            backup_cfg = _extract_site_config_from_json_gz(fp)
    except Exception as exc:
        warning = f"Could not read backup configuration: {exc}"
    backup_fp = _config_fingerprint(backup_cfg or {})
    changes = _diff_config_messages(live_fp, backup_fp) if backup_cfg is not None else []
    if backup_cfg is None:
        warning = warning or "Could not read site configuration from this backup"
        changes = ["Backup configuration could not be compared with live settings"]
    return {
        "filename": fp.name,
        "method": method,
        "config_differs": bool(changes),
        "live": live_fp,
        "backup": backup_fp if backup_cfg is not None else None,
        "changes": changes,
        "warning": warning,
    }


def restore_backup(filename: str, *, confirm_config_diff: bool = False) -> dict:
    """Start restore in a background thread so progress polling is not blocked."""
    fp = get_backup_path(filename)
    if not fp:
        raise FileNotFoundError(f"Backup file not found: {filename}")

    preview = preview_restore(filename)
    if preview.get("config_differs") and not confirm_config_diff:
        raise RestoreNeedsConfirmation(preview)

    with _restore_lock:
        if _restore_state.get("active"):
            raise RuntimeError("A restore is already running")
        _restore_state.update({
            "active": True,
            "done": False,
            "filename": fp.name,
            "pct": 1,
            "phase": "Starting restore…",
            "error": None,
            "result": None,
        })

    threading.Thread(
        target=_execute_restore,
        args=(fp, preview),
        name="pms-restore",
        daemon=True,
    ).start()
    return {"status": "started", "filename": fp.name}


def _kill_other_db_sessions() -> None:
    """Drop other MySQL sessions on this database so DROP TABLE is not blocked."""
    try:
        import pymysql
    except Exception:
        return
    info = _parse_db_url()
    host = info["host"]
    if host in ("localhost", "::1"):
        host = "127.0.0.1"
    conn = pymysql.connect(
        host=host,
        port=int(info["port"] or 3306),
        user=info["user"],
        password=info["password"],
        database=info["database"],
        connect_timeout=5,
        autocommit=True,
    )
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT CONNECTION_ID()")
            me = cur.fetchone()[0]
            cur.execute(
                "SELECT ID FROM information_schema.PROCESSLIST WHERE ID <> %s AND `DB` = %s",
                (me, info["database"]),
            )
            pids = [int(row[0]) for row in cur.fetchall() if row and row[0] != me]
            for pid in pids:
                try:
                    cur.execute(f"KILL {pid}")
                except Exception:
                    pass
    finally:
        conn.close()


def _prepare_db_for_restore() -> None:
    try:
        engine.dispose()
    except Exception:
        pass
    try:
        _kill_other_db_sessions()
    except Exception:
        pass


def _execute_restore(fp: Path, preview: dict) -> None:
    def progress(pct: int, phase: str) -> None:
        _set_restore_progress(pct=max(0, min(100, int(pct))), phase=phase)

    try:
        progress(5, "Preparing restore…")
        _prepare_db_for_restore()
        progress(8, "Restoring database…")
        if fp.name.endswith(".sql.gz"):
            result = _restore_sql(fp, progress)
        elif fp.name.endswith(".json.gz"):
            result = _restore_json(fp, progress)
        else:
            raise ValueError(f"Unknown backup format: {fp.name}")
        try:
            engine.dispose()
        except Exception:
            pass
        progress(100, "Restore complete")
        result["config_replaced"] = bool(preview.get("config_differs"))
        _set_restore_progress(
            active=False, done=True, pct=100, phase="Restore complete",
            error=None, result=result,
        )
    except Exception as exc:
        _set_restore_progress(
            active=False, done=True, error=str(exc), phase="Restore failed",
        )


def _gzip_uncompressed_size(filepath: Path) -> int:
    try:
        with filepath.open("rb") as fh:
            fh.seek(-4, 2)
            return int.from_bytes(fh.read(4), "little") or filepath.stat().st_size
    except Exception:
        return max(filepath.stat().st_size, 1)


def _restore_sql(filepath: Path, progress: Optional[Callable[[int, str], None]] = None) -> dict:
    """Restore from a mysqldump .sql.gz file."""
    if not _mysql_available():
        raise RuntimeError("mysql CLI not found — cannot restore SQL backup")

    db_info = _parse_db_url()
    defaults_file = _write_mysql_defaults(db_info)
    report = progress or (lambda _pct, _phase: None)
    report(8, "Reading backup…")
    total = max(_gzip_uncompressed_size(filepath), 1)

    try:
        cmd = [
            "mysql",
            f"--defaults-extra-file={defaults_file}",
            db_info["database"],
        ]
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        sent = 0
        stderr_chunks: list[bytes] = []

        def _drain_stderr() -> None:
            try:
                if proc.stderr:
                    stderr_chunks.append(proc.stderr.read() or b"")
            except Exception:
                pass

        drain = threading.Thread(target=_drain_stderr, daemon=True)
        drain.start()
        try:
            with gzip.open(filepath, "rb") as gz:
                while True:
                    chunk = gz.read(256 * 1024)
                    if not chunk:
                        break
                    if proc.poll() is not None:
                        break
                    proc.stdin.write(chunk)
                    proc.stdin.flush()
                    sent += len(chunk)
                    pct = 10 + int(80 * min(sent, total) / total)
                    report(min(90, pct), "Restoring database…")
            if proc.stdin:
                proc.stdin.close()
            report(92, "Finalizing MySQL restore…")
            proc.wait(timeout=600)
            drain.join(timeout=10)
            stderr = b"".join(stderr_chunks)
        except Exception:
            proc.kill()
            drain.join(timeout=2)
            raise
        if proc.returncode != 0:
            raise RuntimeError(
                f"mysql restore failed: {(stderr or b'').decode('utf-8', errors='replace')}"
            )
    finally:
        try:
            defaults_file.unlink(missing_ok=True)
        except Exception:
            pass

    report(98, "Refreshing connections…")
    return {
        "status": "restored",
        "method": "sql",
        "filename": filepath.name,
        "restored_at": datetime.now().isoformat(),
    }


def _restore_json(filepath: Path, progress: Optional[Callable[[int, str], None]] = None) -> dict:
    """Restore from a JSON .json.gz backup — truncate + re-insert."""
    report = progress or (lambda _pct, _phase: None)
    report(10, "Reading JSON backup…")
    with gzip.open(filepath, "rt", encoding="utf-8") as f:
        data = json.load(f)

    tables_with_rows = [table for table in TABLES_TO_BACKUP if data.get(table)]
    total_tables = max(len(tables_with_rows), 1)

    db: Session = SessionLocal()
    try:
        db.execute(text("SET FOREIGN_KEY_CHECKS = 0"))
        restored_tables = []
        report(20, "Clearing live tables…")

        for table in reversed(TABLES_TO_BACKUP):
            if table in data:
                try:
                    db.execute(text(f"TRUNCATE TABLE `{table}`"))
                except Exception:
                    db.execute(text(f"DELETE FROM `{table}`"))

        for table in TABLES_TO_BACKUP:
            rows = data.get(table, [])
            if not rows:
                continue
            for row in rows:
                cols = ", ".join(f"`{k}`" for k in row.keys())
                placeholders = ", ".join(f":{k}" for k in row.keys())
                stmt = text(f"INSERT INTO `{table}` ({cols}) VALUES ({placeholders})")
                db.execute(stmt, row)
            restored_tables.append(f"{table} ({len(rows)} rows)")
            pct = 25 + int(70 * min(len(restored_tables), total_tables) / total_tables)
            report(min(95, pct), f"Restoring {table}…")

        db.execute(text("SET FOREIGN_KEY_CHECKS = 1"))
        db.commit()
    except Exception as exc:
        db.rollback()
        raise RuntimeError(f"JSON restore failed: {exc}") from exc
    finally:
        db.close()

    return {
        "status": "restored",
        "method": "json",
        "filename": filepath.name,
        "restored_at": datetime.now().isoformat(),
        "tables": restored_tables,
    }


def cleanup_old_backups(max_keep: int = 10):
    """Remove oldest backups beyond max_keep count."""
    backups = list_backups()
    if len(backups) <= max_keep:
        return 0
    removed = 0
    for old in backups[max_keep:]:
        if delete_backup(old["filename"]):
            removed += 1
    return removed


def run_scheduled_backup():
    """Called by APScheduler — create backup + cleanup old ones."""
    from .models import SessionLocal
    import json as _json

    db = SessionLocal()
    try:
        from .models import SiteConfig
        row = db.query(SiteConfig).first()
        cfg = _json.loads(row.config_json) if row else {}
        backup_cfg = cfg.get("backup", {})
        max_keep = backup_cfg.get("max_backups", 10)
    except Exception:
        max_keep = 10
    finally:
        db.close()

    try:
        result = create_backup(method="auto", triggered_by="scheduled")
        print(f"[Archive] Scheduled backup created: {result['filename']} ({result['size_display']})")
        removed = cleanup_old_backups(max_keep)
        if removed:
            print(f"[Archive] Cleaned up {removed} old backup(s)")
    except Exception as exc:
        print(f"[Archive] Scheduled backup FAILED: {exc}")
