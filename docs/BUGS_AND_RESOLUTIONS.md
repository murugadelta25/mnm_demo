# EAP PMS — Bugs & Resolutions (Testing Appendix)

| Document | Details |
|----------|---------|
| Project | EAP PMS (`EAP_PMS_code`) |
| Purpose | Testing / UAT appendix — defect log with resolutions |
| Source | Git commit history (Jul 2026) + development session fixes + uncommitted working-tree fixes |
| Generated | 2026-08-04 |
| How to use | Fill **Actual (after fix)**, **Verified by / Date** during regression. Open this `.md` in Word via *File → Open* or paste into a `.docx` if required. |

### Severity guide

| Severity | Meaning |
|----------|---------|
| **Critical** | Blocks production use, data corruption risk, login/status broken, HTTP 500 on core flows |
| **Major** | Incorrect KPIs/counts, wrong status lifecycle, dual-login / access wrong; workaround limited |
| **Minor** | UI polish, display formatting, layout, non-blocking deploy/docs issues |

### Verification status legend

| Value | Meaning |
|-------|---------|
| Pass / Fail | Tester result after retest |
| *(blank)* | Not yet verified on this build |

---

## A. Committed bug fixes (on `main`)

### BUG-01 — Concurrent plans / setting-change machine status

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Module** | Machine status / Production Planning / Model Change |
| **Build / Commit** | `d6cca84` · 2026-07-10 |
| **Steps to reproduce** | 1. Start plan A on a machine. 2. Start another non-trial plan B on the same machine. 3. Approve a model-change / setting-change request and let it complete. 4. Observe machine status while Node-RED also publishes status. |
| **Expected** | Only one non-trial plan running; conflicting plan auto-paused; after setting change machine is idle (not stuck running); Node-RED does not overwrite status during active MCR; alarm excluded on plan start/resume. |
| **Actual (before fix)** | Concurrent running plans; machine stayed `running` after setting change; Node-RED could overwrite guarded status; alarm not excluded. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Alarm on exclusion list; auto-pause conflicting plan (skip trial); idle after setting change; MCR guard; no DB/WS write when status unchanged. |
| **Verified by / Date** | |

---

### BUG-02 — QC approval KeyError / SPC chart sizing

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Module** | QC Approvals / SPC |
| **Build / Commit** | `6390427` · 2026-07-07 |
| **Steps to reproduce** | 1. Open QC Approvals with hour-band grid. 2. Open SPC chart for a report with deviations. |
| **Expected** | Approval grid loads without error; SPC chart fits container and is readable. |
| **Actual (before fix)** | Approval-structure `KeyError`; SPC chart container sizing wrong. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Hour-band grid + KeyError fix; SPC chart container sizing corrected. |
| **Verified by / Date** | |

---

### BUG-03 — nginx install / PowerShell syntax failures

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Module** | Deploy / nginx |
| **Build / Commit** | `6390427` · 2026-07-07 |
| **Steps to reproduce** | 1. Run `scripts/Install-Nginx.ps1` (or `run.ps1`) as Administrator on Windows. |
| **Expected** | nginx installs/configures without PowerShell syntax or permission errors. |
| **Actual (before fix)** | Permission / PowerShell syntax failures during setup. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Installer permission handling and PowerShell syntax fixed. |
| **Verified by / Date** | |

---

### BUG-04 — Loss Tracker Unaccounted calculation wrong

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Module** | Loss Tracker |
| **Build / Commit** | `e5f6378` · 2026-07-15 |
| **Steps to reproduce** | 1. Open Loss Tracker for a live shift with known losses. 2. Compare Unaccounted tile vs elapsed − known durations. 3. Confirm Remaining tile = unused shift time. |
| **Expected** | Unaccounted = elapsed (or shift base) − known durations; Remaining shows unused shift time separately. |
| **Actual (before fix)** | Unaccounted mixed remaining/shift logic and was incorrect. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Recalculate Unaccounted; add Remaining tile. |
| **Verified by / Date** | |

---

### BUG-05 — Machine KPI formula layout broken

| Field | Value |
|-------|-------|
| **Severity** | Minor |
| **Module** | Machine KPI |
| **Build / Commit** | `e0d3342` · 2026-07-15 |
| **Steps to reproduce** | 1. Open Machine KPI dialog and view formula display. |
| **Expected** | Formulas readable, correctly laid out. |
| **Actual (before fix)** | Layout hard to read / broken. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Improved KPI formula display layout. |
| **Verified by / Date** | |

---

### BUG-06 — Historic data loading / KPI dialog

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Module** | Dashboard / Machine KPI |
| **Build / Commit** | `5a2ecc3` · 2026-07-16 |
| **Steps to reproduce** | 1. Select a past date/shift on Dashboard or KPI views. 2. Confirm historic rows and KPI dialog load correctly. |
| **Expected** | Historic data and KPI dialog load without empty/wrong results for past dates. |
| **Actual (before fix)** | Historic loading and KPI dialog issues. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Historic load + KPI dialog fixes (shipped with shift auto-transition). |
| **Verified by / Date** | |

---

### BUG-07 — Planning Gantt display incorrect

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Module** | Production Planning / Work Order Gantt |
| **Build / Commit** | `5ccaf51` · 2026-07-15 |
| **Steps to reproduce** | 1. Open Work Order / Planning Gantt with multi-day plans. 2. Verify bar positions vs plan dates/shifts. |
| **Expected** | Gantt bars align with planned schedule. |
| **Actual (before fix)** | Gantt visualization incorrect. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Gantt fix with KPI/report UI enhancements. |
| **Verified by / Date** | |

---

### BUG-08 — mysqldump / archive 500 with special chars in DB password

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Module** | Database Backup / Archive |
| **Build / Commit** | `fc0a6f2`, `f36caa7` · 2026-07-16 |
| **Steps to reproduce** | 1. Use `DATABASE_URL` with password containing `@` or other URL-encoded chars. 2. Trigger backup / mysqldump from DB Management. |
| **Expected** | Backup succeeds (mysqldump or JSON fallback). |
| **Actual (before fix)** | HTTP 500 / mysqldump failure. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | URL-decode username/password; fall back to JSON backup. |
| **Verified by / Date** | |

---

### BUG-09 — User Management self-edit role returns 400

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Module** | User Management |
| **Build / Commit** | `f36caa7` · 2026-07-16 |
| **Steps to reproduce** | 1. Log in as a user. 2. Edit own account in User Management and save. |
| **Expected** | Save succeeds; role cannot be changed on own account. |
| **Actual (before fix)** | HTTP 400 when role included in PUT for self. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Disable role selector for own account; omit role from PUT payload. |
| **Verified by / Date** | |

---

### BUG-10 — SPC alerts missing from bell; dashboard not current shift

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Module** | Notifications / Dashboard / SPC |
| **Build / Commit** | `89d83f0`, `f36caa7` · 2026-07-16 |
| **Steps to reproduce** | 1. Submit QC report with SPC warning. 2. Check notification bell within 24h. 3. Log in fresh and open Dashboard. |
| **Expected** | SPC alert in bell; Dashboard defaults to current live shift/date after config loads. |
| **Actual (before fix)** | SPC alerts not shown; dashboard shift/date applied too early. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | SPC from QC payloads + WS reload triggers; wait for site config before filters. |
| **Verified by / Date** | |

---

### BUG-11 — Loss Tracker thresholds lost after deploy/config save

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Module** | Loss Tracker / Site Config |
| **Build / Commit** | `391226e` · 2026-07-16 |
| **Steps to reproduce** | 1. Set decimal Loss Tracker thresholds. 2. Save site config / redeploy. 3. Reload Loss Tracker. |
| **Expected** | Thresholds persist as floats across save/deploy. |
| **Actual (before fix)** | Thresholds reset or lost; int-only storage. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Persist `loss_tracker_limits` in SiteConfig; float thresholds; fail loudly if save does not reach server. |
| **Verified by / Date** | |

---

### BUG-12 — Threshold input / SPC tooltip incomplete

| Field | Value |
|-------|-------|
| **Severity** | Minor |
| **Module** | Loss Tracker / SPC chart |
| **Build / Commit** | `f36caa7` · 2026-07-16 |
| **Steps to reproduce** | 1. Enter threshold as `1.5`, `1:30`, or `1m 28s`. 2. Hover SPC point with deviation. |
| **Expected** | Decimal/`mm:ss`/unit input accepted with preview; tooltip shows measured value. |
| **Actual (before fix)** | Integers only; tooltip missing measured value. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Flexible threshold parsing; tooltip shows actual measured value. |
| **Verified by / Date** | |

---

### BUG-13 — OEE/AR/PR/QR shown with decimals

| Field | Value |
|-------|-------|
| **Severity** | Minor |
| **Module** | Dashboard |
| **Build / Commit** | `4b6e802` · 2026-07-16 |
| **Steps to reproduce** | 1. Open Dashboard KPI % columns. |
| **Expected** | Whole-number percentages (no decimals). |
| **Actual (before fix)** | Decimals shown. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Round/display as whole numbers. |
| **Verified by / Date** | |

---

### BUG-14 — Realtime OEE missing under day/shift/week/range/month filters

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Module** | Dashboard / OEE |
| **Build / Commit** | `ae0805c`, `32b198c` · 2026-07-20 |
| **Steps to reproduce** | 1. Open Dashboard. 2. Switch filters: day, shift, week, range, month. 3. Confirm Live (realtime) and manual rows both appear; search finds realtime; QC only on manual rows (except live QC path if enabled — see BUG-24). |
| **Expected** | Manual + realtime merged for all filters; search applies to realtime. |
| **Actual (before fix)** | Realtime missing on several filters / date ranges. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Merge realtime with manual across filters; search on realtime; restrict legacy QC to manual where applicable. |
| **Verified by / Date** | |

---

### BUG-15 — Hourly expected qty only filled early slots

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Module** | Hourly Output |
| **Build / Commit** | `21fad13` · 2026-07-20 |
| **Steps to reproduce** | 1. Create a plan with planned qty for a full shift. 2. Open hourly expected output. |
| **Expected** | Planned qty distributed across all productive shift hours (after breaks). |
| **Actual (before fix)** | Early slots filled; later slots zeroed. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Proportional distribution by productive minutes after configured breaks. |
| **Verified by / Date** | |

---

### BUG-16 — Prior-shift carryover inflated early part counts

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Module** | Hourly Output / Part counting |
| **Build / Commit** | `b928f63` · 2026-07-22 |
| **Steps to reproduce** | 1. Leave machine `running` across shift boundary (log before shift start). 2. Open hourly output early slots for new shift. 3. Confirm phantom carryover segment is not counted as a finished part. |
| **Expected** | Prior-shift carryover segment excluded from part counts. |
| **Actual (before fix)** | Phantom segment from shift_start → first log counted as a completed part; early slots inflated. Also thresholds (51% / micro_gap 0) filtered real segments on long CT machines. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Tag first segment `prior=True`; skip in countable/transition/slot logic; restore running threshold ~30% and micro_gap 15s. |
| **Verified by / Date** | |

---

### BUG-17 — Stale operator losses stayed open (>12h)

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Module** | Machine status / Loss Tracker |
| **Build / Commit** | `b6ce107` · 2026-07-22 |
| **Steps to reproduce** | 1. Leave an operator loss open >12h. 2. Call machine status / Loss Tracker compute path. 3. Confirm loss is closed in DB. |
| **Expected** | Stale losses auto-close and persist. |
| **Actual (before fix)** | Close computed in memory but never committed; losses blocked status / Loss Tracker. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Commit stale operator-loss auto-close in `_compute_status`. |
| **Verified by / Date** | |

---

### BUG-18 — Orphan operator reference photos / runtime uploads committed

| Field | Value |
|-------|-------|
| **Severity** | Minor |
| **Module** | Operators / Storage / Git |
| **Build / Commit** | `7fa45b0` · 2026-07-22 |
| **Steps to reproduce** | 1. Re-upload or hard-delete operator reference photo. 2. Confirm old file removed from disk. 3. Confirm uploads are gitignored. |
| **Expected** | Old photo deleted; runtime uploads not committed. |
| **Actual (before fix)** | Orphan files left; local artifacts could be committed. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Delete on replace/hard-delete; gitignore operator-reference uploads. |
| **Verified by / Date** | |

---

### BUG-19 — Notification panel stacking / User Management layout

| Field | Value |
|-------|-------|
| **Severity** | Minor |
| **Module** | User Management / Notifications UI |
| **Build / Commit** | `00d9225` · 2026-07-24 |
| **Steps to reproduce** | 1. Open notification panel over User Management edit form. 2. Edit password fields. |
| **Expected** | Panel stacks correctly; password/edit layout usable. |
| **Actual (before fix)** | Stacking wrong; edit/password layout issues. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Panel stacking + password field layout polish (with password policy). |
| **Verified by / Date** | |

---

### BUG-20 — Missing operator tables blanked entire Dashboard after pull

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Module** | Dashboard / Machines / Notifications API |
| **Build / Commit** | `9ab833b` · 2026-07-28 |
| **Steps to reproduce** | 1. Simulate missing/unavailable operator tables (or pull code onto DB without those tables). 2. Open Dashboard. |
| **Expected** | Machines/notifications still load; operator presence degrades gracefully. |
| **Actual (before fix)** | Entire dashboard blanked. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Harden machines + notifications APIs when operator tables missing. |
| **Verified by / Date** | |

---

### BUG-21 — Schema drift: `raised_by_name` missing → 500 on status PATCH

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Module** | Machine status / Breakdown tickets |
| **Build / Commit** | `65059e4` · 2026-07-28 |
| **Steps to reproduce** | 1. On an older DB without `breakdown_tickets.raised_by_name`, PATCH machine status / raise breakdown. 2. After schema update, repeat. |
| **Expected** | Status/breakdown flows succeed. |
| **Actual (before fix)** | HTTP 500 due to missing column. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Add `raised_by_name VARCHAR(100)` to `database/schema.sql`. **Note:** existing DBs need `ALTER TABLE` / migrate — schema file alone does not alter live tables. |
| **Verified by / Date** | |

---

### BUG-22 — Deploy updates looked like “data missing”

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Module** | Deploy / preflight |
| **Build / Commit** | `da38365` · 2026-07-28 |
| **Steps to reproduce** | 1. Run `./run.sh preflight` (or Windows equivalent) before pull/restart. 2. Confirm backup + schema checks run. |
| **Expected** | Wrong DB / missing columns / risky migrations flagged before UI looks empty. |
| **Actual (before fix)** | Pull/restart could make UI look empty even when data existed. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Deploy preflight backup + schema guard; `DEPLOY-SAFE-CHECKLIST.md`. |
| **Verified by / Date** | |

---

### BUG-23 — Port 80 blocked on Kubernetes path

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Module** | Deploy / K8s Ingress |
| **Build / Commit** | `b99d746` · 2026-07-03 |
| **Steps to reproduce** | 1. Deploy with k8 ingress where host port 80 is blocked. |
| **Expected** | Alternate ingress exposure works. |
| **Actual (before fix)** | Port 80 blocked; service unreachable on that path. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | k8-ingress YAML addition for alternate exposure. |
| **Verified by / Date** | |

---

## B. Development-session fixes (verify on current build)

### BUG-24 — QC disabled on Live / past-date realtime rows

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Module** | Dashboard QC / OEE |
| **Build / Commit** | Session fix (OEE `defect/by-machine` APIs) — confirm present on target build |
| **Steps to reproduce** | 1. Open Dashboard on current or past date with **Live** rows only. 2. Edit defect qty via QC. 3. Open QC log after first save. |
| **Expected** | QC editable on live rows; QR/OEE recalculate; log works after first save. |
| **Actual (before fix)** | QC disabled on Live (no DB id); past dates often blocked. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | `PATCH/GET /api/oee/defect/by-machine`; create OEE from live snapshot if needed; enable QC on live rows. |
| **Verified by / Date** | |

---

### BUG-25 — Operator API route conflict → 422 on roster/allocation

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Module** | Operators API |
| **Build / Commit** | Session fix in `operators.py` route order |
| **Steps to reproduce** | 1. Call `GET/PUT /api/operators/roster` and `/allocation`. |
| **Expected** | Endpoints succeed (not treated as `{operator_id}`). |
| **Actual (before fix)** | HTTP 422 — `"roster"` parsed as operator id. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Register static routes before parameterized `/{operator_id}` routes. |
| **Verified by / Date** | |

---

### BUG-26 — React crash rendering FastAPI validation detail

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Module** | Operator Management UI |
| **Build / Commit** | Session fix in Operator Management error handling |
| **Steps to reproduce** | 1. Trigger a FastAPI validation error from Operators UI. |
| **Expected** | Human-readable error string; no React crash. |
| **Actual (before fix)** | Crash: objects not valid as React child (`{type, loc, msg, input}`). |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Stringify/normalize API `detail` before display. |
| **Verified by / Date** | |

---

### BUG-27 — My Work Hours 404 for admin/supervisor without operator profile

| Field | Value |
|-------|-------|
| **Severity** | Minor |
| **Module** | My Work Hours |
| **Build / Commit** | Session fix |
| **Steps to reproduce** | 1. Log in as admin/supervisor with no operator directory row. 2. Open My Work Hours. |
| **Expected** | Empty week view (not 404). |
| **Actual (before fix)** | HTTP 404. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Return empty week instead of 404. |
| **Verified by / Date** | |

---

### BUG-28 — Live camera black screen / Capture opened upload dialog

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Module** | Operator Management — reference photo |
| **Build / Commit** | Session fix in `OperatorManagement.jsx` |
| **Steps to reproduce** | 1. Open Operators → Open live camera. 2. Click Capture photo. 3. Click Upload photo separately. |
| **Expected** | Live preview after permission; Capture snaps frame; only Upload opens file picker. |
| **Actual (before fix)** | Black screen; Capture opened file dialog. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Attach stream after `<video>` mounts; Capture uses live frame only. |
| **Verified by / Date** | |

---

### BUG-29 — Work hours inflated by open punches (no punch-out)

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Module** | Operator work hours / Attendance |
| **Build / Commit** | Session fix (shift-end cap + auto-close) |
| **Steps to reproduce** | 1. Leave an attendance row open after shift end. 2. Open work-hours / attendance report next day. |
| **Expected** | Open punches capped at shift end; stale opens auto-closed; hours not counted until “now”. |
| **Actual (before fix)** | Open punch counted until now (e.g. ~24h); UI showed only first punch. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Cap at shift end; auto-close stale opens on load; punch-in closes leftover opens. |
| **Verified by / Date** | |

---

### BUG-30 — nginx HTTPS failed when cert path contained spaces

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Module** | Deploy / HTTPS / nginx (Windows) |
| **Build / Commit** | Working-tree / session fix in `Install-Nginx.ps1` (verify after commit) |
| **Steps to reproduce** | 1. Repo under path with spaces (e.g. `Project documents`). 2. Run `run.ps1`, choose HTTPS `true`. |
| **Expected** | nginx starts on 80+443; `https://din.eappms` reachable (self-signed warning OK). |
| **Actual (before fix)** | nginx refused to start — `ssl_certificate` split on spaces. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Copy certs to `C:\ProgramData\EAP-PMS\nginx-win\ssl\` (space-free) and quote paths. |
| **Verified by / Date** | |

---

## C. Uncommitted working-tree fixes (commit before release UAT)

> **Release gate:** Items below exist in the local working tree vs `main`. Commit and tag a build before signing UAT Pass.

### BUG-31 — Work Instructions hidden for all roles

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Module** | Feature access / Work Instructions |
| **Build / Commit** | *Uncommitted* — `feature_modules.py`, `access_matrix.py` |
| **Steps to reproduce** | 1. Log in as admin/supervisor/operator/quality. 2. Check sidebar for Work Instructions. 3. After feature-role save, reload. |
| **Expected** | Menu visible per default matrix (not all-false). |
| **Actual (before fix)** | `qc.work_instructions` all-false map persisted; menu/route blocked for every role. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Self-heal ignore stored all-false for repair IDs; restore defaults; add access-matrix row. |
| **Verified by / Date** | |

---

### BUG-32 — Dual tablet login / concurrent session race

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Module** | Mobile operator sessions |
| **Build / Commit** | *Uncommitted* — `mobile.py` |
| **Steps to reproduce** | 1. Sign in operator on tablet A. 2. Sign in same operator on tablet B (different tab/MAC). 3. Re-login same tablet (same tab/MAC). 4. Leave session >16h and retry. |
| **Expected** | Different device → **409** `OPERATOR_ALREADY_ACTIVE`; same device replaces session; stale >16h auto-ended. |
| **Actual (before fix)** | Two tablets could both appear active; race on concurrent starts; abandoned sessions blocked forever. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | `FOR UPDATE` locks; one active device; replace same tab/MAC; conflict detail payload; stale timeout. |
| **Verified by / Date** | |

---

### BUG-33 — Broken tablet blocked re-login (no force sign-out)

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Module** | Operator Management / Sessions |
| **Build / Commit** | *Uncommitted* — `operators.py`, `OperatorManagement.jsx` |
| **Steps to reproduce** | 1. Leave operator active on offline/broken tablet. 2. Supervisor uses **Force sign out** on live allocation. 3. Operator signs in on new tablet. |
| **Expected** | Session ended; attendance punched out if open; new login succeeds. |
| **Actual (before fix)** | Operator locked out until original device could sign out. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | `POST /api/operators/sessions/force-end` + Force sign out UI. |
| **Verified by / Date** | |

---

### BUG-34 — Tablet showed “no assignment” after operator signed in

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Module** | Mobile assignment |
| **Build / Commit** | *Uncommitted* — `operators.py` pending assignment |
| **Steps to reproduce** | 1. Assign operator to machine. 2. Operator signs in (allocation → `active`). 3. Tablet polls pending assignment (including after later sign-out). |
| **Expected** | Assignment still returned when status is `active`. |
| **Actual (before fix)** | Only `assigned`/`acknowledged` queried → “no assignment” for rest of shift. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Include `active` in pending assignment filter. |
| **Verified by / Date** | |

---

### BUG-35 — Plans stayed running/paused after shift end

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Module** | Production Planning |
| **Build / Commit** | *Uncommitted* — `plans.py`, plan status migrate |
| **Steps to reproduce** | 1. Leave plan `running`/`paused` past shift end. 2. Open Plans list/summary. 3. Abort a running/paused plan manually. |
| **Expected** | Auto-heal: full qty → `completed`, shortfall → `incomplete`; manual `aborted` allowed from running/paused. |
| **Actual (before fix)** | Plans stuck running after shift end. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | `_heal_shift_ended_plans` on list/summary; statuses `aborted` / `incomplete`. |
| **Verified by / Date** | |

---

### BUG-36 — Shift handoff always marked prior plan completed

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Module** | Hourly Output / shift auto-transition |
| **Build / Commit** | *Uncommitted* — `hourly_output.py` |
| **Steps to reproduce** | 1. Run same part across shifts with prior plan actual &lt; planned. 2. Trigger auto-transition. |
| **Expected** | Prior plan → `incomplete` if shortfall; `completed` only if actual ≥ planned. |
| **Actual (before fix)** | Prior running/paused always set to `completed`. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Handoff compares actual vs planned before setting status. |
| **Verified by / Date** | |

---

### BUG-37 — SuperAdmin bootstrap promoted first shop-floor admin

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Module** | Auth / bootstrap |
| **Build / Commit** | *Uncommitted* — `main.py`, README / seed |
| **Steps to reproduce** | 1. Fresh DB with only `admin`. 2. Start backend. 3. Confirm reserved `SuperAdmin` exists and `admin` remains admin. |
| **Expected** | Reserved `SuperAdmin` / `Password@123` created; shop-floor admin not promoted. |
| **Actual (before fix)** | First `admin` promoted to `superadmin`. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Create/ensure username `SuperAdmin` instead of promoting first admin. |
| **Verified by / Date** | |

---

### BUG-38 — Work order leftover qty after schedule end unclear

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Module** | Work Orders |
| **Build / Commit** | *Uncommitted* — `work_orders.py`, models, migrate |
| **Steps to reproduce** | 1. Create WO with plans; let end date pass with remaining qty. 2. Verify `closed` + outstanding. 3. Club/consume into new WO or discard. |
| **Expected** | `closed` with `outstanding_qty` / status (`available` / `consumed` / `discarded`); not falsely `completed`. |
| **Actual (before fix)** | Leftover after schedule end not clearly tracked. |
| **Actual (after fix)** | ☐ Pass / ☐ Fail |
| **Resolution** | Status `closed` + outstanding fields + consume/discard/club flows. |
| **Verified by / Date** | |

---

## D. Summary matrix (quick view)

| ID | Severity | Module | Status | Commit |
|----|----------|--------|--------|--------|
| BUG-01 | Critical | Machine status / plans | Committed | `d6cca84` |
| BUG-02 | Major | QC Approvals / SPC | Committed | `6390427` |
| BUG-03 | Major | nginx deploy | Committed | `6390427` |
| BUG-04 | Major | Loss Tracker | Committed | `e5f6378` |
| BUG-05 | Minor | Machine KPI UI | Committed | `e0d3342` |
| BUG-06 | Major | Historic / KPI | Committed | `5a2ecc3` |
| BUG-07 | Major | Gantt | Committed | `5ccaf51` |
| BUG-08 | Critical | DB backup | Committed | `fc0a6f2` |
| BUG-09 | Major | User Management | Committed | `f36caa7` |
| BUG-10 | Major | Notifications / Dashboard | Committed | `89d83f0` |
| BUG-11 | Major | Loss Tracker thresholds | Committed | `391226e` |
| BUG-12 | Minor | Threshold / SPC tooltip | Committed | `f36caa7` |
| BUG-13 | Minor | Dashboard % display | Committed | `4b6e802` |
| BUG-14 | Critical | Dashboard OEE merge | Committed | `ae0805c` |
| BUG-15 | Major | Hourly expected | Committed | `21fad13` |
| BUG-16 | Critical | Part count carryover | Committed | `b928f63` |
| BUG-17 | Critical | Stale operator loss | Committed | `b6ce107` |
| BUG-18 | Minor | Photo cleanup | Committed | `7fa45b0` |
| BUG-19 | Minor | Notification UI | Committed | `00d9225` |
| BUG-20 | Critical | Dashboard blank after pull | Committed | `9ab833b` |
| BUG-21 | Critical | Schema drift breakdown | Committed | `65059e4` |
| BUG-22 | Major | Deploy preflight | Committed | `da38365` |
| BUG-23 | Major | K8s ingress | Committed | `b99d746` |
| BUG-24 | Major | Live QC | Session | *(verify build)* |
| BUG-25 | Critical | Operators route order | Session | *(verify build)* |
| BUG-26 | Major | React error detail | Session | *(verify build)* |
| BUG-27 | Minor | My Work Hours 404 | Session | *(verify build)* |
| BUG-28 | Major | Camera capture | Session | *(verify build)* |
| BUG-29 | Critical | Open punch hours | Session | *(verify build)* |
| BUG-30 | Critical | nginx SSL spaces | Session / WT | *(commit)* |
| BUG-31 | Major | Work Instructions access | Uncommitted | — |
| BUG-32 | Critical | Dual tablet login | Uncommitted | — |
| BUG-33 | Critical | Force sign-out | Uncommitted | — |
| BUG-34 | Major | Assignment active | Uncommitted | — |
| BUG-35 | Critical | Plan shift-end heal | Uncommitted | — |
| BUG-36 | Major | Handoff incomplete | Uncommitted | — |
| BUG-37 | Major | SuperAdmin bootstrap | Uncommitted | — |
| BUG-38 | Major | WO outstanding/closed | Uncommitted | — |

### Counts by severity

| Severity | Count |
|----------|-------|
| Critical | 14 |
| Major | 19 |
| Minor | 5 |
| **Total** | **38** |

---

## E. High-risk regression checklist

| # | Focus | Related bugs | Tester | Pass? |
|---|-------|--------------|--------|-------|
| 1 | Hourly part count early slots after overnight run | BUG-16 | | ☐ |
| 2 | Dashboard day/shift/week/range Live + Manual | BUG-14, BUG-24 | | ☐ |
| 3 | Machine status during MCR / concurrent plans | BUG-01 | | ☐ |
| 4 | Mobile dual-login + force sign-out | BUG-32, BUG-33 | | ☐ |
| 5 | Plan status after shift end (completed / incomplete / aborted) | BUG-35, BUG-36 | | ☐ |
| 6 | Breakdown / status PATCH after DB upgrade (`raised_by_name`) | BUG-21 | | ☐ |
| 7 | Work Instructions menu after feature-role save | BUG-31 | | ☐ |
| 8 | Operator work hours with open punch past shift end | BUG-29 | | ☐ |
| 9 | HTTPS nginx start on Windows path with spaces | BUG-30 | | ☐ |
| 10 | Backup with special characters in DB password | BUG-08 | | ☐ |

---

## F. Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Prepared by | | | |
| Tested by | | | |
| Reviewed by | | | |
| Approved for release | | | |

**Build under test:** _________________  
**Git commit / tag:** _________________  
**Environment:** ☐ Local ☐ Windows IPC ☐ Ubuntu IPC ☐ Other: _______

---

*End of testing appendix. Open `docs/BUGS_AND_RESOLUTIONS.md` in Microsoft Word (File → Open) or copy into a `.docx` template as needed.*
