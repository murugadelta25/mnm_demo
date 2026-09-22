#!/usr/bin/env python3
"""Sync portal siteTitle / SITE_TITLE from CLIENT_NAME (deploy.env / db.config.json).

Fixes installs where the DB still has a previous customer title (e.g. Groz) after
the operator chose a new client name like MAHINDRA_HYD.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"


def _pretty_client_title(raw: str) -> str:
    name = (raw or "").strip()
    if not name:
        return "Production Monitoring System (PMS)"
    # MAHINDRA_HYD / mahindra-hyd → Mahindra Hyd
    spaced = re.sub(r"[_\-]+", " ", name)
    spaced = re.sub(r"\s+", " ", spaced).strip()
    titled = " ".join(
        w.upper() if w.upper() in {"PMS", "EAP", "CNC", "SPM", "PLC", "OEE"} else w.capitalize()
        for w in spaced.split(" ")
    )
    if titled.upper().endswith("(PMS)") or titled.upper().endswith("PMS"):
        return titled if "(PMS)" in titled.upper() else f"{titled}"
    return f"{titled} (PMS)"


def _load_client_name() -> str:
    env_client = (os.environ.get("CLIENT_NAME") or "").strip()
    if env_client:
        return env_client
    deploy = ROOT / "deploy.env"
    if deploy.exists():
        for line in deploy.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line.startswith("CLIENT_NAME="):
                val = line.split("=", 1)[1].strip().strip("'\"")
                if val:
                    return val
    db_cfg = ROOT / "database" / "db.config.json"
    if db_cfg.exists():
        try:
            data = json.loads(db_cfg.read_text(encoding="utf-8"))
            val = (data.get("clientName") or "").strip()
            if val:
                return val
        except Exception:
            pass
    return ""


def _stale_title(title: str, client_title: str) -> bool:
    t = (title or "").strip()
    if not t:
        return True
    low = t.lower()
    if "groz" in low:
        return True
    defaults = {
        "production monitoring system (pms)",
        "production monitoring system",
        "delta-eap-pms",
        "delta eap pms",
        "eap pms",
    }
    if low in defaults:
        return True
    # Title does not include this client name → treat as stale (other customer leftover)
    client_key = re.sub(r"[^a-z0-9]+", "", client_title.lower())
    title_key = re.sub(r"[^a-z0-9]+", "", low)
    if client_key and client_key not in title_key:
        return True
    return False


def _set_env_site_title(env_path: Path, title: str) -> None:
    if not env_path.exists():
        return
    lines = env_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    out = []
    found = False
    for line in lines:
        if line.startswith("SITE_TITLE="):
            out.append(f"SITE_TITLE={title}")
            found = True
        else:
            out.append(line)
    if not found:
        out.append(f"SITE_TITLE={title}")
    env_path.write_text("\n".join(out) + "\n", encoding="utf-8")


def apply_branding(force: bool = False) -> dict:
    sys.path.insert(0, str(BACKEND))
    os.chdir(BACKEND)

    # Load backend .env for DATABASE_URL
    env_file = BACKEND / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

    client = _load_client_name()
    title = _pretty_client_title(client)
    _set_env_site_title(env_file, title)

    from app.models import SessionLocal, SiteConfig  # noqa: WPS433

    db = SessionLocal()
    changed = False
    try:
        row = db.query(SiteConfig).first()
        cfg = {}
        if row and row.config_json:
            try:
                cfg = json.loads(row.config_json) or {}
            except Exception:
                cfg = {}
        factory = cfg.get("factory") if isinstance(cfg.get("factory"), dict) else {}
        if not isinstance(factory, dict):
            factory = {}
        current = (factory.get("siteTitle") or "").strip()
        should = force or _stale_title(current, title) or (client and not current)
        if should:
            factory["siteTitle"] = title
            # Rename placeholder / Groz factory entries to client plant name
            factories = factory.get("factories") if isinstance(factory.get("factories"), list) else []
            plant = re.sub(r"\s*\(PMS\)\s*$", "", title, flags=re.I).strip() or title
            for fac in factories:
                if not isinstance(fac, dict):
                    continue
                fname = str(fac.get("name") or "")
                if not fname or "groz" in fname.lower() or fname.lower() in {"plant", "factory", "delta india"}:
                    fac["name"] = plant
            factory["factories"] = factories
            cfg["factory"] = factory
            payload = json.dumps(cfg, ensure_ascii=False)
            if row:
                row.config_json = payload
            else:
                db.add(SiteConfig(config_json=payload))
            db.commit()
            changed = True
        return {
            "client": client,
            "siteTitle": title,
            "previous": current,
            "updated": changed,
        }
    finally:
        db.close()


def main() -> int:
    force = "--force" in sys.argv
    try:
        result = apply_branding(force=force)
    except Exception as exc:
        print(f"[branding] skipped: {exc}")
        return 0
    if result.get("updated"):
        print(
            f"[branding] siteTitle -> {result['siteTitle']!r}"
            f" (was {result.get('previous') or '-'!r}; client={result.get('client') or '-'})"
        )
    else:
        print(
            f"[branding] kept siteTitle={result.get('previous') or result.get('siteTitle')!r}"
            f" (client={result.get('client') or '-'})"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
