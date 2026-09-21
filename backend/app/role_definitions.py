"""Dynamic application roles — DB-backed, linked to featureRoleAccess matrix."""
from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy.orm import Session

from .models import AppRole, SiteConfig, User
from .role_seeds import BUILTIN_ROLE_SEEDS
from .feature_registry import all_feature_item_ids
from .access_matrix import access_matrix_role_defaults, CAPABILITY_ROWS

SLUG_RE = re.compile(r"^[a-z][a-z0-9_]{0,48}$")


def slugify_role_label(label: str) -> str:
    raw = (label or "").strip().lower()
    raw = re.sub(r"[^a-z0-9]+", "_", raw)
    raw = re.sub(r"_+", "_", raw).strip("_")
    if not raw:
        return "role"
    if not raw[0].isalpha():
        raw = f"r_{raw}"
    return raw[:50]


def validate_role_slug(slug: str) -> str:
    s = (slug or "").strip().lower()
    if not SLUG_RE.match(s):
        raise ValueError(
            "Role id must start with a letter and use only lowercase letters, numbers, and underscores (max 50 chars)."
        )
    return s


def _load_site_json(db: Session) -> dict:
    row = db.query(SiteConfig).first()
    if not row:
        return {}
    try:
        return json.loads(row.config_json)
    except (json.JSONDecodeError, TypeError):
        return {}


def _save_site_json(db: Session, cfg: dict) -> None:
    row = db.query(SiteConfig).first()
    if row:
        row.config_json = json.dumps(cfg)
    else:
        db.add(SiteConfig(config_json=json.dumps(cfg)))


def _role_row_payload(r: AppRole) -> dict[str, Any]:
    return {
        "slug": r.slug,
        "label": r.label,
        "description": r.description or "",
        "color": r.color or "#64748b",
        "icon": r.icon or "👤",
        "isSystem": bool(r.is_system),
        "inheritsSlug": r.inherits_slug,
        "sortOrder": r.sort_order or 100,
    }


def _seed_payload(seed: dict[str, Any]) -> dict[str, Any]:
    return {
        "slug": seed["slug"],
        "label": seed["label"],
        "description": seed.get("description") or "",
        "color": seed.get("color") or "#64748b",
        "icon": seed.get("icon") or "👤",
        "isSystem": bool(seed.get("is_system")),
        "inheritsSlug": seed.get("inherits_slug"),
        "sortOrder": seed.get("sort_order") or 100,
    }


def list_role_slugs(db: Session) -> list[str]:
    """Built-in roles first, then custom roles. Never drop builtins when a custom role exists."""
    try:
        ensure_roles_table_and_seed(db)
    except Exception:
        pass
    rows = (
        db.query(AppRole)
        .filter(AppRole.active == 1)
        .order_by(AppRole.sort_order, AppRole.label)
        .all()
    )
    ordered: list[str] = []
    seen: set[str] = set()
    for seed in BUILTIN_ROLE_SEEDS:
        slug = seed["slug"]
        if slug not in seen:
            ordered.append(slug)
            seen.add(slug)
    for r in rows:
        if r.slug not in seen:
            ordered.append(r.slug)
            seen.add(r.slug)
    return ordered


def list_roles_payload(db: Session) -> list[dict[str, Any]]:
    """Return built-in + custom roles. Re-seed missing system roles if the table was empty."""
    try:
        ensure_roles_table_and_seed(db)
    except Exception:
        pass
    rows = (
        db.query(AppRole)
        .filter(AppRole.active == 1)
        .order_by(AppRole.sort_order, AppRole.label)
        .all()
    )
    by_slug = {r.slug: _role_row_payload(r) for r in rows}
    ordered: list[dict[str, Any]] = []
    seen: set[str] = set()
    for seed in BUILTIN_ROLE_SEEDS:
        slug = seed["slug"]
        ordered.append(by_slug.get(slug) or _seed_payload(seed))
        seen.add(slug)
    for r in rows:
        if r.slug not in seen:
            ordered.append(by_slug[r.slug])
            seen.add(r.slug)
    return ordered


def role_exists(db: Session, slug: str) -> bool:
    return db.query(AppRole).filter(AppRole.slug == slug, AppRole.active == 1).first() is not None


def ensure_roles_table_and_seed(db: Session) -> None:
    """Create app_roles table and seed built-in roles if missing."""
    from .models import Base, engine
    AppRole.__table__.create(bind=engine, checkfirst=True)

    existing = {r.slug for r in db.query(AppRole).all()}
    added = False
    for seed in BUILTIN_ROLE_SEEDS:
        if seed["slug"] in existing:
            continue
        db.add(AppRole(
            slug=seed["slug"],
            label=seed["label"],
            description=seed.get("description"),
            color=seed.get("color", "#64748b"),
            icon=seed.get("icon", "👤"),
            is_system=seed.get("is_system", 0),
            inherits_slug=seed.get("inherits_slug"),
            sort_order=seed.get("sort_order", 100),
            active=1,
        ))
        added = True
    if added:
        db.commit()


def _all_feature_ids_for_access() -> set[str]:
    ids = set(all_feature_item_ids())
    ids.update(access_matrix_role_defaults().keys())
    for cap in CAPABILITY_ROWS:
        ids.add(cap["id"])
    return ids


def _extend_role_access_for_slug(db: Session, slug: str, default_on: bool = False) -> None:
    cfg = _load_site_json(db)
    access = cfg.get("featureRoleAccess") or {}
    for fid in _all_feature_ids_for_access():
        row = dict(access.get(fid) or {})
        if slug not in row:
            row[slug] = default_on
        access[fid] = row
    cfg["featureRoleAccess"] = access
    _save_site_json(db, cfg)


def _remove_role_from_access(db: Session, slug: str) -> None:
    cfg = _load_site_json(db)
    access = cfg.get("featureRoleAccess") or {}
    for fid, roles_map in list(access.items()):
        if isinstance(roles_map, dict) and slug in roles_map:
            next_map = dict(roles_map)
            del next_map[slug]
            access[fid] = next_map
    cfg["featureRoleAccess"] = access
    _save_site_json(db, cfg)


def create_role(
    db: Session,
    *,
    slug: str,
    label: str,
    description: str = "",
    color: str = "#64748b",
    icon: str = "👤",
    inherits_slug: str | None = None,
) -> dict[str, Any]:
    slug = validate_role_slug(slug)
    label = (label or slug).strip()
    if not label:
        raise ValueError("Role label is required")
    try:
        ensure_roles_table_and_seed(db)
    except Exception:
        pass
    if db.query(AppRole).filter(AppRole.slug == slug).first():
        raise ValueError(f"Role '{slug}' already exists")
    if inherits_slug:
        inherits_slug = validate_role_slug(inherits_slug)
        if not role_exists(db, inherits_slug):
            raise ValueError(f"Inherit role '{inherits_slug}' not found")

    max_order = db.query(AppRole.sort_order).order_by(AppRole.sort_order.desc()).first()
    sort_order = (max_order[0] if max_order and max_order[0] else 100) + 10

    row = AppRole(
        slug=slug,
        label=label,
        description=description or None,
        color=color or "#64748b",
        icon=icon or "👤",
        is_system=0,
        inherits_slug=inherits_slug,
        sort_order=sort_order,
        active=1,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    # Copy inherit role access if specified, else default all pages off.
    if inherits_slug:
        defaults = access_matrix_role_defaults()
        cfg = _load_site_json(db)
        access = cfg.get("featureRoleAccess") or {}
        for fid in _all_feature_ids_for_access():
            src = access.get(fid) or {}
            if inherits_slug in src:
                inherited = bool(src.get(inherits_slug))
            else:
                inherited = bool((defaults.get(fid) or {}).get(inherits_slug))
            row_map = dict(src)
            row_map[slug] = inherited
            access[fid] = row_map
        cfg["featureRoleAccess"] = access
        _save_site_json(db, cfg)
    else:
        _extend_role_access_for_slug(db, slug, default_on=False)

    db.commit()
    payloads = list_roles_payload(db)
    return next((p for p in payloads if p["slug"] == slug), {
        "slug": slug, "label": label, "description": description,
        "color": color, "icon": icon, "isSystem": False,
    })


def update_role(
    db: Session,
    slug: str,
    *,
    label: str | None = None,
    description: str | None = None,
    color: str | None = None,
    icon: str | None = None,
    inherits_slug: str | None = None,
    sort_order: int | None = None,
) -> dict[str, Any]:
    slug = validate_role_slug(slug)
    row = db.query(AppRole).filter(AppRole.slug == slug, AppRole.active == 1).first()
    if not row:
        raise ValueError(f"Role '{slug}' not found")
    if label is not None:
        row.label = label.strip() or row.label
    if description is not None:
        row.description = description
    if color is not None:
        row.color = color
    if icon is not None:
        row.icon = icon
    if sort_order is not None:
        row.sort_order = sort_order
    if inherits_slug is not None:
        if inherits_slug == "":
            row.inherits_slug = None
        else:
            inherits_slug = validate_role_slug(inherits_slug)
            if inherits_slug == slug:
                raise ValueError("Role cannot inherit from itself")
            if not role_exists(db, inherits_slug):
                raise ValueError(f"Inherit role '{inherits_slug}' not found")
            row.inherits_slug = inherits_slug
    db.commit()
    db.refresh(row)
    payloads = list_roles_payload(db)
    return next((p for p in payloads if p["slug"] == slug), payloads[0])


def delete_role(db: Session, slug: str) -> dict[str, Any]:
    slug = validate_role_slug(slug)
    if slug == "superadmin":
        raise ValueError("Super Admin role cannot be deleted")
    row = db.query(AppRole).filter(AppRole.slug == slug).first()
    if not row:
        raise ValueError(f"Role '{slug}' not found")
    if row.is_system:
        raise ValueError(f"System role '{row.label}' cannot be deleted — edit its page access in the matrix instead")
    user_count = db.query(User).filter(User.role == slug).count()
    if user_count:
        raise ValueError(f"Cannot delete role '{row.label}': {user_count} user(s) still assigned. Reassign them first.")

    _remove_role_from_access(db, slug)
    db.delete(row)
    db.commit()
    return {"ok": True, "deleted": slug}
