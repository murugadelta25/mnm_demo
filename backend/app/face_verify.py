"""Lightweight operator face match against master reference photo (no image retention)."""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import List, Optional, Tuple

# Combined similarity score (0–1). Tuned for Haar + hist/NCC on shop tablets
# (lighting / angle vary). Lower = fewer false rejects of the same person.
MATCH_THRESHOLD = 0.35

_cv2 = None
_np = None
_import_error = None


def _ensure_cv2():
    """Lazy-load OpenCV so the API can start even if cv2 is not installed yet."""
    global _cv2, _np, _import_error
    if _cv2 is not None:
        return _cv2, _np
    if _import_error is not None:
        raise _import_error
    try:
        import cv2
        import numpy as np
        _cv2 = cv2
        _np = np
        return _cv2, _np
    except ImportError as e:
        _import_error = RuntimeError(
            "OpenCV (cv2) is not installed in this Python environment. "
            "Run: pip install opencv-python-headless numpy"
        )
        raise _import_error from e


def _apply_exif_orientation(image_path: Path) -> None:
    """Normalize phone selfie orientation so Haar can find the face."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return
    try:
        with Image.open(image_path) as im:
            fixed = ImageOps.exif_transpose(im)
            if fixed is im:
                return
            # Always save as JPEG for OpenCV reliability
            if fixed.mode not in ("RGB", "L"):
                fixed = fixed.convert("RGB")
            fixed.save(image_path, format="JPEG", quality=92)
    except Exception:
        return


def _read_gray(image_path: Path):
    cv2, np = _ensure_cv2()
    _apply_exif_orientation(image_path)
    img = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if img is None:
        # Fallback for odd encodings
        try:
            data = np.fromfile(str(image_path), dtype=np.uint8)
            img = cv2.imdecode(data, cv2.IMREAD_COLOR)
        except Exception:
            img = None
    if img is None:
        return None
    # Downscale very large tablet photos for faster / more stable detection
    h, w = img.shape[:2]
    max_side = max(h, w)
    if max_side > 1280:
        scale = 1280.0 / max_side
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Improve contrast under factory lighting
    try:
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)
    except Exception:
        gray = cv2.equalizeHist(gray)
    return gray


def _detect_faces(gray) -> List[tuple]:
    """Try several Haar cascades / params — tablet selfies often need looser settings."""
    cv2, _ = _ensure_cv2()
    cascade_names = (
        "haarcascade_frontalface_default.xml",
        "haarcascade_frontalface_alt2.xml",
        "haarcascade_frontalface_alt.xml",
    )
    param_sets = (
        dict(scaleFactor=1.05, minNeighbors=3, minSize=(48, 48)),
        dict(scaleFactor=1.1, minNeighbors=4, minSize=(60, 60)),
        dict(scaleFactor=1.2, minNeighbors=5, minSize=(80, 80)),
    )
    found: List[tuple] = []
    for name in cascade_names:
        path = cv2.data.haarcascades + name
        cascade = cv2.CascadeClassifier(path)
        if cascade.empty():
            continue
        for params in param_sets:
            try:
                faces = cascade.detectMultiScale(gray, **params)
            except Exception:
                continue
            if faces is None or len(faces) == 0:
                continue
            for (x, y, w, h) in faces:
                found.append((int(x), int(y), int(w), int(h)))
            if found:
                break
        if found:
            break
    return found


def _largest_face(gray) -> Optional[tuple]:
    faces = _detect_faces(gray)
    if not faces:
        return None
    return max(faces, key=lambda f: f[2] * f[3])


def _face_roi(image_path: Path):
    """Return equalized 128×128 face ROI, or None if no face."""
    cv2, _ = _ensure_cv2()
    gray = _read_gray(image_path)
    if gray is None:
        return None
    box = _largest_face(gray)
    if not box:
        return None
    x, y, w, h = box
    # Slight padding helps when crop is tight
    pad = int(0.08 * max(w, h))
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(gray.shape[1], x + w + pad)
    y1 = min(gray.shape[0], y + h + pad)
    roi = gray[y0:y1, x0:x1]
    if roi.size == 0:
        return None
    roi = cv2.resize(roi, (128, 128), interpolation=cv2.INTER_AREA)
    return roi


def _hist_score(a, b) -> float:
    cv2, _ = _ensure_cv2()
    ha = cv2.calcHist([a], [0], None, [64], [0, 256])
    hb = cv2.calcHist([b], [0], None, [64], [0, 256])
    cv2.normalize(ha, ha)
    cv2.normalize(hb, hb)
    score = float(cv2.compareHist(ha, hb, cv2.HISTCMP_CORREL))
    # Correlation is [-1, 1]; negatives mean dissimilar → 0
    return max(0.0, min(1.0, score))


def _ncc_score(a, b) -> float:
    """Normalized cross-correlation template match (0–1)."""
    cv2, np = _ensure_cv2()
    try:
        a32 = a.astype(np.float32)
        b32 = b.astype(np.float32)
        res = cv2.matchTemplate(a32, b32, cv2.TM_CCOEFF_NORMED)
        score = float(res[0][0])
        return max(0.0, min(1.0, score))
    except Exception:
        return 0.0


def _orb_score(a, b) -> float:
    """ORB feature match ratio (0–1). Soft signal — lighting tolerant."""
    cv2, _ = _ensure_cv2()
    try:
        orb = cv2.ORB_create(nfeatures=400)
        kp1, des1 = orb.detectAndCompute(a, None)
        kp2, des2 = orb.detectAndCompute(b, None)
        if des1 is None or des2 is None or len(kp1) < 8 or len(kp2) < 8:
            return 0.0
        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
        matches = bf.knnMatch(des1, des2, k=2)
        good = 0
        total = 0
        for pair in matches:
            if len(pair) < 2:
                continue
            m, n = pair
            total += 1
            if m.distance < 0.78 * n.distance:
                good += 1
        if total == 0:
            return 0.0
        return max(0.0, min(1.0, good / max(12, total)))
    except Exception:
        return 0.0


def compare_faces(reference_path: Path, live_path: Path) -> Tuple[bool, float, str]:
    """
    Compare reference master photo vs live capture.
    Returns (verified, score, message). Live file should be deleted by caller.
    """
    try:
        _ensure_cv2()
    except RuntimeError as e:
        return False, 0.0, str(e)

    try:
        if not reference_path.exists():
            return False, 0.0, (
                "No reference photo on file for this operator. "
                "Ask admin to upload one in User Management."
            )

        ref_roi = _face_roi(reference_path)
        if ref_roi is None:
            return False, 0.0, (
                "Reference photo has no detectable face. "
                "Re-upload a clear front-facing photo in Operator / User Management."
            )

        live_roi = _face_roi(live_path)
        if live_roi is None:
            return False, 0.0, (
                "No face detected in live capture. "
                "Hold the tablet at eye level, face the camera, and use better lighting."
            )

        hist = _hist_score(ref_roi, live_roi)
        ncc = _ncc_score(ref_roi, live_roi)
        orb = _orb_score(ref_roi, live_roi)
        # Weight: appearance hist + pixel alignment + feature matches
        score = (0.40 * hist) + (0.40 * ncc) + (0.20 * orb)
        score = round(float(score), 3)
        verified = score >= MATCH_THRESHOLD
        if verified:
            return True, score, "Face verified against operator master photo."
        return (
            False,
            score,
            f"Face does not match operator master photo (score {score:.2f}, need {MATCH_THRESHOLD:.2f}). "
            "Retake a clear front-facing photo, or use password-only login.",
        )
    except Exception as e:
        # Never bubble as HTTP 500 — return a safe failure message
        return False, 0.0, f"Face verification failed ({type(e).__name__}: {e})"


def save_temp_upload(upload_bytes: bytes, suffix: str = ".jpg") -> Path:
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(upload_bytes)
    tmp.close()
    return Path(tmp.name)
