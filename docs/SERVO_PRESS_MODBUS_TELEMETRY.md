# Servo Press Modbus → Node-RED → EAP-PMS

## What “Result ready” means

**Status\*** (Modbus `0x00CE`) is the machine phase code:

| Status* code | Phase shown in UI | Meaning |
|---|---|---|
| **0** | Idle / Standby \| code 0 | Idle |
| **3** | Pressing \| code 3 | Cycle in progress; previous Pressing Result values clear |
| **4–8** | Result ready \| code N | Cycle finished — **Pressing Result** registers are valid to read |

So **Result ready | code 5** means: phase = *Result ready*, raw Status\* = **5** (one of 4–8). It is **not** an alarm. Alarms use **Alarm Code** (`0x0106`), e.g. 101.

Rules (§8.4.2):

- **Live Status** — readable anytime.
- **Pressing Result** — read when Status\* is **4–8**; cleared when Status\* returns to **3**.

## OEE formulas (unchanged)

Servo Press Equipment Overview **does not replace** OEE Dashboard math.

- **OEE / AR / PR / QR / TEEP** come only from existing `kpi_panel` → `machine_kpi._compute_kpi` (plans + status segments + OEE entries).
- Modbus may show **production counters** (Total/Pass/NG) and live tags on the Servo screen; that is telemetry display only.
- There is **no** separate Servo OEE formula path in the UI.

## Configure tags in the UI (recommended)

Tags are **not** always visible on Machine Config.

1. Open **Machine Config** (`/machines`)
2. **Add** or **Edit** a machine and set **Machine type** to one of:
   - `Servo Press`
   - `Servo Linear Motor`
   - `PLC`
   - `SPM` (Special Purpose Machine)
3. Click **⚙ Config Tags** (also available as **⚙ Tags** on fleet rows for those types)
4. In the popup: **+ Add Tag** / **Edit** / **Delete**
5. **Close** when done — tags apply to that machine-type profile

Field mapping matches the manufacturer sheet / Node-RED:

- **Item** — UI label (e.g. `Emergency button press`)
- **Node-RED reading name** — must match `readings[].name`
- **Screen group** — `Live Status` or `Pressing Result`
- **Modbus** / **EIP/PN** / **Type** / **Scale** / **Unit** / **Note**

Defaults for Servo Press are seeded from Modbus §8.4.2 (`telemetry_tags` where `profile_id=servo_press`). PLC, Servo Linear Motor and SPM start empty until you add tags, each in its own profile (`generic_plc`, `servo_linear_motor`, `spm`) so their mappings never collide.

### Which machine types get this screen

`TELEMETRY_DASHBOARD_MACHINE_TYPES` in `backend/app/machine_telemetry_profiles.py` is the single
source of truth: **Servo Press, Servo Linear Motor, PLC and SPM**. `is_telemetry_dashboard_type()`
matches them regardless of spelling (`servo_press`, `ServoPress`, `plc`), and
`usesTelemetryDashboard()` in `ServoPressEquipmentView.jsx` mirrors it for the frontend.

Those four types get:

| Behaviour | Gate |
|---|---|
| Machine Dashboard on Equipment Overview instead of the generic tiles | `usesTelemetryDashboard()` in `EquipmentOverview.jsx` |
| Modbus OEE (`formula='servo_press_modbus'`) in the equipment screen, KPI dialog and OEE Dashboard | `uses_telemetry_dashboard()` in `servo_press_oee.py` |
| Live status derived from Modbus `Status*` / `Alarm Code` rather than status logs | `is_telemetry_dashboard_type()` in `overview._machine_payload` |
| **⚙ Config Tags** button in Machine Config | `TAG_CONFIG_TYPES` in `MachineConfig.jsx` |

Every other type (CNC, VMC, Lathe, …) keeps the generic overview and the untouched PMS
`machine_kpi` formulas. The dashboard header shows the machine's own type, so a PLC machine reads
"PLC / Machine Dashboard" rather than "Servo Press".

### The Parameters screens follow the configured tags

The Parameters list, the Live and Result tables, and the two screen tabs are all built from the
machine's own tag profile — nothing is hardcoded to press registers any more:

- `public_telemetry()` reports `registers` and `profile` (id, label, screens) **whether or not
  telemetry has arrived**. Before this, a machine with no Node-RED data returned `registers: null`,
  and the UI fell back to press keys — which is why a PLC screen listed "live force" and "live step"
  with `—` values.
- `DEFAULT_PROFILE_GROUPS` in `ServoPressEquipmentView.jsx` is now a fallback **for the press
  profile only**. Other profiles show exactly their configured tags, or an explicit "No tags
  configured … add them in Machine Config → ⚙ Config Tags" row.
- Tab and table headings come from the profile's `screens[].label`, so a Servo Linear Motor reads
  **Setpoints (Write)** and an SPM reads **Cycle Result** rather than "Pressing Result". The tag
  editor uses the same names for its group filter and chips.
- Tags left in group `other` (or with no group) are listed on the live screen instead of being
  dropped.

### Current Values, Machine Status and the trend follow the catalog too

The three press-shaped panels are now derived from the registers the machine actually has, so a PLC
no longer reports blank Position / Force / Velocity / Cycle Time tiles:

| Panel | Press catalog | Any other catalog |
|---|---|---|
| **Current Values** | Position, Force, Velocity, Cycle Time (kept, because sticky cycle time is applied after mapping) | `current_tiles` — the first four non-result tags, measurements before condition words, so the AH PLC reads Pressure, Flow, Tank Level, Temperature |
| **Machine Status** | Press Status, Live Mode, Live Step, Pressing Result, Alarm | Each of those rows only when its register is mapped, then up to five status-like tags (name or item containing status, alarm, state, fault, limit, done, enable, ready, mode) — the AH PLC reads Digital Input Status, Digital Output Status, PLC Status |
| **Live Trend** | Position / Force / Velocity | Only the series whose register is mapped, named after the tag (a linear motor charts **Current Position (mm)** via `live_position`). With none mapped the chart is replaced by a note pointing at the live table |

`map_node_red_readings` builds both blocks, so `public_telemetry` serves them with or without live
data: called with an empty reading list it returns the same skeleton with `null` values, which is
what the screen shows while waiting for Node-RED.

### Seeded vendor catalogs

`backend/app/telemetry_tag_defaults.py` seeds the commissioned hardware so a newly typed machine
shows real parameters. A profile is seeded only while it has **no** rows, so existing mappings are
never overwritten.

**AH PLC kit** — Modbus TCP `192.168.1.5:502`, profile `generic_plc`:

| Tag | PLC | Modbus |
|---|---|---|
| Pressure | `D200` | `40201` |
| Flow | `D202` | `40203` |
| Tank Level | `D204` | `40205` |
| Temperature | `D206` | `40207` |
| Digital Input Status | `D208` | `40209` |
| Digital Output Status | `D210` | `40211` |
| PLC Status | `D212` | `40213` |

PLC Status is keyed `plc_status`, deliberately **not** `status`: the press phase machine reads
`status` as a Status\* code (3 = Pressing, 4–8 = Result ready), so mapping a PLC health word there
would fake pressing phases. The status badge keeps using PMS status for these machines.

**Linear servo motor** — Modbus TCP `192.168.1.7:502`, profile `servo_linear_motor`: read block
`%MW20`–`%MW32` (`40021`–`40033`) on Live Status, write block `%MW0`–`%MW6` (`40001`–`40007`) on
Setpoints. Two keys are shared with the press catalog on purpose, so existing panels light up:
`live_position` (Current Position, `%MW21`) feeds the live tile and trend chart, and `alarm_code`
(Alarm, `%MW26`) feeds the Alarms tab. Everything else keeps its own key.

Vendor sheets quote INT registers with no scaling, so seeded rows use type `W`, scale `1` and no
unit — set units and scales in Config Tags once the physical ranges are known rather than guessing.
Each row carries `nodered_aliases` for both addresses (`D204`, `40205`), so a reading maps whether
Node-RED publishes `Tank Level`, `D204` or `40205`.

SPM has no vendor catalog yet, so it starts empty and its screens show the "No tags configured"
row until you add tags.

Rows saved by hand before the catalog existed keep whatever group and aliases they were given.
`backend/migrate_plc_tags.py` re-files the seven AH PLC rows onto the Live screen and backfills
their `D2xx` / `4xxxx` aliases; it is idempotent, so it is safe to re-run.

APIs:

- `GET /api/machines/telemetry/tags?profile_id=servo_press`
- `POST /api/machines/telemetry/tags` (admin)
- `PUT /api/machines/telemetry/tags/{id}` (admin)
- `DELETE /api/machines/telemetry/tags/{id}` (admin)

### Example: Emergency button press

| Field | Value |
|---|---|
| Item | Emergency button press |
| Node-RED name | Emergency button press |
| Group | Live Status |
| Modbus | *(your register hex)* |
| EIP/PN | *(e.g. Dxxx)* |
| Type | W |
| Scale | 1 |

Node-RED must publish that name in `readings[]`. After the next telemetry push (or refresh of Equipment Overview), the row shows under **Live Status**.

## Built-in catalog (fallback)

Catalog defaults also live in code:

`backend/app/servo_press_modbus.py` → `SERVO_PRESS_REGISTERS`

UI groups come from each tag’s `group` (`live` | `result`), via profile:

`backend/app/machine_telemetry_profiles.py`

Prefer the **Telemetry Tags UI** over editing Python for day-to-day mapping.

## Machine linking

In **Machine Config**:

- Set **Machine type** = `Servo Press`
- Set **name** (must match Node-RED `deviceName`)
- Optionally set **PLC topic** = Edge device UUID

## PMS ingest endpoint

`POST /api/machines/telemetry` (no JWT — same pattern as machine status push)

Optional explicit machine: `POST /api/machines/{machine_id}/telemetry`

### Example Node-RED `msg.payload`

```json
{
  "id": "46371886-eb4a-4669-8ed2-b58a3177d9c3",
  "syncBy": "MODBUS",
  "deviceName": "Servo press",
  "device": "7dcfa25e-250c-4447-9b3a-0dfce0a639ad",
  "origin": 1789123062372,
  "readings": [
    { "name": "status:Int16", "value": "0" },
    { "name": "Live position", "value": "42600" },
    { "name": "Live force", "value": "958" },
    { "name": "Emergency button press", "value": "1" },
    { "name": "Total amount", "value": "1248" },
    { "name": "Pass amount", "value": "1232" },
    { "name": "NG amount", "value": "16" }
  ]
}
```

Raw Modbus integers are scaled in PMS (e.g. position × 0.001 → mm, force × 0.1 → kgf, production time × 0.01 → s).

## Production counters during Pressing

When Status\* = **3**, Modbus clears Pressing Result registers (Total/Pass/NG → 0).  
PMS **holds the last Result-ready counters** for:

- Production tiles (Total / Good / Reject)
- Modbus OEE quality rate (QR)
- Parameters → Pressing Result table

Counters update again when Status\* is **4–8** (Result ready).

## OEE — Servo Press formula (separate from PMS)

Classic CNC / Data Entry / Production Dashboard KPI formulas in
`machine_kpi._compute_kpi` and `oee.calculate_oee` are **unchanged**.

Servo Press uses a dedicated formula in `backend/app/servo_press_oee.py`:

| Rate | Definition |
|---|---|
| **AR** | (Pressing + Result-ready seconds from Modbus Status*) / shift available time × 100 |
| **PR** | Modbus **shift** actual (Total − shift-start baseline) / plan expected qty × 100 |
| **QR** | Modbus shift Pass / shift Total × 100 |
| **OEE** | AR × PR × QR / 10000 |

AR, PR and QR are each **capped at 100%** before the product (same rule as Data Entry OEE).
Without the cap, an over-producing shift (actual ≫ expected) pushed PR and OEE past 100%, and the
UI clamped each tile separately — so AR×PR×QR no longer matched the OEE number. Uncapped values
remain available as `ar_raw` / `pr_raw` / `qr_raw` / `oee_raw` on the KPI payload for audit.

Expected qty uses plan cycle time and shift available minutes (same planning inputs, different actuals source).  
Modbus Total/Pass/NG are **cumulative device counters** — only the **delta since shift start** is used.

**Counter restarts.** A press that is power-cycled — or a Node-RED flow that is redeployed — starts its
counters again from a lower value. `ensure_shift_production_baseline` detects that the live counter has
fallen below the shift baseline, banks the pieces already counted this shift as `shift_carry_*`, and
re-baselines on the new value, so shift production keeps climbing instead of sticking at 0 for the rest
of the shift. Zero reads are ignored for this check because Status\*=3 clears the result registers.

### Where it is used

| Screen / API | Formula |
|---|---|
| Equipment Overview → Servo Press OEE | `servo_oee` (`formula=servo_press_modbus`) |
| OEE Dashboard → realtime rows for Servo Press | same Servo formula (`source=realtime_servo_press`) |
| OEE Dashboard → machine KPI dialog (Servo Press) | Servo formula; classic PMS result kept under `pms_kpi` |
| CNC / other machines / Data Entry | **unchanged** PMS formulas |
| Production plan `actual_qty` | **not** written from Modbus |

### Live Trend chart

Position and Force share the **left** Y-axis (mm / kgf).  
Velocity uses the **right** Y-axis (mm/s) so it is not flattened at the bottom.

All three parameters are plotted by default. Selecting a chip (**All Parameters / Position / Force /
Velocity**) — or clicking a legend entry — isolates that parameter and clears the others; the Y-axis
label and axes follow the selection. Clicking the active parameter again restores all three.

### Alarm distribution (Alarms tab)

Four extruded 3D bar panels with labelled X / Y axes. **Every bar inside a panel has its own
dual-tone gradient colour**, and the legend is rendered in the panel header (top-right, outside the
plot) so it never overlaps the bars.

Category labels are drawn **horizontally**, never tilted: the `AxisTick` renderer splits a long label on
`|` (and then on word boundaries past 14 characters) and stacks the parts on separate lines, so
`Result ready | code 5` reads straight across two rows.

| Panel | One bar per | Bar height | Colours |
|---|---|---|---|
| **Alarm Type** | distinct Modbus Alarm Code | how many times that issue **occurred** (raise events; a raise + its clear is one occurrence) | rotating palette, one colour per code |
| **Event** | `raised` / `cleared` | event count | raised amber, cleared green |
| **Status\*** | Status\* phase \| code at the time of the event | event count | PMS status palette (alarm red, pressing green, result blue, idle amber) |
| **Quality Result** | OK / NG | **shift pieces from the production counters** | OK green, NG pink |

The Quality Result panel reads the same shift Pass / NG counters as the Production tiles, **not** the
alarm event log. Counting the event log there over-reports NG, because alarm events only exist around
a fault — one NG part can produce a raise and a clear event while hundreds of good parts produce none.

Alarm Type bar labels come from `ALARM_TYPE_LABELS` in
`frontend/src/components/overview/ServoPressEquipmentView.jsx` — a code → name map that is empty by
default. Fill it from the manufacturer alarm table §9.1 (e.g. `{ 101: 'Overload' }`) to get
`Overload (101)` instead of `Code 101`. If a code is not mapped, PMS uses the Node-RED event label
when it is descriptive, otherwise `Code N`.

The simulator flow (`nodered/servo_press_flows.json`) rotates through two code tables so the panel
has several bars: `FAULT_CODES = [101, 102, 103, 104]` raise on an NG result, and
`WARN_CODES = [201, 202, 305]` raise on every 3rd good result (part stays OK). Warning cadence is
driven by a good-result counter, not `tick % n` — the result phase is `tick % 6 === 4 or 5`, so a
`tick % 3` condition can never coincide with it.

## Node-RED store and forward (CSV spool)

If PMS is unreachable — `ECONNREFUSED` because the backend window was closed, a timeout, or a 5xx —
the sample is **not** lost. `nodered/servo_press_flows.json` buffers it to CSV and replays it after
the connection returns:

| Node | Role |
|---|---|
| `delivered? -> spool` | Only a **numeric 2xx** counts as delivered. A connection failure leaves `msg.statusCode` as a string (`ECONNREFUSED`), so it routes to the spool. Replayed rows go to their own output. |
| `spool row to CSV` → `append spool CSV` | Appends one row per sample, writing the header on the first row of a session. |
| `reconnected? flush spool` | Fires on the next successful POST (and once ~12 s after Deploy, to drain a previous session). Skips when the spool is empty or a drain is already running. |
| `read spool CSV` → `load spooled rows` → `next spooled row` | Replays **oldest row first** so history reaches PMS in the order it happened. |
| `drain result` | Loops back for the next row while PMS keeps answering; on a fresh failure it puts the row back, rewrites the CSV with everything still pending, and waits for the next reconnect. |
| `rewrite spool CSV` | Leaves just the header once the backlog is delivered. |
| `prove spool file` → `read spool back` → `report spool location` | Once per session, reads the CSV back and warns with the path, size, row count and the host/user Node-RED runs as. |
| `GET /servo-press-spool.csv` | Downloads the spool over HTTP (`http in` → `read spool for download` → `serve spool CSV` → `http response`); answers 404 while nothing is buffered. |

Spool file and CSV columns are set in **`cfg PMS URL + device`** (`SPOOL_FILE`, `SPOOL_COLUMNS`).
Use an **absolute** path — a bare filename resolves against the working directory Node-RED was
started in, not the user directory, which on an appliance install may not be writable. Defaults:
`/var/tmp/servo_press_spool.csv` on the Ubuntu Node-RED host, `C:/eap-pms/servo_press_spool.csv` on
Windows. The directory is created if missing (`createDir`).

Columns are `iso_time, origin, device_name, device_uuid` plus one column per Modbus tag holding the
**raw register value**, so the file opens directly in Excel and replays without loss (`status`
rebuilds both `status:Int16` and `Status*1`).

Both file nodes read their path from `msg.filename`, which in Node-RED 3.1+ means
`filenameType: "msg"` with `filename: "filename"` — the **property name**, not a blank field. A blank
field raises `Invalid property expression: zero-length` followed by `No filename specified`, and every
buffered sample is dropped.

### The CSV path is not visible from a host shell

An absolute path is no guarantee the file lands where an operator can see it. When Node-RED runs in a
container, as a snap, or as a systemd unit with `PrivateTmp=yes`, its `/var/tmp` is a private mount —
`ls /var/tmp` on the host shows nothing, even while the flow writes and reads the file happily.
Symptom: `spool row to CSV` reports rows spooled and `load spooled rows` reports rows to resend
(a count it can only get by reading the file), yet the path does not exist for the shell.

Two aids in the flow, rather than guesswork:

- `report spool location` warns once per session with the real path, byte count, buffered row count,
  and `HOSTNAME / USER / HOME / NODE_RED_HOME / PWD / container`. If that hostname is not the machine
  you are shelled into, the path is inside Node-RED's own filesystem. Function nodes have no
  `process` object, so this uses `env.get()`, which falls through to the process environment.
- `GET http://<node-red-host>:1880/servo-press-spool.csv` returns the file as a download regardless
  of namespace, which is also the only way to collect it when the container has no shell.

To land the CSV on the host filesystem, point `SPOOL_FILE` at a bind-mounted directory — the
Node-RED user directory is the usual one (`/data/servo_press_spool.csv` in the official image).
Spooling itself does not depend on this: the buffer replays to PMS from wherever it lives.

### Inspecting the spool from the editor

Four injects read the CSV without a shell, which is the only option when Node-RED is a pod behind a
reverse proxy:

| Inject | Result |
|---|---|
| `spool: summary` | One message with the path, byte count, buffered row count, column count, and the oldest and newest sample timestamps. |
| `spool: next 5 rows` | The next five samples as named fields (`iso_time`, `status`, `live_force`, …). Press again to walk forward; paging wraps at the end. |
| `spool: back to first row` | Resets the paging cursor. |
| `spool: download URL` | Asks this Node-RED's `/settings` for `httpNodeRoot` and prints the exact path to open in a browser. |

Rows are emitted **one per message** deliberately: the debug sidebar truncates a message at 1000
characters by default, so a page packed into a single message would be cut off mid-row.

`spool: download URL` exists because the download path is `httpNodeRoot + /servo-press-spool.csv`,
and `httpNodeRoot` is a deployment setting — on a stock install it resolves to
`/servo-press-spool.csv`, but an appliance that mounts Node-RED under a prefix moves it. Reading it
from the running instance beats guessing.

### Node-RED in a Kubernetes pod (EDA appliance)

On the EDA appliance Node-RED runs as pod `nodered-*` in namespace `eda`, so its `/var/tmp` is the
container's own layer. Nothing on the node's filesystem shows it, and port 1880 is not published, so
the download endpoint is unreachable from outside until it is forwarded.

```bash
POD=$(kubectl -n eda get pods -l app=nodered -o name | head -1)   # or the nodered-* name from get pods
kubectl -n eda exec $POD -- ls -l /var/tmp/servo_press_spool.csv    # is it there, how big
kubectl -n eda exec $POD -- cat /var/tmp/servo_press_spool.csv > servo_press_spool.csv   # copy it out
kubectl -n eda port-forward $POD 1880:1880                          # then GET /servo-press-spool.csv
```

`exec … cat` is preferred over `kubectl cp`, which needs `tar` inside the container.

**The pod's filesystem is not durable.** A restart or reschedule discards `/var/tmp`, and with it any
backlog collected during a long outage. Keep the spool on the volume that carries the Node-RED user
directory:

```bash
kubectl -n eda get pod $POD -o jsonpath='{range .spec.containers[*].volumeMounts[*]}{.name}{"  "}{.mountPath}{"\n"}{end}'
```

The `probe writable paths` inject answers the same question from inside the container: it writes a
`.pms_spool_probe` file into `/data`, `$HOME/.node-red`, `$HOME`, `$NODE_RED_HOME`,
`/var/lib/node-red`, `/var/tmp` and `/tmp` with `createDir` off, then warns `WRITABLE <dir>` or
`NOT usable <dir> -> <reason>` for each. Set `SPOOL_FILE` to a writable path that the command above
shows as a mounted volume.

**Replay timestamps.** `append_trend_point` / `append_alarm_events` / `append_history_snapshot` stamp
rows with the ingest time, so replayed samples appear in PMS Trend/Alarms/History clustered at the
reconnect moment. The true instrument time is preserved in the CSV (`iso_time`, `origin`). An outage
that spans a shift change therefore counts its backlog against the shift that received it.

### Screen layout

Sub-screens (Production Overview / Live Status / Pressing Result / Alarms / History) are tabs
inside the dark header bar, on the same row as Servo Press / Machine Dashboard, the status badge
and the Line / Device labels.
The page has no fixed viewport height, so it scrolls normally at any browser zoom level and
the tile grids wrap instead of overflowing.

The Machine Overview frame has a transparent background, so upload machine images as
**PNG with an alpha channel** (`backend/tools/make_transparent_png.py` keys out a solid-colour
backdrop from a render). Images with a baked-in white background will still show that white box.

On each telemetry POST, PMS updates `machines.status`:

| Modbus | PMS status | UI badge (Servo screen) |
|---|---|---|
| Alarm Code ≠ 0 | `alarm` | Alarm \| code N |
| Status\* = 3 (Pressing) | `running` | Pressing \| code 3 |
| Status\* = 4–8 (Result ready) | `running` | Result ready \| code N |
| Status\* = 0 (Idle) | `idle` | Idle / Standby \| code 0 |

Transitions are written to `machine_status_log` with source `modbus`.

### Machine matching

1. `machine_id` in body, or  
2. `deviceName` matches `machines.name`, or  
3. `device` UUID equals `machines.plc_topic`
