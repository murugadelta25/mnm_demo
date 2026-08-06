# EAP PMS — Formulas Reference

Catalog of calculation formulas used in the Production Management System: expression, meaning, code location, and which dashboard/page shows the result.

**Source of truth:** backend routers under `backend/app/routers/`. Frontend may mirror formulas for live preview (Data Entry) or display-only helpers (heat map colors).

---

## Quick map: page → formula families

| Page / surface | Primary formulas |
|----------------|------------------|
| **Data Entry** | Manual OEE (A×P×Q), CT, possible qty, AR/PR/QR |
| **Dashboard** | Stored manual OEE; realtime OEE (status-log based) |
| **Factory Overview** | Running %, plan achievement, utilization %, MTTR, MTBF |
| **Line Overview** | Same as factory, scoped to one line; station tiles |
| **Equipment Overview** | Machine KPI (AR/PR/QR/OEE), MUR, Yield, TEEP, plan qty, cycle breakup |
| **Machine Hourly Output** | Hourly expected/actual, slot AR/PR/QR/OEE |
| **Production Planning** | Plan achievement %, plan complete % |
| **Work Order Management** | WO completed/remaining/unplanned qty, complete % |
| **Operator Management / Mobile** | Attendance duration, open punch effective out |
| **Tool / planning forecast** | Tool life used %, projected cycles |
| **OEE Excel / email reports** | Avg AR/PR/QR/OEE; same manual OEE fields |

---

## 1. Cycle time (shared)

Used across OEE, plans, hourly output, equipment overview, parts, and process control.

| ID | Formula | Expression | Unit |
|----|---------|------------|------|
| CT1 | Cycle time | `process_time + loading_unloading` | seconds |
| CT2 | Stored override | If `plan.cycle_time > 0`, use that instead of CT1 | seconds |

**Code:** `oee.calculate_oee`, `hourly_output._plan_ct` / `_float_ct`, `parts`, `overview` plan payload, frontend `cycleTime.js`  
**Pages:** Data Entry, Equipment Overview, Hourly Output, Production Planning, Operator work instructions

---

## 2. Manual OEE (Data Entry)

Classic shop-floor OEE from form fields (breaks, management loss, downtime buckets, actual/defect qty).

**Code:** `backend/app/routers/oee.py` → `calculate_oee()`  
**Frontend preview:** `frontend/src/pages/DataEntry.jsx` → `calcPreview()`  
**Pages:** Data Entry (live preview + save), Dashboard (stored entries), OEE Excel/email exports

| Step | Name | Expression | Unit |
|------|------|------------|------|
| 1 | Cycle time | `process_time + loading_unloading` | sec |
| 2 | Total breaks | `lunch + tea + tpm_cleaning + other_cleaning + management_meeting` | min |
| 3 | Shift working time | `total_minutes − total_breaks` | min |
| 4 | Management loss | `no_load + new_model_trial + power_cut + planned_maintenance + no_manpower_planned` | min |
| 5 | Available shift time | `shift_working − management_loss` | min |
| 6 | Total downtime | `setting_time + tool_change + dimension_correction + scrap_removal + break_down` | min |
| 7 | Operating time | `available − total_downtime` | min |
| 8 | Possible qty | `floor((operating × 60) / CT)` | qty |
| 9 | Production loss | `max(0, possible − actual_qty)` | qty |
| 10 | Accepted qty | `max(0, actual_qty − defect_qty)` | qty |
| 11 | Availability (AR) | `(operating / available) × 100`, then **cap at 100** | % |
| 12 | Performance (PR) | `(actual_qty / possible_qty) × 100`, then **cap at 100** | % |
| 13 | Quality (QR) | `(accp_qty / actual_qty) × 100`, then **cap at 100** | % |
| 14 | OEE | `AR × PR × QR / 10000` (using capped rates) | % |

**Edge cases**

- Available ≤ 0 → AR = 0; CT ≤ 0 → possible = 0; actual ≤ 0 → QR = 0.
- Raw uncapped rates stored only when capping occurred (`ar_raw`, `pr_raw`, `qr_raw`, `oee_raw`).
- Frontend preview does **not** apply the 100% cap; backend does.

---

## 3. Realtime OEE (status-log based)

Computed from machine status segments for the shift (no manual downtime buckets). Quality is fixed at 100% (no live defect feed).

**Code:** `backend/app/routers/oee.py` → `_compute_realtime_oee_for_date()`  
**Pages:** Dashboard (merged with / alongside manual entries)

| Name | Expression | Unit |
|------|------------|------|
| Available minutes | Shift total − break minutes | min |
| Operating minutes | Sum of time in `running` + `ld_unld` (clipped to now for live shift) | min |
| Actual qty | Count of countable `running` segments (see §6) | qty |
| Possible qty | `floor(available_mins × 60 / CT)` if CT > 0, else total planned | qty |
| Expected qty | `min(possible, total_planned)` if planned > 0, else possible | qty |
| AR | `min(op_mins / available_mins × 100, 100)` | % |
| PR | `actual / expected × 100` (**not capped**) | % |
| QR | Always `100` | % |
| OEE | `AR × PR × QR / 10000` | % |

---

## 4. Machine KPI (Equipment Overview)

Status-log KPIs for one machine / shift, with optional upward override from manual OEE actual/defect.

**Code:** `backend/app/routers/machine_kpi.py` → `_compute_kpi()`  
**Pages:** Equipment Overview (main OEE card: AR, PR, QR, OEE, Machine Utilization, Yield, TEEP)

| Name | Expression | Unit | Notes |
|------|------------|------|-------|
| Available time | Shift length − timed break overlap | min | |
| Operating time | `running_min + ld_unld_min` | min | Idle &lt; `ld_unld_max_sec` (default 60s) → classified as ld/unld |
| Downtime | `max(0, available − operating)` | min | |
| Actual production time | `running_min` only | min | Used for MUR |
| Expected qty | `floor(available_time_min × 60 / CT)` | qty | |
| Theoretical qty | `floor(shift_total_min × 60 / CT)` | qty | Full shift basis |
| Actual qty | Countable running segs; `max` with sum of OEE entry actuals if higher | qty | |
| Good / defect | From OEE defects if present; else good = actual, defect = 0 | qty | |
| AR | `min(operating / available × 100, 100)` | % | |
| PR | `actual / expected × 100` (**not capped**) | % | |
| QR | `good / actual × 100`; if actual = 0 → **100** | % | Differs from manual OEE |
| OEE | `AR × PR × QR / 10000` | % | |
| Machine Utilization (MUR) | `min(running / available × 100, 100)` | % | Excludes ld/unld |
| Production Yield | `actual / theoretical × 100` | % | Not capped |
| TEEP | `OEE × MUR / 100` | % | Shift-based proxy |

---

## 5. Factory / Line Overview — utilization, MTTR, MTBF, achievement

Aggregated from current-shift status logs and today’s plans.

**Code:** `backend/app/routers/overview.py` → `_shift_utilization`, `_running_pct`, `_plan_achievement`  
**Pages:** Factory Overview, Line Overview (and charts: utilization bars, achievement bars, freeform tiles)

### Status definitions

| Bucket | Statuses |
|--------|----------|
| **Uptime** | `running` only |
| **Failure** | `breakdown`, `alarm` |
| **Downtime** | Everything that is not `running` (includes failures, idle, offline, setting, …) |

| Name | Expression | Unit | Edge cases |
|------|------------|------|------------|
| Uptime / downtime | Sum of segment seconds in shift → ÷ 60 | min | Machines with no logs are skipped |
| Available (util) | `uptime + downtime` | min | Observed logged time only (not full shift length if gaps) |
| **Utilization %** | `100 × uptime / (uptime + downtime)` | % | Denom ≤ 0 → 0 |
| Failure events | Count of transitions **into** failure | count | Not double-counted as downtime events |
| Downtime events | New non-failure downtime episodes | count | idle→offline does not re-count |
| **MTTR** | `(failure_sec / 60) / failure_events` | min | **`null` if no failures** (UI shows —) |
| **MTBF** | `uptime_min / failure_events` | min | **`null` if no failures** |
| **Running %** | `100 × (# machines with status == running) / total` | % | Snapshot of live status |
| **Plan achievement** | `100 × Σ actual_qty / Σ planned_qty` | % | One primary plan per machine (priority); planned = 0 → 0 |

**Do not confuse** overview utilization with Equipment MUR:

- Overview utilization = `running / (running + all other logged states)`
- MUR = `running / (shift − breaks)`

---

## 6. Part counting & status classification (shared)

Shared by realtime OEE, machine KPI, and hourly output.

**Code:** `backend/app/routers/hourly_output.py`  
**Config:** `hourly_output.running_part_threshold_pct` (default **30%**), `ld_unld_max_sec` (default **60**), `micro_gap_sec` (default **15**)

| Name | Rule |
|------|------|
| Countable running segment | `state == running`, not prior carry-over, and `seconds ≥ max(1, CT × threshold_ratio)` |
| Ld/UnLd classify | Idle duration &lt; `ld_unld_max_sec` → treat as `ld_unld` |
| Micro-gap merge | `running + short ld_unld + running` merged if gap &lt; `micro_gap_sec` |

---

## 7. Hourly output (expected / actual / slot OEE)

**Code:** `backend/app/routers/hourly_output.py` (`_compute_oee_slots`, `_oee_shift_totals`, expected distribution)  
**Frontend helpers:** `frontend/src/utils/hourlyOutput.js`  
**Pages:** Machine Hourly Output; Equipment Overview hourly panel; operator work instruction (`exp_per_hour`)

| Name | Expression | Unit | Notes |
|------|------------|------|-------|
| Slot available minutes | Slot span − break overlap | min | Untimed breaks scale weights |
| Expected (CT capacity) | `floor(mins × 60 / CT)` | qty | Backend floors; some FE helpers use `round` |
| Expected (with plan) | Distribute `planned_total` across slots by productive-minute weights (largest remainder) | qty | Sum = planned |
| Actual per slot | Countable running segments overlapping the slot | qty | §6 |
| Slot AR | `min(op_mins / avail_mins × 100, 100)` | % | op = running + ld/unld |
| Slot PR | `actual / expected × 100` | % | Not capped |
| Slot QR | Average of manual OEE QR for machine/shift, else **100** | % | |
| Slot OEE | `AR × PR × QR / 10000` | % | Rounded to 1 decimal |
| Shift totals | Same formulas on summed avail / op / actual / expected | % | |
| Parts/min (UI) | `60 / CT` | parts/min | Display helper |

**Plan actual sync:** `sync_plan_actuals_from_status_logs` writes countable running parts into `production_plans.actual_qty` (feeds Planning / WO screens).

---

## 8. Production planning & work orders

| Name | Expression | Code | Pages |
|------|------------|------|-------|
| Plan achievement % | `100 × Σ actual / Σ planned` | `plans.py` summary/export; overview | Production Planning; Factory/Line Overview |
| WO completed qty | `Σ plan.actual_qty` | `work_orders.py` `_wo_stats` | Work Order Management / Gantt |
| WO remaining | `max(target − completed, 0)` | work_orders | WO UI |
| WO unplanned | `max(target − planned, 0)` | work_orders | WO UI |
| WO complete % | `100 × completed / target` | work_orders | WO UI |
| Plan complete % | `100 × actual / planned` | work_orders timeline | WO detail |
| Near-completion hint | `remaining / planned ≤ 0.15` | machine suggestion | Planning |

---

## 9. Attendance / work hours

**Code:** `backend/app/routers/operators.py`, `mobile.py`  
**Pages:** Operator Management, Mobile operator app

| Name | Expression | Unit | Notes |
|------|------------|------|-------|
| Punch span | `(time_out − time_in)` minutes; if negative add 24h | min | Capped at **16 hours** |
| Open punch effective out | `min(now, shift_end)` while in shift; else `shift_end` | — | Avoids unbounded open punches |
| Worked minutes | Prefer punch span; fallback `duration_mins` | min | |
| Duration hours (report) | `duration_mins / 60` | hours | |
| Live open loss elapsed | `(now − started_at) / 60` | min | Mobile loss timer |

---

## 10. Tool life forecast

**Code:** `backend/app/tool_service.py` → `build_forecast()`  
**Pages:** Tool-related planning / stock screens

| Name | Expression |
|------|------------|
| Cycles needed | `planned_qty × cycles_per_part` (default cpp = 1) |
| Projected cycles | `cycles_used + cycles_needed` |
| Life used % | `100 × used / limit` |
| Warning | `projected ≥ limit × (life_warning_pct / 100)` (default 90%) |

---

## 11. Model change elapsed

**Code:** `backend/app/routers/model_change.py`  
**Pages:** Model change / setting flows; can feed setting-time awareness for losses

| Name | Expression | Unit |
|------|------------|------|
| Elapsed | `(end − start)` or `(now − start)` if open | min |
| Setting minutes (OEE-related) | Sum of `ideal_minutes` for approved/completed MCRs in shift | min |

---

## 12. Display-only thresholds (not KPIs)

| Helper | Rule | Where |
|--------|------|--------|
| Heat map color | &lt;25% red, &lt;50% blue, &lt;80% yellow, else green | `frontend/src/utils/heatMap.js` — Factory/Line charts |
| OEE tile colors (UI) | Commonly ≥85 green, ≥65 amber, else red | Data Entry, Dashboard, Equipment Overview |
| Hourly perf cell color | ratio = actual/expected; red &lt;0.5, orange &lt;0.6, … | Hourly Output UI |

---

## Important differences between OEE engines

PMS uses **three** OEE-style calculations. Values on different pages are not always interchangeable.

| Topic | Manual OEE (§2) | Realtime OEE (§3) | Machine KPI (§4) |
|-------|-----------------|-------------------|------------------|
| Operating time | Available − downtime buckets | `running` + `ld_unld` from logs | Same as realtime |
| Expected / possible | Possible from operating ÷ CT | Expected capped by plan | Expected from available ÷ CT |
| PR capped at 100%? | Yes | No | No |
| QR source | Defects on form | Always 100% | OEE defects, else 100% |
| QR when actual = 0 | 0 | 100 (fixed) | **100** |
| Extra KPIs | — | — | MUR, Yield, TEEP |
| Primary UI | Data Entry, Dashboard | Dashboard | Equipment Overview |

---

## Config knobs that affect formulas

| Config path | Effect | Default |
|-------------|--------|---------|
| `hourly_output.running_part_threshold_pct` | Min fraction of CT for a running segment to count as one part | 30 |
| `hourly_output.ld_unld_max_sec` | Max idle seconds treated as load/unload | 60 |
| `hourly_output.micro_gap_sec` | Merge short interruptions between running segments | 15 |
| Shift break windows in config | Subtracted from available time | per shift |
| Tool `life_warning_pct` | Tool life warning threshold | 90 |

---

## Related docs

- `docs/SOFTWARE_ARCHITECTURE.md` — system layout  
- `docs/DATABASE_SCHEMA.md` — tables behind plans, OEE entries, status logs  
- `docs/BUGS_AND_RESOLUTIONS.md` — known formula/UI edge cases (e.g. MTTR/MTBF null handling)
