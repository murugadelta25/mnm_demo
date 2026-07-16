# EAP PMS — Software Architecture Document

**Project:** Production Monitoring System (PMS)  
**Version:** 1.0  
**Generated:** 2026-07-16  

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Frontend Architecture](#3-frontend-architecture)
4. [Backend Architecture](#4-backend-architecture)
5. [Data Flow Diagrams](#5-data-flow-diagrams)
6. [Deployment Architecture](#6-deployment-architecture)
7. [Feature Capabilities](#7-feature-capabilities)
8. [Limitations](#8-limitations)
9. [Strengths & Advantages](#9-strengths--advantages)

---

## 1. System Overview

The Production Monitoring System (PMS) is a full-stack web application designed for real-time monitoring, tracking, and analysis of manufacturing production lines. It provides live machine status tracking, OEE (Overall Equipment Effectiveness) computation, production planning, quality control, and automated alert systems.

### Target Environment
- **Deployment:** On-premise Ubuntu IPC (Industrial PC) on the factory floor
- **Network:** Factory LAN (accessible via `http://<ipc-ip>:5174`)
- **Users:** Operators, Supervisors, Maintenance, Quality, Admin
- **Scale:** Single factory, multiple stations, 1–50 machines

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT BROWSERS                          │
│              (Chrome / Edge on factory terminals)                │
│                                                                 │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│   │  Dashboard    │  │ Hourly Output│  │ Loss Tracker │  ...    │
│   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘         │
│          │                  │                  │                  │
│          └──────────────────┼──────────────────┘                 │
│                             │                                    │
│                    HTTP / WebSocket                               │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      VITE DEV SERVER                            │
│                  (localhost:5174 — dev mode)                     │
│              Reverse proxy: /api → :8010, /ws → :8010           │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FASTAPI BACKEND (:8010)                       │
│                                                                 │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌───────────┐ │
│  │ REST API   │  │ WebSocket  │  │ Scheduler  │  │ Static    │ │
│  │ (20 routers│  │ (real-time │  │ (APScheduler│  │ Files     │ │
│  │  60+ endpt)│  │  broadcast)│  │  email jobs)│  │ (images)  │ │
│  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘  └───────────┘ │
│         │               │               │                       │
│         └───────────────┼───────────────┘                       │
│                         │                                        │
│                  SQLAlchemy ORM                                   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   MySQL / MariaDB                                │
│                 (22 tables, InnoDB)                              │
│                                                                 │
│    machines · production_plans · machine_status_log              │
│    oee_entries · work_orders · parts · machine_kpi_log          │
│    model_change_requests · breakdown_tickets · ...              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Frontend Architecture

### 3.1 Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| **React** | 19.2 | UI library — functional components with hooks |
| **Vite** | 8.0 | Build tool & dev server (HMR, proxy, fast builds) |
| **React Router** | 7.15 | Client-side routing with nested layouts |
| **Axios** | 1.16 | HTTP client for API communication |
| **Recharts** | 3.8 | Charting library (OEE bar charts, histograms) |
| **date-fns** | 4.2 | Date manipulation utilities |
| **SheetJS (xlsx)** | 0.18 | Client-side Excel file parsing |
| **CSS-in-JS** | — | Inline styles with theme objects (no CSS framework) |

### 3.2 Frontend Architecture Diagram

```
App.jsx
 │
 ├── BrowserRouter
 │    └── AuthProvider (JWT token management)
 │         └── PlatformAuthProvider (multi-tenant auth)
 │              └── BrandingProvider (dynamic site title/favicon)
 │                   └── ThemeProvider (dark/light mode)
 │                        └── ConfigProvider (shifts, breaks, factory config)
 │                             └── FeatureFlagsProvider (module toggles)
 │                                  └── AppRoutes
 │
 ├── Public Routes
 │    ├── /login ──────────── Login.jsx
 │    ├── /autologin ──────── AutoLogin.jsx
 │    └── /platform/* ─────── PlatformLogin / FeatureModulesAdmin
 │
 └── Authenticated Routes (wrapped in AppShell layout)
      │
      ├── PRODUCTION
      │    ├── /dashboard ────────── Dashboard.jsx (OEE overview + real-time)
      │    ├── /planning ─────────── ProductionPlanning.jsx
      │    ├── /work-orders ──────── WorkOrderManagement.jsx (Gantt chart)
      │    ├── /entry ────────────── DataEntry.jsx (manual OEE input)
      │    ├── /hourly-output ────── MachineHourlyOutput.jsx (per-slot metrics)
      │    └── /model-change ─────── ModelChange.jsx (changeover interlock)
      │
      ├── QC (Quality Control)
      │    ├── /qc-approvals ─────── QcApprovals.jsx
      │    ├── /work-instructions ── OperatorWorkInstructionDashboard.jsx
      │    ├── /parts ────────────── PartManagement.jsx
      │    └── /wi-revisions ─────── WorkInstructionRevision.jsx
      │
      ├── MAINTENANCE
      │    ├── /breakdown ────────── Breakdown.jsx (ticket management)
      │    ├── /maintenance ──────── MaintenanceDashboard.jsx
      │    └── /loss-tracker ─────── LossTracker.jsx (shift utilization)
      │
      ├── ALERTS
      │    └── /alerts/email ─────── EmailAlerts.jsx (schedule & groups)
      │
      └── SETTINGS
           ├── /config ──────────── Configuration.jsx (shifts, breaks, thresholds)
           ├── /machines ────────── MachineConfig.jsx
           ├── /factory-setup ───── FactorySetup.jsx
           └── /users ───────────── UserManagement.jsx
```

### 3.3 State Management

| Layer | Technology | Scope |
|-------|-----------|-------|
| **Server State** | Direct `useState` + API calls | Data fetched from backend (no React Query) |
| **UI State** | `useState` / `useReducer` | Component-local state |
| **Persisted State** | `usePersistedState` hook (sessionStorage) | Form drafts, filter selections |
| **Cross-Cutting** | React Context | Auth, Theme, Config, Branding, Feature Flags |
| **Real-Time** | WebSocket (`useWebSocket` hook) | Live machine status updates, plan events |

### 3.4 Key Frontend Patterns

```
Context Providers (global state)
 │
 ├── AuthContext ────── JWT token, user role, login/logout
 ├── ThemeContext ───── Dark/Light mode toggle, theme object (colors)
 ├── ConfigContext ──── Site config (shifts, breaks), getCurrentShift()
 ├── BrandingContext ── Dynamic site title, favicon per factory
 └── FeatureFlagsContext ── Module enable/disable toggles
 │
 ▼
Pages (data fetching + business logic)
 │
 ├── useState + useEffect for API calls
 ├── useMemo / useCallback for computed values
 ├── usePersistedState for filter persistence across navigation
 └── Inline styles with theme objects (s = getStyles(t))
 │
 ▼
Shared Components
 │
 ├── PageHeader ─────── Title, shift indicator, auto-refresh countdown
 ├── AppShell ──────── Sidebar navigation + Outlet (React Router)
 ├── PerformanceLegend ── Color legend for hourly output
 ├── WorkOrderGantt ──── Gantt chart for work order timelines
 └── MachineCard ────── Hourly output card per machine
```

### 3.5 Real-Time Communication

```
Frontend (useWebSocket hook)
    │
    │  ws://host:5174/ws  (proxied to :8010)
    │
    ▼
FastAPI WebSocket endpoint
    │
    │  Broadcast events:
    │    • plan_started / plan_completed / plan_updated
    │    • model_change_request / model_change_completed
    │    • actual_qty_updated
    │    • machine_status_changed
    │
    ▼
All connected clients receive JSON messages
→ Frontend re-fetches relevant data on event receipt
```

---

## 4. Backend Architecture

### 4.1 Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Python** | 3.10+ | Server-side language |
| **FastAPI** | 0.115 | Async web framework (REST + WebSocket) |
| **Uvicorn** | 0.29 | ASGI server (production & development) |
| **SQLAlchemy** | 2.0 | ORM for database access |
| **PyMySQL** | 1.1 | MySQL database driver |
| **Pydantic** | 2.10 | Request/response validation & serialization |
| **APScheduler** | 3.10 | Background job scheduler (email reports) |
| **python-jose** | 3.3 | JWT token generation & validation |
| **passlib + bcrypt** | — | Password hashing |
| **openpyxl** | 3.1 | Excel report generation (.xlsx) |
| **websockets** | 12.0 | WebSocket protocol support |
| **pytz** | 2024.2 | IST timezone handling |
| **python-dotenv** | 1.0 | Environment variable management |

### 4.2 Backend Architecture Diagram

```
FastAPI Application (main.py)
 │
 ├── Lifespan (startup/shutdown)
 │    ├── Auto-migrate tables (if missing)
 │    ├── Start APScheduler (email jobs)
 │    └── Shutdown: stop scheduler
 │
 ├── Middleware
 │    └── CORS (allow all origins for LAN access)
 │
 ├── WebSocket Manager (ws_manager.py)
 │    └── Broadcast events to all connected clients
 │
 ├── Scheduler Service (scheduler_service.py)
 │    └── APScheduler cron jobs for scheduled email reports
 │
 ├── Static Files (/static)
 │    ├── /machines — machine images
 │    ├── /parts — part images & sketches
 │    ├── /factory — factory logos
 │    └── /work-instructions — document uploads
 │
 └── API Routers (20 routers, 60+ endpoints)
      │
      ├── AUTHENTICATION
      │    └── auth.py ─────── POST /api/auth/login (JWT tokens)
      │
      ├── CORE PRODUCTION
      │    ├── oee.py ─────────── /api/oee/* (CRUD, realtime, download, CSV)
      │    ├── plans.py ───────── /api/plans/* (CRUD, reschedule, bulk ops)
      │    ├── work_orders.py ─── /api/work-orders/* (CRUD, Gantt data)
      │    ├── hourly_output.py ── /api/hourly-output/* (computed metrics)
      │    ├── machine_kpi.py ──── /api/machine-kpi/* (OEE/AR/PR/QR/TEEP)
      │    └── model_change.py ─── /api/model-change/* (approval workflow)
      │
      ├── MACHINE & STATION
      │    ├── machines.py ─────── /api/machines/* (CRUD, status, status-log)
      │    └── stations.py ─────── /api/stations/* (CRUD)
      │
      ├── QUALITY CONTROL
      │    ├── parts.py ─────────── /api/parts/* (CRUD, documents, QC params)
      │    ├── qc_inspection.py ─── /api/qc/* (inspections, approvals, SPC)
      │    └── operator_dashboard.py ── /api/operator-dashboard/*
      │
      ├── MAINTENANCE
      │    ├── breakdown.py ─────── /api/breakdown/* (ticket lifecycle)
      │    └── deviation_alerts.py ── /api/deviation-alerts/* (escalation)
      │
      ├── CONFIGURATION
      │    ├── config.py ──────── /api/config/* (site config, factory, branding)
      │    ├── users.py ───────── /api/users/* (CRUD, role management)
      │    └── features.py ────── /api/features/* (module toggles)
      │
      ├── NOTIFICATIONS
      │    ├── email_router.py ── /api/email/* (groups, schedules, send)
      │    └── notifications.py ── /api/notifications/* (in-app)
      │
      └── PLATFORM
           └── platform.py ──── /api/platform/* (multi-tenant auth)
```

### 4.3 API Authentication Flow

```
Client                          Backend
  │                                │
  │  POST /api/auth/login          │
  │  { username, password }        │
  │ ──────────────────────────────►│
  │                                │  Verify bcrypt hash
  │                                │  Generate JWT (python-jose)
  │  { access_token, role }        │
  │ ◄──────────────────────────────│
  │                                │
  │  GET /api/oee/                 │
  │  Authorization: Bearer <jwt>   │
  │ ──────────────────────────────►│
  │                                │  Decode JWT → get_current_user()
  │                                │  Role check → require_role()
  │  { data }                      │
  │ ◄──────────────────────────────│
```

### 4.4 Key Backend Patterns

**Dependency Injection:**
```python
@router.get("/")
def get_data(
    db: Session = Depends(get_db),        # DB session
    user = Depends(get_current_user),      # JWT auth
):
```

**Role-Based Access:**
```python
@router.delete("/{id}")
async def delete(id: int,
    user = Depends(require_role("supervisor", "admin")),
):
```

**WebSocket Broadcasting:**
```python
await manager.broadcast({
    "type": "plan_started",
    "plan_id": plan.id,
    "machine_id": plan.machine_id,
})
```

**Auto-Transition (Shift Continuity):**
```python
def auto_transition_shift_plans(db, entry_date, shift_id, cfg):
    # If same part continues from previous shift:
    # 1. Auto-start current shift plan (no model-change needed)
    # 2. Auto-complete previous shift plan
    # Works across days (Shift C → next-day Shift A)
```

---

## 5. Data Flow Diagrams

### 5.1 Real-Time Machine Monitoring Flow

```
PLC / Manual Input
    │
    │  Machine status change (running → idle → breakdown...)
    │
    ▼
POST /api/machines/{id}/status
    │
    ├── 1. Update machines.status in DB
    ├── 2. Insert into machine_status_log (timestamp journal)
    ├── 3. Check deviation thresholds (config)
    │       └── If breach → send escalation email
    └── 4. WebSocket broadcast → all clients
                │
                ▼
         Frontend re-renders:
          • Dashboard heart icon color changes
          • Hourly Output updates running count
          • Loss Tracker recalculates utilization
```

### 5.2 Production Planning & Execution Flow

```
Supervisor creates Work Order
    │
    ▼
Supervisor creates Production Plans (per shift, per machine)
    │
    ▼
Plan status: PENDING
    │
    ├── Same part as previous shift? ──► AUTO-START (no approval needed)
    │
    └── Different part? ──► Create Model Change Request
                                │
                                ├── Supervisor approves on Model Change page
                                │
                                ▼
                          Plan status: RUNNING
                                │
                                ├── Machine status → running
                                ├── Hourly Output starts counting parts
                                ├── Dashboard shows real-time OEE
                                │
                                ▼
                     actual_qty ≥ planned_qty?
                          │           │
                         YES          NO (shift ends)
                          │           │
                          ▼           ▼
                    AUTO-COMPLETE   PAUSE/COMPLETE
                          │
                          ▼
                   Work Order progress updated
```

### 5.3 OEE Calculation Flow

```
                    ┌─────────────────────┐
                    │  machine_status_log  │
                    │  (real-time journal)  │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Build Status        │
                    │  Segments            │
                    │  • Classify idle     │
                    │    durations as      │
                    │    ld_unld or idle    │
                    │  • Merge micro-gaps  │
                    │  • Stitch multi-     │
                    │    segment cycles    │
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                     │
          ▼                    ▼                     ▼
  ┌───────────────┐  ┌────────────────┐   ┌────────────────┐
  │ Running Time  │  │ Operating Time │   │ Part Count     │
  │ (state=running│  │ (running +     │   │ (countable     │
  │  segments)    │  │  ld_unld)      │   │  running segs  │
  └───────┬───────┘  └────────┬───────┘   │  above CT      │
          │                   │           │  threshold)    │
          │                   │           └────────┬───────┘
          │                   │                    │
          ▼                   ▼                    ▼
  ┌──────────────────────────────────────────────────────┐
  │                   KPI CALCULATIONS                    │
  │                                                      │
  │  AR = Operating Time / Available Time × 100          │
  │  PR = Actual Output / Expected Output × 100          │
  │  QR = Good Units / Total Units × 100 (default 100%)  │
  │  OEE = AR × PR × QR / 10000                         │
  │  MUR = Running Time / Available Time × 100           │
  │  Yield = Actual Output / Theoretical Output × 100    │
  │  TEEP = OEE × MUR / 100                             │
  └──────────────────────────────────────────────────────┘
          │
          ├──► Hourly Output Dashboard (per-slot breakdown)
          ├──► Dashboard (shift-level summary)
          ├──► Machine KPI Dialog (7 metrics)
          └──► machine_kpi_log (historic snapshots)
```

### 5.4 Email & Report Flow

```
                  ┌─────────────────────┐
                  │   APScheduler       │
                  │   (cron jobs)       │
                  │   Runs at configured│
                  │   send_hour:minute  │
                  └──────────┬──────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        OEE Report    Planning Report   Breakdown Report
              │              │              │
              └──────────────┼──────────────┘
                             │
                   ┌─────────▼─────────┐
                   │  Build XLSX with  │
                   │  openpyxl         │
                   │  (styled headers, │
                   │   multiple sheets)│
                   └─────────┬─────────┘
                             │
                   ┌─────────▼─────────┐
                   │  Send via SMTP    │
                   │  (Gmail / custom) │
                   │  To: email groups │
                   └─────────┬─────────┘
                             │
                   ┌─────────▼─────────┐
                   │  Log to email_logs│
                   │  (audit trail)    │
                   └───────────────────┘

  Manual triggers:
    • Dashboard → Download Excel / CSV
    • Email Alerts page → Send Now
    • Planning page → Export / Email Report
```

---

## 6. Deployment Architecture

### 6.1 Production Deployment (Ubuntu IPC)

```
┌─────────────────────────────────────────────────────────────┐
│                   Ubuntu IPC (Factory Floor)                  │
│                                                              │
│   ┌────────────────────────────────────────────────────┐    │
│   │  systemd service: pms-backend                       │    │
│   │  uvicorn app.main:app --host 0.0.0.0 --port 8010   │    │
│   │                                                     │    │
│   │  Python 3.10+ virtual environment                   │    │
│   │  └── FastAPI + SQLAlchemy + APScheduler             │    │
│   └────────────────────────┬───────────────────────────┘    │
│                            │                                 │
│   ┌────────────────────────┼───────────────────────────┐    │
│   │  systemd service: pms-frontend                      │    │
│   │  npx vite preview --host --port 5174                │    │
│   │  (or: npx serve dist -l 5174)                       │    │
│   │                                                     │    │
│   │  Vite production build (static assets)              │    │
│   │  Proxy: /api → localhost:8010                       │    │
│   └────────────────────────┬───────────────────────────┘    │
│                            │                                 │
│   ┌────────────────────────┼───────────────────────────┐    │
│   │  MySQL / MariaDB Server                             │    │
│   │  Database: pms_dashboard (or configured name)       │    │
│   │  22 tables, InnoDB engine                           │    │
│   └────────────────────────────────────────────────────┘    │
│                                                              │
│   Access: http://<ipc-ip>:5174                              │
│   Factory terminals connect via LAN                          │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 Development Setup

```
Windows / Linux / macOS developer machine
    │
    ├── Terminal 1: cd backend && uvicorn app.main:app --port 8010 --reload
    ├── Terminal 2: cd frontend && pnpm dev (Vite HMR on :5174)
    └── MySQL running locally or remote
```

---

## 7. Feature Capabilities

### 7.1 Production Monitoring

| Feature | Description |
|---------|-------------|
| **Real-Time Dashboard** | Live OEE, AR, PR, QR per machine with animated status hearts |
| **Hourly Output** | Per-slot (hourly) production count, expected vs actual, OEE breakdown |
| **Loss Tracker** | Shift utilization breakdown with status duration analysis, cycle time histograms |
| **Machine KPI Dialog** | 7 KPIs (OEE, AR, PR, QR, MUR, Yield, TEEP) with historic snapshots |
| **Machine Status Log** | Complete status change journal with deviation reasons |
| **Multi-Shift Support** | 3 configurable shifts (A/B/C) with automatic shift transitions |
| **Cross-Day Continuity** | Same-part auto-transition across overnight shifts and day boundaries |
| **Micro-Gap Merging** | Automatically merges brief interruptions (< configurable seconds) |
| **Cycle Stitching** | Multi-segment cycle support for milling/orientation-change operations |

### 7.2 Production Planning

| Feature | Description |
|---------|-------------|
| **Work Orders** | Create, track, and complete work orders with Gantt chart visualization |
| **Shift Planning** | Plan per machine, per shift, per date with multi-day/multi-shift bulk creation |
| **Model Change Interlock** | Supervisor approval required when changing parts (auto-skipped for same part) |
| **Plan Rescheduling** | Individual and bulk reschedule with split-remaining support |
| **Auto-Complete** | Plans auto-complete when actual qty reaches planned qty |
| **Priority Queue** | Machine pipeline view ordered by priority |

### 7.3 Quality Control

| Feature | Description |
|---------|-------------|
| **Part Management** | Full part master with operations, cycle times, QC parameters |
| **Process Control Sheets** | Work instructions with document revision tracking |
| **QC Inspection Reports** | Multi-level approval (Operator → Inspector → Incharge) |
| **SPC Integration** | LSL/USL limits on numeric QC parameters |
| **Defect Tracking** | Before/after OEE audit when defects are updated post-QC |
| **Document Versioning** | Full revision history with archive/supersede workflow |

### 7.4 Maintenance & Alerts

| Feature | Description |
|---------|-------------|
| **Breakdown Tickets** | Full lifecycle: raised → acknowledged → in_progress → resolved |
| **Deviation Alerts** | Configurable thresholds per status type (idle, breakdown, alarm, etc.) |
| **Multi-Level Escalation** | Auto-escalate alerts (Operator → Supervisor → Manager) with configurable delays |
| **Email Reports** | Scheduled daily/shift reports with XLSX attachments |
| **Email Groups** | Configurable recipient groups by report type |

### 7.5 Configuration & Admin

| Feature | Description |
|---------|-------------|
| **Shift Configuration** | Define shift times, enable/disable shifts, configure breaks |
| **Break Windows** | Lunch, tea, TPM breaks deducted from available time |
| **Threshold Configuration** | Running part threshold %, Ld/UnLd max, micro-gap merge duration |
| **Factory Hierarchy** | Factory → Department → Line → Station mapping |
| **User Management** | Role-based access (operator, supervisor, maintenance, admin, quality) |
| **Feature Flags** | Enable/disable application modules per deployment |
| **Dark/Light Theme** | User-selectable UI theme |
| **Auto-Login** | URL-based auto-login for kiosk/terminal deployments |

### 7.6 Reporting & Export

| Feature | Description |
|---------|-------------|
| **Excel Download** | OEE, Hourly Output, Planning reports in styled XLSX |
| **CSV Export** | Lightweight CSV downloads for data analysis |
| **Email Reports** | Automated scheduled reports with XLSX attachments |
| **Manual Email** | Send reports on-demand to selected groups |
| **Report Columns** | Full data parity: Date, Station, Machine, Shift, Work Order, Model, CT, Plan Qty, Possible, Actual, Prod Loss, AR, PR, QR, OEE |

---

## 8. Limitations

### 8.1 Architecture Limitations

| Area | Limitation | Impact |
|------|-----------|--------|
| **No ORM Relationships** | SQLAlchemy models lack `relationship()` mappings | Requires multiple queries + Python-side joins; no lazy loading |
| **No API Versioning** | All endpoints are `/api/*` without version prefix | Breaking changes affect all clients simultaneously |
| **No Caching Layer** | No Redis/Memcached for frequently accessed data | Every request hits the database directly |
| **Single Process** | Uvicorn runs as a single process (no Gunicorn workers) | Limited concurrency under heavy load |
| **No Message Queue** | No RabbitMQ/Kafka for async processing | Email sending and heavy computations block the request thread |
| **No Database Migrations Framework** | Manual migration scripts instead of Alembic | Schema changes require manual SQL scripts |
| **Session-Based Persistence** | Frontend uses sessionStorage for filter state | State lost on browser tab close; no cross-device persistence |

### 8.2 Scalability Limitations

| Area | Limitation |
|------|-----------|
| **Single Database** | No read replicas or sharding; single MySQL instance |
| **No Horizontal Scaling** | Application designed for single-instance deployment |
| **Machine Count** | Tested with 1–10 machines; may slow with 50+ machines and dense status logs |
| **Status Log Volume** | `machine_status_log` grows indefinitely; no archival/purge strategy |
| **No CDN** | Static assets served directly from Uvicorn; no CDN for images |

### 8.3 Security Limitations

| Area | Limitation |
|------|-----------|
| **JWT Secret** | Stored in `.env` file; no key rotation mechanism |
| **CORS** | Set to `allow_origins=["*"]` (open to all origins) |
| **No HTTPS** | Runs on HTTP within factory LAN; no TLS certificate management |
| **Password Policy** | No password complexity requirements or expiration |
| **No Audit Trail** | User actions (login, data changes) not comprehensively logged |
| **SMTP Password** | Stored in plaintext in `email_smtp_config` table |

### 8.4 Feature Limitations

| Area | Limitation |
|------|-----------|
| **No Mobile App** | Web-only; responsive but not optimized for mobile |
| **No Offline Mode** | Requires constant network connectivity |
| **Single Language** | English-only UI (no i18n/l10n support) |
| **No Multi-Factory** | Designed for single factory deployment; factory hierarchy is visual only |
| **Manual Machine Status** | PLC integration (MQTT/Modbus/OPC-UA) is configured but primarily manual |
| **No SPC Charts** | QC has LSL/USL parameters but no control charts (X-bar, R-chart) |
| **No Predictive Analytics** | Historical data only; no ML-based predictive maintenance |

---

## 9. Strengths & Advantages

### 9.1 Architecture Strengths

| Strength | Benefit |
|----------|---------|
| **Simple Stack** | React + FastAPI + MySQL — easy to understand, debug, and maintain |
| **Zero External Dependencies** | No Redis, Kafka, Nginx, or Docker required — single machine deployment |
| **Real-Time Updates** | WebSocket broadcasting ensures all connected clients see instant status changes |
| **Self-Contained** | Single `git clone` + `pip install` + `pnpm install` gets the full system running |
| **Auto-Migration** | Backend auto-creates missing tables on startup; no manual migration steps |
| **LAN-Optimized** | Runs entirely on factory LAN; no cloud dependency or internet requirement |

### 9.2 Development Strengths

| Strength | Benefit |
|----------|---------|
| **Hot Module Replacement** | Vite HMR enables instant UI changes during development |
| **Type Hints** | Pydantic models validate all API request/response data automatically |
| **FastAPI Docs** | Auto-generated OpenAPI (Swagger) documentation at `/docs` |
| **Modular Routers** | 20 independent routers make feature development isolated |
| **Inline Styles + Theme** | No CSS build pipeline; theme-aware styles without CSS-in-JS library overhead |
| **Single Codebase** | Frontend and backend in one repo — simple CI/CD and deployment |

### 9.3 Production Strengths

| Strength | Benefit |
|----------|---------|
| **Configurable Thresholds** | Running part %, micro-gap duration, Ld/UnLd classification — all configurable without code changes |
| **Smart Part Counting** | Duration-based threshold prevents over-counting micro-runs as parts |
| **Cycle Stitching** | Handles multi-orientation milling where 1 part = 3+ running cycles |
| **Automatic Shift Transitions** | Same-part continuity across shifts without manual intervention |
| **Computed Columns** | MySQL-level calculations ensure data consistency for OEE breakdowns |
| **Historic KPI Storage** | `machine_kpi_log` enables trend analysis and shift-over-shift comparison |
| **Multi-Level Escalation** | Automated alert escalation ensures breakdowns are never ignored |

### 9.4 Operational Strengths

| Strength | Benefit |
|----------|---------|
| **Low Resource Footprint** | Runs on a single Ubuntu IPC (2GB RAM sufficient) |
| **No License Costs** | 100% open-source stack — no per-seat or per-machine licensing |
| **Cross-Platform Backend** | Python backend runs identically on Windows (dev) and Linux (prod) |
| **Instant Deploy** | `git pull` + restart services — no build pipelines required in production |
| **Dual Data Source** | Dashboard merges real-time computed data with manual data entry; neither blocks the other |
| **Role-Based Access** | 5 user roles (operator → admin) with appropriate feature restrictions |

---

## Appendix A: File Structure

```
EAP_PMS_code/
│
├── frontend/
│   ├── src/
│   │   ├── api/            # Axios client, WebSocket hook
│   │   ├── components/     # Shared UI components
│   │   │   └── layout/     # AppShell, Sidebar, Navigation
│   │   ├── context/        # React Context providers (7 contexts)
│   │   ├── hooks/          # Custom hooks (usePersistedState, etc.)
│   │   ├── pages/          # 18 page components
│   │   ├── themes/         # Theme definitions, color palettes
│   │   ├── utils/          # Utility functions
│   │   └── App.jsx         # Root component with routing
│   ├── package.json
│   └── vite.config.js
│
├── backend/
│   ├── app/
│   │   ├── routers/        # 20 API routers (60+ endpoints)
│   │   ├── models.py       # SQLAlchemy ORM models (22 tables)
│   │   ├── main.py         # FastAPI app, lifespan, middleware
│   │   ├── auth.py         # JWT authentication
│   │   ├── ws_manager.py   # WebSocket broadcast manager
│   │   ├── scheduler_service.py  # APScheduler email jobs
│   │   └── cycle_stitcher.py     # Multi-segment cycle logic
│   ├── static/             # Uploaded images (machines, parts, docs)
│   ├── requirements.txt
│   └── .env                # DATABASE_URL, JWT_SECRET, SMTP config
│
├── database/
│   ├── schema.sql          # Full database schema
│   ├── init_database.ps1   # PowerShell DB init script
│   └── migrate_*.sql/py    # Migration scripts
│
├── deploy/                 # Deployment scripts
├── docs/                   # Documentation
│   ├── DATABASE_SCHEMA.md
│   └── SOFTWARE_ARCHITECTURE.md (this file)
│
└── CLAUDE.md               # AI assistant project guide
```

---

## Appendix B: API Endpoint Summary

| Router | Prefix | Endpoints | Key Operations |
|--------|--------|-----------|----------------|
| auth | /api/auth | 1 | Login (JWT) |
| oee | /api/oee | 8 | CRUD, realtime, download XLSX/CSV, summary |
| plans | /api/plans | 8 | CRUD, status, reschedule, bulk ops, export |
| work_orders | /api/work-orders | 6 | CRUD, Gantt, status sync |
| hourly_output | /api/hourly-output | 3 | Computed hourly data, machine CT, XLSX |
| machine_kpi | /api/machine-kpi | 2 | Compute KPI, history |
| machines | /api/machines | 5 | CRUD, status, status-log |
| stations | /api/stations | 3 | CRUD |
| model_change | /api/model-change | 4 | Request, approve, start, complete |
| breakdown | /api/breakdown | 4 | CRUD, acknowledge, resolve |
| parts | /api/parts | 8 | CRUD, documents, QC params, search |
| qc_inspection | /api/qc | 6 | Reports, approvals, SPC |
| config | /api/config | 4 | Site config, branding, factory logos |
| users | /api/users | 3 | CRUD, role management |
| email_router | /api/email | 6 | Groups, schedules, send, logs |
| deviation_alerts | /api/deviation-alerts | 3 | Config, logs, escalation |
| notifications | /api/notifications | 2 | In-app notifications |
| platform | /api/platform | 2 | Multi-tenant auth |
| features | /api/features | 2 | Module toggle |
| operator_dashboard | /api/operator-dashboard | 2 | Operator view |
