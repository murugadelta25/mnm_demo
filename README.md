# PMS Production Dashboard

## Stack
- Frontend: React + Vite + Recharts
- Backend: FastAPI + SQLAlchemy
- Database: MySQL
- Realtime: WebSocket

## Setup

### 1. Database
```sql
mysql -u root -p < database/schema.sql
```

### 2. Backend
```bash
cd backend
pip install -r requirements.txt
# Edit .env with your MySQL credentials
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```

## Default Users (update passwords after first login)
| Username | Role | Default Password |
|---|---|---|
| SuperAdmin | superadmin | Password@123 |
| admin | admin | admin123 |
| supervisor1 | supervisor | sup123 |
| operator1 | operator | op123 |
| maintenance1 | maintenance | maint123 |

> Update password hashes in DB using: `python -c "from passlib.context import CryptContext; print(CryptContext(schemes=['bcrypt']).hash('yourpassword'))"`

## Screens
- `/dashboard` — OEE KPIs, charts, table with shift/day/month/model filters + CSV download
- `/entry` — Manual data entry with live OEE calculation preview
- `/model-change` — Operator requests, supervisor approval, live timer (green/red)
- `/breakdown` — Machine layout with colored status squares, ticket lifecycle
- `/maintenance` — Maintenance-only view for ticket acknowledgement and resolution
