import json
import os
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
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
    # auto = live PLC/status capture (default); manual = Data Entry form + missing-shift alerts
    "data_capture": {
        "mode": "auto",
    },
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
    # Optional tablet / mobile coupling — OFF = web app runs independently
    "mobile_integration": {
        "enabled": True,
    },
}

class ConfigPayload(BaseModel):
    config: dict


def parse_stored_config(raw) -> dict:
    """Parse site_config.config_json; never raise on corrupt restore/import data."""
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        data = json.loads(raw)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def merge_config(stored: dict) -> dict:
    """Merge stored site config with defaults (timed breaks required for hourly output)."""
    if not stored or not isinstance(stored, dict):
        return dict(DEFAULT_CONFIG)
    merged = {**DEFAULT_CONFIG, **stored}
    merged["shifts"] = stored.get("shifts") or DEFAULT_CONFIG["shifts"]
    if not isinstance(merged["shifts"], list):
        merged["shifts"] = DEFAULT_CONFIG["shifts"]
    breaks_out = {}
    stored_breaks = stored.get("breaks") if isinstance(stored.get("breaks"), dict) else {}
    for sh in merged["shifts"]:
        if not isinstance(sh, dict):
            continue
        sid = sh.get("id")
        if not sid:
            continue
        base = DEFAULT_CONFIG["breaks"].get(sid, DEFAULT_CONFIG["breaks"]["A"])
        extra = stored_breaks.get(sid, {}) if isinstance(stored_breaks.get(sid), dict) else {}
        breaks_out[sid] = {**base, **extra}
    merged["breaks"] = breaks_out
    factory = stored.get("factory") if isinstance(stored.get("factory"), dict) else {}
    merged["factory"] = {**DEFAULT_CONFIG["factory"], **factory}
    esc = stored.get("deviation_escalation") if isinstance(stored.get("deviation_escalation"), dict) else {}
    default_esc = DEFAULT_CONFIG["deviation_escalation"]
    merged["deviation_escalation"] = {
        "enabled": esc.get("enabled", default_esc["enabled"]),
        "levels": esc.get("levels") or default_esc["levels"],
    }
    lt = stored.get("loss_tracker_limits") if isinstance(stored.get("loss_tracker_limits"), dict) else {}
    default_lt = DEFAULT_CONFIG["loss_tracker_limits"]
    merged["loss_tracker_limits"] = {**default_lt, **lt}
    hourly = stored.get("hourly_output") if isinstance(stored.get("hourly_output"), dict) else {}
    default_hourly = DEFAULT_CONFIG["hourly_output"]
    merged["hourly_output"] = {**default_hourly, **hourly}
    backup = stored.get("backup") if isinstance(stored.get("backup"), dict) else {}
    default_backup = DEFAULT_CONFIG["backup"]
    merged["backup"] = {**default_backup, **backup}
    mi = stored.get("mobile_integration") if isinstance(stored.get("mobile_integration"), dict) else {}
    default_mi = DEFAULT_CONFIG["mobile_integration"]
    merged["mobile_integration"] = {**default_mi, **mi}
    dc = stored.get("data_capture") if isinstance(stored.get("data_capture"), dict) else {}
    default_dc = DEFAULT_CONFIG["data_capture"]
    mode = str(dc.get("mode") or default_dc["mode"] or "auto").strip().lower()
    if mode not in ("auto", "manual"):
        mode = "auto"
    merged["data_capture"] = {**default_dc, **dc, "mode": mode}
    return merged


def _load_config(db: Session) -> dict:
    try:
        row = db.query(SiteConfig).first()
    except Exception:
        return dict(DEFAULT_CONFIG)
    if not row:
        return dict(DEFAULT_CONFIG)
    cfg = merge_config(parse_stored_config(row.config_json))
    factory = cfg.get("factory") or {}
    if not isinstance(factory, dict):
        factory = dict(DEFAULT_CONFIG["factory"])
    if "siteTitle" not in factory:
        factory["siteTitle"] = DEFAULT_CONFIG["factory"]["siteTitle"]
    if "faviconFactoryId" not in factory:
        factory["faviconFactoryId"] = None
    cfg["factory"] = factory
    return cfg


@router.get("/branding")
def get_branding(db: Session = Depends(get_db)):
    """Public site title + favicon for browser tab (no auth required)."""
    try:
        cfg = _load_config(db)
        factory_cfg = cfg.get("factory") or {}
        site_title = factory_cfg.get("siteTitle") or DEFAULT_SITE_TITLE
        favicon_url = None
        favicon_id = factory_cfg.get("faviconFactoryId")
        factories = factory_cfg.get("factories") if isinstance(factory_cfg.get("factories"), list) else []
        for f in factories:
            if not isinstance(f, dict):
                continue
            if favicon_id and f.get("id") == favicon_id and f.get("logoUrl"):
                favicon_url = f["logoUrl"]
                break
        if not favicon_url:
            for f in factories:
                if isinstance(f, dict) and f.get("logoUrl"):
                    favicon_url = f["logoUrl"]
                    break
        return {"siteTitle": site_title, "faviconUrl": favicon_url}
    except Exception:
        return {"siteTitle": DEFAULT_SITE_TITLE, "faviconUrl": None}


@router.get("/network")
def get_network_info():
    """Public LAN URLs and auto-detected IPs (no auth). Use when din.eappms DNS is unavailable."""
    return build_network_payload()


@router.get("/mobile-integration")
def get_mobile_integration_status(db: Session = Depends(get_db)):
    """Public flag for tablet apps — whether coupling with the web PMS is enabled."""
    from ..mobile_integration import is_mobile_integration_enabled
    enabled = is_mobile_integration_enabled(db)
    return {
        "enabled": enabled,
        "message": (
            "Mobile app integration is enabled."
            if enabled
            else "Mobile app integration is disabled in Configuration. Web app runs independently."
        ),
    }


@router.get("/")
def get_config(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return _load_config(db)

@router.put("/")
def save_config(payload: ConfigPayload, db: Session = Depends(get_db), _=Depends(require_role("admin"))):
    """Persist site config while preserving runtime keys omitted by the UI.

    Loss Tracker thresholds (and similar nested settings) live in the same
    SiteConfig blob. Configuration page drafts may not include them — never
    wipe stored values just because the payload left a key out.
    """
    row = db.query(SiteConfig).first()
    existing = {}
    if row and row.config_json:
        try:
            existing = json.loads(row.config_json) or {}
        except Exception:
            existing = {}

    incoming = dict(payload.config or {})
    # Keys that must survive if the client omits or sends an empty object
    preserve_keys = (
        "loss_tracker_limits",
        "deviation_escalation",
        "hourly_output",
        "factory",
        "backup",
        "featureModules",
        "mobile_integration",
    )
    for key in preserve_keys:
        if key not in incoming or incoming.get(key) in (None, {}):
            if key in existing and existing[key] not in (None, {}):
                incoming[key] = existing[key]

    # Nested merge for loss_tracker_limits so partial updates keep other statuses
    if isinstance(incoming.get("loss_tracker_limits"), dict) and isinstance(existing.get("loss_tracker_limits"), dict):
        incoming["loss_tracker_limits"] = {
            **DEFAULT_CONFIG["loss_tracker_limits"],
            **existing["loss_tracker_limits"],
            **incoming["loss_tracker_limits"],
        }

    if isinstance(incoming.get("mobile_integration"), dict):
        incoming["mobile_integration"] = {
            **DEFAULT_CONFIG["mobile_integration"],
            **(existing.get("mobile_integration") or {}),
            **incoming["mobile_integration"],
        }

    # Nested merge for factory only when the client explicitly sent a factory object
    incoming_factory = (payload.config or {}).get("factory")
    if isinstance(incoming_factory, dict) and incoming_factory not in (None, {}):
        incoming["factory"] = {
            **DEFAULT_CONFIG["factory"],
            **(existing.get("factory") or {}),
            **incoming_factory,
        }
        # Explicit factories list from client always wins (including empty list)
        if "factories" in incoming_factory:
            incoming["factory"]["factories"] = list(incoming_factory.get("factories") or [])

    if row:
        row.config_json = json.dumps(incoming)
    else:
        db.add(SiteConfig(config_json=json.dumps(incoming)))
    db.commit()
    return merge_config(incoming)


@router.post("/factory-logo")
def upload_factory_logo(file: UploadFile = File(...), _=Depends(require_role("admin", "superadmin"))):
    """Upload a factory logo image; returns a public /static/factory/... URL."""
    if not file.filename:
        raise HTTPException(400, "No file provided")
    ext = (Path(file.filename).suffix or ".png").lower()
    if ext not in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}:
        raise HTTPException(400, "Unsupported image type. Use PNG, JPG, GIF, WEBP, or SVG.")
    FACTORY_DIR.mkdir(parents=True, exist_ok=True)
    fname = f"factory_logo_{uuid.uuid4().hex[:8]}{ext}"
    fpath = FACTORY_DIR / fname
    with open(fpath, "wb") as f:
        shutil.copyfileobj(file.file, f)
    size = fpath.stat().st_size
    if size <= 0:
        fpath.unlink(missing_ok=True)
        raise HTTPException(400, "Uploaded file is empty")
    if size > 8 * 1024 * 1024:
        fpath.unlink(missing_ok=True)
        raise HTTPException(400, "Logo must be under 8 MB")
    return {"logoUrl": f"/static/factory/{fname}", "filename": fname, "size": size}
