# EAP PMS — Formulas Reference

Catalog of calculation formulas used in the Production Management System: expression, meaning, code location, and which dashboard/page shows the result.

**Source of truth:** backend routers under `backend/app/routers/`. Frontend may mirror formulas for live preview (Data Entry) or display-only helpers (heat map colors).

**Last verified against code:** Aug 2026 (includes Factory running-rate trend and Equipment MTTR/MTBF).

---

## Quick map: page → formula families

| Page / surface | Primary formulas |
| -------------- | ---------------- |
| **Data Entry** | Manual OEE (A×P×Q), CT, possible qty, AR/PR/QR |
| **Dashboard** | Stored manual OEE; realtime OEE; machine KPI card (when opened) |
| **Factory Overview** | Running %, plan achievement, utilization %, MTTR, MTBF, **hourly running-rate trend** |
| **Line Overview** | Running %, plan achievement (overall + per station) — **not** util/MTTR/MTBF charts |
| **Equipment Overview** | Machine KPI (AR/PR/QR/OEE, MUR, Yield, TEEP, **MTTR/MTBF**), plan qty, hourly panel |
| **Machine Hourly Output** | Hourly expected/actual, slot AR/PR/QR/OEE |
| **Production Planning** | Plan achievement %, plan complete % |
| **Work Order Management** | WO completed/remaining/unplanned qty, complete % |
| **Operator Management / Mobile** | Attendance duration, open punch effective out |
| **Tool / planning forecast** | Tool life used %, projected cycles |
| **Model Change** | Elapsed minutes; ideal setting minutes |
| **OEE Excel / email reports** | Avg AR/PR/QR/OEE; same manual OEE fields |

---

## 1. Cycle time (shared)

Used across OEE, plans, hourly output, equipment overview, parts, and process control.

| ID | Formula | Expression | Unit |
| -- | ------- | ---------- | ---- |
| CT1 | Cycle time | `process_time + loading_unloading` | seconds |
| CT2 | Stored override | If `plan.cycle_time > 0`, use that instead of CT1 | seconds |

| Where | Which CT |
| ----- | -------- |
| Manual OEE (`oee.calculate_oee`) | Always CT1 (form fields) |
| Hourly output / Machine KPI (`_plan_ct`) | CT2 if set, else CT1 |
| Overview plan tiles / achievement enrichment | **CT1 only** (does not apply stored `cycle_time` override) |
| Realtime OEE | CT1 from first plan with CT > 0 |

**Code:** `oee.calculate_oee`, `hourly_output._plan_ct` / `_float_ct`, `overview._today_plans_by_machine`, frontend `cycleTime.js`  
**Pages:** Data Entry, Equipment Overview, Hourly Output, Production Planning, Factory/Line Overview plan tiles, Operator work instructions

---

## 2. Manual OEE (Data Entry)

Classic shop-floor OEE from form fields (breaks, management loss, downtime buckets, actual/defect qty).

**Code:** `backend/app/routers/oee.py` → `calculate_oee()`, `_calculate_display_rates()`  
**Frontend preview:** `frontend/src/pages/DataEntry.jsx` → `calcPreview()`  
**Pages:** Data Entry (live preview + save), Dashboard (stored entries), OEE Excel/email exports

| Step | Name | Expression | Unit |
| ---- | ---- | ---------- | ---- |
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
- Operating / shift working are **not** clamped (mis-entry can go negative).
- Raw uncapped rates stored only when capping occurred (`ar_raw`, `pr_raw`, `qr_raw`, `oee_raw`).
- Frontend preview does **not** apply the 100% cap; backend does.

---

## 3. Realtime OEE (status-log based)

Computed from machine status segments for the shift (no manual downtime buckets). Quality is fixed at 100% (no live defect feed).

**Code:** `backend/app/routers/oee.py` → `_compute_realtime_oee_for_date()`  
**Pages:** Dashboard (`/api/oee/realtime`)

| Name | Expression | Unit |
| ---- | ---------- | ---- |
| Available minutes | Shift total − break minutes (full shift window) | min |
| Operating minutes | Sum of time in `running` + `ld_unld`, clipped to `min(shift_end, now)` | min |
| Actual qty | Count of countable `running` segments (see §6) | qty |
| Possible qty | `floor(available_mins × 60 / CT)` if CT > 0, else total planned | qty |
| Expected qty | `min(possible, total_planned)` if planned > 0, else possible | qty |
| AR | `min(op_mins / available_mins × 100, 100)` | % |
| PR | `actual / expected × 100` (**not capped**) | % |
| QR | Always `100` | % |
| OEE | `AR × PR × QR / 10000` | % |

**Notes**

- CT uses CT1 only (no `plan.cycle_time` override).
- For a live shift, operating time is clipped to “now” while available is the full shift — AR can understate until shift ends.

---

## 4. Machine KPI (Equipment Overview)

Status-log KPIs for one machine / shift, with optional upward override from manual OEE actual/defect.

**Code:** `backend/app/routers/machine_kpi.py` → `_compute_kpi()`  
**Pages:** Equipment Overview (OEE card + detail); Dashboard machine KPI panel when opened

| Name | Expression | Unit | Notes |
| ---- | ---------- | ---- | ----- |
| Available time | `max(0, shift_total − timed_break_overlap)` | min | Mgmt-loss fields may be summed as `standard_loss_min` but are **not** subtracted from available |
| Operating time | `running_min + ld_unld_min` | min | Idle &lt; `ld_unld_max_sec` (default 60s) → classified as ld/unld |
| Downtime | `max(0, available − operating)` | min | |
| Actual production time | `running_min` only | min | Used for MUR |
| Expected qty | `floor(available_time_min × 60 / CT)` | qty | CT via `_plan_ct` (CT2 override allowed) |
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
| **MTTR** | `(failure_sec / 60) / failure_events` | min | Failures = classified `breakdown`/`alarm`; **`null` if no failures** (UI —) |
| **MTBF** | `running_min / failure_events` | min | **`null` if no failures** |

**Do not confuse** Equipment MTBF with Factory Overview MTBF:

- Equipment: uptime = classified **running** minutes only.
- Factory overview: uptime = raw status **`running`** minutes across sampled machines.

---

## 5. Factory / Line Overview — utilization, MTTR, MTBF, achievement, running %

Aggregated from current-shift status logs and today’s plans.

**Code:** `backend/app/routers/overview.py` → `_shift_utilization`, `_running_pct`, `_plan_achievement`, `_today_plans_by_machine`  
**Pages:** Factory Overview (all KPIs below); Line Overview (**running % + achievement only**)

### Status definitions (overview utilization — raw logs, no ld/unld reclass)

| Bucket | Statuses |
| ------ | -------- |
| **Uptime** | `running` only |
| **Failure** | `breakdown`, `alarm` |
| **Downtime** | Everything that is not `running` (includes failures, idle, offline, setting, …) |

| Name | Expression | Unit | Edge cases | Shown on |
| ---- | ---------- | ---- | ---------- | -------- |
| Uptime / downtime | Sum of segment seconds in shift → ÷ 60 | min | Machines with no logs are skipped | Factory |
| Available (util) | `uptime + downtime` | min | Observed logged time only (not full shift if gaps) | Factory |
| **Utilization %** | `100 × uptime / (uptime + downtime)` | % | Denom ≤ 0 → 0; 1 decimal | Factory (`LineUtilizationBarChart`) |
| Failure events | Count of transitions **into** failure | count | Not also counted as downtime events | — |
| Downtime events | New non-failure downtime episodes | count | idle→offline does not re-count | — |
| **MTTR** | `(failure_sec / 60) / failure_events` | min | `null` if no failures (UI —) | Factory |
| **MTBF** | `uptime_min / failure_events` | min | `null` if no failures | Factory |
| **Running %** | `100 × (# machines with status == running) / total` | % | Live status snapshot | Factory, Line, Equipment list |
| **Plan achievement** | `100 × Σ actual_qty / Σ planned_qty` | % | planned = 0 → 0; 1 decimal | Factory, Line |
| Station running % (FE) | `100 × running / machines_on_station` | % | Computed in `LineOverview.jsx` | Line |
| Station achievement (FE) | Same Σ actual/planned per station | % | `LineOverview.jsx` | Line |

**Overview utilization vs Equipment MUR**

- Overview utilization = `running / (running + all other logged states)`
- MUR = `running / (shift − breaks)`

### Plan selection & live actual enrichment

`_today_plans_by_machine`:

1. Pick one primary plan per machine for today (prefer current shift; then status rank: running → paused → completed → incomplete → aborted → pending).
2. For current-shift plans in `running` / `paused` / `incomplete`:
   - `rt_count` = countable running parts from status segments (§6)
   - `actual_qty` used in achievement = `max(plan.actual_qty, rt_count)`

This feeds Factory/Line achievement gauges and charts.

---

## 5b. Hourly Running Rate Trend (Factory Overview)

Per-line hourly % of available machine-time that was spent **running** in the current shift.

**Code:** `backend/app/routers/overview.py` → `factory_running_rate_trend`  
**Chart:** `frontend/src/components/charts/RunningRateTrendChart.jsx`  
**Page:** Factory Overview  
**API:** `GET /api/overview/factory/running-rate-trend`

| Name | Expression | Unit | Notes |
| ---- | ---------- | ---- | ----- |
| Slot window | Hourly slots from shift start, capped at `effective_end` (now) | — | Future slots omitted |
| Slot available minutes | `_mins_available(slot_start, slot_end, breaks)` | min | Timed breaks deducted |
| Total available | `slot_avail_min × number_of_line_machines` | min | Enabled machines on line stations |
| Total running | Σ minutes where raw status == `running` overlapping the slot | min | Raw status (not ld/unld classified) |
| **Hourly running rate** | `100 × total_running / total_available` | % | avail ≤ 0 → 0; 1 decimal |

---

## 6. Part counting & status classification (shared)

Shared by realtime OEE, machine KPI, hourly output, overview achievement enrichment, and plan actual sync.

**Code:** `backend/app/routers/hourly_output.py`  
**Config:** `hourly_output.running_part_threshold_pct` (default **30%**), `ld_unld_max_sec` (default **60**), `micro_gap_sec` (default **15**)

| Name | Rule |
| ---- | ---- |
| Countable running segment | `state == running`, not prior carry-over, and `seconds ≥ max(1, CT × threshold_ratio)` |
| CT missing | Count every non-prior running segment |
| Ld/UnLd classify | Idle duration &lt; `ld_unld_max_sec` → treat as `ld_unld` |
| Micro-gap merge | `running + short ld_unld + running` merged if gap &lt; `micro_gap_sec` |

---

## 7. Hourly output (expected / actual / slot OEE)

**Code:** `backend/app/routers/hourly_output.py` (`_compute_oee_slots`, `_oee_shift_totals`, `_expected_parts`, expected distribution)  
**Frontend helpers:** `frontend/src/utils/hourlyOutput.js`  
**Pages:** Machine Hourly Output; Equipment Overview hourly panel; operator work instruction (`exp_per_hour`)

| Name | Expression | Unit | Notes |
| ---- | ---------- | ---- | ----- |
| Slot available minutes | Slot span − break overlap | min | Untimed breaks scale weights |
| Expected (CT capacity) | `floor(mins × 60 / CT)` | qty | Backend floors; some FE helpers use `round` |
| Expected (with plan) | Distribute `planned_total` across slots by productive-minute weights (largest remainder) | qty | Sum = planned |
| Actual per slot | Countable running segments overlapping the slot | qty | §6 |
| Slot AR | `min(op_mins / avail_mins × 100, 100)` | % | op = running + ld/unld; 1 decimal |
| Slot PR | `actual / expected × 100` | % | Not capped |
| Slot QR | Average of manual OEE QR for machine/shift, else **100** | % | |
| Slot OEE | `AR × PR × QR / 10000` | % | Rounded to 1 decimal |
| Shift totals | Same formulas on summed avail / op / actual / expected | % | |
| Parts/min (UI) | `60 / CT` | parts/min | Display helper |

**Plan actual sync:** `sync_plan_actuals_from_status_logs` writes  
`actual_qty = max(existing, countable_running)` into `production_plans` (feeds Planning / WO screens).

---

## 8. Production planning & work orders

| Name | Expression | Code | Pages |
| ---- | ---------- | ---- | ----- |
| Plan achievement % | `round(100 × Σ actual / Σ planned, 1)` if planned else 0 | `plans.py` summary/export; overview | Production Planning; Factory/Line Overview |
| Per-plan / station achievement | `actual / planned × 100` | plans export; FE Excel | Production Planning |
| WO completed qty | `Σ plan.actual_qty` | `work_orders.py` `_wo_stats` | Work Order Management / Gantt |
| WO remaining | `max(target − completed, 0)` | work_orders | WO UI |
| WO unplanned | `max(target − planned, 0)` | work_orders | WO UI |
| WO complete % | `100 × completed / target` | work_orders | WO UI |
| Plan complete % | `100 × actual / planned` | work_orders timeline | WO detail |
| Near-completion hint | `remaining / planned ≤ 0.15` | machine suggestion | Planning |
| Shift handoff status | If prev plan running/paused: `completed` if `actual ≥ planned`, else `incomplete` | `hourly_output.auto_transition_shift_plans` | Planning |

---

## 9. Attendance / work hours

**Code:** `backend/app/routers/operators.py`, `mobile.py`  
**Pages:** Operator Management, Mobile operator app

| Name | Expression | Unit | Notes |
| ---- | ---------- | ---- | ----- |
| Punch span | `(time_out − time_in)` minutes; if negative add 24h | min | Capped at **16 hours** |
| Open punch effective out | `min(now, shift_end)` while in shift; else `shift_end` | — | Avoids unbounded open punches |
| Worked minutes | Prefer punch span; fallback `duration_mins` | min | |
| Duration hours (report) | `duration_mins / 60` | hours | |
| Live open loss elapsed | `(now − started_at) / 60` | min | Mobile loss timer |

---

## 10. Tool life forecast

**Code:** `backend/app/tool_service.py` → `build_forecast()`, `life_ratio`, `refresh_tool_status`  
**Pages:** Tool-related planning / stock screens

| Name | Expression |
| ---- | ---------- |
| Cycles needed | `planned_qty × cycles_per_part` (default cpp = 1) |
| Projected cycles | `cycles_used + cycles_needed` |
| Life used % | `100 × used / limit` (limit ≤ 0 → null) |
| Warning | `projected ≥ limit × (life_warning_pct / 100)` (default 90%) |
| Correction block | With correction ack, block when `used / limit ≥ 1.05` |

---

## 11. Model change elapsed

**Code:** `backend/app/routers/model_change.py`; mobile setting-minute helpers  
**Pages:** Model change / setting flows; can feed setting-time awareness for losses

| Name | Expression | Unit |
| ---- | ---------- | ---- |
| Elapsed | `(end − start)` or `(now − start)` if open | min |
| Setting minutes (OEE-related) | Sum of `ideal_minutes` for approved/completed MCRs in shift | min |

---

## 12. Display-only thresholds (not KPIs)

| Helper | Rule | Where |
| ------ | ---- | ----- |
| Heat map color | &lt;25% red, &lt;50% blue, &lt;80% yellow, else green | `frontend/src/utils/heatMap.js` — Factory charts |
| OEE tile colors (UI) | Commonly ≥85 green, ≥65 amber, else red (some Dashboard cards use ≥60 amber) | Data Entry, Dashboard, Equipment Overview |
| Hourly perf cell color | ratio = actual/expected; red &lt;0.5, orange &lt;0.6, … | Hourly Output UI |
| Planning achievement color | ≥90 green, ≥70 amber, else red | Production Planning summary |

---

## Important differences between OEE / reliability engines

PMS uses **three** OEE-style calculations plus two MTTR/MTBF contexts. Values on different pages are not always interchangeable.

| Topic | Manual OEE (§2) | Realtime OEE (§3) | Machine KPI (§4) |
| ----- | --------------- | ----------------- | ---------------- |
| Operating time | Available − downtime buckets | `running` + `ld_unld` from logs (clipped) | Same classified |
| Expected / possible | Possible from operating ÷ CT | Expected capped by plan | Expected from available ÷ CT |
| CT override (`plan.cycle_time`) | N/A (form CT) | No | Yes (`_plan_ct`) |
| PR capped at 100%? | Yes | No | No |
| QR source | Defects on form | Always 100% | OEE defects, else 100% |
| QR when actual = 0 | 0 | 100 (fixed) | **100** |
| Extra KPIs | — | — | MUR, Yield, TEEP, MTTR, MTBF |
| Primary UI | Data Entry, Dashboard | Dashboard | Equipment Overview |

| Reliability KPI | Factory Overview (§5) | Equipment KPI (§4) |
| --------------- | --------------------- | ------------------ |
| Failure states | Raw `breakdown` / `alarm` | Classified `breakdown` / `alarm` |
| MTTR | Mean failure duration (min) | Same idea on classified segs |
| MTBF | `uptime_min / failures` (raw running) | `running_min / failures` (classified) |
| Null when no failures | Yes (UI —) | Yes (UI —) |

---

## Config knobs that affect formulas

| Config path | Effect | Default |
| ----------- | ------ | ------- |
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
