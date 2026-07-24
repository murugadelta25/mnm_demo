"""
API endpoints for database backup & archive management.
All endpoints require admin role.
"""
import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import Optional

from ..models import SiteConfig, get_db
from ..auth import require_role, require_superadmin
from ..archive_service import (
    create_backup,
    list_backups,
    get_backup_path,
    delete_backup,
    restore_backup,
    BACKUP_DIR,
)

router = APIRouter(prefix="/api/archive", tags=["archive"])

DEFAULT_BACKUP_CONFIG = {
    "enabled": False,
    "interval_days": 15,
    "max_backups": 10,
    "last_backup_at": None,
}


class BackupConfigPayload(BaseModel):
    enabled: bool = False
    interval_days: int = Field(default=15, ge=1, le=90)
    max_backups: int = Field(default=10, ge=1, le=100)


def _get_backup_config(db: Session) -> dict:
    row = db.query(SiteConfig).first()
    if not row:
        return dict(DEFAULT_BACKUP_CONFIG)
    cfg = json.loads(row.config_json)
    return {**DEFAULT_BACKUP_CONFIG, **cfg.get("backup", {})}


def _save_backup_config(db: Session, backup_cfg: dict):
    row = db.query(SiteConfig).first()
    if row:
        cfg = json.loads(row.config_json)
    else:
        cfg = {}
        row = SiteConfig(config_json="{}")
        db.add(row)
    cfg["backup"] = backup_cfg
    row.config_json = json.dumps(cfg)
    db.commit()


@router.get("/config")
def get_archive_config(db: Session = Depends(get_db), _=Depends(require_superadmin())):
    return _get_backup_config(db)


@router.put("/config")
def update_archive_config(
    payload: BackupConfigPayload,
    db: Session = Depends(get_db),
    _=Depends(require_superadmin()),
):
    current = _get_backup_config(db)
    current["enabled"] = payload.enabled
    current["interval_days"] = payload.interval_days
    current["max_backups"] = payload.max_backups
    _save_backup_config(db, current)

    from ..scheduler_service import reload_archive_schedule
    reload_archive_schedule(db)

    return current


@router.post("/backup")
def trigger_backup(_=Depends(require_superadmin())):
    """Create a backup immediately (manual trigger)."""
    try:
        result = create_backup(method="auto", triggered_by="manual")
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/list")
def list_all_backups(_=Depends(require_superadmin())):
    return list_backups()


@router.get("/download/{filename}")
def download_backup(filename: str, _=Depends(require_superadmin())):
    fp = get_backup_path(filename)
    if not fp:
        raise HTTPException(status_code=404, detail="Backup not found")
    return FileResponse(
        path=str(fp),
        filename=filename,
        media_type="application/gzip",
    )


@router.post("/restore/{filename}")
def restore_from_backup(filename: str, _=Depends(require_superadmin())):
    """Restore database from a backup file. WARNING: overwrites current data."""
    try:
        result = restore_backup(filename)
        return result
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Backup not found")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Historical archive (remote LAN DB, ~2 month hot retention) ──────────────

class TableArchiveSetting(BaseModel):
    name: str
    enabled: bool = False
    retention_days: int = Field(default=60, ge=30, le=3650)


class HistoryArchiveConfigPayload(BaseModel):
    enabled: bool = False
    retention_days: int = Field(default=60, ge=30, le=3650)
    interval_days: int = Field(default=1, ge=1, le=30)
    host: str = ""
    port: int = Field(default=3306, ge=1, le=65535)
    user: str = ""
    password: Optional[str] = None  # omit / blank = keep existing
    database: str = "eap_pms_archive"
    tables: Optional[list[TableArchiveSetting]] = None


@router.get("/history/config")
def get_history_archive_config(db: Session = Depends(get_db), _=Depends(require_superadmin())):
    from ..history_archive import public_history_status
    return public_history_status(db)


@router.put("/history/config")
def update_history_archive_config(
    payload: HistoryArchiveConfigPayload,
    db: Session = Depends(get_db),
    _=Depends(require_superadmin()),
):
    from ..history_archive import (
        TABLE_CATALOG,
        _get_site_history_cfg,
        _save_site_history_cfg,
        public_history_status,
        get_archive_engine,
    )
    current = _get_site_history_cfg(db)
    current["enabled"] = payload.enabled
    current["retention_days"] = payload.retention_days
    current["interval_days"] = payload.interval_days
    current["host"] = (payload.host or "").strip()
    current["port"] = payload.port
    current["user"] = (payload.user or "").strip()
    current["database"] = (payload.database or "eap_pms_archive").strip()
    if payload.password is not None and payload.password != "":
        current["password"] = payload.password
    if payload.tables is not None:
        tables_cfg = {}
        for t in payload.tables:
            if t.name not in TABLE_CATALOG:
                continue
            tables_cfg[t.name] = {
                "enabled": bool(t.enabled),
                "retention_days": int(t.retention_days),
            }
        current["tables"] = tables_cfg
    _save_site_history_cfg(db, current)
    try:
        get_archive_engine(current, force_refresh=True)
    except Exception:
        pass
    from ..scheduler_service import reload_history_archive_schedule
    reload_history_archive_schedule(db)
    return public_history_status(db)


@router.post("/history/test")
def test_history_archive_connection(db: Session = Depends(get_db), _=Depends(require_superadmin())):
    from ..history_archive import ensure_archive_schema, public_history_status
    try:
        schema = ensure_archive_schema()
        status = public_history_status(db)
        return {"ok": True, "schema": schema, "status": status}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/history/run")
def run_history_archive_now(db: Session = Depends(get_db), _=Depends(require_superadmin())):
    from ..history_archive import run_history_archive
    try:
        return run_history_archive(db, triggered_by="manual")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/{filename}")
def delete_a_backup(filename: str, _=Depends(require_superadmin())):
    if delete_backup(filename):
        return {"status": "deleted", "filename": filename}
    raise HTTPException(status_code=404, detail="Backup not found")
