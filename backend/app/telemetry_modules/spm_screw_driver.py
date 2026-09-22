"""
SPM Screw Driver telemetry — Delta ECM / Edge TorqueValue · PositionValue · Result.

Isolated from Servo Press, AH PLC, and Linear Motor. Only runs when profile_id == spm.

Production counters:
  Result 1 (OK)  → good_count += 1 (edge-triggered)
  Result 2 (NG)  → reject_count += 1 (edge-triggered)
  total          = good_count + reject_count

OEE uses the same Modbus KPI helper with SPM phase buckets
(driving / result / idle) tracked in runtime.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from .base import TelemetryFamilyModule

SPM_SCREW_DRIVER_ALIASES: dict[str, str] = {
    "device type": "device_type",
    "device_type": "device_type",
    "devicetype": "device_type",
    "torquevalue": "torque",
    "torque value": "torque",
    "torque_value": "torque",
    "torque": "torque",
    "positionvalue": "position_value",
    "position value": "position_value",
    "position_value": "position_value",
    "result": "pressing_result",
    "pressing result": "pressing_result",
    "pressing_result": "pressing_result",
    "screw result": "pressing_result",
    "tightening result": "pressing_result",
    "runningstatus": "running_status",
    "running status": "running_status",
    "running_status": "running_status",
    "run status": "running_status",
}

_TILE_ACCENTS = ("#f59e0b", "#3b82f6", "#22c55e", "#8b5cf6")

# Delta Screw Driver RunningStatus (Edge RunningStatus;Int16)
RUNNING_STATUS_LABELS = {
    4: "Ready",
    8: "Running",
    5: "Ready and OK",
}


def decode_running_status(code: Any) -> dict:
    """4=Ready · 8=Running · 5=Ready and OK."""
    num = _to_float(code)
    if num is None:
        return {"code": None, "label": "—", "running": False}
    c = int(num)
    return {
        "code": c,
        "label": RUNNING_STATUS_LABELS.get(c, f"Status {c}"),
        "running": c == 8,
    }


def _to_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _display_value(value: Any, unit: Optional[str] = None) -> Optional[str]:
    if value is None:
        return None
    text = f"{value:g}" if isinstance(value, float) else str(value)
    return f"{text} {unit}" if unit else text


def _torque_nm(value: Any) -> Optional[float]:
    """Edge TorqueValue Int16 is milli-Nm → engineering Nm."""
    num = _to_float(value)
    if num is None:
        return None
    return num / 1000.0


def _display_torque_nm(value: Any) -> Optional[str]:
    nm = _torque_nm(value)
    if nm is None:
        return None
    text = f"{nm:g}"
    return f"{text} Nm"


def _display_position_deg(value: Any) -> Optional[str]:
    text = _display_value(value)
    if text is None:
        return None
    return f"{text} °"


def update_screw_driver_runtime(
    runtime: Optional[dict],
    mapped: dict,
    *,
    now: Optional[datetime] = None,
) -> dict:
    """
    SPM-only runtime:
      - edge-count OK / NG results into good / reject
      - total = good + reject
      - phase time buckets for OEE (driving / result / idle)
    """
    rt = dict(runtime or {})
    now = now or datetime.now()
    scaled = mapped.get("scaled") if isinstance(mapped.get("scaled"), dict) else {}
    result_info = mapped.get("pressing_result") if isinstance(mapped.get("pressing_result"), dict) else {}

    good = int(rt.get("sd_good_count") or 0)
    reject = int(rt.get("sd_reject_count") or 0)
    last_code = rt.get("sd_last_result_code")
    try:
        last_code_i = int(last_code) if last_code is not None else None
    except (TypeError, ValueError):
        last_code_i = None

    curr_code = result_info.get("code")
    try:
        curr_code_i = int(curr_code) if curr_code is not None else None
    except (TypeError, ValueError):
        curr_code_i = None

    # Edge: entering a latched Result (1=OK, 2=NG) from a different/cleared code
    if curr_code_i in (1, 2) and curr_code_i != last_code_i:
        if curr_code_i == 1:
            good += 1
        else:
            reject += 1
        rt["sd_last_result_code"] = curr_code_i
        rt["cycles_delta"] = float(rt.get("cycles_delta") or 0) + 1.0
    elif curr_code_i in (None, 0):
        # Cleared between cycles so the next 1/2 counts again
        rt["sd_last_result_code"] = curr_code_i if curr_code_i is not None else 0

    rt["sd_good_count"] = good
    rt["sd_reject_count"] = reject
    total = good + reject
    rt["last_good"] = float(good)
    rt["last_reject"] = float(reject)
    rt["last_total"] = float(total)

    # Phase for AR: RunningStatus 8 = driving; 5 / latched Result = result; 4 = idle
    pos = _to_float(scaled.get("position_value"))
    run_info = decode_running_status(scaled.get("running_status"))
    if run_info.get("running"):
        phase_key = "pressing"
    elif run_info.get("code") == 5 or (
        result_info.get("ok") is not None and curr_code_i in (1, 2)
    ):
        phase_key = "result"
    elif run_info.get("code") == 4:
        phase_key = "idle"
    elif pos is not None and abs(pos) > 0:
        phase_key = "pressing"
    else:
        phase_key = "idle"

    last_ts_raw = rt.get("last_ts")
    last_phase = rt.get("last_phase") or phase_key
    if last_ts_raw:
        try:
            last_ts = datetime.fromisoformat(str(last_ts_raw))
            dt = max(0.0, min((now - last_ts).total_seconds(), 30.0))
        except Exception:
            dt = 0.0
    else:
        dt = 0.0
        rt["started_at"] = now.isoformat(timespec="seconds")

    buckets = rt.setdefault("seconds", {
        "pressing": 0.0, "result": 0.0, "idle": 0.0, "alarm": 0.0, "other": 0.0,
    })
    if dt > 0 and last_phase in buckets:
        buckets[last_phase] = float(buckets.get(last_phase) or 0) + dt

    rt["last_ts"] = now.isoformat(timespec="seconds")
    rt["last_phase"] = phase_key
    rt["seconds"] = buckets
    # Spin direction only meaningful while Running (8); still store sign of PositionValue
    if pos is not None and pos > 0:
        rt["sd_spin_direction"] = 1
    elif pos is not None and pos < 0:
        rt["sd_spin_direction"] = -1
    else:
        rt["sd_spin_direction"] = 0
    rt["sd_running_status"] = run_info.get("code")
    rt["sd_is_running"] = bool(run_info.get("running"))
    return rt


def apply_screw_driver_production(mapped: dict, runtime: dict) -> dict:
    """Write accumulated good/reject/total into mapped production + scaled counters."""
    if not isinstance(mapped, dict):
        return mapped
    rt = runtime or {}
    good = int(rt.get("sd_good_count") or 0)
    reject = int(rt.get("sd_reject_count") or 0)
    total = good + reject
    mapped["production"] = {
        "total": total,
        "good": good,
        "reject": reject,
    }
    scaled = dict(mapped.get("scaled") or {})
    scaled["pass_amount"] = float(good)
    scaled["ng_amount"] = float(reject)
    scaled["total_amount"] = float(total)
    mapped["scaled"] = scaled

    current = dict(mapped.get("current") or {})
    current["torque"] = scaled.get("torque")
    current["position_value"] = scaled.get("position_value")
    if current.get("position_mm") is None and scaled.get("position_value") is not None:
        current["position_mm"] = scaled.get("position_value")
    # Nominal cycle time for PR when Edge has none — 3s typical hand-tool cycle
    if current.get("cycle_time_sec") is None:
        current["cycle_time_sec"] = float(rt.get("last_cycle_time_sec") or 3.0)
    mapped["current"] = current

    result_info = mapped.get("pressing_result") if isinstance(mapped.get("pressing_result"), dict) else {}
    run_info = decode_running_status(scaled.get("running_status"))
    mapped["screw_driver"] = {
        "spin_direction": rt.get("sd_spin_direction") or 0,
        "position_value": scaled.get("position_value"),
        "torque": scaled.get("torque"),
        "running_status": run_info.get("code"),
        "running_label": run_info.get("label"),
        "is_running": bool(run_info.get("running")),
        "result_label": result_info.get("label"),
        "result_ok": result_info.get("ok"),
        "good_count": good,
        "reject_count": reject,
        "total_count": total,
    }
    return mapped


class SpmScrewDriverTelemetryModule(TelemetryFamilyModule):
    module_id = "spm"
    label = "SPM Screw Driver"
    profile_ids = ("spm",)

    def describe(self) -> dict:
        return {
            "module_id": self.module_id,
            "label": self.label,
            "profile_ids": list(self.profile_ids),
            "screens": ["Live Status", "Cycle Result"],
            "edge_tags": ["TorqueValue", "PositionValue", "Result", "RunningStatus", "device_type"],
            "running_status": "4=Ready · 8=Running · 5=Ready and OK",
            "production": "Result OK→good, NG→reject; total=good+reject; OEE from Modbus KPI",
            "note": "Screw Driver only — spin animation when RunningStatus=8; CW/CCW from PositionValue sign.",
        }

    def base_aliases(self) -> dict[str, str]:
        return dict(SPM_SCREW_DRIVER_ALIASES)

    def enrich_mapped(self, mapped: dict[str, Any]) -> dict[str, Any]:
        """Build Screw Driver Current Values / Machine Status without touching press layouts."""
        if not isinstance(mapped, dict):
            return mapped

        scaled = dict(mapped.get("scaled") or {})
        raw = mapped.get("raw") if isinstance(mapped.get("raw"), dict) else {}
        result_info = mapped.get("pressing_result") if isinstance(mapped.get("pressing_result"), dict) else {}

        current = dict(mapped.get("current") or {})
        if current.get("position_mm") is None and scaled.get("position_value") is not None:
            current["position_mm"] = scaled.get("position_value")
        current["torque"] = scaled.get("torque")
        current["position_value"] = scaled.get("position_value")
        current["running_status"] = scaled.get("running_status")
        mapped["current"] = current

        run_info = decode_running_status(scaled.get("running_status"))

        if not (mapped.get("current_tiles") or []):
            result_label = result_info.get("label") or _display_value(scaled.get("pressing_result"))
            accent_ok = "#22c55e" if result_info.get("ok") else (
                "#ef4444" if result_info.get("ok") is False else "#8b5cf6"
            )
            mapped["current_tiles"] = [
                {
                    "key": "torque",
                    "label": "Torque",
                    "value": _display_value(_torque_nm(scaled.get("torque"))),
                    "unit": "Nm",
                    "accent": _TILE_ACCENTS[0],
                    "note": "TorqueValue ÷ 1000 → Nm (SPM Screw Driver)",
                },
                {
                    "key": "position_value",
                    "label": "Position",
                    "value": _display_value(scaled.get("position_value")),
                    "unit": "°",
                    "accent": _TILE_ACCENTS[1],
                    "note": "PositionValue → degrees (SPM Screw Driver)",
                },
                {
                    "key": "running_status",
                    "label": "Status",
                    "value": run_info.get("label"),
                    "unit": "",
                    "accent": "#3b82f6" if run_info.get("running") else "#8b5cf6",
                    "note": "RunningStatus · 4=Ready · 8=Running · 5=Ready and OK",
                },
                {
                    "key": "pressing_result",
                    "label": "Result",
                    "value": result_label,
                    "unit": "",
                    "accent": accent_ok,
                    "note": "Result · 1=OK · 2=NG",
                },
            ]

        io_status: list[dict] = []
        io_status.append({
            "label": "Status",
            "value": (
                f"{run_info.get('code')} · {run_info.get('label')}"
                if run_info.get("code") is not None
                else None
            ),
            "ok": True if run_info.get("running") else (None if run_info.get("code") is None else True),
        })
        io_status.append({
            "label": "Torque",
            "value": _display_torque_nm(scaled.get("torque")),
            "ok": scaled.get("torque") is not None,
        })
        io_status.append({
            "label": "Position",
            "value": _display_position_deg(scaled.get("position_value")),
            "ok": scaled.get("position_value") is not None,
        })
        result_label = result_info.get("label") or _display_value(scaled.get("pressing_result")) or "—"
        if result_info.get("reason") and result_info.get("ok") is False:
            result_label = f"{result_label} · {result_info['reason']}"
        io_status.append({
            "label": "Result",
            "value": result_label,
            "ok": result_info.get("ok"),
        })
        dtype = scaled.get("device_type") or raw.get("device_type")
        if dtype is not None:
            io_status.append({
                "label": "Device Type",
                "value": str(dtype),
                "ok": True,
            })
        mapped["io_status"] = io_status
        mapped["telemetry_module"] = self.module_id
        return mapped
