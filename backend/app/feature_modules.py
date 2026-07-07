"""Customer feature toggles — per menu item from feature-registry.json."""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from .feature_registry import all_feature_item_ids, registry_groups, registry_payload
from .models import SiteConfig


def default_feature_modules() -> dict[str, bool]:
    return {item_id: True for item_id in all_feature_item_ids()}


def _normalize(modules: dict[str, Any] | None) -> dict[str, bool]:
    """Merge stored flags with registry; support legacy group-level keys."""
    out = default_feature_modules()
    if not modules:
        return out

    item_ids = set(all_feature_item_ids())

    for group in registry_groups():
        gid = group["id"]
        if gid in modules and modules[gid] is False:
            for item in group.get("items") or []:
                out[item["id"]] = False

    for key, value in modules.items():
        if key in item_ids:
            out[key] = bool(value)

    for group in registry_groups():
        gid = group["id"]
        if gid in modules and modules[gid] is True:
            for item in group.get("items") or []:
                if item["id"] not in modules:
                    out[item["id"]] = True

    return out


def _load_site_json(db: Session) -> dict:
    row = db.query(SiteConfig).first()
    if not row:
        return {}
    try:
        return json.loads(row.config_json)
    except (json.JSONDecodeError, TypeError):
        return {}


def get_feature_modules(db: Session) -> dict[str, bool]:
    stored = _load_site_json(db).get("featureModules")
    return _normalize(stored)


def set_feature_modules(db: Session, modules: dict[str, bool]) -> dict[str, bool]:
    item_ids = set(all_feature_item_ids())
    filtered = {k: bool(v) for k, v in modules.items() if k in item_ids}
    normalized = _normalize(filtered)
    row = db.query(SiteConfig).first()
    if row:
        cfg = _load_site_json(db)
        cfg["featureModules"] = normalized
        row.config_json = json.dumps(cfg)
    else:
        db.add(SiteConfig(config_json=json.dumps({"featureModules": normalized})))
    db.commit()
    return normalized


def feature_modules_payload(db: Session) -> dict:
    return {
        "registry": registry_payload(),
        "modules": get_feature_modules(db),
    }
