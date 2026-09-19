"""JWT + password hashing + RBAC dependencies."""
from datetime import datetime, timedelta, timezone
from typing import Iterable
import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from .config import get_settings
from .database import get_db

settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

ROLES = ["ADMIN", "MUNICIPAL_OFFICER", "EMERGENCY_RESPONDER", "ANALYST", "CITIZEN"]
ROLE_RANK = {r: i for i, r in enumerate(reversed(ROLES))}  # ADMIN highest


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(sub: str, role: str, kind: str = "access") -> str:
    now = datetime.now(timezone.utc)
    exp = now + (timedelta(minutes=settings.access_token_minutes) if kind == "access" else timedelta(days=settings.refresh_token_days))
    return jwt.encode({"sub": sub, "role": role, "type": kind, "iat": now, "exp": exp}, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {e}")


def get_current_user(token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    from app.models import User
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User inactive")
    return user


def get_optional_user(token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    if not token:
        return None
    try:
        return get_current_user(token, db)
    except HTTPException:
        return None


def require_roles(*roles: str):
    allowed: Iterable[str] = roles

    def dep(user=Depends(get_current_user)):
        if user.role not in allowed and user.role != "ADMIN":
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Role {user.role} not permitted")
        return user
    return dep


OFFICER_ROLES = ("ADMIN", "MUNICIPAL_OFFICER", "EMERGENCY_RESPONDER", "ANALYST")
