from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..models import User, get_db
from ..auth import verify_password, create_access_token, hash_password
from ..password_policy import PASSWORD_HINT, validate_password_or_raise

router = APIRouter(prefix="/api/auth", tags=["auth"])

APPROVER_ROLES = {"admin", "superadmin", "site_admin"}


class ForgotPasswordRequest(BaseModel):
    username: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8)
    approver_username: str = Field(..., min_length=1)
    approver_password: str = Field(..., min_length=1)


def _user_login_payload(user: User) -> dict:
    must_change = bool(getattr(user, "password_must_change", 0))
    return {
        "access_token": create_access_token({"sub": user.username, "role": user.role}),
        "token_type": "bearer",
        "role": user.role,
        "username": user.username,
        "id": user.id,
        "reference_photo_url": user.reference_photo_url,
        "has_reference_photo": bool(user.reference_photo_url),
        "must_change_password": must_change,
        "password_hint": PASSWORD_HINT if must_change else None,
    }


@router.post("/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form.username).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return _user_login_payload(user)


@router.post("/forgot-password")
@router.post("/forgot_password")
def forgot_password(data: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """
    Reset any user's password from the login screen.
    Requires a valid admin or superadmin to authorize the reset (no email on factory LAN).
    """
    target_name = data.username.strip()
    approver_name = data.approver_username.strip()
    if not target_name or not approver_name:
        raise HTTPException(400, "Username and approver username are required")
    validate_password_or_raise(data.new_password)
    if target_name.lower() == approver_name.lower():
        raise HTTPException(400, "Ask another admin or superadmin to authorize your password reset")

    target = db.query(User).filter(User.username == target_name).first()
    if not target:
        raise HTTPException(404, "User not found")

    approver = db.query(User).filter(User.username == approver_name).first()
    if (
        not approver
        or approver.role not in APPROVER_ROLES
        or not verify_password(data.approver_password, approver.password_hash)
    ):
        raise HTTPException(401, "Invalid approver credentials")

    if target.role == "superadmin" and approver.role != "superadmin":
        raise HTTPException(403, "Only a superadmin can reset a superadmin password")

    target.password_hash = hash_password(data.new_password)
    target.password_must_change = 0  # reset already applied new policy
    db.commit()
    return {
        "ok": True,
        "username": target.username,
        "role": target.role,
        "message": f"Password reset for {target.username}. You can sign in now.",
        "password_hint": PASSWORD_HINT,
    }
