"""
API endpoints for database backup & archive management.
All endpoints require admin role.
"""
import json
import uuid
from pathlib import Path

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask
from typing import Optional

from ..models import SiteConfig, get_db
from ..auth import require_superadmin, require_superadmin_jwt
from ..archive_service import (
    BACKUP_DIR,
    RestoreNeedsConfirmation,
    build_backup_bundle,
    classify_backup_upload_name,
    create_backup,
    delete_backup,
    get_restore_progress,
    import_uploaded_backup_files,
    list_backups,
    preview_restore,
    restore_backup,
    unlink_quietly,
)
from ..upload_limits import MAX_BACKUP_BYTES, save_upload_limited

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


@router.post("/upload")
async def upload_backup(
    files: list[UploadFile] = File(...),
    _=Depends(require_superadmin()),
):
    """Import a dump, optional .meta.json sidecar, and/or zip bundle from another IPC."""
    uploads = [item for item in files if item is not None]
    if not uploads:
        raise HTTPException(
            status_code=400,
            detail="Choose a .sql.gz / .json.gz dump, its .meta.json file, or a zip of both",
        )
    saved: list[tuple[str, Path]] = []
    try:
        for upload in uploads:
            original = (upload.filename or "").strip()
            if not original:
                raise HTTPException(status_code=400, detail="Uploaded file is missing a name")
            kind = classify_backup_upload_name(original)
            if not kind:
                raise HTTPException(
                    status_code=400,
                    detail="Upload a .sql.gz / .json.gz dump, its .meta.json file, or a zip of both",
                )
            token = uuid.uuid4().hex[:12]
            tmp = BACKUP_DIR / f".upload_{token}_{Path(original).name.lower()}"
            limit = 64 * 1024 if kind == "meta" else MAX_BACKUP_BYTES
            size = await save_upload_limited(upload, tmp, limit)
            if size == 0:
                raise HTTPException(status_code=400, detail="Uploaded file is empty")
            saved.append((original, tmp))
        return import_uploaded_backup_files(saved)
    except HTTPException:
        for _, path in saved:
            path.unlink(missing_ok=True)
        raise
    except ValueError as exc:
        for _, path in saved:
            path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        for _, path in saved:
            path.unlink(missing_ok=True)
        raise


@router.get("/list")
def list_all_backups(_=Depends(require_superadmin())):
    return list_backups()


@router.get("/download/{filename}")
def download_backup(filename: str, _=Depends(require_superadmin())):
    """Download dump + .meta.json as a zip for FTP / IPC-to-IPC transfer."""
    try:
        bundle_path, bundle_name = build_backup_bundle(filename)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Backup not found")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return FileResponse(
        path=str(bundle_path),
        filename=bundle_name,
        media_type="application/zip",
        background=BackgroundTask(unlink_quietly, bundle_path),
    )


class RestorePayload(BaseModel):
    confirm_config_diff: bool = False


@router.get("/restore-preview/{filename}")
def restore_preview(filename: str, _=Depends(require_superadmin())):
    """Compare live configuration with backup before restoring."""
    try:
        return preview_restore(filename)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Backup not found")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/restore-progress")
def restore_progress(_=Depends(require_superadmin_jwt)):
    """In-memory restore percent. JWT-only so polling works while tables are locked."""
    return get_restore_progress()


@router.post("/restore/{filename}")
def restore_from_backup(
    filename: str,
    payload: Optional[RestorePayload] = Body(default=None),
    _=Depends(require_superadmin()),
):
    """Start database restore. Poll GET /restore-progress until done. Overwrites live data only."""
    try:
        confirm = bool(payload and payload.confirm_config_diff)
        result = restore_backup(filename, confirm_config_diff=confirm)
        return JSONResponse(status_code=202, content=result)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Backup not found")
    except RestoreNeedsConfirmation as exc:
        raise HTTPException(status_code=409, detail=exc.preview) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
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
