"""Factory / Line / Equipment overview aggregates (CNC / EAP — Line naming, not Zone)."""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..models import Machine, MachineStatusLog, ProductionPlan, Station, get_db, now_ist
from .config import _load_config
from .machines import _compute_status
from .machine_kpi import _compute_kpi
from .hourly_output import _load_config as _load_kpi_config

router = APIRouter(prefix="/api/overview", tags=["overview"])

# Productive vs non-productive for shift utilization (raw status log states)
_UPTIME_STATUSES = frozenset({"running"})
_FAILURE_STATUSES = frozenset({"breakdown", "alarm"})


def _as_naive_ist(dt: Optional[datetime]) -> Optional[datetime]:
    """Normalize aware/naive datetimes to naive IST wall-clock for duration math."""
    if dt is None:
        return None
    if getattr(dt, "tzinfo", None) is not None:
        try:
            import pytz
            return dt.astimezone(pytz.timezone("Asia/Kolkata")).replace(tzinfo=None)
        except Exception:
            return dt.replace(tzinfo=None)
    return dt


def _parse_hhmm(value: str) -> int:
    try:
        hh, mm = (value or "0:0").split(":")[:2]
        return int(hh) * 60 + int(mm)
    except Exception:
        return 0


def _shift_lookup_key(sh: Optional[dict]) -> str:
    """Stable key for a shift config entry: id → name → start."""
    if not sh:
        return ""
    return str(sh.get("id") or sh.get("name") or sh.get("start") or "").strip()


def _match_shift_at(cfg: dict, now: datetime) -> Optional[dict]:
    """Return the enabled shift whose window contains `now`, or None."""
    if getattr(now, "tzinfo", None) is not None:
        now = now.replace(tzinfo=None)
    hhmm = now.hour * 60 + now.minute
    for sh in (cfg.get("shifts") or []):
        if not sh.get("enabled", True):
            continue
        start_m = _parse_hhmm(sh.get("start") or "00:00")
        end_m = _parse_hhmm(sh.get("end") or "00:00")
        overnight = end_m <= start_m
        in_shift = (
            (hhmm >= start_m or hhmm < end_m) if overnight else (start_m <= hhmm < end_m)
        )
        if in_shift:
            return sh
    return None


def _resolve_active_shift_id(cfg: dict, now: Optional[datetime] = None) -> str:
    """Id/name/start key for the currently active enabled shift.

    Tracks the matched window first so a shift with a missing/falsy `id` (and
    name) does not fall through to the first enabled shift — that would skew
    KPI to the wrong window.
    """
    if now is None:
        now = now_ist()
    if getattr(now, "tzinfo", None) is not None:
        now = now.replace(tzinfo=None)
    matched = _match_shift_at(cfg, now)
    if matched is not None:
        # Prefer id/name; if absent, keep this shift via start rather than another
        return _shift_lookup_key(matched) or "A"
    enabled = [s for s in (cfg.get("shifts") or []) if s.get("enabled", True)]
    first = enabled[0] if enabled else None
    return _shift_lookup_key(first) or "A"


def _current_shift_window(cfg: dict) -> tuple[Optional[dict], datetime, datetime, datetime]:
    """Return (shift_def, shift_start, effective_end, now) for the active enabled shift."""
    now = now_ist()
    if getattr(now, "tzinfo", None) is not None:
        now = now.replace(tzinfo=None)
    sh = _match_shift_at(cfg, now)
    if not sh:
        return None, now, now, now
    start_m = _parse_hhmm(sh.get("start") or "00:00")
    end_m = _parse_hhmm(sh.get("end") or "00:00")
    overnight = end_m <= start_m
    hhmm = now.hour * 60 + now.minute
    # Overnight: if clock is before end, the shift started yesterday
    start_date = now.date()
    if overnight and hhmm < end_m:
        start_date = (now - timedelta(days=1)).date()
    shift_start = datetime.combine(start_date, datetime.min.time()) + timedelta(minutes=start_m)
    if overnight:
        shift_end = datetime.combine(start_date + timedelta(days=1), datetime.min.time()) + timedelta(minutes=end_m)
    else:
        shift_end = datetime.combine(start_date, datetime.min.time()) + timedelta(minutes=end_m)
    effective_end = min(now, shift_end)
    return sh, shift_start, effective_end, now


def _machine_shift_segments(
    db: Session,
    machine_id: int,
    shift_start: datetime,
    effective_end: datetime,
) -> list[dict]:
    """Build raw status duration segments for one machine in [shift_start, effective_end]."""
    if effective_end <= shift_start:
        return []
    prior = (
        db.query(MachineStatusLog)
        .filter(
            MachineStatusLog.machine_id == machine_id,
            MachineStatusLog.changed_at < shift_start,
        )
        .order_by(MachineStatusLog.changed_at.desc())
        .first()
    )
    logs = (
        db.query(MachineStatusLog)
        .filter(
            MachineStatusLog.machine_id == machine_id,
            MachineStatusLog.changed_at >= shift_start,
            MachineStatusLog.changed_at <= effective_end,
        )
        .order_by(MachineStatusLog.changed_at.asc())
        .all()
    )
    if not prior and not logs:
        return []

    timeline: list[tuple[datetime, str, Optional[str]]] = []
    if prior:
        timeline.append((shift_start, prior.status or "offline", prior.deviation_reason))
    elif logs:
        # No prior carry-over: project first in-shift status back to shift open.
        # Do not also append logs[0] below — timestamps differ so dedup would miss it.
        timeline.append((shift_start, logs[0].status or "offline", logs[0].deviation_reason))

    # When we seeded from logs[0] at shift_start, skip that log to avoid a duplicate
    # segment boundary at logs[0].changed_at with the same status.
    for log in (logs[1:] if (not prior and logs) else logs):
        st = log.status or "offline"
        if timeline and timeline[-1][0] == log.changed_at and timeline[-1][1] == st:
            continue
        timeline.append((log.changed_at, st, log.deviation_reason))

    segments = []
    for i, (t_start, status, reason) in enumerate(timeline):
        t_end = timeline[i + 1][0] if i + 1 < len(timeline) else effective_end
        seg_start = max(t_start, shift_start)
        seg_end = min(t_end, effective_end)
        if seg_end <= seg_start:
            continue
        seconds = (seg_end - seg_start).total_seconds()
        segments.append({
            "status": status,
            "seconds": seconds,
            "reason": (reason or "").strip() or None,
        })
    return segments


def _shift_utilization(db: Session, machines: list[Machine], cfg: dict) -> dict[str, Any]:
    """Aggregate current-shift utilization: uptime, downtime, MTTR, MTBF."""
    shift, shift_start, effective_end, now = _current_shift_window(cfg)
    empty = {
        "shift_id": shift.get("id") if shift else None,
        "shift_name": (shift.get("name") if shift else None) or "—",
        "as_of": now.isoformat(sep=" "),
        "uptime_min": 0.0,
        "downtime_min": 0.0,
        "available_min": 0.0,
        "utilization_pct": 0.0,
        # MTTR/MTBF are undefined with zero failures — do not substitute other downtime
        "mttr_min": None,
        "mtbf_min": None,
        "downtime_events": 0,
        "failure_events": 0,
        "machines_sampled": 0,
    }
    if not shift or not machines:
        return empty

    uptime_sec = 0.0
    downtime_sec = 0.0
    failure_sec = 0.0
    downtime_events = 0
    failure_events = 0
    status_sec: Counter[str] = Counter()
    sampled = 0

    for m in machines:
        segs = _machine_shift_segments(db, m.id, shift_start, effective_end)
        if not segs:
            continue
        sampled += 1
        prev_st = None
        for seg in segs:
            st = (seg["status"] or "offline").lower()
            sec = float(seg["seconds"] or 0)
            status_sec[st] += sec
            if st in _UPTIME_STATUSES:
                uptime_sec += sec
            else:
                downtime_sec += sec
                if st in _FAILURE_STATUSES:
                    # Failures are tracked only via failure_events (not also as
                    # downtime_events) so the first/only failure is not double-counted.
                    failure_sec += sec
                    if prev_st not in _FAILURE_STATUSES:
                        failure_events += 1
                elif (
                    prev_st is None
                    or prev_st in _UPTIME_STATUSES
                    or prev_st in _FAILURE_STATUSES
                ):
                    # New non-failure downtime episode: start of shift, leaving
                    # uptime, or leaving a failure (breakdown/alarm → idle/…).
                    # Do not re-count when already in non-failure downtime
                    # (e.g. idle → offline).
                    downtime_events += 1
            prev_st = st

    uptime_min = round(uptime_sec / 60.0, 1)
    downtime_min = round(downtime_sec / 60.0, 1)
    available_min = round((uptime_sec + downtime_sec) / 60.0, 1)
    util_pct = (
        round(100.0 * uptime_sec / (uptime_sec + downtime_sec), 1)
        if (uptime_sec + downtime_sec) > 0
        else 0.0
    )
    # MTTR = mean failure (repair) duration only — never average idle/setup/offline
    # into "repair time". Undefined when there are no failure events.
    mttr = (
        round((failure_sec / 60.0) / failure_events, 1)
        if failure_events
        else None
    )
    # MTBF = uptime / failures; undefined when there are no failures
    mtbf = round(uptime_min / failure_events, 1) if failure_events else None

    return {
        "shift_id": shift.get("id"),
        "shift_name": shift.get("name") or shift.get("id") or "—",
        # Same clock as empty path: snapshot time of this computation (not shift trunc)
        "as_of": now.isoformat(sep=" "),
        "uptime_min": uptime_min,
        "downtime_min": downtime_min,
        "available_min": available_min,
        "utilization_pct": util_pct,
        "mttr_min": mttr,
        "mtbf_min": mtbf,
        "downtime_events": downtime_events,
        "failure_events": failure_events,
        "machines_sampled": sampled,
        "status_minutes": {
            k: round(v / 60.0, 1) for k, v in sorted(status_sec.items(), key=lambda x: -x[1])
        },
    }


# Backward-compatible alias
_factory_utilization = _shift_utilization


LINE_COLORS = [
    "#22cae7",
    "#38bdf8",
    "#0ea5e9",
    "#77AF46",
    "#2dd4bf",
    "#67e8f9",
    "#0284c7",
    "#5eead4",
]

STATUS_LABELS = {
    "running": "Running",
    "idle": "Idle",
    "breakdown": "Breakdown",
    "alarm": "Alarm",
    "setting_change": "Setting Change",
    "offline": "Offline",
}

STATUS_COLORS = {
    "running": "#10b981",
    "idle": "#f59e0b",
    "breakdown": "#ef4444",
    "alarm": "#f97316",
    "setting_change": "#8b5cf6",
    "offline": "#6b7280",
}


def _factories_tree(cfg: dict) -> list[dict]:
    return list((cfg.get("factory") or {}).get("factories") or [])


def _station_label(st: Optional[Station], station_id: Optional[int] = None) -> str:
    """Prefer display_name, then name; never return empty when a station id is known."""
    if st is not None:
        label = (st.display_name or st.name or "").strip()
        if label:
            return label
    if station_id is None:
        return "Unassigned"
    return f"Station {station_id}"


def _build_lines_meta(cfg: dict, stations: dict[int, Station]) -> list[dict]:
    """Each Factory Setup line becomes an overview Line (skips disabled lines)."""
    lines_out: list[dict] = []
    for factory in _factories_tree(cfg):
        for dept in factory.get("departments") or []:
            for line in dept.get("lines") or []:
                # Soft-disable from Factory Setup (default enabled when key missing)
                if line.get("enabled") is False:
                    continue
                raw_name = (line.get("name") or "").strip()
                station_ids = [
                    int(s)
                    for s in (line.get("stationIds") or [])
                    if isinstance(s, int) or str(s).isdigit()
                ]
                # Only include enabled stations on the line
                station_ids = [
                    sid for sid in station_ids
                    if sid in stations and int(getattr(stations[sid], "is_enabled", 1) or 0) != 0
                ]
                if not raw_name and not station_ids:
                    continue
                line_name = raw_name or f"Line {len(lines_out) + 1}"
                factory_name = (factory.get("name") or "").strip()
                department_name = (dept.get("name") or "").strip()
                path = " / ".join(filter(None, [factory_name, department_name, line_name]))
                station_rows = []
                for sid in station_ids:
                    st = stations.get(sid)
                    station_rows.append(
                        {
                            "id": sid,
                            "name": _station_label(st, sid),
                        }
                    )
                lines_out.append(
                    {
                        "id": str(line.get("id") or line_name or f"line-{len(lines_out) + 1}"),
                        "name": line_name,
                        "factory_id": factory.get("id"),
                        "factory_name": factory_name,
                        "department_id": dept.get("id"),
                        "department_name": department_name,
                        "location_path": path,
                        "station_ids": station_ids,
                        "stations": station_rows,
                    }
                )
    return lines_out


def _machine_payload(m: Machine, db: Session, stations: dict[int, Station], plan_by_machine: dict) -> dict:
    live = _compute_status(m, db)
    st = stations.get(m.station_id)
    plan = plan_by_machine.get(m.id)
    return {
        "id": m.id,
        "name": m.name,
        "station_id": m.station_id,
        "station_name": _station_label(st, m.station_id),
        "machine_type": m.machine_type,
        "make": m.make,
        "model_no": m.model_no,
        "location": m.location,
        "image_url": m.image_url,
        "status": live,
        "status_label": STATUS_LABELS.get(live, live or "Unknown"),
        "status_color": STATUS_COLORS.get(live, "#6b7280"),
        "plan": plan,
    }


def _running_pct(items: list[dict]) -> float:
    if not items:
        return 0.0
    run = sum(1 for x in items if x.get("status") == "running")
    return round(100.0 * run / len(items), 1)


def _status_counts(items: list[dict]) -> dict[str, Any]:
    keys = ("running", "idle", "breakdown", "alarm", "setting_change", "offline")
    counts = {k: 0 for k in keys}
    counts["total"] = len(items)
    for x in items:
        key = x.get("status") or "offline"
        if key in counts:
            counts[key] += 1
        else:
            counts["offline"] += 1
    return counts


def _today_plans_by_machine(db: Session, cfg: Optional[dict] = None) -> dict[int, dict]:
    """Return today's best plan per machine with real-time actual_qty from status log segments."""
    if cfg is None:
        from .config import _load_config as _lc
        cfg = _lc(db)
    now = now_ist()
    shift_id = _resolve_active_shift_id(cfg, now)
    sh_def, sh_start, eff_end, _ = _current_shift_window(cfg)
    threshold_ratio = float((cfg.get("hourly_output") or {}).get("running_part_threshold_pct", 30)) / 100.0
    ld_unld_max = int((cfg.get("hourly_output") or {}).get("ld_unld_max_sec", 60))
    micro_gap = int((cfg.get("hourly_output") or {}).get("micro_gap_sec", 15))

    today = now.date()
    plans = (
        db.query(ProductionPlan)
        .filter(
            ProductionPlan.plan_date == today,
            ProductionPlan.status.in_(("running", "paused", "pending", "completed", "incomplete", "aborted")),
        )
        .order_by(ProductionPlan.priority, ProductionPlan.id)
        .all()
    )
    # Priority: running > paused > completed > incomplete > aborted > pending
    # Prefer current-shift plans; within same shift prefer by status rank
    _STATUS_RANK = {"running": 0, "paused": 1, "completed": 2, "incomplete": 3, "aborted": 4, "pending": 5}
    best: dict[int, Any] = {}
    for p in plans:
        if not p.machine_id:
            continue
        cur = best.get(p.machine_id)
        if cur is None:
            best[p.machine_id] = p
        elif p.shift == shift_id and cur.shift != shift_id:
            best[p.machine_id] = p
        elif p.shift != shift_id and cur.shift == shift_id:
            pass
        elif _STATUS_RANK.get(p.status, 9) < _STATUS_RANK.get(cur.status, 9):
            best[p.machine_id] = p
        elif _STATUS_RANK.get(p.status, 9) == _STATUS_RANK.get(cur.status, 9) and p.id > cur.id:
            best[p.machine_id] = p

    out: dict[int, dict] = {}
    for machine_id, p in best.items():
        rt_actual = p.actual_qty or 0
        # For active shift plans, compute real-time count from status segments
        if sh_def and p.shift == shift_id and p.status in ("running", "paused", "incomplete"):
            try:
                from .hourly_output import _build_status_segments, _countable_running_segments
                ct = float(p.process_time or 0) + float(p.loading_unloading or 0)
                segs = _build_status_segments(db, machine_id, sh_start, eff_end, None, ld_unld_max, micro_gap)
                running_segs = [s for s in segs if s.get("state") == "running" and not s.get("prior")]
                rt_count = _countable_running_segments(running_segs, ct, threshold_ratio) if ct > 0 else len(running_segs)
                rt_actual = max(rt_actual, rt_count)
            except Exception:
                pass
        out[machine_id] = {
            "id": p.id,
            "model_variant": p.model_variant,
            "planned_qty": p.planned_qty,
            "actual_qty": rt_actual,
            "status": p.status,
            "shift": p.shift,
            "work_order_id": p.work_order_id,
            "process_time_sec": float(p.process_time or 0),
            "loading_unloading_sec": float(p.loading_unloading or 0),
            "cycle_time_sec": float(p.process_time or 0) + float(p.loading_unloading or 0),
        }
    return out


def _plan_achievement(items: list[dict]) -> dict[str, Any]:
    planned = 0
    actual = 0
    for m in items:
        plan = m.get("plan") or {}
        planned += int(plan.get("planned_qty") or 0)
        actual += int(plan.get("actual_qty") or 0)
    pct = round(100.0 * actual / planned, 1) if planned else 0.0
    return {"pct": pct, "actual": actual, "planned": planned}


def _assign_machine_to_line(m: dict, lines_meta: list[dict]) -> str | None:
    sid = m.get("station_id")
    loc = (m.get("location") or "").strip()
    for line in lines_meta:
        if sid and sid in (line.get("station_ids") or []):
            return line["id"]
        if loc and loc == (line.get("location_path") or ""):
            return line["id"]
    return None


def _overview_payload(db: Session) -> dict:
    cfg = _load_config(db)
    stations = {s.id: s for s in db.query(Station).all()}
    enabled_station_ids = {
        sid for sid, st in stations.items()
        if int(getattr(st, "is_enabled", 1) or 0) != 0
    }
    machines = (
        db.query(Machine)
        .order_by(Machine.station_id, Machine.name)
        .all()
    )
    # Soft-disabled machines / stations are omitted from operational overviews
    machines = [
        m for m in machines
        if int(getattr(m, "is_enabled", 1) or 0) != 0
        and (m.station_id in enabled_station_ids or m.station_id is None)
    ]
    plan_map = _today_plans_by_machine(db, cfg)
    items = [_machine_payload(m, db, stations, plan_map) for m in machines]
    machine_by_id = {m.id: m for m in machines}
    counts = _status_counts(items)
    running_pct = _running_pct(items)
    achievement = _plan_achievement(items)

    factories = _factories_tree(cfg)
    lines_meta = _build_lines_meta(cfg, stations)

    factory_options = [
        {
            "id": f.get("id"),
            "name": (f.get("name") or "").strip() or str(f.get("id") or "Factory"),
        }
        for f in factories
        if f.get("id") or f.get("name")
    ]

    site_label = ""
    if factory_options:
        site_label = factory_options[0]["name"]
    elif cfg.get("site_name"):
        site_label = str(cfg.get("site_name"))
    else:
        site_label = "Factory"

    overall_util = _shift_utilization(db, machines, cfg)
    line_rows = []
    by_line_util = []
    for idx, line in enumerate(lines_meta):
        sids = set(line.get("station_ids") or [])
        path = line.get("location_path") or ""
        line_machines = [
            x
            for x in items
            if (x["station_id"] in sids)
            or (path and (x.get("location") or "").strip() == path)
        ]
        # de-dupe
        seen = set()
        uniq = []
        for m in line_machines:
            if m["id"] in seen:
                continue
            seen.add(m["id"])
            uniq.append(m)
        ach = _plan_achievement(uniq)
        orm_for_line = [machine_by_id[m["id"]] for m in uniq if m["id"] in machine_by_id]
        line_util = _shift_utilization(db, orm_for_line, cfg)
        line_util_row = {
            "id": line["id"],
            "name": line["name"],
            "uptime_min": line_util["uptime_min"],
            "downtime_min": line_util["downtime_min"],
            "mttr_min": line_util["mttr_min"],
            "mtbf_min": line_util["mtbf_min"],
            "utilization_pct": line_util["utilization_pct"],
            "machines_sampled": line_util["machines_sampled"],
        }
        by_line_util.append(line_util_row)
        line_rows.append(
            {
                "id": line["id"],
                "name": line["name"],
                "factory_id": line.get("factory_id"),
                "factory_name": line.get("factory_name") or "",
                "department_name": line.get("department_name") or "",
                "location_path": path,
                "stations": line.get("stations") or [],
                "color": LINE_COLORS[idx % len(LINE_COLORS)],
                "running_pct": _running_pct(uniq),
                "running": sum(1 for x in uniq if x.get("status") == "running"),
                "total": len(uniq),
                "achievement_pct": ach["pct"],
                "achievement_actual": ach["actual"],
                "achievement_planned": ach["planned"],
                "status_counts": _status_counts(uniq),
                "machines": uniq,
                "uptime_min": line_util["uptime_min"],
                "downtime_min": line_util["downtime_min"],
                "mttr_min": line_util["mttr_min"],
                "mtbf_min": line_util["mtbf_min"],
                "utilization_pct": line_util["utilization_pct"],
            }
        )

    # Machines not on any configured line
    assigned = set()
    for lr in line_rows:
        for m in lr["machines"]:
            assigned.add(m["id"])
    unassigned = [x for x in items if x["id"] not in assigned]

    return {
        "site_label": site_label,
        "factory_name": site_label,
        "factories": factory_options,
        "lines_hint": (
            None
            if line_rows
            else "No lines configured. Add Factory → Department → Line and assign stations in Factory Setup."
        ),
        "running_rate": {
            "pct": running_pct,
            "running": counts["running"],
            "total": counts["total"],
        },
        "achievement_rate": achievement,
        "status_counts": counts,
        "utilization": {
            **overall_util,
            "by_line": by_line_util,
        },
        "lines": line_rows,
        "unassigned_machines": unassigned,
        "machines": items,
    }


@router.get("/factory/running-rate-trend")
def factory_running_rate_trend(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Per-line hourly running rate (%) for the current shift, hour 1 to hour N.
    Running rate per slot = running_minutes / slot_available_minutes * 100.
    Uses machine_status_log segments — same source as loss tracker / hourly output.
    """
    cfg = _load_config(db)
    sh, shift_start, effective_end, now = _current_shift_window(cfg)
    if not sh:
        return {"shift_name": "—", "slots": [], "lines": []}

    # Build hourly slot boundaries for the shift
    from .hourly_output import _shift_slots, _break_windows, _mins_available
    slots = _shift_slots(sh)
    break_cfg = (cfg.get("breaks") or {}).get(sh.get("id") or "", {})
    breaks = _break_windows(break_cfg)

    stations = {s.id: s for s in db.query(Station).all()}
    enabled_station_ids = {sid for sid, st in stations.items() if int(getattr(st, "is_enabled", 1) or 0) != 0}
    all_machines = (
        db.query(Machine)
        .filter(Machine.is_enabled == 1)
        .order_by(Machine.station_id, Machine.name)
        .all()
    )
    all_machines = [m for m in all_machines if m.station_id in enabled_station_ids or m.station_id is None]
    machine_by_id = {m.id: m for m in all_machines}

    lines_meta = _build_lines_meta(cfg, stations)

    # Determine how many slots have started (cap at effective_end)
    completed_slots = []
    for s in slots:
        slot_start = shift_start + timedelta(hours=s["slot_index"])
        slot_end = shift_start + timedelta(hours=s["slot_index"] + 1)
        if slot_start >= effective_end:
            break
        completed_slots.append({
            "label": s["label"],
            "slot_index": s["slot_index"],
            "slot_start": slot_start,
            "slot_end": min(slot_end, effective_end),
            "avail_min": _mins_available(slot_start, min(slot_end, effective_end), breaks),
        })

    # Cache segments per machine (avoid re-querying)
    seg_cache: dict[int, list] = {}

    def _get_segs(machine_id: int) -> list:
        if machine_id not in seg_cache:
            seg_cache[machine_id] = _machine_shift_segments(db, machine_id, shift_start, effective_end)
        return seg_cache[machine_id]

    def _running_min_in_slot(machine_id: int, slot_start: datetime, slot_end: datetime) -> float:
        total = 0.0
        for seg in _get_segs(machine_id):
            if seg["status"] != "running":
                continue
            # _machine_shift_segments returns {status, seconds, reason} — no start/end
            # We need start/end; rebuild from the raw log instead via a helper
            pass
        return total

    # _machine_shift_segments returns segments without absolute start/end timestamps.
    # Re-use the raw timeline approach directly here.
    def _running_min_in_slot_direct(machine_id: int, slot_start: datetime, slot_end: datetime) -> float:
        """Sum running seconds in [slot_start, slot_end] from MachineStatusLog."""
        prior = (
            db.query(MachineStatusLog)
            .filter(MachineStatusLog.machine_id == machine_id,
                    MachineStatusLog.changed_at < shift_start)
            .order_by(MachineStatusLog.changed_at.desc())
            .first()
        )
        logs = (
            db.query(MachineStatusLog)
            .filter(MachineStatusLog.machine_id == machine_id,
                    MachineStatusLog.changed_at >= shift_start,
                    MachineStatusLog.changed_at <= effective_end)
            .order_by(MachineStatusLog.changed_at.asc())
            .all()
        )
        if not prior and not logs:
            return 0.0
        timeline: list[tuple] = []
        if prior:
            timeline.append((shift_start, prior.status or "offline"))
        elif logs:
            timeline.append((shift_start, logs[0].status or "offline"))
        for log in (logs[1:] if (not prior and logs) else logs):
            if timeline and timeline[-1][0] == log.changed_at and timeline[-1][1] == log.status:
                continue
            timeline.append((_as_naive_ist(log.changed_at), log.status or "offline"))
        total = 0.0
        for i, (t_start, status) in enumerate(timeline):
            t_end = timeline[i + 1][0] if i + 1 < len(timeline) else effective_end
            lo = max(t_start, slot_start)
            hi = min(t_end, slot_end)
            if hi > lo and status == "running":
                total += (hi - lo).total_seconds() / 60.0
        return total

    line_rows = []
    for idx, line in enumerate(lines_meta):
        sids = set(line.get("station_ids") or [])
        line_machines = [m for m in all_machines if m.station_id in sids]
        if not line_machines:
            continue
        hourly_pct = []
        for sl in completed_slots:
            total_running = sum(
                _running_min_in_slot_direct(m.id, sl["slot_start"], sl["slot_end"])
                for m in line_machines
            )
            # Available = avail_min × number of machines
            total_avail = sl["avail_min"] * len(line_machines)
            pct = round(100.0 * total_running / total_avail, 1) if total_avail > 0 else 0.0
            hourly_pct.append(pct)
        line_rows.append({
            "id": line["id"],
            "name": line["name"],
            "color": LINE_COLORS[idx % len(LINE_COLORS)],
            "hourly_pct": hourly_pct,
        })

    return {
        "shift_name": sh.get("name") or sh.get("id") or "—",
        "shift_start": sh.get("start"),
        "shift_end": sh.get("end"),
        "slots": [s["label"] for s in completed_slots],
        "lines": line_rows,
    }


@router.get("/factory")
def factory_overview(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return _overview_payload(db)


@router.get("/lines")
def list_lines(db: Session = Depends(get_db), _=Depends(get_current_user)):
    data = _overview_payload(db)
    return {
        "site_label": data["site_label"],
        "factory_name": data.get("factory_name") or data["site_label"],
        "factories": data.get("factories") or [],
        "lines_hint": data.get("lines_hint"),
        "lines": [
            {
                "id": ln["id"],
                "name": ln["name"],
                "factory_id": ln.get("factory_id"),
                "factory_name": ln.get("factory_name") or "",
                "stations": ln.get("stations") or [],
                "running": ln["running"],
                "total": ln["total"],
                "running_pct": ln["running_pct"],
                "achievement_pct": ln.get("achievement_pct", 0),
                "achievement_actual": ln.get("achievement_actual", 0),
                "achievement_planned": ln.get("achievement_planned", 0),
            }
            for ln in data["lines"]
        ],
    }


@router.get("/line/{line_id}")
def line_overview(line_id: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    data = _overview_payload(db)
    line = next((ln for ln in data["lines"] if str(ln["id"]) == str(line_id)), None)
    if not line:
        raise HTTPException(404, f"Line not found: {line_id}")
    counts = line.get("status_counts") or _status_counts(line["machines"])
    return {
        "site_label": data["site_label"],
        "factory_name": line.get("factory_name") or data.get("factory_name") or data["site_label"],
        "factories": data.get("factories") or [],
        "line": line,
        "status_counts": counts,
        "running_rate": {
            "pct": line["running_pct"],
            "running": line["running"],
            "total": line["total"],
        },
        "achievement_rate": {
            "pct": line.get("achievement_pct", 0),
            "actual": line.get("achievement_actual", _plan_achievement(line["machines"])["actual"]),
            "planned": line.get("achievement_planned", _plan_achievement(line["machines"])["planned"]),
        },
        "stations": line.get("stations") or [],
        "machines": line["machines"],
        "lines": [
            {
                "id": ln["id"],
                "name": ln["name"],
                "factory_name": ln.get("factory_name") or "",
            }
            for ln in data["lines"]
        ],
    }


@router.get("/equipment")
def equipment_overview(db: Session = Depends(get_db), _=Depends(get_current_user)):
    data = _overview_payload(db)
    cfg = _load_kpi_config(db)
    now = now_ist()
    today = now.date()
    # Fallback shift when a machine has no plan
    active_shift_id = _resolve_active_shift_id(cfg, now)

    orm_by_id = {
        m.id: m
        for m in db.query(Machine).filter(
            Machine.id.in_([x["id"] for x in data["machines"]] or [-1])
        ).all()
    }

    lines_meta = [
        {
            "id": ln["id"],
            "name": ln["name"],
            "factory_name": ln.get("factory_name") or "",
            "station_ids": [s["id"] for s in (ln.get("stations") or [])],
            "location_path": ln.get("location_path") or "",
        }
        for ln in data["lines"]
    ]
    machines = []
    for m in data["machines"]:
        row = dict(m)
        lid = _assign_machine_to_line(m, [
            {
                "id": ln["id"],
                "station_ids": ln["station_ids"],
                "location_path": ln["location_path"],
            }
            for ln in lines_meta
        ])
        line = next((ln for ln in lines_meta if ln["id"] == lid), None) if lid else None
        row["line_id"] = lid
        row["line_name"] = line["name"] if line else None
        row["factory_name"] = line["factory_name"] if line else ""
        # Use the machine's best plan shift; fall back to active shift
        plan = (m.get("plan") or {})
        shift_id = (plan.get("shift") or "").strip() or active_shift_id
        oee_val = None
        orm = orm_by_id.get(m["id"])
        if orm and shift_id:
            try:
                kpi = _compute_kpi(db, orm, today, shift_id, cfg)
                if kpi is not None:
                    oee_val = round(float((kpi.get("kpi") or {}).get("oee") or 0))
            except Exception:
                oee_val = None
        row["oee"] = oee_val
        machines.append(row)
    return {
        "site_label": data["site_label"],
        "factory_name": data.get("factory_name") or data["site_label"],
        "factories": data.get("factories") or [],
        "status_counts": data["status_counts"],
        "running_rate": data["running_rate"],
        "machines": machines,
        "lines": [
            {"id": ln["id"], "name": ln["name"], "factory_name": ln.get("factory_name") or ""}
            for ln in data["lines"]
        ],
    }


@router.get("/equipment/{machine_id}")
def equipment_detail(machine_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    data = _overview_payload(db)
    machine = next((m for m in data["machines"] if m["id"] == machine_id), None)
    if not machine:
        raise HTTPException(404, "Machine not found")

    m_orm = db.query(Machine).filter(Machine.id == machine_id).first()
    if not m_orm:
        raise HTTPException(404, "Machine not found")

    line = None
    for ln in data["lines"]:
        if any(x["id"] == machine_id for x in ln.get("machines") or []):
            line = {"id": ln["id"], "name": ln["name"], "factory_name": ln.get("factory_name") or ""}
            break

    siblings = [
        {
            "id": m["id"],
            "name": m["name"],
            "status": m["status"],
            "status_label": m.get("status_label"),
            "status_color": m.get("status_color"),
            "image_url": m.get("image_url"),
            "plan": m.get("plan"),
        }
        for m in data["machines"]
        if m.get("station_id") == machine.get("station_id")
    ]

    plan = machine.get("plan") or {}
    now = now_ist()
    cfg = _load_kpi_config(db)
    shift_id = (plan.get("shift") or "").strip()
    if not shift_id:
        shift_id = _resolve_active_shift_id(cfg, now)

    kpi_panel = None
    try:
        kpi_panel = _compute_kpi(db, m_orm, now.date(), shift_id, cfg)
    except Exception as exc:
        print(f"[WARN] equipment_detail KPI compute failed: {exc}")

    from .hourly_output import (
        _cfg_ld_unld_max_sec,
        _cfg_micro_gap_sec,
        _get_cycle_profile,
        _build_status_segments,
        _shift_window,
        _effective_shift_end,
    )

    ld_unld_max = _cfg_ld_unld_max_sec(cfg)
    # Prefer plan-configured L&U as threshold when present (idle beyond this is not L&U)
    plan_lu = float((plan or {}).get("loading_unloading_sec") or 0)
    lu_threshold = plan_lu if plan_lu > 0 else float(ld_unld_max)

    # Live segment elapsed (current status duration)
    last_log = (
        db.query(MachineStatusLog)
        .filter(MachineStatusLog.machine_id == machine_id)
        .order_by(MachineStatusLog.changed_at.desc())
        .first()
    )
    live_elapsed_sec = 0.0
    live_status = machine.get("status") or "idle"
    if last_log and last_log.changed_at:
        # now_ist() is already naive IST; convert aware DB timestamps to the same
        # wall-clock (astimezone → strip) so elapsed math never mixes zones.
        started = _as_naive_ist(last_log.changed_at)
        now_n = _as_naive_ist(now)
        if started is not None and now_n is not None:
            live_elapsed_sec = max(0.0, (now_n - started).total_seconds())
        live_status = last_log.status or live_status

    # Prefer plan fields including an explicit 0.0; only fall back when absent/None.
    # Truthiness checks would wrongly treat planned zero process/L&U as "missing".
    def _sec_or_none(src: dict, key: str) -> Optional[float]:
        if not src or key not in src or src.get(key) is None:
            return None
        return float(src[key])

    process_sec = _sec_or_none(plan, "process_time_sec")
    load_sec = _sec_or_none(plan, "loading_unloading_sec")
    cycle_sec = _sec_or_none(plan, "cycle_time_sec")
    if kpi_panel:
        if process_sec is None:
            process_sec = _sec_or_none(kpi_panel, "process_time_sec")
        if load_sec is None:
            load_sec = _sec_or_none(kpi_panel, "loading_unloading_sec")
        if cycle_sec is None:
            cycle_sec = _sec_or_none(kpi_panel, "cycle_time_sec")
        # Do not dump full cycle_time_sec into process_sec — that would mislabel
        # machining time and make cycle_time_sec == process + 0 below.
    split_known = process_sec is not None or load_sec is not None
    process_sec = 0.0 if process_sec is None else process_sec
    load_sec = 0.0 if load_sec is None else load_sec
    cycle_sec = 0.0 if cycle_sec is None else cycle_sec

    machining_live = round(live_elapsed_sec, 1) if live_status == "running" else 0.0
    # Match hourly_output._classify: idle < threshold → ld_unld; otherwise idle (show 0)
    loading_live = 0.0
    idle_beyond_lu = False
    if live_status == "idle":
        if live_elapsed_sec > 0 and live_elapsed_sec < lu_threshold:
            loading_live = round(live_elapsed_sec, 1)
        elif live_elapsed_sec >= lu_threshold:
            idle_beyond_lu = True
            loading_live = 0.0

    live_cycle_sec = round(machining_live + loading_live, 1)

    # Avg cycle breakups from completed shift segments
    avg_machining_sec = 0.0
    avg_loading_sec = 0.0
    avg_cycle_sec = 0.0
    try:
        shift_defs = [s for s in (cfg.get("shifts") or []) if s.get("enabled", True)]
        # shift_id may be id, name, or start (see _resolve_active_shift_id / _compute_kpi)
        sd = next((s for s in shift_defs if s.get("id") == shift_id), None)
        if not sd and shift_id:
            sd = next((s for s in shift_defs if (s.get("name") or "") == shift_id), None)
        if not sd and shift_id:
            sd = next((s for s in shift_defs if str(s.get("start") or "") == shift_id), None)
        if sd:
            s_start, s_end = _shift_window(now.date(), sd)
            eff_end = _effective_shift_end(s_start, s_end)
            micro_gap = _cfg_micro_gap_sec(cfg)
            cycle_profile = None
            if plan.get("model_variant"):
                cycle_profile = _get_cycle_profile(db, plan.get("model_variant") or "")
            segs = _build_status_segments(
                db, machine_id, s_start, eff_end, cycle_profile, int(lu_threshold) or ld_unld_max, micro_gap,
            )
            run_durs = [float(s.get("seconds") or 0) for s in segs if s.get("state") == "running" and float(s.get("seconds") or 0) > 0]
            lu_durs = [float(s.get("seconds") or 0) for s in segs if s.get("state") == "ld_unld" and float(s.get("seconds") or 0) > 0]
            if run_durs:
                avg_machining_sec = round(sum(run_durs) / len(run_durs), 1)
            if lu_durs:
                avg_loading_sec = round(sum(lu_durs) / len(lu_durs), 1)
            if avg_machining_sec or avg_loading_sec:
                avg_cycle_sec = round(avg_machining_sec + avg_loading_sec, 1)
    except Exception as exc:
        print(f"[WARN] avg cycle breakup failed: {exc}")

    from ..operator_presence import get_live_operator_map, operator_fields_for_machine
    op = operator_fields_for_machine(get_live_operator_map(db), machine_id)

    # Shift hourly output for this machine (same rows as Hourly Output page)
    hourly_output = None
    try:
        from .hourly_output import build_hourly_output

        entry_date = now.date()
        if kpi_panel and kpi_panel.get("entry_date"):
            try:
                from datetime import date as _date
                entry_date = _date.fromisoformat(str(kpi_panel["entry_date"]))
            except Exception:
                pass
        # Hourly builder matches shift by id; accept id or display name
        shift_for_ho = shift_id
        for sh in (cfg.get("shifts") or []):
            if not sh.get("enabled", True):
                continue
            if sh.get("id") == shift_id or (sh.get("name") or "") == shift_id:
                shift_for_ho = sh.get("id") or sh.get("name") or shift_id
                break
        station_id = m_orm.station_id
        ho = build_hourly_output(
            db,
            entry_date,
            shift_for_ho,
            "station" if station_id else "all",
            station_id,
            None,
            None,
        )
        m_row = next(
            (x for x in (ho.get("machines") or []) if x.get("machine_id") == machine_id),
            None,
        )
        if m_row:
            hourly_output = {
                "entry_date": ho.get("entry_date"),
                "shift": ho.get("shift"),
                "shift_name": ho.get("shift_name"),
                "shift_start": ho.get("shift_start"),
                "shift_end": ho.get("shift_end"),
                "slots": ho.get("slots") or [],
                "states": m_row.get("states") or {},
                "shift_totals": m_row.get("shift_totals") or {},
            }
    except Exception as exc:
        print(f"[WARN] equipment_detail hourly output failed: {exc}")

    return {
        "machine": machine,
        "factory_name": (line or {}).get("factory_name") or data.get("factory_name") or "",
        "factories": data.get("factories") or [],
        "line": line,
        "siblings": siblings,
        "equipment_info": {
            "name": machine["name"],
            "status": machine["status_label"],
            "status_key": machine["status"],
            "status_color": machine["status_color"],
            "station": machine.get("station_name"),
            "type": machine.get("machine_type") or "CNC",
            "make": machine.get("make") or "—",
            "model": machine.get("model_no") or "—",
            "location": machine.get("location") or "—",
            "image_url": machine.get("image_url"),
            **op,
        },
        "plan": {
            **plan,
            "process_time_sec": process_sec,
            "loading_unloading_sec": load_sec,
            # Prefer explicit split when available (including zeros); otherwise cycle total
            "cycle_time_sec": (
                process_sec + load_sec if split_known else cycle_sec
            ),
        },
        "live_cycle": {
            "status": live_status,
            "elapsed_sec": round(live_elapsed_sec, 1),
            "process_time_sec": process_sec,
            "loading_unloading_sec": load_sec,
            "ld_unld_threshold_sec": round(lu_threshold, 1),
            "machining_live_sec": machining_live,
            "loading_live_sec": loading_live,
            "live_cycle_sec": live_cycle_sec,
            "idle_beyond_lu": idle_beyond_lu,
            "idle_elapsed_sec": round(live_elapsed_sec, 1) if idle_beyond_lu else 0.0,
            "avg_machining_sec": avg_machining_sec,
            "avg_loading_sec": avg_loading_sec,
            "avg_cycle_sec": avg_cycle_sec,
        },
        "kpi_panel": kpi_panel,
        "hourly_output": hourly_output,
        "all_machines": [
            {"id": m["id"], "name": m["name"], "status": m["status"], "station_name": m.get("station_name")}
            for m in data["machines"]
        ],
    }
