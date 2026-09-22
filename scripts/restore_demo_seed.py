#!/usr/bin/env python3
"""Restore lean plant config/machines seed into an empty-ish database.

Only loads when machines table is empty (or --force). Used by setup-database.sh
after first-time schema creation so Ubuntu demos get machines + telemetry tags.
"""
from __future__ import annotations

import gzip
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
SEED = ROOT / "database" / "seeds" / "plant_config_machines.json.gz"
SEED_STATIC = ROOT / "database" / "seeds" / "static"

# Load order matters for FKs
TABLE_ORDER = [
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


def _copy_seed_static() -> int:
    """Copy packaged factory/machine/part images into backend/static/."""
    import shutil

    if not SEED_STATIC.is_dir():
        return 0
    copied = 0
    for folder in ("machines", "factory", "parts", "work-instructions"):
        src_dir = SEED_STATIC / folder
        if not src_dir.is_dir():
            continue
        dest_dir = BACKEND / "static" / folder
        dest_dir.mkdir(parents=True, exist_ok=True)
        for src in src_dir.iterdir():
            if not src.is_file() or src.name.startswith("."):
                continue
            shutil.copy2(src, dest_dir / src.name)
            copied += 1
    if copied:
        print(f"[demo-seed] copied {copied} static asset(s) → backend/static/")
    return copied


def main() -> int:
    force = "--force" in sys.argv
    if not SEED.exists():
        print(f"[demo-seed] no seed at {SEED} — skip")
        return 0

    # Always refresh packaged images (safe; does not overwrite DB)
    _copy_seed_static()

    sys.path.insert(0, str(BACKEND))
    os.chdir(BACKEND)
    env_file = BACKEND / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

    from sqlalchemy import text
    from app.models import SessionLocal, engine

    with gzip.open(SEED, "rt", encoding="utf-8") as f:
        data = json.load(f)

    db = SessionLocal()
    try:
        try:
            machine_count = db.execute(text("SELECT COUNT(*) FROM machines")).scalar() or 0
        except Exception:
            machine_count = 0
        if machine_count > 0 and not force:
            print(f"[demo-seed] machines already present ({machine_count}) — skip DB rows")
            return 0

        if force:
            # Wipe in reverse FK order so a full plant snapshot can replace live config
            for table in reversed(TABLE_ORDER):
                if table == "users":
                    continue  # keep local login accounts unless rows re-inserted by id
                try:
                    db.execute(text(f"DELETE FROM `{table}`"))
                except Exception:
                    pass

        restored = []
        for table in TABLE_ORDER:
            rows = data.get(table) or []
            if not rows:
                continue
            # Skip if table missing
            try:
                db.execute(text(f"SELECT 1 FROM `{table}` LIMIT 1"))
            except Exception:
                continue
            if not force:
                try:
                    existing = db.execute(text(f"SELECT COUNT(*) FROM `{table}`")).scalar() or 0
                except Exception:
                    existing = 0
                if existing > 0 and table != "site_config":
                    continue
            cols = list(rows[0].keys())
            col_sql = ", ".join(f"`{c}`" for c in cols)
            placeholders = ", ".join(f":{c}" for c in cols)
            # site_config: replace single row
            if table == "site_config" and not force:
                db.execute(text("DELETE FROM site_config"))
            for row in rows:
                params = {c: row.get(c) for c in cols}
                try:
                    db.execute(
                        text(
                            f"INSERT INTO `{table}` ({col_sql}) VALUES ({placeholders}) "
                            f"ON DUPLICATE KEY UPDATE {cols[0]}=VALUES({cols[0]})"
                        ),
                        params,
                    )
                except Exception:
                    # Fallback without ON DUPLICATE for odd schemas
                    try:
                        db.execute(
                            text(f"INSERT IGNORE INTO `{table}` ({col_sql}) VALUES ({placeholders})"),
                            params,
                        )
                    except Exception as exc:
                        print(f"[demo-seed] {table} row skip: {exc}")
            restored.append(f"{table}:{len(rows)}")
        db.commit()
        print(f"[demo-seed] restored {', '.join(restored) or 'nothing'}")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
