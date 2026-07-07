from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..feature_modules import feature_modules_payload
from ..models import get_db

router = APIRouter(prefix="/api/features", tags=["features"])


@router.get("/")
def get_public_features(db: Session = Depends(get_db)):
    """Public feature flags for customer UI (nav + route guards). No user auth required."""
    return feature_modules_payload(db)
