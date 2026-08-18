# EAP-PMS — One-Page VAPT Scope

**Document ID:** EAP-PMS-VAPT-SCOPE-001  
**Classification:** Confidential  
**Application:** EAP Production Monitoring System (EAP-PMS)  
**Version under test:** _(fill commit/tag)_  
**Assessment window:** _(fill dates)_  
**Environment:** Isolated VAPT / Staging only  

---

## 1. Objective

Authorize and bound Vulnerability Assessment and Penetration Testing of the EAP-PMS web application covering:

- Transport security (SSL/TLS)
- Authentication and session management
- Authorization / role separation
- API and WebSocket security
- Configuration and sensitive-data exposure
- End-to-end feature security controls

---

## 2. In-scope assets

### 2.1 Application entry points (VAPT environment defaults)

| Asset | Default URL / endpoint | Notes |
|-------|------------------------|-------|
| Web UI (via nginx) | `http://vapt.eappms` or `https://vapt.eappms` | Preferred entry |
| Direct frontend (dev/proxy) | `http://<host>:5274` | Optional; staging only |
| Backend API | `http(s)://<host>/api/*` or `:8020` | Prefer nginx proxy |
| Platform admin UI | `/platform/login`, `/platform/modules` | Separate auth realm |
| Customer login | `/login` | JWT-based |
| Auto-login helper | `/autologin` | Staging only; treat as sensitive |
| OpenAPI/Swagger | `/docs`, `/openapi.json` (if enabled) | Must be reviewed |
| WebSocket | `/ws` (proxied) | Auth & abuse checks |

> Production defaults today often use `din.eappms`, frontend `:5174`, backend `:8010`.  
> **VAPT instance must use separate domain/ports/DB** (see environment setup).

### 2.2 Ports (VAPT defaults)

| Service | Production-typical | VAPT-isolated default |
|---------|--------------------|------------------------|
| nginx HTTP | 80 | 80 (or host-specific) |
| nginx HTTPS | 443 | 443 |
| Frontend (Vite) | 5174 | **5274** |
| Backend (FastAPI) | 8010 | **8020** |
| MySQL | 3306 | 3306 (DB name: `eap_pms_vapt`) |
| LAN DNS (optional) | 53 | Disabled unless required |

### 2.3 Application roles in scope

| Role | Purpose |
|------|---------|
| `operator` | Lowest web privilege / shop-floor related access |
| `quality` | QC / inspection related access |
| `maintenance` | Breakdown acknowledge/resolve |
| `supervisor` | Supervisory operations |
| `admin` | Customer admin |
| `superadmin` | Full access incl. factory setup / backup / archive |
| Platform admin | `/platform/*` (not a customer User Management role) |

### 2.4 Feature modules in scope (UI routes)

`/dashboard`, `/overview/*`, `/planning`, `/work-orders`, `/entry`, `/model-change`, `/breakdown`, `/maintenance`, `/loss-tracker`, `/alerts/email`, `/factory-setup`, `/config`, `/machines`, `/hourly-output`, `/work-instructions`, `/qc-approvals`, `/parts`, `/tools`, `/wi-revisions`, `/users`, `/operators`, `/my-work-hours`, `/database-management`, `/platform/*`

### 2.5 API families in scope

`/api/auth/*`, `/api/platform/*`, `/api/users/*`, `/api/operators/*`, `/api/machines/*`, `/api/stations/*`, `/api/plans/*`, `/api/work-orders/*`, `/api/oee/*`, `/api/breakdown/*`, `/api/model-change/*`, `/api/email/*`, `/api/config/*`, `/api/parts/*`, `/api/tools/*`, `/api/qc/*`, `/api/archive/*`, `/api/mobile/*`, notifications / deviation-alerts / overview / KPI endpoints as deployed.

---

## 3. Out of scope

| Item | Reason |
|------|--------|
| Production EAP-PMS instance / production DB | Avoid operational & data risk |
| Factory PLCs / machines / OT networks | Separate OT assessment |
| Corporate AD/LDAP/DC infrastructure | Assessed only via app integration if approved later |
| Email/SMTP provider infrastructure | Provider-side |
| Physical IPC hardware tampering | Physical security separate |
| Social engineering of staff | Not authorized unless separately approved |
| DoS / stress beyond agreed light checks | Requires explicit approval |
| Third-party cloud SaaS unrelated to PMS | N/A |

---

## 4. Authorized test accounts (to be provisioned)

| Account | Role | Password policy |
|---------|------|-----------------|
| `vapt_operator` | operator | Known test secret |
| `vapt_quality` | quality | Known test secret |
| `vapt_maint` | maintenance | Known test secret |
| `vapt_supervisor` | supervisor | Known test secret |
| `vapt_admin` | admin | Known test secret |
| `vapt_superadmin` | superadmin | Known test secret |
| Platform admin | platform | From VAPT `.env` only |

Credentials are shared securely with the VAPT team and rotated after assessment.

---

## 5. Allowed / disallowed techniques

**Allowed (on VAPT host only):** authenticated/unauthenticated scanning, manual authZ testing, TLS/config review, input validation review, session testing, secure header review, controlled privilege checks.

**Disallowed without written approval:** ransomware simulation, mass destructive DB operations on shared infra, password spraying against corporate AD, attacking other LAN hosts, exfiltration of real PII outside the report channel.

---

## 6. Contacts & stop condition

| Role | Name | Contact |
|------|------|---------|
| Application owner | | |
| VAPT lead | | |
| Emergency stop | | |

**Stop condition:** Any unintended access to production, data corruption, or service outage outside VAPT host → stop immediately and notify contacts.

---

## 7. Deliverables expected from VAPT

1. Executive summary  
2. Technical findings with CVSS/severity  
3. Evidence (request/response excerpts, screenshots)  
4. Remediation recommendations  
5. Retest report after fixes  

---

## 8. Authorization

| Party | Name | Signature | Date |
|-------|------|-----------|------|
| Application owner | | | |
| VAPT provider | | | |
| IT / InfoSec | | | |

**Statement:** The undersigned authorize testing **only** against the VAPT/staging assets listed above during the assessment window.
