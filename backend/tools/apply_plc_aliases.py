"""Apply Node-RED camelCase / coil aliases to existing generic_plc telemetry tags."""
from __future__ import annotations

import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

from app.models import SessionLocal, TelemetryTag, now_ist  # noqa: E402
from app.telemetry_tag_defaults import default_tags_for_profile  # noqa: E402


def _alias_list(raw) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(a) for a in raw if a]
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [str(a) for a in data if a]
    except Exception:
        pass
    return []


db = SessionLocal()
defaults = {r["key"]: r for r in default_tags_for_profile("generic_plc")}
n = 0
for row in db.query(TelemetryTag).filter(TelemetryTag.profile_id == "generic_plc").all():
    spec = defaults.get(row.tag_key)
    if not spec:
        continue
    want = list(spec.get("aliases") or [])
    have = _alias_list(row.nodered_aliases)
    merged = list(have)
    changed = False
    for a in want:
        if a not in merged:
            merged.append(a)
            changed = True
    # keep D#### / 4xxxx from defaults helper (already in want via default_tags_for_profile)
    if (row.unit or "") != (spec.get("unit") or "") and spec.get("unit"):
        row.unit = spec["unit"]
        changed = True
    if spec.get("note") and (row.note or "") != spec["note"]:
        row.note = spec["note"]
        changed = True
    if changed:
        row.nodered_aliases = json.dumps(merged) if merged else None
        row.updated_at = now_ist()
        n += 1

if n:
    db.commit()
print(f"updated aliases/units on {n} tags")
for row in (
    db.query(TelemetryTag)
    .filter(TelemetryTag.profile_id == "generic_plc")
    .order_by(TelemetryTag.sort_order, TelemetryTag.id)
):
    print(f"  {row.tag_key:24} aliases={row.nodered_aliases} unit={row.unit or '-'}")
db.close()
