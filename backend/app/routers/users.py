from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from ..models import User, get_db
from ..auth import hash_password, get_current_user, require_role

router = APIRouter(prefix="/api/users", tags=["users"])

ROLES = ["operator", "supervisor", "maintenance", "admin", "quality"]

class UserCreate(BaseModel):
    username: str
    password: str
    role: str

class UserUpdate(BaseModel):
    role: Optional[str] = None
    password: Optional[str] = None  # blank = don't change

class PasswordChange(BaseModel):
    current_password: str
    new_password: str

@router.get("/")
def list_users(db: Session = Depends(get_db), _=Depends(get_current_user)):
    users = db.query(User).order_by(User.role, User.username).all()
    return [{"id": u.id, "username": u.username, "role": u.role} for u in users]

@router.post("/")
def create_user(data: UserCreate, db: Session = Depends(get_db),
                _=Depends(require_role("admin"))):
    if data.role not in ROLES:
        raise HTTPException(400, f"role must be one of {ROLES}")
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(400, "Username already exists")
    if len(data.password) < 4:
        raise HTTPException(400, "Password must be at least 4 characters")
    u = User(username=data.username, password_hash=hash_password(data.password), role=data.role)
    db.add(u)
    db.commit()
    db.refresh(u)
    return {"id": u.id, "username": u.username, "role": u.role}

@router.put("/{user_id}")
def update_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db),
                current=Depends(require_role("admin"))):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(404, "User not found")
    # Prevent admin from removing their own admin role
    if u.id == current.id and data.role and data.role != "admin":
        raise HTTPException(400, "Cannot change your own role")
    if data.role:
        if data.role not in ROLES:
            raise HTTPException(400, f"role must be one of {ROLES}")
        u.role = data.role
    if data.password:
        if len(data.password) < 4:
            raise HTTPException(400, "Password must be at least 4 characters")
        u.password_hash = hash_password(data.password)
    db.commit()
    return {"id": u.id, "username": u.username, "role": u.role}

@router.delete("/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db),
                current=Depends(require_role("admin"))):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(404, "User not found")
    if u.id == current.id:
        raise HTTPException(400, "Cannot delete your own account")
    db.delete(u)
    db.commit()
    return {"ok": True}

# Any logged-in user can change their own password
@router.post("/me/change-password")
def change_own_password(data: PasswordChange, db: Session = Depends(get_db),
                        current=Depends(get_current_user)):
    import bcrypt as _bcrypt
    if not _bcrypt.checkpw(data.current_password.encode(), current.password_hash.encode()):
        raise HTTPException(400, "Current password is incorrect")
    if len(data.new_password) < 4:
        raise HTTPException(400, "New password must be at least 4 characters")
    current.password_hash = hash_password(data.new_password)
    db.commit()
    return {"ok": True}
