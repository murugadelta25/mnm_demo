# EAP-PMS — VAPT Test Case Specification

**Document ID:** EAP-PMS-VAPT-TC-001  
**Classification:** Confidential  
**Related scope:** [VAPT_SCOPE.md](./VAPT_SCOPE.md)  
**Environment:** VAPT/Staging only  

### Severity scale

| Severity | Meaning |
|----------|---------|
| Critical | Full compromise / auth bypass / RCE / mass data exposure |
| High | Privilege escalation, sensitive data exposure, weak crypto in transit |
| Medium | Partial authZ gaps, missing hardening, session weaknesses |
| Low | Informational / best-practice gaps |
| Info | Observation only |

### Result values

`Pass` | `Fail` | `Blocked` | `N/A` | `Retest Pass`

---

## A. Transport security (SSL/TLS)

| ID | Test case | Preconditions | Steps (high-level) | Expected result |
|----|-----------|---------------|--------------------|-----------------|
| TC-TLS-01 | HTTPS availability | nginx HTTPS enabled | Open `https://vapt.eappms` | Site loads over HTTPS |
| TC-TLS-02 | HTTP to HTTPS redirect | Redirect configured | Open `http://vapt.eappms` | Redirects to HTTPS |
| TC-TLS-03 | Certificate trust | CA-signed or trusted internal CA | Inspect browser cert | No untrusted-cert warning for intended clients |
| TC-TLS-04 | TLS protocol floor | TLS config applied | Review TLS config / scanner | TLS 1.2+ only; legacy SSL disabled |
| TC-TLS-05 | Weak ciphers disabled | TLS config applied | Cipher suite review | Weak/export ciphers not offered |
| TC-TLS-06 | HSTS present | HTTPS live | Inspect response headers | `Strict-Transport-Security` present (if required by policy) |
| TC-TLS-07 | No mixed content | App loaded over HTTPS | Browse key pages | No active mixed HTTP content |
| TC-TLS-08 | API via HTTPS proxy | nginx proxies `/api` | Call API through HTTPS URL | API traffic encrypted end-to-browser |

---

## B. Authentication & session

| ID | Test case | Preconditions | Steps (high-level) | Expected result |
|----|-----------|---------------|--------------------|-----------------|
| TC-AUTH-01 | Valid login | Known user | Login with valid credentials | JWT issued; redirected to app |
| TC-AUTH-02 | Invalid password | Known user | Login with wrong password | 401; no token |
| TC-AUTH-03 | Invalid user | None | Login with unknown user | 401; no user enumeration beyond policy |
| TC-AUTH-04 | Password policy enforcement | Policy enabled | Attempt weak password on create/change | Rejected per policy |
| TC-AUTH-05 | Must-change-password gate | User flagged | Login | Forced to change before app use |
| TC-AUTH-06 | Forgot-password authorization | Flow enabled | Attempt reset without proper authorizer | Rejected / controlled |
| TC-AUTH-07 | JWT required on protected API | Logged out | Call protected `/api/*` without token | 401 |
| TC-AUTH-08 | Tampered JWT rejected | Valid token obtained | Modify token payload/signature | 401 |
| TC-AUTH-09 | Expired token rejected | Short TTL test env | Use expired token | 401 |
| TC-AUTH-10 | Logout client session clear | Logged in | Logout | Token removed from client; UI to `/login` |
| TC-AUTH-11 | Idle timeout | Idle guard enabled | Remain idle beyond timeout | Session ended / redirect login |
| TC-AUTH-12 | Platform login isolation | Platform creds set | Customer token cannot access `/api/platform/*` admin functions | 401/403 |
| TC-AUTH-13 | Default/secret hygiene | Env reviewed | Confirm `SECRET_KEY` not default `changeme` on VAPT | Non-default secret |
| TC-AUTH-14 | Autologin control | `/autologin` exists | Verify disabled or tightly controlled on VAPT | No unrestricted credential injection |

---

## C. Authorization / RBAC

| ID | Test case | Role under test | Steps (high-level) | Expected result |
|----|-----------|-----------------|--------------------|-----------------|
| TC-RBAC-01 | Operator denied user admin | operator | Open `/users` and call user-admin APIs | UI blocked and API 403 |
| TC-RBAC-02 | Maintenance limited | maintenance | Attempt create work order / admin config if restricted | Denied where designed |
| TC-RBAC-03 | Supervisor vs admin | supervisor | Access admin-only config/archive | Denied |
| TC-RBAC-04 | Admin cannot create superadmin | admin | Create user role=superadmin | 403 |
| TC-RBAC-05 | Superadmin archive only | non-superadmin | Call `/api/archive/*` backup/restore | 403 |
| TC-RBAC-06 | Feature flag enforcement | role with feature off | Navigate restricted route + API | Blocked |
| TC-RBAC-07 | Horizontal access (IDOR) | two users same role | Access another user’s restricted object by ID | Denied or scoped |
| TC-RBAC-08 | Vertical privilege via API | low role token | Call admin endpoints directly | 403 |
| TC-RBAC-09 | Platform vs customer boundary | customer admin | Access platform module APIs | Denied |
| TC-RBAC-10 | QC dual-control rules | QC flows | Attempt same-user dual sign where forbidden | Rejected |

---

## D. API & input validation

| ID | Test case | Steps (high-level) | Expected result |
|----|-----------|--------------------|-----------------|
| TC-API-01 | Auth surface inventory | Map public vs protected endpoints | Only intended public endpoints unauthenticated |
| TC-API-02 | SQL injection resilience | Fuzz search/filter fields with malicious strings | No SQL error leakage / no data dump |
| TC-API-03 | XSS resilience | Submit script-like strings in text fields | Stored/reflected XSS not executable |
| TC-API-04 | Path traversal on downloads | Attempt `../` in download/filename params | Blocked |
| TC-API-05 | Upload validation | Upload disallowed type/oversized file where uploads exist | Rejected |
| TC-API-06 | Mass assignment | Extra privileged fields in JSON body | Ignored / rejected |
| TC-API-07 | Error message hygiene | Trigger 400/500 | No stack traces / secrets in client responses |
| TC-API-08 | Rate / abuse (login) | Repeated failed logins (agreed limit) | Lockout, delay, or monitoring per policy |
| TC-API-09 | CORS posture | Inspect CORS headers | Not overly permissive for production-equivalent policy |
| TC-API-10 | Security headers | Inspect UI responses | Expected headers present per policy |

---

## E. Sensitive data & configuration

| ID | Test case | Steps (high-level) | Expected result |
|----|-----------|--------------------|-----------------|
| TC-CFG-01 | `.env` not web-accessible | Request common env paths via HTTP | 404/denied |
| TC-CFG-02 | Backup files not public | Probe backup download without auth | 401/403 |
| TC-CFG-03 | Secrets not in frontend bundle | Review built JS for secrets | No DB/JWT/SMTP secrets |
| TC-CFG-04 | Swagger exposure | Open `/docs` | Disabled or auth-protected in VAPT/prod-like mode |
| TC-CFG-05 | Password hashes not returned | User APIs | No password hashes in responses |
| TC-CFG-06 | Email password handling | Email config APIs | Password not echoed back in clear |

---

## F. WebSocket / realtime

| ID | Test case | Steps (high-level) | Expected result |
|----|-----------|--------------------|-----------------|
| TC-WS-01 | WS requires auth (if designed) | Connect without token | Rejected or no sensitive data |
| TC-WS-02 | Role-appropriate events | Connect as low privilege | No privileged event leakage |
| TC-WS-03 | Input validation on WS messages | Send malformed messages | Safe handling; no crash/abuse |

---

## G. Business-feature security (sampled E2E)

| ID | Feature | Security check |
|----|---------|----------------|
| TC-FEAT-01 | User Management | Only allowed roles create/edit/delete users |
| TC-FEAT-02 | Database Management | Backup/restore/archive restricted to superadmin |
| TC-FEAT-03 | Factory Setup | Restricted to authorized roles |
| TC-FEAT-04 | Email Alerts | Config change restricted; no secret leakage |
| TC-FEAT-05 | Operator Management | PIN/photo flows do not expose secrets |
| TC-FEAT-06 | QC Approvals | Dual-control integrity held |
| TC-FEAT-07 | Work Orders | Create/manage permissions match role matrix |
| TC-FEAT-08 | Breakdown / Maintenance | Status transitions authorized |

Full feature matrix: [VAPT_E2E_FEATURE_CHECKLIST.md](./VAPT_E2E_FEATURE_CHECKLIST.md)

---

## H. Exit criteria

VAPT cycle may close when:

1. All Critical/High findings are fixed or formally accepted with risk sign-off  
2. Failed test cases are retested to Pass or accepted  
3. Scope assets remain unchanged from tested build, or delta retested  
4. Final report + retest report delivered  
