from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from ..models import BreakdownTicket, Machine, Operator, ProductionPlan, User, get_db, now_ist
from ..auth import get_current_user, require_capability
from ..ws_manager import manager

from .machines import _log_status

router = APIRouter(prefix="/api/breakdown", tags=["breakdown"])


def _ensure_raised_by_name_column(db: Session):
    """Add denormalized raised_by_name if missing (safe on existing DBs)."""
    try:
        from sqlalchemy import text, inspect
        bind = db.get_bind()
        inspector = inspect(bind)
        if not inspector.has_table("breakdown_tickets"):
            return
        cols = {c["name"] for c in inspector.get_columns("breakdown_tickets")}
        if "raised_by_name" not in cols:
            with bind.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE breakdown_tickets ADD COLUMN raised_by_name VARCHAR(120) NULL"
                ))
    except Exception as exc:
        print(f"[breakdown] raised_by_name column ensure skipped: {exc}")


def _operator_label(op: Operator) -> str:
    name = (op.name or "").strip()
    code = (op.employee_code or "").strip()
    if name and code and name.lower() != code.lower():
        return f"{name} ({code})"
    return name or code or f"Operator #{op.id}"


def _user_label(u: User) -> str:
    return (u.username or f"User #{u.id}").strip()


def _ensure_user_for_operator(db: Session, op: Operator) -> User:
    """
    Map operator → users.id for breakdown_tickets.raised_by FK.
    Prefer linked_user_id, then username=employee_code, else create a stub operator login.
    """
    if op.linked_user_id:
        u = db.query(User).filter(User.id == op.linked_user_id).first()
        if u:
            return u

    code = (op.employee_code or "").strip()
    if code:
        u = db.query(User).filter(User.username == code).first()
        if u:
            if not op.linked_user_id:
                op.linked_user_id = u.id
            return u

    # Stub user so FK is satisfied and display can show the operator code
    from ..auth import hash_password
    import secrets
    username = code or f"op{op.id}"
    # Avoid colliding with an existing elevated account username
    existing = db.query(User).filter(User.username == username).first()
    if existing:
        if not op.linked_user_id:
            op.linked_user_id = existing.id
        return existing

    u = User(
        username=username,
        password_hash=hash_password(secrets.token_urlsafe(24)),
        role="operator",
        reference_photo_url=op.reference_photo_url,
    )
    db.add(u)
    db.flush()
    op.linked_user_id = u.id
    return u


def _resolve_raiser(db: Session, user, requested_raised_by: Optional[int]) -> tuple:
    """
    Returns (users.id, display_name).
    Mobile operator tokens must NOT use operator.id as users.id (ID collision → wrong name).
    """
    if getattr(user, "is_operator_principal", False):
        op = db.query(Operator).filter(Operator.id == user.operator_id).first()
        if not op:
            raise HTTPException(400, "Operator account not found")
        u = _ensure_user_for_operator(db, op)
        return u.id, _operator_label(op)

    # Web / User Management account
    if user.role in ("admin", "supervisor", "maintenance", "superadmin") and requested_raised_by:
        # Form may select an operator user OR a directory operator id by mistake —
        # prefer matching User; if it matches an Operator.id only, resolve via operator.
        u = db.query(User).filter(User.id == requested_raised_by).first()
        if u:
            op = (
                db.query(Operator)
                .filter(
                    (Operator.linked_user_id == u.id) | (Operator.employee_code == u.username)
                )
                .first()
            )
            label = _operator_label(op) if op else _user_label(u)
            return u.id, label
        op = db.query(Operator).filter(Operator.id == requested_raised_by).first()
        if op:
            u = _ensure_user_for_operator(db, op)
            return u.id, _operator_label(op)
        raise HTTPException(400, "Invalid raised_by user")

    # Operator-role web user raising for themselves
    op = (
        db.query(Operator)
        .filter(
            (Operator.linked_user_id == user.id) | (Operator.employee_code == user.username)
        )
        .first()
    )
    label = _operator_label(op) if op else _user_label(user)
    return user.id, label


def _display_raiser(db: Session, ticket: BreakdownTicket, users: dict, ops_by_user: dict, ops_by_code: dict) -> str:
    if getattr(ticket, "raised_by_name", None):
        return ticket.raised_by_name
    uid = ticket.raised_by
    op = ops_by_user.get(uid)
    if op:
        return _operator_label(op)
    uname = users.get(uid)
    if uname:
        op2 = ops_by_code.get(uname)
        if op2:
            return _operator_label(op2)
        return uname
    return str(uid) if uid else ""


class TicketCreate(BaseModel):
    machine_id: int
    raised_by: Optional[int] = None  # optional; ignored for operator tokens
    description: str


class TicketResolve(BaseModel):
    resolution_notes: str


@router.post("/")
async def raise_ticket(data: TicketCreate, db: Session = Depends(get_db), user=Depends(require_capability("capability.raise_breakdown", "operator", "supervisor", "admin"))):
    _ensure_raised_by_name_column(db)
    raised_by_id, raised_by_name = _resolve_raiser(db, user, data.raised_by)
    ticket = BreakdownTicket(
        machine_id=data.machine_id,
        raised_by=raised_by_id,
        raised_by_name=raised_by_name,
        description=data.description,
        created_at=now_ist(),
    )
    db.add(ticket)
    machine = db.query(Machine).filter(Machine.id == data.machine_id).first()
    if machine:
        machine.status = "breakdown"
    db.commit()
    db.refresh(ticket)
    _log_status(data.machine_id, "breakdown", "breakdown", db)
    db.commit()
    await manager.broadcast({
        "type": "breakdown_raised",
        "id": ticket.id,
        "machine_id": data.machine_id,
        "description": data.description,
        "status": "raised",
        "raised_by_name": raised_by_name,
    })
    return ticket


@router.patch("/{ticket_id}/acknowledge")
async def acknowledge_ticket(ticket_id: int, db: Session = Depends(get_db), user=Depends(require_capability("capability.ack_breakdown", "maintenance", "admin"))):
    ticket = db.query(BreakdownTicket).filter(BreakdownTicket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(404, "Not found")
    ticket.status = "acknowledged"
    ticket.acknowledged_by = user.id
    ticket.ack_time = now_ist()
    db.commit()
    try:
        from ..deviation_alert_service import resolve_escalation_for_machine
        resolve_escalation_for_machine(db, ticket.machine_id, 'breakdown_acknowledged')
    except Exception as exc:
        print(f"[DeviationAlert] resolve on acknowledge failed: {exc}")
    await manager.broadcast({"type": "breakdown_acknowledged", "id": ticket_id, "machine_id": ticket.machine_id})
    return ticket


@router.patch("/{ticket_id}/start")
async def start_troubleshoot(ticket_id: int, db: Session = Depends(get_db), user=Depends(require_capability("capability.resolve_breakdown", "maintenance", "admin"))):
    ticket = db.query(BreakdownTicket).filter(BreakdownTicket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(404, "Not found")
    ticket.status = "in_progress"
    ticket.start_troubleshoot = now_ist()
    db.commit()
    await manager.broadcast({"type": "breakdown_in_progress", "id": ticket_id, "machine_id": ticket.machine_id})
    return ticket


@router.patch("/{ticket_id}/resolve")
async def resolve_ticket(ticket_id: int, data: TicketResolve, db: Session = Depends(get_db), user=Depends(require_capability("capability.resolve_breakdown", "maintenance", "admin"))):
    ticket = db.query(BreakdownTicket).filter(BreakdownTicket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(404, "Not found")
    ticket.status = "resolved"
    ticket.resolved_time = now_ist()
    ticket.resolution_notes = data.resolution_notes
    machine = db.query(Machine).filter(Machine.id == ticket.machine_id).first()
    if machine:
        from .machines import _compute_status
        machine.status = _compute_status(machine, db)
        _log_status(ticket.machine_id, machine.status, "breakdown_resolved", db)
    db.commit()
    await manager.broadcast({"type": "breakdown_resolved", "id": ticket_id,
                              "machine_id": ticket.machine_id, "status": machine.status if machine else "idle"})
    return ticket


@router.get("/users")
def get_users(db: Session = Depends(get_db), _=Depends(get_current_user)):
    # Prefer Operator Directory for shop-floor attribution in the raise form
    ops = (
        db.query(Operator)
        .filter(Operator.is_active == 1)
        .order_by(Operator.employee_code)
        .all()
    )
    if ops:
        out = []
        for op in ops:
            u = _ensure_user_for_operator(db, op)
            out.append({
                "id": u.id,
                "username": _operator_label(op),
                "role": "operator",
                "employee_code": op.employee_code,
                "operator_id": op.id,
            })
        db.commit()
        return out
    return [{"id": u.id, "username": u.username, "role": u.role}
            for u in db.query(User)
                       .filter(User.role.in_(["operator", "supervisor"]))
                       .order_by(User.role, User.username).all()]


@router.get("/")
def get_tickets(db: Session = Depends(get_db), _=Depends(get_current_user)):
    _ensure_raised_by_name_column(db)
    tickets = db.query(BreakdownTicket).order_by(BreakdownTicket.created_at.desc()).all()
    users_rows = db.query(User).all()
    users = {u.id: u.username for u in users_rows}
    users_by_id = {u.id: u for u in users_rows}
    ops = db.query(Operator).all()
    ops_by_user = {o.linked_user_id: o for o in ops if o.linked_user_id}
    ops_by_code = {o.employee_code: o for o in ops if o.employee_code}
    ops_by_id = {o.id: o for o in ops}

    healed = False
    for tk in tickets:
        # Heal mobile ID-collision: operator.id was stored as users.id (e.g. shows "admin")
        if not getattr(tk, "raised_by_name", None) and tk.raised_by:
            u = users_by_id.get(tk.raised_by)
            op_collision = ops_by_id.get(tk.raised_by)
            if (
                op_collision
                and u
                and u.role in ("admin", "superadmin", "maintenance", "supervisor")
                and (u.username or "").lower() != (op_collision.employee_code or "").lower()
            ):
                try:
                    linked = _ensure_user_for_operator(db, op_collision)
                    tk.raised_by = linked.id
                    tk.raised_by_name = _operator_label(op_collision)
                    healed = True
                except Exception:
                    tk.raised_by_name = _operator_label(op_collision)
                    healed = True
    if healed:
        db.commit()

    result = []
    for tk in tickets:
        d = {c.name: getattr(tk, c.name) for c in tk.__table__.columns}
        label = _display_raiser(db, tk, users, ops_by_user, ops_by_code)
        d["raised_by_username"] = label
        d["raised_by_name"] = label
        d["acknowledged_by_username"] = users.get(tk.acknowledged_by, str(tk.acknowledged_by) if tk.acknowledged_by else "")
        result.append(d)
    return result


@router.get("/machines")
def get_machines(db: Session = Depends(get_db), _=Depends(get_current_user)):
    from .machines import _compute_status
    machines = db.query(Machine).order_by(Machine.station_id, Machine.id).all()
    result = []
    for m in machines:
        live = _compute_status(m, db)
        has_plan = db.query(ProductionPlan).filter(
            ProductionPlan.status == "running",
            (ProductionPlan.machine_id == m.id) |
            (ProductionPlan.station_no == m.station_id)
        ).first() is not None
        result.append({
            "id": m.id, "name": m.name, "station_id": m.station_id,
            "status": live, "machine_type": m.machine_type,
            "make": m.make, "model_no": m.model_no, "tonnage": m.tonnage,
            "features": m.features, "image_url": m.image_url, "location": m.location,
            "plc_source": m.plc_source, "has_plan": has_plan,
        })
    return result
