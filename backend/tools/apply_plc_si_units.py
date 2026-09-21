"""Apply SI / engineering units to existing generic_plc telemetry tags."""
from app.models import SessionLocal, TelemetryTag, now_ist
from app.telemetry_tag_defaults import default_tags_for_profile

db = SessionLocal()
defaults = {r["key"]: r for r in default_tags_for_profile("generic_plc")}
n = 0
for row in db.query(TelemetryTag).filter(TelemetryTag.profile_id == "generic_plc").all():
    spec = defaults.get(row.tag_key)
    if not spec or not spec.get("unit"):
        continue
    if (row.unit or "") != spec["unit"]:
        row.unit = spec["unit"]
        if spec.get("note"):
            row.note = spec["note"]
        row.updated_at = now_ist()
        n += 1
if n:
    db.commit()
print(f"updated units on {n} tags")
for row in (
    db.query(TelemetryTag)
    .filter(TelemetryTag.profile_id == "generic_plc")
    .order_by(TelemetryTag.sort_order, TelemetryTag.id)
):
    print(f"  {row.tag_key:22} unit={(row.unit or '-'):8} item={row.item}")
db.close()
