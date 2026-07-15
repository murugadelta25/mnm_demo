import json
import os
from fastapi import APIRouter, Depends, UploadFile, File
from sqlalchemy.orm import Session
from pydantic import BaseModel
from pathlib import Path
import shutil, uuid
from ..models import SiteConfig, get_db
from ..auth import get_current_user, require_role
from ..network_utils import build_network_payload

router = APIRouter(prefix="/api/config", tags=["config"])

FACTORY_DIR = Path(__file__).parent.parent.parent / "static" / "factory"
FACTORY_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_SITE_TITLE = os.getenv("SITE_TITLE", "Production Monitoring System (PMS)")

DEFAULT_CONFIG = {
    "shifts": [
        {"id": "A", "name": "Shift A", "start": "08:00", "end": "20:00", "enabled": True},
        {"id": "B", "name": "Shift B", "start": "20:00", "end": "08:00", "enabled": True},
        {"id": "C", "name": "Shift C", "start": "22:00", "end": "06:00", "enabled": False},
    ],
    "breaks": {
        "A": {
            "lunch_break": 30, "lunch_start": "12:00", "lunch_end": "12:30",
            "tea_break": 10, "tea_start": "10:00", "tea_end": "10:10",
            "tpm_cleaning": 10, "tpm_start": "11:00", "tpm_end": "11:10",
            "other_cleaning": 0, "management_meeting": 0,
        },
        "B": {
            "lunch_break": 30, "lunch_start": "00:00", "lunch_end": "00:30",
            "tea_break": 10, "tea_start": "22:00", "tea_end": "22:10",
            "tpm_cleaning": 10, "tpm_start": "23:00", "tpm_end": "23:10",
            "other_cleaning": 0, "management_meeting": 0,
        },
        "C": {
            "lunch_break": 30, "lunch_start": "02:00", "lunch_end": "02:30",
            "tea_break": 10, "tea_start": "00:00", "tea_end": "00:10",
            "tpm_cleaning": 10, "tpm_start": "01:00", "tpm_end": "01:10",
            "other_cleaning": 0, "management_meeting": 0,
        },
    },
    "checkDataDaysBack": 1,
    "hourly_output": {
        "running_part_threshold_pct": 30,
        "ld_unld_max_sec": 60,
        "micro_gap_sec": 15,
    },
    "loss_tracker_limits": {
        "idle": 1,
        "breakdown": 90,
        "alarm": 30,
        "offline": 30,
        "setting_change": 120,
    },
    "deviation_escalation": {
        "enabled": True,
        "levels": [
            {"level": 1, "label": "Operator / Production", "group_names": ["production"], "delay_minutes": 0},
            {"level": 2, "label": "Supervisor", "group_names": ["maintenance"], "delay_minutes": 15},
            {"level": 3, "label": "Manager", "group_names": ["management"], "delay_minutes": 30},
        ],
    },
    "factory": {
        "configured": False,
        "siteTitle": DEFAULT_SITE_TITLE,
        "faviconFactoryId": None,
        "factories": [],
    },
    "backup": {
        "enabled": False,
        "interval_days": 15,
        "max_backups": 10,
        "last_backup_at": None,
    },
}

class ConfigPayload(BaseModel):
    config: dict


def merge_config(stored: dict) -> dict:
    """Merge stored site config with defaults (timed breaks required for hourly output)."""
    if not stored:
        return dict(DEFAULT_CONFIG)
    merged = {**DEFAULT_CONFIG, **stored}
    merged["shifts"] = stored.get("shifts") or DEFAULT_CONFIG["shifts"]
    breaks_out = {}
    for sh in merged["shifts"]:
        sid = sh.get("id")
        if not sid:
            continue
        base = DEFAULT_CONFIG["breaks"].get(sid, DEFAULT_CONFIG["breaks"]["A"])
        breaks_out[sid] = {**base, **(stored.get("breaks") or {}).get(sid, {})}
    merged["breaks"] = breaks_out
    factory = stored.get("factory") or {}
    merged["factory"] = {**DEFAULT_CONFIG["factory"], **factory}
    esc = stored.get("deviation_escalation") or {}
    default_esc = DEFAULT_CONFIG["deviation_escalation"]
    merged["deviation_escalation"] = {
        "enabled": esc.get("enabled", default_esc["enabled"]),
        "levels": esc.get("levels") or default_esc["levels"],
    }
    lt = stored.get("loss_tracker_limits") or {}
    default_lt = DEFAULT_CONFIG["loss_tracker_limits"]
    merged["loss_tracker_limits"] = {**default_lt, **lt}
    hourly = stored.get("hourly_output") or {}
    default_hourly = DEFAULT_CONFIG["hourly_output"]
    merged["hourly_output"] = {**default_hourly, **hourly}
    backup = stored.get("backup") or {}
    default_backup = DEFAULT_CONFIG["backup"]
    merged["backup"] = {**default_backup, **backup}
    return merged


def _load_config(db: Session) -> dict:
    row = db.query(SiteConfig).first()
    if not row:
        return dict(DEFAULT_CONFIG)
    cfg = merge_config(json.loads(row.config_json))
    factory = cfg.get("factory") or {}
    if "siteTitle" not in factory:
        factory["siteTitle"] = DEFAULT_CONFIG["factory"]["siteTitle"]
    if "faviconFactoryId" not in factory:
        factory["faviconFactoryId"] = None
    cfg["factory"] = factory
    return cfg


@router.get("/branding")
def get_branding(db: Session = Depends(get_db)):
    """Public site title + favicon for browser tab (no auth required)."""
    cfg = _load_config(db)
    factory_cfg = cfg.get("factory") or {}
    site_title = factory_cfg.get("siteTitle") or DEFAULT_SITE_TITLE
    favicon_url = None
    favicon_id = factory_cfg.get("faviconFactoryId")
    for f in factory_cfg.get("factories") or []:
        if favicon_id and f.get("id") == favicon_id and f.get("logoUrl"):
            favicon_url = f["logoUrl"]
            break
    if not favicon_url:
        for f in factory_cfg.get("factories") or []:
            if f.get("logoUrl"):
                favicon_url = f["logoUrl"]
                break
    return {"siteTitle": site_title, "faviconUrl": favicon_url}


@router.get("/network")
def get_network_info():
    """Public LAN URLs and auto-detected IPs (no auth). Use when din.eappms DNS is unavailable."""
    return build_network_payload()


@router.get("/")
def get_config(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return _load_config(db)

@router.put("/")
def save_config(payload: ConfigPayload, db: Session = Depends(get_db), _=Depends(require_role("admin"))):
    row = db.query(SiteConfig).first()
    if row:
        row.config_json = json.dumps(payload.config)
    else:
        db.add(SiteConfig(config_json=json.dumps(payload.config)))
    db.commit()
    return payload.config


@router.post("/factory-logo")
def upload_factory_logo(file: UploadFile = File(...), _=Depends(require_role("admin"))):
    ext = Path(file.filename).suffix or ".png"
    fname = f"factory_logo_{uuid.uuid4().hex[:8]}{ext}"
    fpath = FACTORY_DIR / fname
    with open(fpath, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"logoUrl": f"/static/factory/{fname}"}
