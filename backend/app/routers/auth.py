"""Authentication, profile, settings and user administration."""
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import (ROLES, create_token, decode_token, get_current_user, hash_password, require_roles,
                               verify_password)
from app.models import PasswordReset, User

router = APIRouter(prefix="/api/auth", tags=["Auth"])
admin = APIRouter(prefix="/api/users", tags=["Users (admin)"])
SELF_REGISTER_ROLES = {"CITIZEN", "ANALYST", "EMERGENCY_RESPONDER", "MUNICIPAL_OFFICER"}


def _pw_rules(v: str) -> str:
    if len(v) < 8 or not any(c.isdigit() for c in v) or not any(c.isalpha() for c in v):
        raise ValueError("Password must be ≥8 characters and contain letters and digits")
    return v


class RegisterIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=120)
    password: str
    role: str = "CITIZEN"
    department: str = ""
    phone: str = Field(default="", max_length=20)
    city: str = "hyderabad"
    language: str = "en"
    _v = field_validator("password")(_pw_rules)


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)   # not EmailStr: demo accounts use the reserved .local domain
    password: str = Field(min_length=1, max_length=128)


class ProfileIn(BaseModel):
    full_name: str | None = Field(default=None, max_length=120)
    department: str | None = None
    phone: str | None = Field(default=None, max_length=20)
    city: str | None = None
    language: str | None = None
    theme: str | None = None
    notify_web: bool | None = None
    notify_email: bool | None = None
    notify_sms: bool | None = None


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str
    _v = field_validator("new_password")(_pw_rules)


class ForgotIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)


class ResetIn(BaseModel):
    token: str
    new_password: str
    _v = field_validator("new_password")(_pw_rules)


def user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role, "department": u.department,
            "phone": u.phone, "city": u.city, "language": u.language, "theme": u.theme, "notify_web": u.notify_web,
            "notify_email": u.notify_email, "notify_sms": u.notify_sms, "is_active": u.is_active,
            "requested_role": u.requested_role,
            "created_at": u.created_at.isoformat() if u.created_at else None}


def _tokens(u: User) -> dict:
    return {"access_token": create_token(str(u.id), u.role), "refresh_token": create_token(str(u.id), u.role, "refresh"),
            "token_type": "bearer", "user": user_out(u)}


@router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    role = body.role.upper()
    if role not in SELF_REGISTER_ROLES:
        raise HTTPException(400, "Role not allowed for self-registration")
    if db.query(User).filter(User.email == body.email.lower()).first():
        raise HTTPException(409, "Email already registered")
    # Privileged roles are never self-granted: the account starts as CITIZEN with a pending request
    # that an ADMIN approves via PATCH /api/users/{id}.
    u = User(email=body.email.lower(), full_name=body.full_name, hashed_password=hash_password(body.password), role="CITIZEN",
             requested_role=None if role == "CITIZEN" else role,
             department=body.department, phone=body.phone, city=body.city, language=body.language)
    db.add(u)
    db.commit()
    db.refresh(u)
    audit(db, u.id, "REGISTER", "user", f"role={role}", request.client.host if request.client else "")
    return _tokens(u)


def _login(email: str, password: str, request: Request, db: Session):
    u = db.query(User).filter(User.email == email.lower()).first()
    if not u or not verify_password(password, u.hashed_password):
        audit(db, None, "LOGIN_FAILED", "user", email, request.client.host if request.client else "")
        raise HTTPException(401, "Invalid email or password")
    if not u.is_active:
        raise HTTPException(403, "Account disabled")
    audit(db, u.id, "LOGIN", "user", "", request.client.host if request.client else "")
    return _tokens(u)


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    return _login(body.email, body.password, request, db)


@router.post("/token", include_in_schema=True, summary="OAuth2 password flow (Swagger 'Authorize')")
def token(form: OAuth2PasswordRequestForm = Depends(), request: Request = None, db: Session = Depends(get_db)):
    return _login(form.username, form.password, request, db)


@router.post("/refresh")
def refresh(body: dict, db: Session = Depends(get_db)):
    p = decode_token(body.get("refresh_token", ""))
    if p.get("type") != "refresh":
        raise HTTPException(401, "Not a refresh token")
    u = db.get(User, int(p["sub"]))
    if not u or not u.is_active:
        raise HTTPException(401, "User inactive")
    return _tokens(u)


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return user_out(user)


@router.put("/me")
def update_me(body: ProfileIn, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    for k, v in body.model_dump(exclude_none=True).items():
        if k == "language" and v not in ("en", "hi", "te", "ta", "mr"):
            raise HTTPException(400, "Unsupported language")
        if k == "theme" and v not in ("dark", "light", "system"):
            raise HTTPException(400, "Invalid theme")
        setattr(user, k, v)
    db.commit()
    audit(db, user.id, "PROFILE_UPDATE", "user", ",".join(body.model_dump(exclude_none=True).keys()))
    return user_out(user)


@router.post("/change-password")
def change_password(body: PasswordChangeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(400, "Current password incorrect")
    user.hashed_password = hash_password(body.new_password)
    db.commit()
    audit(db, user.id, "PASSWORD_CHANGE", "user")
    return {"ok": True}


@router.post("/forgot-password")
def forgot(body: ForgotIn, db: Session = Depends(get_db)):
    """Always returns 200 (no account enumeration). The reset link is delivered through the email
    adapter; in development (no SMTP) the token is returned so the flow can be demonstrated."""
    from app.engines.ops import notifier
    u = db.query(User).filter(User.email == body.email.lower()).first()
    resp = {"ok": True, "message": "If the account exists, a reset link has been sent."}
    if u:
        tok = secrets.token_urlsafe(32)
        db.add(PasswordReset(user_id=u.id, token=tok, expires_at=datetime.utcnow() + timedelta(minutes=30)))
        db.commit()
        rec = notifier.send("EMAIL", u.email, "FloodShield AI password reset", f"Reset token (valid 30 min): {tok}")
        audit(db, u.id, "PASSWORD_RESET_REQUEST", "user")
        if get_settings().env == "development" and rec["status"] != "SENT":
            resp["dev_reset_token"] = tok
    return resp


@router.post("/reset-password")
def reset(body: ResetIn, db: Session = Depends(get_db)):
    pr = db.query(PasswordReset).filter(PasswordReset.token == body.token, PasswordReset.used.is_(False)).first()
    if not pr or pr.expires_at < datetime.utcnow():
        raise HTTPException(400, "Invalid or expired token")
    u = db.get(User, pr.user_id)
    u.hashed_password = hash_password(body.new_password)
    pr.used = True
    db.commit()
    audit(db, u.id, "PASSWORD_RESET", "user")
    return {"ok": True}


@router.get("/roles")
def roles():
    return {"roles": ROLES, "self_register": sorted(SELF_REGISTER_ROLES), "permissions": ROLE_PERMISSIONS}


ROLE_PERMISSIONS = {
    "ADMIN": ["*"],
    "MUNICIPAL_OFFICER": ["view_all", "manage_alerts", "manage_incidents", "moderate_reports", "run_simulations", "maintenance", "reports"],
    "EMERGENCY_RESPONDER": ["view_all", "routing", "manage_incidents", "reports"],
    "ANALYST": ["view_all", "run_simulations", "historical", "validation", "reports"],
    "CITIZEN": ["view_public", "submit_reports", "routing", "helplines", "alerts"],
}


# ------------------------------------------------------------------ admin
class RoleIn(BaseModel):
    role: str | None = None
    is_active: bool | None = None


@admin.get("")
def list_users(_: User = Depends(require_roles("ADMIN")), db: Session = Depends(get_db)):
    return [user_out(u) for u in db.query(User).order_by(User.id).all()]


@admin.patch("/{uid}")
def update_user(uid: int, body: RoleIn, request: Request, actor: User = Depends(require_roles("ADMIN")), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "User not found")
    if body.role:
        if body.role.upper() not in ROLES:
            raise HTTPException(400, "Unknown role")
        u.role = body.role.upper()
        u.requested_role = None
    if body.is_active is not None:
        u.is_active = body.is_active
    db.commit()
    audit(db, actor.id, "USER_UPDATE", f"user:{uid}", body.model_dump_json(), request.client.host if request.client else "")
    return user_out(u)
