"""Tool groups — shared tool sets for Part Master tools parameters."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_role
from ..models import ToolGroup, ToolGroupMember, ToolStock, get_db, now_ist
try:
    from ..tool_service import serialize_tool
except ImportError:
    def serialize_tool(tool):
        return {"id": tool.id, "tool_code": tool.tool_code, "tool_name": tool.tool_name}

router = APIRouter(prefix="/api/tools/groups", tags=["tool-groups"])


class GroupMemberIn(BaseModel):
    tool_id: int
    sort_order: int = 0
    approx_tool_life: Optional[str] = None
    rpm: Optional[str] = None
    feed_mm_rev: Optional[str] = None
    depth_of_cut: Optional[str] = None
    cutting_speed: Optional[str] = None
    notes: Optional[str] = None


class ToolGroupCreate(BaseModel):
    group_code: str
    name: str
    description: Optional[str] = None
    active: int = 1
    members: List[GroupMemberIn] = Field(default_factory=list)


class ToolGroupUpdate(BaseModel):
    group_code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    active: Optional[int] = None
    members: Optional[List[GroupMemberIn]] = None


def ensure_tool_groups_schema(bind=None):
    """Create tool_groups / tool_group_members and parts.tool_group_id if missing."""
    from sqlalchemy import inspect, text
    from ..models import engine, Part, _add_column_if_missing

    if bind is None:
        bind = engine
    ToolGroup.__table__.create(bind=bind, checkfirst=True)
    ToolGroupMember.__table__.create(bind=bind, checkfirst=True)
    try:
        _add_column_if_missing(bind, text, "parts", "tool_group_id", "tool_group_id INT NULL")
    except Exception as exc:
        print(f"[WARN] parts.tool_group_id: {exc}")


def _serialize_member(m: ToolGroupMember, tool: Optional[ToolStock] = None) -> dict:
    return {
        "id": m.id,
        "tool_id": m.tool_id,
        "sort_order": m.sort_order or 0,
        "approx_tool_life": m.approx_tool_life,
        "rpm": m.rpm,
        "feed_mm_rev": m.feed_mm_rev,
        "depth_of_cut": m.depth_of_cut,
        "cutting_speed": m.cutting_speed,
        "notes": m.notes,
        "tool": serialize_tool(tool) if tool else None,
        "tool_code": tool.tool_code if tool else None,
        "tool_name": tool.tool_name if tool else None,
        "life_cycles_limit": tool.life_cycles_limit if tool else None,
    }


def _serialize_group(db: Session, g: ToolGroup, *, with_members: bool = True) -> dict:
    out = {
        "id": g.id,
        "group_code": g.group_code,
        "name": g.name,
        "description": g.description,
        "active": int(g.active or 0),
        "created_at": g.created_at.isoformat() if g.created_at else None,
        "updated_at": g.updated_at.isoformat() if g.updated_at else None,
        "member_count": 0,
        "members": [],
    }
    if not with_members:
        out["member_count"] = (
            db.query(ToolGroupMember).filter(ToolGroupMember.group_id == g.id).count()
        )
        return out

    members = (
        db.query(ToolGroupMember)
        .filter(ToolGroupMember.group_id == g.id)
        .order_by(ToolGroupMember.sort_order, ToolGroupMember.id)
        .all()
    )
    tool_ids = [m.tool_id for m in members]
    tools = {
        t.id: t
        for t in db.query(ToolStock).filter(ToolStock.id.in_(tool_ids)).all()
    } if tool_ids else {}
    out["members"] = [_serialize_member(m, tools.get(m.tool_id)) for m in members]
    out["member_count"] = len(out["members"])
    return out


def group_to_tools_param_rows(db: Session, group_id: int) -> list[dict]:
    """Build tools_parameters.rows from a group (for Part Master load)."""
    members = (
        db.query(ToolGroupMember)
        .filter(ToolGroupMember.group_id == group_id)
        .order_by(ToolGroupMember.sort_order, ToolGroupMember.id)
        .all()
    )
    tool_ids = [m.tool_id for m in members]
    tools = {
        t.id: t
        for t in db.query(ToolStock).filter(ToolStock.id.in_(tool_ids)).all()
    } if tool_ids else {}
    rows = []
    for m in members:
        tool = tools.get(m.tool_id)
        if not tool:
            continue
        life = m.approx_tool_life
        if not life and tool.life_cycles_limit is not None:
            life = str(tool.life_cycles_limit)
        rows.append({
            "tool_id": tool.id,
            "tools_detail": tool.tool_name or "",
            "tool_no": tool.tool_code or "",
            "approx_tool_life": life or "",
            "rpm": m.rpm or "",
            "feed_mm_rev": m.feed_mm_rev or "",
            "depth_of_cut": m.depth_of_cut or "",
            "cutting_speed": m.cutting_speed or "",
        })
    return rows


def _replace_members(db: Session, group_id: int, members: List[GroupMemberIn]) -> None:
    db.query(ToolGroupMember).filter(ToolGroupMember.group_id == group_id).delete()
    seen = set()
    for i, mem in enumerate(members or []):
        if mem.tool_id in seen:
            continue
        tool = db.query(ToolStock).filter(ToolStock.id == mem.tool_id).first()
        if not tool:
            raise HTTPException(400, f"Tool id {mem.tool_id} not found")
        seen.add(mem.tool_id)
        db.add(ToolGroupMember(
            group_id=group_id,
            tool_id=mem.tool_id,
            sort_order=mem.sort_order if mem.sort_order is not None else i,
            approx_tool_life=(mem.approx_tool_life or "").strip() or None,
            rpm=(mem.rpm or "").strip() or None,
            feed_mm_rev=(mem.feed_mm_rev or "").strip() or None,
            depth_of_cut=(mem.depth_of_cut or "").strip() or None,
            cutting_speed=(mem.cutting_speed or "").strip() or None,
            notes=(mem.notes or "").strip() or None,
        ))


@router.get("/")
def list_groups(
    active_only: bool = True,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(ToolGroup)
    if active_only:
        q = q.filter(ToolGroup.active == 1)
    if search and search.strip():
        term = f"%{search.strip()}%"
        q = q.filter(
            (ToolGroup.group_code.ilike(term)) | (ToolGroup.name.ilike(term))
        )
    rows = q.order_by(ToolGroup.group_code).all()
    return [_serialize_group(db, g, with_members=False) for g in rows]


@router.get("/{group_id:int}")
def get_group(group_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    g = db.query(ToolGroup).filter(ToolGroup.id == group_id).first()
    if not g:
        raise HTTPException(404, "Tool group not found")
    return _serialize_group(db, g, with_members=True)


@router.get("/{group_id:int}/tools-parameters")
def get_group_as_tools_parameters(
    group_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Return tools_parameters-shaped payload for loading into Part Master."""
    g = db.query(ToolGroup).filter(ToolGroup.id == group_id).first()
    if not g:
        raise HTTPException(404, "Tool group not found")
    columns = [
        {"key": "tools_detail", "label": "Tools Detail"},
        {"key": "tool_no", "label": "Tool No"},
        {"key": "approx_tool_life", "label": "Approx Tool life"},
        {"key": "rpm", "label": "RPM"},
        {"key": "feed_mm_rev", "label": "Feed mm/rev"},
        {"key": "depth_of_cut", "label": "Depth of Cut"},
        {"key": "cutting_speed", "label": "Cutting speed m/min"},
    ]
    rows = group_to_tools_param_rows(db, group_id)
    return {
        "group": _serialize_group(db, g, with_members=False),
        "tools_parameters": {"columns": columns, "rows": rows},
    }


@router.post("/")
def create_group(
    data: ToolGroupCreate,
    db: Session = Depends(get_db),
    _=Depends(require_role("admin", "superadmin", "supervisor")),
):
    code = (data.group_code or "").strip().upper()
    name = (data.name or "").strip()
    if not code or not name:
        raise HTTPException(400, "group_code and name are required")
    if db.query(ToolGroup).filter(ToolGroup.group_code == code).first():
        raise HTTPException(400, "Group code already exists")
    now = now_ist()
    g = ToolGroup(
        group_code=code,
        name=name,
        description=(data.description or "").strip() or None,
        active=1 if data.active is None else int(data.active),
        created_at=now,
        updated_at=now,
    )
    db.add(g)
    db.flush()
    _replace_members(db, g.id, data.members or [])
    db.commit()
    db.refresh(g)
    return _serialize_group(db, g, with_members=True)


@router.put("/{group_id:int}")
def update_group(
    group_id: int,
    data: ToolGroupUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_role("admin", "superadmin", "supervisor")),
):
    g = db.query(ToolGroup).filter(ToolGroup.id == group_id).first()
    if not g:
        raise HTTPException(404, "Tool group not found")
    if data.group_code is not None:
        code = data.group_code.strip().upper()
        if not code:
            raise HTTPException(400, "group_code cannot be empty")
        other = db.query(ToolGroup).filter(ToolGroup.group_code == code, ToolGroup.id != group_id).first()
        if other:
            raise HTTPException(400, "Group code already exists")
        g.group_code = code
    if data.name is not None:
        name = data.name.strip()
        if not name:
            raise HTTPException(400, "name cannot be empty")
        g.name = name
    if data.description is not None:
        g.description = data.description.strip() or None
    if data.active is not None:
        g.active = int(data.active)
    if data.members is not None:
        _replace_members(db, g.id, data.members)
    g.updated_at = now_ist()
    db.commit()
    db.refresh(g)
    return _serialize_group(db, g, with_members=True)


@router.delete("/{group_id:int}")
def delete_group(
    group_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_role("admin", "superadmin")),
):
    g = db.query(ToolGroup).filter(ToolGroup.id == group_id).first()
    if not g:
        raise HTTPException(404, "Tool group not found")
    g.active = 0
    g.updated_at = now_ist()
    db.commit()
    return {"ok": True, "id": group_id}
