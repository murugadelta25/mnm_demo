"""
CRUD + catalog resolution for editable telemetry tags (Node-RED ↔ UI map).
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from sqlalchemy.orm import Session

from .models import TelemetryTag, now_ist
from .servo_press_modbus import SERVO_PRESS_REGISTERS, _NAME_ALIASES


DEFAULT_PROFILE = "servo_press"


def _slug_key(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (text or "").strip().lower())
    return s.strip("_") or "tag"


def ensure_telemetry_tags_schema(bind=None):
    from .models import engine
    if bind is None:
        bind = engine
    TelemetryTag.__table__.create(bind=bind, checkfirst=True)
    return True


def _alias_list(raw) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [str(x).strip() for x in data if str(x).strip()]
    except Exception:
        pass
    # comma-separated fallback
    return [p.strip() for p in str(raw).split(",") if p.strip()]


def public_tag(row: TelemetryTag) -> dict:
    return {
        "id": row.id,
        "profile_id": row.profile_id,
        "tag_key": row.tag_key,
        "item": row.item,
        "nodered_name": row.nodered_name,
        "nodered_aliases": _alias_list(row.nodered_aliases),
        "modbus": row.modbus,
        "eip_pn": row.eip_pn,
        "type": row.data_type,
        "scale": float(row.scale) if row.scale is not None else 1.0,
        "unit": row.unit or "",
        "group": row.group_name,
        "note": row.note or "",
        "sort_order": int(row.sort_order or 0),
        "is_enabled": int(row.is_enabled or 0) == 1,
        "created_at": row.created_at.isoformat(timespec="seconds") if row.created_at else None,
        "updated_at": row.updated_at.isoformat(timespec="seconds") if row.updated_at else None,
    }


def seed_default_servo_press_tags(db: Session, *, profile_id: str = DEFAULT_PROFILE) -> int:
    """Insert §8.4.2 defaults when the profile has no rows yet. Returns inserted count."""
    existing = db.query(TelemetryTag).filter(TelemetryTag.profile_id == profile_id).count()
    if existing:
        return 0

    # Build reverse: tag_key → preferred Node-RED display names from aliases
    key_to_aliases: dict[str, list[str]] = {}
    for alias, key in _NAME_ALIASES.items():
        key_to_aliases.setdefault(key, [])
        if alias not in key_to_aliases[key]:
            key_to_aliases[key].append(alias)

    inserted = 0
    for i, (key, meta) in enumerate(SERVO_PRESS_REGISTERS.items()):
        aliases = [a for a in key_to_aliases.get(key, []) if a.replace(" ", "_") != key and a != key]
        # Prefer human label as primary Node-RED name (matches Edge tags like "Live position")
        primary = meta.get("item") or key
        # Drop primary from aliases if present (case-insensitive)
        aliases = [a for a in aliases if a.lower() != primary.lower()]
        row = TelemetryTag(
            profile_id=profile_id,
            tag_key=key,
            item=meta.get("item") or key,
            nodered_name=primary,
            nodered_aliases=json.dumps(aliases[:12]) if aliases else None,
            modbus=meta.get("modbus"),
            eip_pn=meta.get("eip_pn"),
            data_type=meta.get("type") or "W",
            scale=float(meta.get("scale") or 1),
            unit=meta.get("unit") or "",
            group_name=meta.get("group") or "live",
            note=meta.get("note") or "",
            sort_order=i * 10,
            is_enabled=1,
            created_at=now_ist(),
            updated_at=now_ist(),
        )
        db.add(row)
        inserted += 1
    if inserted:
        db.commit()
    return inserted


def seed_profile_defaults(db: Session, *, profile_id: str) -> int:
    """Insert the vendor catalog for a non-Servo-Press profile when it has no rows yet."""
    from .telemetry_tag_defaults import default_tags_for_profile

    rows = default_tags_for_profile(profile_id)
    if not rows:
        return 0
    if db.query(TelemetryTag).filter(TelemetryTag.profile_id == profile_id).count():
        return 0

    inserted = 0
    for i, row in enumerate(rows):
        db.add(TelemetryTag(
            profile_id=profile_id,
            tag_key=row["key"],
            item=row["item"],
            nodered_name=row["nodered_name"],
            nodered_aliases=json.dumps(row["aliases"]) if row["aliases"] else None,
            modbus=row["modbus"],
            eip_pn=row["eip_pn"],
            data_type=row["type"],
            scale=row["scale"],
            unit=row["unit"],
            group_name=row["group"],
            note=row["note"],
            sort_order=i * 10,
            is_enabled=1,
            created_at=now_ist(),
            updated_at=now_ist(),
        ))
        inserted += 1
    if inserted:
        db.commit()
    return inserted


def ensure_tags_ready(db: Session, *, profile_id: str = DEFAULT_PROFILE) -> None:
    ensure_telemetry_tags_schema()
    # Servo Press seeds from the manufacturer §8.4.2 catalog; the other profiles seed
    # from their commissioned vendor sheets (AH PLC kit, linear servo motor).
    if profile_id == DEFAULT_PROFILE:
        seed_default_servo_press_tags(db, profile_id=profile_id)
    else:
        seed_profile_defaults(db, profile_id=profile_id)


def list_tags(db: Session, *, profile_id: str = DEFAULT_PROFILE, enabled_only: bool = False) -> list[dict]:
    ensure_tags_ready(db, profile_id=profile_id)
    q = db.query(TelemetryTag).filter(TelemetryTag.profile_id == profile_id)
    if enabled_only:
        q = q.filter(TelemetryTag.is_enabled == 1)
    rows = q.order_by(TelemetryTag.sort_order.asc(), TelemetryTag.id.asc()).all()
    return [public_tag(r) for r in rows]


def get_registers_and_aliases(
    db: Session,
    *,
    profile_id: str = DEFAULT_PROFILE,
) -> tuple[dict, dict]:
    """
    Build SERVO_PRESS_REGISTERS-shaped dict + name→key aliases from DB tags.
    Falls back to built-in catalog if DB empty after seed.
    """
    ensure_tags_ready(db, profile_id=profile_id)
    rows = (
        db.query(TelemetryTag)
        .filter(TelemetryTag.profile_id == profile_id, TelemetryTag.is_enabled == 1)
        .order_by(TelemetryTag.sort_order.asc(), TelemetryTag.id.asc())
        .all()
    )
    if not rows:
        # Built-in fallback only for Servo Press; PLC / Linear Motor start empty until tags are added
        if profile_id == DEFAULT_PROFILE:
            return dict(SERVO_PRESS_REGISTERS), dict(_NAME_ALIASES)
        return {}, {}

    registers: dict[str, dict] = {}
    aliases: dict[str, str] = {}
    for row in rows:
        key = row.tag_key
        registers[key] = {
            "item": row.item,
            "modbus": row.modbus,
            "eip_pn": row.eip_pn,
            "type": row.data_type or "W",
            "scale": float(row.scale) if row.scale is not None else 1.0,
            "unit": row.unit or "",
            "group": row.group_name or "live",
            "note": row.note or "",
        }
        names = [row.nodered_name] + _alias_list(row.nodered_aliases)
        names.append(key)
        names.append(key.replace("_", " "))
        if row.item:
            names.append(row.item)
        for n in names:
            base = re.sub(r"\s+", " ", str(n or "").strip().lower())
            if not base:
                continue
            aliases[base] = key
            aliases[base.replace(" ", "_").replace("-", "_")] = key
    return registers, aliases


def create_tag(db: Session, data: dict, *, profile_id: str = DEFAULT_PROFILE) -> dict:
    ensure_tags_ready(db, profile_id=profile_id)
    item = (data.get("item") or "").strip()
    if not item:
        raise ValueError("item is required")
    nodered_name = (data.get("nodered_name") or item).strip()
    tag_key = (data.get("tag_key") or _slug_key(item)).strip()
    if not tag_key:
        tag_key = _slug_key(nodered_name)
    group = (data.get("group") or data.get("group_name") or "live").strip().lower()
    if group not in ("live", "result", "other"):
        raise ValueError("group must be live, result, or other")

    dup = (
        db.query(TelemetryTag)
        .filter(TelemetryTag.profile_id == profile_id, TelemetryTag.tag_key == tag_key)
        .first()
    )
    if dup:
        raise ValueError(f"tag_key '{tag_key}' already exists for this profile")

    max_order = (
        db.query(TelemetryTag)
        .filter(TelemetryTag.profile_id == profile_id)
        .count()
    )
    aliases = data.get("nodered_aliases") or []
    if isinstance(aliases, str):
        aliases = _alias_list(aliases)

    row = TelemetryTag(
        profile_id=profile_id,
        tag_key=tag_key,
        item=item,
        nodered_name=nodered_name,
        nodered_aliases=json.dumps(aliases) if aliases else None,
        modbus=(data.get("modbus") or "").strip() or None,
        eip_pn=(data.get("eip_pn") or "").strip() or None,
        data_type=(data.get("type") or data.get("data_type") or "W").strip() or "W",
        scale=float(data.get("scale") if data.get("scale") is not None else 1),
        unit=(data.get("unit") or "").strip(),
        group_name=group,
        note=(data.get("note") or "").strip(),
        sort_order=int(data.get("sort_order") if data.get("sort_order") is not None else (max_order + 1) * 10),
        is_enabled=1 if data.get("is_enabled", True) else 0,
        created_at=now_ist(),
        updated_at=now_ist(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return public_tag(row)


def update_tag(db: Session, tag_id: int, data: dict) -> dict:
    row = db.query(TelemetryTag).filter(TelemetryTag.id == tag_id).first()
    if not row:
        raise ValueError("Tag not found")

    if "item" in data and data["item"] is not None:
        row.item = str(data["item"]).strip() or row.item
    if "nodered_name" in data and data["nodered_name"] is not None:
        row.nodered_name = str(data["nodered_name"]).strip() or row.nodered_name
    if "nodered_aliases" in data:
        aliases = data["nodered_aliases"]
        if isinstance(aliases, str):
            aliases = _alias_list(aliases)
        row.nodered_aliases = json.dumps(aliases) if aliases else None
    if "modbus" in data:
        row.modbus = (str(data["modbus"]).strip() if data["modbus"] is not None else None) or None
    if "eip_pn" in data:
        row.eip_pn = (str(data["eip_pn"]).strip() if data["eip_pn"] is not None else None) or None
    if "type" in data or "data_type" in data:
        row.data_type = str(data.get("type") or data.get("data_type") or row.data_type or "W").strip()
    if "scale" in data and data["scale"] is not None:
        row.scale = float(data["scale"])
    if "unit" in data and data["unit"] is not None:
        row.unit = str(data["unit"]).strip()
    if "group" in data or "group_name" in data:
        group = str(data.get("group") or data.get("group_name") or row.group_name).strip().lower()
        if group not in ("live", "result", "other"):
            raise ValueError("group must be live, result, or other")
        row.group_name = group
    if "note" in data and data["note"] is not None:
        row.note = str(data["note"]).strip()
    if "sort_order" in data and data["sort_order"] is not None:
        row.sort_order = int(data["sort_order"])
    if "is_enabled" in data and data["is_enabled"] is not None:
        row.is_enabled = 1 if data["is_enabled"] else 0
    if "tag_key" in data and data["tag_key"]:
        new_key = str(data["tag_key"]).strip()
        if new_key != row.tag_key:
            dup = (
                db.query(TelemetryTag)
                .filter(
                    TelemetryTag.profile_id == row.profile_id,
                    TelemetryTag.tag_key == new_key,
                    TelemetryTag.id != row.id,
                )
                .first()
            )
            if dup:
                raise ValueError(f"tag_key '{new_key}' already exists")
            row.tag_key = new_key

    row.updated_at = now_ist()
    db.commit()
    db.refresh(row)
    return public_tag(row)


def delete_tag(db: Session, tag_id: int) -> None:
    row = db.query(TelemetryTag).filter(TelemetryTag.id == tag_id).first()
    if not row:
        raise ValueError("Tag not found")
    db.delete(row)
    db.commit()


def profile_id_for_machine_type(machine_type: Optional[str]) -> str:
    mt = (machine_type or "").strip().lower().replace("_", " ")
    if "linear" in mt and "servo" in mt:
        return "servo_linear_motor"
    if "servo" in mt and "press" in mt:
        return DEFAULT_PROFILE
    if mt in ("servo press", "servopress"):
        return DEFAULT_PROFILE
    if "spm" in mt.split():
        return "spm"
    if mt == "plc" or "plc" in mt:
        return "generic_plc"
    return "generic_plc"
