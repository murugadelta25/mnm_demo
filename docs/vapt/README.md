# EAP-PMS — VAPT Documentation Pack

**Classification:** Confidential  
**Application:** EAP Production Monitoring System (EAP-PMS)  
**Purpose:** Provide a complete, isolated Vulnerability Assessment and Penetration Testing (VAPT) package for the EAP-PMS web application.

This folder is the **single entry point** for security testing. Use it to scope the assessment, stand up a separate test environment, execute test cases, log evidence, and track findings through retest.

---

## Quick start

| Step | Action | Document / asset |
|------|--------|------------------|
| 1 | Define scope and get sign-off | [VAPT_SCOPE.md](./VAPT_SCOPE.md) |
| 2 | Create isolated VAPT environment | [VAPT_ENVIRONMENT_SETUP.md](./VAPT_ENVIRONMENT_SETUP.md) |
| 3 | Run security test cases | [VAPT_TEST_CASE_SPECIFICATION.md](./VAPT_TEST_CASE_SPECIFICATION.md) |
| 4 | Run end-to-end feature + security checks | [VAPT_E2E_FEATURE_CHECKLIST.md](./VAPT_E2E_FEATURE_CHECKLIST.md) |
| 5 | Record execution and evidence | [VAPT_TEST_EXECUTION_LOG.md](./VAPT_TEST_EXECUTION_LOG.md) |
| 6 | Log and track findings | [VAPT_FINDINGS_REGISTER.md](./VAPT_FINDINGS_REGISTER.md) |

---

## Document index

| Document | ID | Audience | Description |
|----------|-----|----------|-------------|
| [VAPT_SCOPE.md](./VAPT_SCOPE.md) | EAP-PMS-VAPT-SCOPE-001 | App owner, IT, VAPT team | One-page scope: URLs, ports, roles, in/out of scope, authorization |
| [VAPT_ENVIRONMENT_SETUP.md](./VAPT_ENVIRONMENT_SETUP.md) | EAP-PMS-VAPT-ENV-001 | DevOps / QA | How to build an isolated staging instance (not production) |
| [VAPT_TEST_CASE_SPECIFICATION.md](./VAPT_TEST_CASE_SPECIFICATION.md) | EAP-PMS-VAPT-TC-001 | VAPT testers | Formal security test cases (TLS, auth, RBAC, API, config, WS) |
| [VAPT_E2E_FEATURE_CHECKLIST.md](./VAPT_E2E_FEATURE_CHECKLIST.md) | EAP-PMS-VAPT-E2E-001 | QA + VAPT | Feature-by-feature E2E with security expectations |
| [VAPT_TEST_EXECUTION_LOG.md](./VAPT_TEST_EXECUTION_LOG.md) | EAP-PMS-VAPT-LOG-001 | Testers | Daily log, pass/fail, evidence references |
| [VAPT_FINDINGS_REGISTER.md](./VAPT_FINDINGS_REGISTER.md) | EAP-PMS-VAPT-FIND-001 | App owner, VAPT | Findings, severity, remediation, retest status |

---

## Supporting assets (repo)

| Asset | Path | Purpose |
|-------|------|---------|
| VAPT deploy config template | `deploy/vapt/deploy.env.example` | Isolated DB name, ports, client name |
| VAPT domain / HTTPS config | `deploy/vapt/domain.config.json` | Default domain `vapt.eappms`, HTTPS on |
| VAPT deploy notes | `deploy/vapt/README.md` | Local secrets / gitignore hints |
| Setup script (Windows) | `scripts/vapt/Setup-VaptEnv.ps1` | Scaffold `.env.vapt` and `deploy.env` |
| Setup script (Ubuntu) | `scripts/vapt/setup-vapt-env.sh` | Same for Linux |

---

## VAPT environment (isolated from production)

**Never test production.** Use a dedicated instance with separate values:

| Setting | Production (typical) | VAPT instance |
|---------|----------------------|---------------|
| Domain | `din.eappms` | `vapt.eappms` |
| Frontend port | 5174 | **5274** |
| Backend port | 8010 | **8020** |
| Database | `eap_pms` / client DB | **`eap_pms_vapt`** |
| JWT `SECRET_KEY` | production secret | **new random secret** |
| Data | live | sanitized / dummy only |

### Scaffold the environment

**Windows (from repo root):**

```powershell
.\scripts\vapt\Setup-VaptEnv.ps1
```

**Ubuntu:**

```bash
chmod +x scripts/vapt/setup-vapt-env.sh
./scripts/vapt/setup-vapt-env.sh
```

Then follow [VAPT_ENVIRONMENT_SETUP.md](./VAPT_ENVIRONMENT_SETUP.md) for DB creation, migrations, nginx/HTTPS, and VAPT user accounts.

---

## In-scope summary

- **Web UI:** `https://vapt.eappms` (or approved staging URL)
- **API:** `/api/*` (via nginx proxy preferred)
- **Platform admin:** `/platform/login`, `/platform/modules`
- **Roles:** `operator`, `quality`, `maintenance`, `supervisor`, `admin`, `superadmin`, platform admin
- **Security areas:** SSL/TLS, authentication, RBAC, API input validation, secrets/config exposure, WebSocket, high-risk admin features (backup, archive, user management)

Full detail: [VAPT_SCOPE.md](./VAPT_SCOPE.md).

---

## Out of scope (default)

- Production EAP-PMS and production database
- Factory PLCs / OT networks
- Corporate AD/LDAP domain controllers (unless separately approved)
- DoS / destructive testing without written approval

---

## Recommended test workflow

```text
1. Sign scope (VAPT_SCOPE.md)
        ↓
2. Deploy VAPT env + seed users
        ↓
3. Pre-flight readiness checklist (VAPT_ENVIRONMENT_SETUP.md §7)
        ↓
4. Automated VA (ZAP/Burp) + TLS review
        ↓
5. Execute VAPT_TEST_CASE_SPECIFICATION.md
        ↓
6. Execute VAPT_E2E_FEATURE_CHECKLIST.md
        ↓
7. Log results in VAPT_TEST_EXECUTION_LOG.md
        ↓
8. Record findings in VAPT_FINDINGS_REGISTER.md
        ↓
9. Fix → retest → close
```

---

## Rules of engagement

1. Test **only** assets listed in the signed scope during the agreed window.
2. Use **VAPT/staging** host and database — not production.
3. **Stop immediately** if production is impacted or unintended data is accessed.
4. Do not run destructive tests (mass DB wipe, DoS) without explicit approval.
5. Store evidence in a controlled folder; do not exfiltrate real PII outside the report channel.
6. Rotate shared test credentials after the assessment.

---

## Roles and contacts (fill before test)

| Role | Name | Contact |
|------|------|---------|
| Application owner | | |
| VAPT lead | | |
| IT / InfoSec | | |
| Emergency stop | | |

---

## Deliverables expected from VAPT

1. Executive summary  
2. Technical findings with severity (e.g. CVSS)  
3. Evidence (requests/responses, screenshots)  
4. Remediation recommendations  
5. Retest report after fixes  

---

## Related project documentation

| Topic | Location |
|-------|----------|
| Software architecture | `docs/SOFTWARE_ARCHITECTURE.md` |
| Domain / HTTPS setup | `DOMAIN-SETUP.md` |
| Safe deploy checklist | `DEPLOY-SAFE-CHECKLIST.md` |
| Ubuntu setup | `UBUNTU_SETUP.md` |

---

## Version history

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-08-12 | | Initial VAPT pack |
