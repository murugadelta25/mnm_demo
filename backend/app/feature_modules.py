"""Customer feature toggles — per menu item from feature-registry.json."""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from .feature_registry import (
    all_feature_item_ids,
    registry_groups,
    registry_payload,
    registry_standalone,
)
from .access_matrix import (
    TOGGLEABLE_ROLES,
    access_matrix_payload,
    access_matrix_role_defaults,
)
from .models import SiteConfig

# Re-export for routers
__all__ = [
    "TOGGLEABLE_ROLES",
    "default_feature_modules",
    "get_feature_modules",
    "set_feature_modules",
    "get_feature_role_access",
    "set_feature_role_access",
    "feature_modules_payload",
]

# Feature ids that once shipped without a `roles` list in feature-registry.json.
# default_feature_role_access() then produced an all-false map that hid the menu
# item and blocked its route for every role. Any stored all-false entry for these
# ids is that artifact, so defaults are re-applied instead (one-time self-heal).
_ROLE_ACCESS_REPAIR_IDS = frozenset({"qc.work_instructions"})


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


def _iter_registry_items() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for item in registry_standalone():
        if not item.get("alwaysEnabled"):
            items.append(item)
    for group in registry_groups():
        items.extend(group.get("items") or [])
    return items


def _default_role_access_for_item(item: dict[str, Any]) -> dict[str, bool]:
    allowed = set(item.get("roles") or [])
    return {role: (role in allowed) for role in TOGGLEABLE_ROLES}


def default_feature_role_access() -> dict[str, dict[str, bool]]:
    out: dict[str, dict[str, bool]] = {}
    for item in _iter_registry_items():
        out[item["id"]] = _default_role_access_for_item(item)
    # Access-matrix defaults override / extend (e.g. My Work Hours operator-only)
    for feature_id, roles in access_matrix_role_defaults().items():
        out[feature_id] = dict(roles)
    return out


def _normalize_role_access(stored: dict[str, Any] | None) -> dict[str, dict[str, bool]]:
    out = default_feature_role_access()
    if not isinstance(stored, dict):
        return out
    for feature_id, roles_map in stored.items():
        if feature_id not in out or not isinstance(roles_map, dict):
            continue
        if feature_id in _ROLE_ACCESS_REPAIR_IDS and not any(
            bool(v) for v in roles_map.values()
        ):
            # Never a real admin choice: the item had no User Management row, so
            # the all-false map came from the missing registry `roles` list and
            # was persisted wholesale by set_feature_role_access().
            continue
        merged = dict(out[feature_id])
        for role, enabled in roles_map.items():
            if role in TOGGLEABLE_ROLES:
                merged[role] = bool(enabled)
        out[feature_id] = merged
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


def get_feature_role_access(db: Session) -> dict[str, dict[str, bool]]:
    stored = _load_site_json(db).get("featureRoleAccess")
    return _normalize_role_access(stored)


def set_feature_role_access(
    db: Session,
    role_access: dict[str, dict[str, bool]],
) -> dict[str, dict[str, bool]]:
    """Update role access for registry + access-matrix feature ids."""
    defaults = default_feature_role_access()
    allowed_ids = set(defaults.keys())
    current = get_feature_role_access(db)
    next_map = dict(current)

    for feature_id, roles_map in (role_access or {}).items():
        if feature_id not in allowed_ids:
            continue
        if not isinstance(roles_map, dict):
            continue
        merged = dict(next_map.get(feature_id) or defaults[feature_id])
        for role, enabled in roles_map.items():
            if role in TOGGLEABLE_ROLES:
                merged[role] = bool(enabled)
        next_map[feature_id] = merged
        # Keep registry id in sync when matrix row uses the same roles
        for row in access_matrix_payload():
            if row["id"] == feature_id and row.get("registryId") and row["registryId"] != feature_id:
                next_map[row["registryId"]] = dict(merged)
            if row.get("registryId") == feature_id and row["id"] != feature_id:
                next_map[row["id"]] = dict(merged)

    row = db.query(SiteConfig).first()
    if row:
        cfg = _load_site_json(db)
        cfg["featureRoleAccess"] = next_map
        row.config_json = json.dumps(cfg)
    else:
        db.add(SiteConfig(config_json=json.dumps({"featureRoleAccess": next_map})))
    db.commit()
    return get_feature_role_access(db)


def feature_modules_payload(db: Session) -> dict:
    return {
        "registry": registry_payload(),
        "modules": get_feature_modules(db),
        "roleAccess": get_feature_role_access(db),
        "accessMatrix": access_matrix_payload(),
        "toggleableRoles": TOGGLEABLE_ROLES,
    }
