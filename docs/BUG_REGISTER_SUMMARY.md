# EAP PMS — Bug Register Summary

| Project | EAP PMS (`EAP_PMS_code`) |
|---------|--------------------------|
| Date | 2026-08-04 |
| Detail appendix | See also `docs/BUGS_AND_RESOLUTIONS.md` |

| S.No | Bug name | Bug description | Bug severity | Status |
|------|----------|-----------------|--------------|--------|
| 1 | Concurrent plans / setting-change status | Starting another plan on same machine conflicted; after setting change machine stayed running; Node-RED could overwrite status during MCR; alarm not excluded on start/resume | Critical | Fixed (Committed) |
| 2 | QC approval KeyError / SPC sizing | QC Approvals threw KeyError; SPC chart container sizing wrong | Major | Fixed (Committed) |
| 3 | nginx / PowerShell install failure | nginx setup failed due to permission / PowerShell syntax errors | Major | Fixed (Committed) |
| 4 | Loss Tracker Unaccounted wrong | Unaccounted time calculated incorrectly; Remaining not separated | Major | Fixed (Committed) |
| 5 | Machine KPI formula layout | KPI formula display in dialog hard to read / broken layout | Minor | Fixed (Committed) |
| 6 | Historic data / KPI dialog | Past-date historic load and KPI dialog returned wrong/empty results | Major | Fixed (Committed) |
| 7 | Planning Gantt incorrect | Work Order / Planning Gantt bars did not align with schedule | Major | Fixed (Committed) |
| 8 | DB backup 500 (special password chars) | mysqldump/archive failed (HTTP 500) when DB password had `@` or URL-encoded chars | Critical | Fixed (Committed) |
| 9 | User self-edit role 400 | Editing own account in User Management returned HTTP 400 when role sent | Major | Fixed (Committed) |
| 10 | SPC bell / dashboard shift default | SPC alerts missing from notification bell; Dashboard did not default to current shift after login | Major | Fixed (Committed) |
| 11 | Loss Tracker thresholds lost | Decimal thresholds reset after config save / deploy | Major | Fixed (Committed) |
| 12 | Threshold input / SPC tooltip | Thresholds accepted integers only; SPC tooltip missing measured value | Minor | Fixed (Committed) |
| 13 | OEE % decimals on Dashboard | OEE/AR/PR/QR shown with decimals instead of whole numbers | Minor | Fixed (Committed) |
| 14 | Realtime OEE missing on filters | Live/realtime OEE rows missing under day/shift/week/range/month filters | Critical | Fixed (Committed) |
| 15 | Hourly expected qty early slots only | Planned qty filled early hours and zeroed later hours | Major | Fixed (Committed) |
| 16 | Prior-shift carryover part count | Phantom prior-shift segment counted as a finished part; early hourly slots inflated | Critical | Fixed (Committed) |
| 17 | Stale operator loss not closed | Losses older than 12h stayed open (close not committed) and blocked status / Loss Tracker | Critical | Fixed (Committed) |
| 18 | Orphan operator reference photos | Replaced photos left orphan files; runtime uploads could be committed to git | Minor | Fixed (Committed) |
| 19 | Notification panel stacking | Notification panel stacking wrong; User Management password/edit layout issues | Minor | Fixed (Committed) |
| 20 | Dashboard blank after pull | Missing operator tables after git pull blanked entire Dashboard | Critical | Fixed (Committed) |
| 21 | Schema drift `raised_by_name` 500 | Missing `breakdown_tickets.raised_by_name` caused HTTP 500 on machine status PATCH | Critical | Fixed (Committed) |
| 22 | Deploy looked like data missing | Pull/restart without preflight could make UI look empty even when data existed | Major | Fixed (Committed) |
| 23 | K8s port 80 blocked | Cluster path blocked on port 80; ingress exposure needed | Major | Fixed (Committed) |
| 24 | QC disabled on Live rows | QC defect edit blocked on Live/realtime rows (no DB id), including past dates | Major | Fixed (In code – verify) |
| 25 | Operators API route conflict 422 | `PUT /{id}` before `/roster`/`/allocation` caused HTTP 422 | Critical | Fixed (In code – verify) |
| 26 | React crash on API validation error | FastAPI validation `detail` array rendered as React child → crash | Major | Fixed (In code – verify) |
| 27 | My Work Hours 404 | Admin/supervisor without operator profile got HTTP 404 | Minor | Fixed (In code – verify) |
| 28 | Camera black screen / wrong Capture | Live camera black; Capture opened file-upload dialog instead of snapping frame | Major | Fixed (In code – verify) |
| 29 | Work hours inflated by open punch | Open attendance (no punch-out) counted until “now” → inflated hours | Critical | Fixed (In code – verify) |
| 30 | nginx HTTPS path with spaces | Cert path under folder with spaces broke nginx SSL start on Windows | Critical | Fixed (In code – verify) |
| 31 | Work Instructions hidden all roles | Feature role map all-false hid Work Instructions menu/route for every role | Major | Fixed (Pending commit) |
| 32 | Dual tablet login / session race | Same operator could be active on two tablets; concurrent start race; abandoned sessions blocked forever | Critical | Fixed (Pending commit) |
| 33 | No force sign-out for broken tablet | Broken/offline tablet blocked operator re-login with no supervisor release | Critical | Fixed (Pending commit) |
| 34 | Tablet “no assignment” after sign-in | After sign-in allocation status `active` excluded → tablet showed no assignment | Major | Fixed (Pending commit) |
| 35 | Plans stuck after shift end | Running/paused plans not closed when shift ended | Critical | Fixed (Pending commit) |
| 36 | Shift handoff always completed | Prior-shift plan always marked completed even when actual < planned | Major | Fixed (Pending commit) |
| 37 | SuperAdmin promoted first admin | Bootstrap promoted first shop-floor `admin` to superadmin | Major | Fixed (Pending commit) |
| 38 | WO leftover qty unclear | Schedule end with leftover qty not tracked as closed/outstanding | Major | Fixed (Pending commit) |
| | **TOTAL** | **Bugs found: 38** | | **Bugs fixed: 38** |

### Status breakdown

| Status | Count |
|--------|------:|
| Fixed (Committed on `main`) | 23 |
| Fixed (In code – verify build) | 7 |
| Fixed (Pending commit / release) | 8 |
| **Bugs found** | **38** |
| **Bugs fixed** | **38** |
| Open / unresolved | **0** |
