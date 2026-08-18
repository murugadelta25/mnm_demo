# EAP-PMS — VAPT End-to-End Feature Checklist

**Document ID:** EAP-PMS-VAPT-E2E-001  
**Purpose:** Exercise every major webapp feature in the VAPT environment while verifying security controls (authN/authZ/TLS/data handling).

**How to use**

1. Run on `https://vapt.eappms` (or approved staging URL).  
2. For each feature: login as **allowed** role (expect success) and **denied** role (expect block).  
3. Mark `Func` (functional E2E) and `Sec` (security expectation) separately.  
4. Record evidence in [VAPT_TEST_EXECUTION_LOG.md](./VAPT_TEST_EXECUTION_LOG.md).

Result codes: `P` Pass · `F` Fail · `B` Blocked · `N` N/A

---

## 0. Environment smoke

| # | Check | Func | Sec | Notes |
|---|-------|------|-----|-------|
| E0.1 | Login page loads over intended scheme (HTTPS preferred) | | | |
| E0.2 | API health via proxied `/api` | | | |
| E0.3 | WebSocket connects (if used on dashboard) | | | |
| E0.4 | Idle timeout / logout works | | | |

---

## 1. Authentication surfaces

| # | Feature | Allowed role(s) | Denied role / condition | Func | Sec |
|---|---------|-----------------|-------------------------|------|-----|
| E1.1 | Customer login `/login` | all provisioned roles | invalid creds | | |
| E1.2 | Platform login `/platform/login` | platform admin | customer JWT | | |
| E1.3 | Password change / must-change gate | flagged user | bypass attempt | | |
| E1.4 | Forgot password | as designed | unauthorized reset | | |
| E1.5 | Autologin `/autologin` | only if explicitly enabled | anonymous abuse | | |

---

## 2. Core monitoring & overview

| # | Route / feature | Typical roles | Security focus | Func | Sec |
|---|-----------------|---------------|----------------|------|-----|
| E2.1 | `/dashboard` | most roles | auth required; no data leak logged-out | | |
| E2.2 | `/overview/factory` | authorized | role/feature gate | | |
| E2.3 | `/overview/line` | authorized | IDOR on `lineId` | | |
| E2.4 | `/overview/equipment` | authorized | IDOR on `machineId` | | |
| E2.5 | `/overview/monitor` | authorized | public kiosk exposure policy | | |

---

## 3. Production operations

| # | Route / feature | Security focus | Func | Sec |
|---|-----------------|----------------|------|-----|
| E3.1 | `/planning` Production Planning | create/edit restricted | | |
| E3.2 | `/work-orders` | maintenance cannot manage if designed | | |
| E3.3 | `/entry` Data Entry | auth + validation | | |
| E3.4 | `/hourly-output` | role gate | | |
| E3.5 | `/loss-tracker` | role gate | | |
| E3.6 | `/model-change` | workflow authorization | | |

---

## 4. Maintenance & quality

| # | Route / feature | Security focus | Func | Sec |
|---|-----------------|----------------|------|-----|
| E4.1 | `/breakdown` | ticket access control | | |
| E4.2 | `/maintenance` | maintenance actions authorized | | |
| E4.3 | `/qc-approvals` | dual-sign / role separation | | |
| E4.4 | `/work-instructions` | operator scope | | |
| E4.5 | `/wi-revisions` | revision rights | | |

---

## 5. Master data & tools

| # | Route / feature | Security focus | Func | Sec |
|---|-----------------|----------------|------|-----|
| E5.1 | `/parts` | CRUD authZ | | |
| E5.2 | `/tools` | CRUD authZ | | |
| E5.3 | `/machines` | machine config restricted | | |
| E5.4 | `/operators` | PIN/photo not leaked; admin-only edits | | |
| E5.5 | `/my-work-hours` | self-scope only | | |

---

## 6. Administration & high-risk features

| # | Route / feature | Allowed | Denied examples | Func | Sec |
|---|-----------------|---------|-----------------|------|-----|
| E6.1 | `/users` User Management | admin/superadmin | operator | | |
| E6.2 | Feature role access matrix | admin/superadmin | low roles | | |
| E6.3 | `/factory-setup` | superadmin (as designed) | admin/operator | | |
| E6.4 | `/config` Configuration | authorized admins | operator | | |
| E6.5 | `/alerts/email` | authorized | secret echo / unauthorized edit | | |
| E6.6 | `/database-management` | superadmin | all others | | |
| E6.7 | Backup download/restore APIs | superadmin | token of lower role | | |
| E6.8 | History archive config | superadmin | lower roles | | |
| E6.9 | `/platform/modules` | platform admin | customer admin | | |

---

## 7. Cross-cutting VAPT validations (run once per build)

| # | Control | Check | Result |
|---|---------|-------|--------|
| X1 | TLS | HTTPS + cert + redirect | |
| X2 | Security headers | HSTS / framing / content-type options as per policy | |
| X3 | CORS | review `Access-Control-Allow-Origin` | |
| X4 | JWT | non-default secret; expiry enforced | |
| X5 | Swagger | `/docs` posture documented | |
| X6 | Logs | failed logins visible to operators of VAPT host | |
| X7 | Secrets | no `.env` / key material via web | |
| X8 | Session | logout + idle timeout | |

---

## 8. Suggested daily E2E security script (2–3 hours)

1. TLS smoke (X1–X3)  
2. Login matrix for all roles (E1)  
3. Negative authZ: operator → `/users`, `/database-management`, archive APIs  
4. Happy-path functional pass on Dashboard, Planning, Work Orders, Breakdown, QC  
5. Admin-only: User Management + one config change  
6. Superadmin-only: Database Management list backups (no production restore)  
7. Platform boundary check  
8. Logout / idle check  

---

## 9. Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| QA / App tester | | | |
| VAPT tester | | | |
| Application owner | | | |
