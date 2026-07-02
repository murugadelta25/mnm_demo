"""Part master, QC parameters, and work-instruction document management."""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy import or_, func
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
from pathlib import Path
from datetime import date, datetime
import shutil
import uuid
import json
import re

from ..models import (
    Part, PartDocument, PartDocumentHistory, PartQcParameter,
    get_db, now_ist,
)
from ..auth import get_current_user, require_role
from ..upload_limits import (
    MAX_PDF_BYTES,
    MAX_IMAGE_BYTES,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    MAX_OPTIONS_LIMIT,
    MAX_REVISION_HISTORY,
    save_upload_limited,
    clamp_page_size,
    assert_wi_doc_extension,
    wi_doc_max_bytes,
)

router = APIRouter(prefix="/api/parts", tags=["parts"])

UPLOAD_DIR = Path(__file__).parent.parent.parent / "static" / "work-instructions"
PART_IMAGE_DIR = Path(__file__).parent.parent.parent / "static" / "parts"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
PART_IMAGE_DIR.mkdir(parents=True, exist_ok=True)

DOC_TYPES = ("control_plan", "wi_visual", "wi_tray", "breakdown_sheet")

DEFAULT_QC_COLUMN_SCHEMA = [
    {"key": "method", "label": "Method"},
    {"key": "frequency", "label": "Freq"},
]


def _qc_column_schema(part: Part) -> list:
    raw = getattr(part, "qc_columns_json", None)
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list) and parsed:
                return parsed
        except json.JSONDecodeError:
            pass
    return list(DEFAULT_QC_COLUMN_SCHEMA)


def _safe_part_slug(part_no: str) -> str:
    """Flat filename slug — part numbers may contain / which breaks paths on disk."""
    slug = re.sub(r"[^\w.\-]+", "_", (part_no or "").strip())
    slug = re.sub(r"_+", "_", slug).strip("_")
    return slug or "part"


def _write_upload(dest: Path, upload: UploadFile) -> None:
    """Legacy sync write — prefer save_upload_limited in async upload handlers."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with dest.open("wb") as buf:
            shutil.copyfileobj(upload.file, buf)
    except OSError as exc:
        raise HTTPException(500, f"Failed to save file: {exc}") from exc


def _part_summary_out(part: Part, db: Session) -> dict:
    qc_rows = (
        db.query(PartQcParameter.parameter)
        .filter(PartQcParameter.part_id == part.id, PartQcParameter.active == 1)
        .order_by(PartQcParameter.seq_no)
        .limit(8)
        .all()
    )
    qc_count = (
        db.query(PartQcParameter)
        .filter(PartQcParameter.part_id == part.id, PartQcParameter.active == 1)
        .count()
    )
    return {
        "id": part.id,
        "part_no": part.part_no,
        "model_variant": part.model_variant,
        "description": part.description,
        "image_url": part.image_url,
        "active": part.active,
        "qc_param_count": qc_count,
        "qc_parameter_preview": [r[0] for r in qc_rows if r[0]],
    }


def _apply_part_search(q, search: Optional[str]):
    if not search or not search.strip():
        return q
    term = f"%{search.strip().lower()}%"
    return q.filter(
        or_(
            func.lower(Part.part_no).like(term),
            func.lower(func.coalesce(Part.model_variant, "")).like(term),
            func.lower(func.coalesce(Part.description, "")).like(term),
            func.lower(func.coalesce(Part.tool_no, "")).like(term),
        )
    )


def _normalize_model_variant(part_no: str, model_variant: Optional[str]) -> str:
    """Use part_no when planning variant is empty or a short numeric placeholder (e.g. '00')."""
    pn = (part_no or "").strip()
    mv = (model_variant or "").strip()
    if not pn:
        return mv
    if not mv or mv == pn:
        return pn
    if len(mv) <= 3 and mv.isdigit():
        return pn
    return mv


class QcParamIn(BaseModel):
    seq_no: int = 1
    parameter: str
    std_value: Optional[str] = None
    method: Optional[str] = None
    frequency: Optional[str] = None
    is_numeric: bool = False
    lsl: Optional[float] = None
    usl: Optional[float] = None
    extra_columns: List[dict] = []
    active: int = 1


class PartCreate(BaseModel):
    part_no: str
    model_variant: Optional[str] = None
    description: Optional[str] = None
    tool_no: Optional[str] = None
    no_of_cavity: int = 1
    production_section: Optional[str] = None
    operation_code: Optional[str] = None
    operation_name: Optional[str] = None
    process_time: Optional[float] = None
    loading_unloading: float = 10
    qc_column_schema: List[dict] = []
    qc_parameters: List[QcParamIn] = []


class PartUpdate(PartCreate):
    active: int = 1


def _qc_param_rows(part_id: int, qc_parameters: List[QcParamIn]):
    rows = []
    for qp in qc_parameters:
        rows.append(PartQcParameter(
            part_id=part_id,
            seq_no=qp.seq_no,
            parameter=qp.parameter,
            std_value=qp.std_value,
            method=qp.method,
            frequency=qp.frequency,
            is_numeric=1 if qp.is_numeric else 0,
            lsl=qp.lsl if qp.is_numeric else None,
            usl=qp.usl if qp.is_numeric else None,
            extra_columns_json=json.dumps(qp.extra_columns or []),
            active=qp.active,
            created_at=now_ist(),
        ))
    return rows


def _cycle_time(part: Part) -> float:
    return float(part.process_time or 0) + float(part.loading_unloading or 0)


def _part_out(part: Part, db: Session) -> dict:
    docs = db.query(PartDocument).filter(
        PartDocument.part_id == part.id,
        PartDocument.is_current == 1,
    ).all()
    qc = db.query(PartQcParameter).filter(
        PartQcParameter.part_id == part.id,
        PartQcParameter.active == 1,
    ).order_by(PartQcParameter.seq_no).all()
    return {
        "id": part.id,
        "part_no": part.part_no,
        "model_variant": part.model_variant,
        "description": part.description,
        "tool_no": part.tool_no,
        "no_of_cavity": part.no_of_cavity,
        "production_section": part.production_section,
        "operation_code": part.operation_code,
        "operation_name": part.operation_name,
        "process_time": float(part.process_time) if part.process_time else None,
        "loading_unloading": float(part.loading_unloading) if part.loading_unloading else 10,
        "cycle_time": _cycle_time(part),
        "active": part.active,
        "image_url": part.image_url,
        "qc_column_schema": _qc_column_schema(part),
        "documents": [
            {
                "id": d.id,
                "doc_type": d.doc_type,
                "revision": d.revision,
                "rev_date": d.rev_date.isoformat() if d.rev_date else None,
                "file_url": d.file_url,
                "notes": d.notes,
            }
            for d in docs
        ],
        "qc_parameters": [
            {
                "id": q.id,
                "seq_no": q.seq_no,
                "parameter": q.parameter,
                "std_value": q.std_value,
                "method": q.method,
                "frequency": q.frequency,
                "is_numeric": bool(q.is_numeric),
                "lsl": float(q.lsl) if q.lsl is not None else None,
                "usl": float(q.usl) if q.usl is not None else None,
                "extra_columns": json.loads(q.extra_columns_json or "[]"),
            }
            for q in qc
        ],
    }


def _find_part_by_variant(db: Session, model_variant: str) -> Optional[Part]:
    if not model_variant:
        return None
    v = model_variant.strip()
    part = db.query(Part).filter(Part.part_no == v, Part.active == 1).first()
    if part:
        return part
    return db.query(Part).filter(Part.model_variant == v, Part.active == 1).first()


@router.get("/options")
def list_part_options(
    active_only: bool = Query(True),
    search: Optional[str] = None,
    limit: int = Query(100, ge=1, le=MAX_OPTIONS_LIMIT),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Lightweight part list for dropdowns (no QC/doc payload)."""
    q = db.query(Part)
    if active_only:
        q = q.filter(Part.active == 1)
    q = _apply_part_search(q, search)
    rows = q.order_by(Part.part_no).limit(limit).all()
    return [
        {
            "id": p.id,
            "part_no": p.part_no,
            "model_variant": p.model_variant,
            "description": p.description,
            "tool_no": p.tool_no,
            "process_time": float(p.process_time) if p.process_time else None,
            "loading_unloading": float(p.loading_unloading) if p.loading_unloading else 10,
            "cycle_time": _cycle_time(p),
        }
        for p in rows
    ]


@router.get("/")
def list_parts(
    active_only: bool = Query(True),
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Paginated part summaries for Knowledge Base (full detail via GET /{part_id})."""
    page_size = clamp_page_size(page_size)
    q = db.query(Part)
    if active_only:
        q = q.filter(Part.active == 1)
    q = _apply_part_search(q, search)
    total = q.count()
    parts = (
        q.order_by(Part.part_no)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    pages = max(1, (total + page_size - 1) // page_size)
    return {
        "items": [_part_summary_out(p, db) for p in parts],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": pages,
    }


@router.get("/by-variant/{model_variant}")
def get_by_variant(model_variant: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    part = _find_part_by_variant(db, model_variant)
    if not part:
        raise HTTPException(404, f"No part master found for variant '{model_variant}'")
    return _part_out(part, db)


@router.get("/documents/revisions")
def list_all_revisions(
    part_id: Optional[int] = None,
    doc_type: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Centralized revision listing — paginated to protect large historic catalogs."""
    page_size = clamp_page_size(page_size)

    q = db.query(PartDocument).join(Part, Part.id == PartDocument.part_id)
    if part_id:
        q = q.filter(PartDocument.part_id == part_id)
    if doc_type:
        q = q.filter(PartDocument.doc_type == doc_type)
    current_total = q.count()
    docs = (
        q.order_by(Part.part_no, PartDocument.doc_type, PartDocument.is_current.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    part_ids = {d.part_id for d in docs}
    part_map = {
        p.id: p.part_no
        for p in db.query(Part).filter(Part.id.in_(part_ids)).all()
    } if part_ids else {}
    result = []
    for d in docs:
        result.append({
            "id": d.id,
            "part_id": d.part_id,
            "part_no": part_map.get(d.part_id),
            "doc_type": d.doc_type,
            "revision": d.revision,
            "rev_date": d.rev_date.isoformat() if d.rev_date else None,
            "file_url": d.file_url,
            "is_current": d.is_current,
            "uploaded_at": d.uploaded_at.isoformat() if d.uploaded_at else None,
        })

    history_q = db.query(PartDocumentHistory).join(Part, Part.id == PartDocumentHistory.part_id)
    if part_id:
        history_q = history_q.filter(PartDocumentHistory.part_id == part_id)
    if doc_type:
        history_q = history_q.filter(PartDocumentHistory.doc_type == doc_type)
    history_total = history_q.count()
    history_cap = min(page_size, MAX_REVISION_HISTORY)
    history = (
        history_q.order_by(PartDocumentHistory.archived_at.desc())
        .offset((page - 1) * history_cap)
        .limit(history_cap)
        .all()
    )
    hist_part_ids = {h.part_id for h in history}
    hist_part_map = {
        p.id: p.part_no
        for p in db.query(Part).filter(Part.id.in_(hist_part_ids)).all()
    } if hist_part_ids else {}
    hist_out = []
    for h in history:
        hist_out.append({
            "id": h.id,
            "part_id": h.part_id,
            "part_no": hist_part_map.get(h.part_id),
            "doc_type": h.doc_type,
            "revision": h.revision,
            "rev_date": h.rev_date.isoformat() if h.rev_date else None,
            "file_url": h.file_url,
            "archived_at": h.archived_at.isoformat() if h.archived_at else None,
        })
    current_pages = max(1, (current_total + page_size - 1) // page_size)
    history_pages = max(1, (history_total + history_cap - 1) // history_cap)
    return {
        "current": result,
        "current_total": current_total,
        "current_page": page,
        "current_pages": current_pages,
        "history": hist_out,
        "history_total": history_total,
        "history_page": page,
        "history_pages": history_pages,
        "page_size": page_size,
    }


@router.get("/{part_id}")
def get_part(part_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    part = db.query(Part).filter(Part.id == part_id).first()
    if not part:
        raise HTTPException(404, "Part not found")
    return _part_out(part, db)


@router.post("/")
def create_part(
    data: PartCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role("supervisor", "admin")),
):
    if db.query(Part).filter(Part.part_no == data.part_no.strip()).first():
        raise HTTPException(400, "Part number already exists")
    part = Part(
        part_no=data.part_no.strip(),
        model_variant=_normalize_model_variant(data.part_no, data.model_variant),
        description=data.description,
        tool_no=data.tool_no,
        no_of_cavity=data.no_of_cavity,
        production_section=data.production_section,
        operation_code=data.operation_code,
        operation_name=data.operation_name,
        process_time=data.process_time,
        loading_unloading=data.loading_unloading,
        qc_columns_json=json.dumps(data.qc_column_schema or DEFAULT_QC_COLUMN_SCHEMA),
        created_by=user.id,
        created_at=now_ist(),
        updated_at=now_ist(),
    )
    db.add(part)
    db.flush()
    for row in _qc_param_rows(part.id, data.qc_parameters):
        db.add(row)
    db.commit()
    db.refresh(part)
    return _part_out(part, db)


@router.put("/{part_id}")
def update_part(
    part_id: int,
    data: PartUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role("supervisor", "admin")),
):
    part = db.query(Part).filter(Part.id == part_id).first()
    if not part:
        raise HTTPException(404, "Part not found")
    dup = db.query(Part).filter(Part.part_no == data.part_no.strip(), Part.id != part_id).first()
    if dup:
        raise HTTPException(400, "Part number already exists")
    part.part_no = data.part_no.strip()
    part.model_variant = _normalize_model_variant(data.part_no, data.model_variant)
    part.description = data.description
    part.tool_no = data.tool_no
    part.no_of_cavity = data.no_of_cavity
    part.production_section = data.production_section
    part.operation_code = data.operation_code
    part.operation_name = data.operation_name
    part.process_time = data.process_time
    part.loading_unloading = data.loading_unloading
    part.active = data.active
    part.qc_columns_json = json.dumps(data.qc_column_schema or DEFAULT_QC_COLUMN_SCHEMA)
    part.updated_at = now_ist()
    db.query(PartQcParameter).filter(PartQcParameter.part_id == part_id).delete()
    for row in _qc_param_rows(part.id, data.qc_parameters):
        db.add(row)
    db.commit()
    db.refresh(part)
    return _part_out(part, db)


@router.delete("/{part_id}")
def delete_part(
    part_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role("admin")),
):
    part = db.query(Part).filter(Part.id == part_id).first()
    if not part:
        raise HTTPException(404, "Part not found")
    part.active = 0
    part.updated_at = now_ist()
    db.commit()
    return {"ok": True}


@router.post("/{part_id}/image")
async def upload_part_image(
    part_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(require_role("supervisor", "admin")),
):
    part = db.query(Part).filter(Part.id == part_id).first()
    if not part:
        raise HTTPException(404, "Part not found")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        raise HTTPException(400, "Only image files are allowed")
    slug = _safe_part_slug(part.part_no)
    fname = f"{slug}_{uuid.uuid4().hex[:8]}{ext}"
    dest = PART_IMAGE_DIR / fname
    await save_upload_limited(file, dest, MAX_IMAGE_BYTES)
    part.image_url = f"/static/parts/{fname}"
    part.updated_at = now_ist()
    db.commit()
    return {"image_url": part.image_url}


@router.post("/{part_id}/documents/{doc_type}/upload")
async def upload_document(
    part_id: int,
    doc_type: str,
    revision: str = Query("0"),
    rev_date: Optional[date] = None,
    notes: Optional[str] = None,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(require_role("supervisor", "admin")),
):
    if doc_type not in DOC_TYPES:
        raise HTTPException(400, f"Invalid doc_type. Use one of: {DOC_TYPES}")
    part = db.query(Part).filter(Part.id == part_id).first()
    if not part:
        raise HTTPException(404, "Part not found")
    ext = Path(file.filename or "").suffix.lower()
    assert_wi_doc_extension(ext)
    slug = _safe_part_slug(part.part_no)
    safe_rev = re.sub(r"[^\w.\-]+", "_", (revision or "0").strip()) or "0"
    fname = f"{slug}_{doc_type}_{safe_rev}_{uuid.uuid4().hex[:8]}{ext}"
    dest = UPLOAD_DIR / fname
    await save_upload_limited(file, dest, wi_doc_max_bytes(ext))
    file_url = f"/static/work-instructions/{fname}"

    current = db.query(PartDocument).filter(
        PartDocument.part_id == part_id,
        PartDocument.doc_type == doc_type,
        PartDocument.is_current == 1,
    ).first()
    if current and current.file_url:
        db.add(PartDocumentHistory(
            part_id=part_id,
            doc_type=doc_type,
            revision=current.revision,
            rev_date=current.rev_date,
            file_url=current.file_url,
            archived_at=now_ist(),
            archived_by=user.id,
            notes=current.notes,
        ))
        current.is_current = 0
        db.flush()

    doc = PartDocument(
        part_id=part_id,
        doc_type=doc_type,
        revision=revision,
        rev_date=rev_date or date.today(),
        file_url=file_url,
        is_current=1,
        uploaded_by=user.id,
        uploaded_at=now_ist(),
        notes=notes,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return {
        "id": doc.id,
        "doc_type": doc.doc_type,
        "revision": doc.revision,
        "rev_date": doc.rev_date.isoformat() if doc.rev_date else None,
        "file_url": doc.file_url,
    }


@router.get("/{part_id}/documents/history")
def document_history(part_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    part = db.query(Part).filter(Part.id == part_id).first()
    if not part:
        raise HTTPException(404, "Part not found")
    current = db.query(PartDocument).filter(PartDocument.part_id == part_id).all()
    history = (
        db.query(PartDocumentHistory)
        .filter(PartDocumentHistory.part_id == part_id)
        .order_by(PartDocumentHistory.archived_at.desc())
        .limit(MAX_REVISION_HISTORY)
        .all()
    )
    return {
        "current": [
            {
                "id": d.id,
                "doc_type": d.doc_type,
                "revision": d.revision,
                "rev_date": d.rev_date.isoformat() if d.rev_date else None,
                "file_url": d.file_url,
                "is_current": d.is_current,
                "uploaded_at": d.uploaded_at.isoformat() if d.uploaded_at else None,
            }
            for d in current
        ],
        "history": [
            {
                "id": h.id,
                "doc_type": h.doc_type,
                "revision": h.revision,
                "rev_date": h.rev_date.isoformat() if h.rev_date else None,
                "file_url": h.file_url,
                "archived_at": h.archived_at.isoformat() if h.archived_at else None,
            }
            for h in history
        ],
    }
