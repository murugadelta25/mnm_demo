# Titan OEE + CPLM UI Skills — Integration Guide

Integrated copy at:

```
D:\Project documents\2026\cursor_Titan_dev_projects\titan-oee_cplm-ui-integrated
```

Original Titan project is **unchanged** at `titan-oee_v4.6.2_fixed_ct_histogram`.

---

## What Was Integrated

| Item | Location | Purpose |
|------|----------|---------|
| CPLM Cursor skills | `.cursor/skills/dev-guide/`, `.cursor/skills/line-manager-sa/` | AI coding standards & UI patterns |
| Cursor rules | `.cursor/rules/titan-cplm-integration.mdc` | Agent orientation for this project |
| Navigation split | `frontend/src/navigation.js` | CPLM pattern: nav separate from routes |
| App shell | `frontend/src/components/layout/AppShell.jsx` | CPLM Root layout (sidebar + outlet) |
| Page frame | `frontend/src/components/layout/SimpleFrame.jsx` | Optional page wrapper (UI only) |
| Layout tokens | `frontend/src/themes/cplm-layout.css` | Spacing/radius tokens from dev-guide |

### What Was NOT Changed

- All `frontend/src/pages/*` business logic (API, state, charts, forms)
- `frontend/src/api/*` — axios client, WebSocket
- `frontend/src/context/*` — Auth, Config, Theme logic
- `backend/` — Python FastAPI, database, routers

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 18+ |
| Python | 3.10+ |
| MySQL | 8.x (for backend) |
| npm or pnpm | Either works for Titan frontend |

---

## Run on Windows (PowerShell)

### 1. Backend

```powershell
cd "D:\Project documents\2026\cursor_Titan_dev_projects\titan-oee_cplm-ui-integrated\backend"

# First time only — create venv and install deps
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Start API (port 8010)
uvicorn app.main:app --host 0.0.0.0 --port 8010 --reload
```

### 2. Frontend (new terminal)

```powershell
cd "D:\Project documents\2026\cursor_Titan_dev_projects\titan-oee_cplm-ui-integrated\frontend"

# First time only
npm install

# Optional: point API to backend (defaults via vite proxy to localhost:8010)
# Set-Content .env "VITE_API_URL=http://localhost:8010`nVITE_WS_URL=ws://localhost:8010"

npm run dev
```

Open: **http://localhost:5174**

Default login: `operator1` / `op123`

### 3. Quick start script

```powershell
cd "D:\Project documents\2026\cursor_Titan_dev_projects\titan-oee_cplm-ui-integrated"
.\run.ps1
```

---

## Run on Linux (original script)

```bash
cd "/path/to/titan-oee_cplm-ui-integrated"
chmod +x run.sh
./run.sh
```

---

## URLs

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5174 |
| Backend API | http://localhost:8010 |
| API docs (Swagger) | http://localhost:8010/docs |
| Health check | http://localhost:8010/health |

---

## Using CPLM Skills in Cursor

1. Open folder `titan-oee_cplm-ui-integrated` in Cursor.
2. Skills auto-load from `.cursor/skills/`.
3. In chat, say:
   - **"Use dev-guide to wrap Dashboard in SimpleFrame"** — UI-only refactor
   - **"Follow dev-guide layout when adding a new page"**

### UI refactor pattern (logic preserved)

```jsx
// Before (logic in page — keep all hooks/API calls)
export default function MyPage() {
  const [data, setData] = useState([]);
  useEffect(() => { /* api.get(...) */ }, []);
  return <div>...</div>;
}

// After (UI shell only — same hooks/API)
import SimpleFrame from '../components/layout/SimpleFrame';

export default function MyPage() {
  const [data, setData] = useState([]);
  useEffect(() => { /* api.get(...) — unchanged */ }, []);
  return (
    <SimpleFrame title="My Page" fillBody>
      {/* same content as before */}
    </SimpleFrame>
  );
}
```

---

## File Map: CPLM → Titan

| CPLM (`cplm-web-ui`) | Titan integrated |
|----------------------|------------------|
| `src/navigation.tsx` | `frontend/src/navigation.js` |
| `src/pages/Root.tsx` | `frontend/src/components/layout/AppShell.jsx` |
| `src/components/frames/SimpleFrame` | `frontend/src/components/layout/SimpleFrame.jsx` |
| `src/routes/index.tsx` | `frontend/src/App.jsx` |
| `src/api/client` (fetch) | `frontend/src/api/client.js` (axios — keep as-is) |
| `src/services/*` | Logic stays in pages + `api/` |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Frontend can't reach API | Ensure backend runs on port 8010; check `vite.config.js` proxy |
| `npm install` fails | Delete `node_modules`, run `npm install` again |
| MySQL connection error | Start MySQL; check credentials in `backend/.env` |
| Empty pairs / missing status logs | Run `database/restore_from_package.ps1` to import `eap_pms_FULL_PACKAGE` data |
| Machine images 404 | Ensure `backend/static/machines/` has files; DB `image_url` must match filenames |
| Corrupt Excel download | Re-login if session expired; backend must be running on 8010 |
| Blank page after login | Check browser console; verify nested routes in `App.jsx` |

---

## Next UI Steps (optional, no logic changes)

1. Wrap each page content in `SimpleFrame` for consistent headers.
2. Align `PageHeader.jsx` styling with dev-guide `layout.md` tokens.
3. Gradually replace inline styles with `cplm-layout.css` variables.
4. Reference CPLM `src/components/basic/` when building new shared UI widgets.

Do **not** replace axios/React context with CPLM's React Query/MUI stack unless explicitly planned — that would affect architecture beyond UI.
