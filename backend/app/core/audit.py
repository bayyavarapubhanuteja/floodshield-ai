"""Audit logging helper."""
from sqlalchemy.orm import Session


def audit(db: Session, user_id: int | None, action: str, resource: str, detail: str = "", ip: str = "") -> None:
    from app.models import AuditLog
    db.add(AuditLog(user_id=user_id, action=action, resource=resource, detail=detail[:2000], ip=ip))
    db.commit()
