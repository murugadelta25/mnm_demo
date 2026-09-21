from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import Optional

from ..auth import require_role
from ..models import get_db
from ..role_definitions import (
    create_role,
    delete_role,
    list_roles_payload,
    slugify_role_label,
    update_role,
    validate_role_slug,
)

router = APIRouter(prefix="/api/roles", tags=["roles"])


class RoleCreate(BaseModel):
    slug: Optional[str] = None
    label: str = Field(..., min_length=1, max_length=100)
    description: str = ""
    color: str = "#64748b"
    icon: str = "👤"
    inheritsSlug: Optional[str] = None


class RoleUpdate(BaseModel):
    label: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    inheritsSlug: Optional[str] = None
    sortOrder: Optional[int] = None


@router.get("/")
def get_roles(db: Session = Depends(get_db)):
    """Public role catalog for User Management and Feature Access Matrix columns."""
    return {"roles": list_roles_payload(db)}


@router.post("/")
def post_role(
    body: RoleCreate,
    db: Session = Depends(get_db),
    _=Depends(require_role("admin", "superadmin")),
):
    slug = body.slug.strip().lower() if body.slug else slugify_role_label(body.label)
    try:
        slug = validate_role_slug(slug)
        created = create_role(
            db,
            slug=slug,
            label=body.label,
            description=body.description,
            color=body.color,
            icon=body.icon,
            inherits_slug=body.inheritsSlug,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return created


@router.patch("/{slug}")
def patch_role(
    slug: str,
    body: RoleUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_role("admin", "superadmin")),
):
    try:
        updated = update_role(
            db,
            slug,
            label=body.label,
            description=body.description,
            color=body.color,
            icon=body.icon,
            inherits_slug=body.inheritsSlug,
            sort_order=body.sortOrder,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return updated


@router.delete("/{slug}")
def remove_role(
    slug: str,
    db: Session = Depends(get_db),
    current=Depends(require_role("admin", "superadmin")),
):
    if slug == "superadmin" and current.role != "superadmin":
        raise HTTPException(403, "Only superadmin can delete roles")
    try:
        return delete_role(db, slug)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
