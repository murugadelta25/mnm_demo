"""One-off: re-file AH PLC kit tags onto the Live screen and backfill address aliases.

The seven rows were configured by hand before `telemetry_tag_defaults.py` existed, so they
landed in group 'other' with no aliases — a reading published as 'D204' or '40205' would not
map, and the editor listed them outside Live Tags.

Run from the backend directory: python migrate_plc_tags.py
"""
import json

from app.models import SessionLocal, TelemetryTag, now_ist
from app.telemetry_tag_defaults import default_tags_for_profile

PROFILE_ID = "generic_plc"


def main() -> None:
    db = SessionLocal()
    try:
        defaults = {row["key"]: row for row in default_tags_for_profile(PROFILE_ID)}
        rows = db.query(TelemetryTag).filter(TelemetryTag.profile_id == PROFILE_ID).all()
        changed = 0
        for row in rows:
            spec = defaults.get(row.tag_key)
            if not spec:
                continue
            before = (row.group_name, row.nodered_aliases, row.item, row.note)
            if (row.group_name or "other") != "live":
                row.group_name = "live"
            if not row.nodered_aliases and spec["aliases"]:
                row.nodered_aliases = json.dumps(spec["aliases"])
            row.item = spec["item"]
            if not (row.note or "").strip():
                row.note = spec["note"]
            if (row.group_name, row.nodered_aliases, row.item, row.note) != before:
                row.updated_at = now_ist()
                changed += 1
        if changed:
            db.commit()
        print(f"updated {changed} of {len(rows)} {PROFILE_ID} tags")
        for row in (
            db.query(TelemetryTag)
            .filter(TelemetryTag.profile_id == PROFILE_ID)
            .order_by(TelemetryTag.sort_order, TelemetryTag.id)
        ):
            print(
                f"  {row.tag_key:22} {row.item:22} group={row.group_name:6} "
                f"modbus={row.modbus:7} eip={row.eip_pn:6} aliases={row.nodered_aliases}"
            )
    finally:
        db.close()


if __name__ == "__main__":
    main()
