#!/usr/bin/env python3
"""Export live plant config (machines, factory, tags, …) into database/seeds/.

Writes:
  database/seeds/plant_config_machines.json.gz
  database/seeds/plant_config_machines.json.gz.meta.json
  database/seeds/static/{machines,factory,parts,work-instructions}/…

SMTP password is stripped (public GitHub). Re-enter SMTP on the target IPC.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
SEED_DIR = ROOT / "database" / "seeds"
SEED = SEED_DIR / "plant_config_machines.json.gz"
SEED_META = SEED_DIR / "plant_config_machines.json.gz.meta.json"
SEED_STATIC = SEED_DIR / "static"

TABLES = [
    "users",
    "stations",
    "machines",
    "site_config",
    "parts",
    "part_qc_parameters",
    "part_documents",
    "telemetry_tags",
    "tool_groups",
    "tool_group_members",
    "tool_stocks",
    "email_groups",
    "email_recipients",
    "email_smtp_config",
]

STATIC_REF = re.compile(
    r"/?static/(machines|factory|parts|work-instructions)/([^\"'?\s#]+)",
    re.I,
)


def _load_env() -> None:
    env_file = BACKEND / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


def _row_to_dict(row) -> dict:
    return {k: (v if not hasattr(v, "isoformat") else v.isoformat()) for k, v in dict(row).items()}


def _sanitize(data: dict) -> dict:
    rows = data.get("email_smtp_config") or []
    for row in rows:
        if "email_password" in row:
            row["email_password"] = ""
        if "password" in row:
            row["password"] = ""
    return data


def _collect_static_refs(data: dict) -> set[tuple[str, str]]:
    found: set[tuple[str, str]] = set()

    def walk(obj):
        if isinstance(obj, dict):
            for v in obj.values():
                walk(v)
        elif isinstance(obj, list):
            for v in obj:
                walk(v)
        elif isinstance(obj, str):
            text = urlparse(obj).path if "://" in obj else obj
            for m in STATIC_REF.finditer(text):
                found.add((m.group(1).lower(), unquote(m.group(2).rstrip("\\/"))))

    walk(data)
    return found


def _copy_static(refs: set[tuple[str, str]]) -> list[str]:
    copied: list[str] = []
    for folder, name in sorted(refs):
        src = BACKEND / "static" / folder / name
        if not src.is_file():
            print(f"[export-seed] missing asset: {src}")
            continue
        dest_dir = SEED_STATIC / folder
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / name
        shutil.copy2(src, dest)
        copied.append(f"{folder}/{name}")
    # Always include .gitkeep placeholders
    for folder in ("machines", "factory", "parts", "work-instructions"):
        d = SEED_STATIC / folder
        d.mkdir(parents=True, exist_ok=True)
        keep = d / ".gitkeep"
        if not keep.exists():
            keep.write_text("", encoding="utf-8")
    return copied


def main() -> int:
    _load_env()
    sys.path.insert(0, str(BACKEND))
    os.chdir(BACKEND)

    from sqlalchemy import text
    from app.models import SessionLocal

    db = SessionLocal()
    data: dict[str, list] = {}
    try:
        for table in TABLES:
            try:
                rows = db.execute(text(f"SELECT * FROM `{table}`")).mappings().all()
                data[table] = [_row_to_dict(r) for r in rows]
            except Exception as exc:
                print(f"[export-seed] {table}: skip ({exc})")
                data[table] = []
    finally:
        db.close()

    data = _sanitize(data)
    refs = _collect_static_refs(data)
    copied = _copy_static(refs)

    SEED_DIR.mkdir(parents=True, exist_ok=True)
    with gzip.open(SEED, "wt", encoding="utf-8") as f:
        json.dump(data, f, default=str, ensure_ascii=False)

    size = SEED.stat().st_size
    meta = {
        "filename": SEED.name,
        "created_at": datetime.now().isoformat(),
        "kind": "config_machines_params",
        "tables": {t: len(data.get(t) or []) for t in TABLES},
        "static_assets": copied,
        "size_bytes": size,
        "note": (
            "Lean seed: stations, machines, site_config, telemetry_tags, parts, users, email. "
            "SMTP password cleared — set Email Settings on target IPC. "
            "Static assets under database/seeds/static/ are copied by restore_demo_seed.py."
        ),
    }
    SEED_META.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"[export-seed] wrote {SEED} ({size} bytes)")
    print(f"[export-seed] tables: {meta['tables']}")
    print(f"[export-seed] static assets: {len(copied)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
