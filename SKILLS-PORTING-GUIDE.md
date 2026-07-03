# CPLM Skills — Porting Guide (English)

This guide explains how to reuse the `.claude/skills` from **cplm-web-ui** in another project (Cursor, Claude Code, or Codex), what `src/` folders the app needs to run, and where translated vs. original skill files live.

---

## What You Have in This Repo

| Location | Language | Purpose |
|----------|----------|---------|
| `.claude/skills/` | Traditional Chinese (zh) | Original Claude Code skills |
| `.claude/skills-backup-zh-original/` | Traditional Chinese | **Backup** of originals (do not edit) |
| `.cursor/skills/` | English (entry + dev-guide refs) | **Cursor Agent Skills** (recommended for Cursor IDE) |
| `.codex/skills/` | Mixed | Codex entry points (`SKILL.md` only) |

### Skills included

1. **`dev-guide`** — React/TypeScript coding standards, layered architecture, Form/Grid/Dialog patterns, i18n, theming, CRUD.
2. **`line-manager-sa`** — Line Manager (CPLM) domain specs: F01–F20 features, B01–B07 business logic, C01–C06 UI components, WinForms → React migration.

---

## Step-by-Step: Use Skills in a New Project

### Option A — Fork / clone this repo (fastest)

Best when the new project **is** CPLM Web UI or a branch of it.

```powershell
# 1. Clone or copy the repo
git clone <repo-url> my-cplm-project
cd my-cplm-project

# 2. Install dependencies (pnpm only)
pnpm install

# 3. Copy environment template if present
# cp .env.example .env

# 4. Start dev server (port 3001, base path /cplm/)
pnpm dev
```

Skills are already in `.claude/skills/` and `.cursor/skills/`. No extra copy needed.

---

### Option B — New empty repo + copy skills + minimal `src/`

Use when you want a **greenfield** app that follows the same conventions.

#### 1. Scaffold the React app

```powershell
pnpm create vite my-new-cplm --template react-ts
cd my-new-cplm
pnpm install
```

Add the same major dependencies as `package.json` in cplm-web-ui (MUI 7, React Query 5, Zustand 5, React Router 7, i18next, ramda, date-fns, notistack, react-hook-form, yup/zod).

#### 2. Copy skills into the new project

**For Cursor IDE:**

```powershell
# From cplm-web-ui root
xcopy /E /I ".cursor\skills" "..\my-new-cplm\.cursor\skills"
```

**For Claude Code:**

```powershell
xcopy /E /I ".claude\skills" "..\my-new-cplm\.claude\skills"
# Or use English backup:
xcopy /E /I ".cursor\skills" "..\my-new-cplm\.claude\skills"
```

**For Codex:**

```powershell
xcopy /E /I ".codex\skills" "..\my-new-cplm\.codex\skills"
```

Also copy orientation files:

```powershell
copy CLAUDE.md ..\my-new-cplm\
copy AGENTS.md ..\my-new-cplm\
```

#### 3. Copy required `src/` infrastructure (minimum to run)

The skills assume this layout. Copy these folders from cplm-web-ui **before** building features:

| Folder | Required? | Why |
|--------|-----------|-----|
| `src/core/` | **Yes** | API client, i18n, auth, query config |
| `src/components/basic/` | **Yes** | Form, Grid, Dialog, LoadingSuspense, etc. |
| `src/components/frames/` | **Yes** | SimpleFrame, SplitFrame, LMFrame |
| `src/components/layout/` | **Yes** | AppBar, Navigator, SideDrawer |
| `src/components/status/` | **Yes** | ErrorBoundary, NoData, NotFound |
| `src/components/graphics/` | Recommended | Icons & illustrations |
| `src/components/line-manager/` | For LM features | LineToolBox, ScopeTile, StepBreadcrumb, Footer |
| `src/contexts/` | **Yes** | Dialogs, Snackbar, Theme providers |
| `src/stores/` | **Yes** | Zustand (theme, drawer, lmScope) |
| `src/hooks/` | **Yes** | useDialogs, useSnackbar, etc. |
| `src/routes/` | **Yes** | Router + guards |
| `src/themes/` | **Yes** | MUI theme & tokens |
| `src/utils/` | **Yes** | queryUtils, date helpers |
| `src/pages/Root.tsx` | **Yes** | App shell |
| `src/assets/` | Recommended | SVG icons |
| `public/locales/` | **Yes** | i18n JSON (en-US, zh-TW, zh-CN) |

Entry files to copy/adapt:

- `src/main.tsx`
- `src/App.tsx` or `AppProvider.tsx`
- `index.html`
- `vite.config.ts` (aliases `@/` → `src/`, `@assets/`, locale plugin)
- `tsconfig.json` / `tsconfig.app.json` (paths for `@/*`)

#### 4. Configure Vite aliases (must match skills)

```typescript
resolve: {
  alias: {
    "@": path.resolve(__dirname, "./src"),
    "@assets": path.resolve(__dirname, "./src/assets"),
  },
},
```

#### 5. Verify the app runs

```powershell
pnpm dev
```

Open `http://localhost:3001/cplm/` (dev base path).

#### 6. Invoke skills in the AI assistant

| Tool | How to load |
|------|-------------|
| **Cursor** | Skills under `.cursor/skills/` are auto-discovered. Mention "use dev-guide" or "follow line-manager-sa" in chat. |
| **Claude Code** | Run `/dev-guide` or `/line-manager-sa` if configured in `CLAUDE.md`. |
| **Codex** | Read `.codex/skills/dev-guide/SKILL.md` per `AGENTS.md`. |

---

## `src/` Folder Map (Components Required to Run)

```
src/
├── core/                    # API, i18n, auth — NO UI imports from pages
├── services/                # Per-domain types + fetchers + mutations (UI-agnostic)
├── components/
│   ├── basic/               # Form, Grid, Dialog, Card, TransferList, FileTransferList…
│   ├── frames/              # SimpleFrame, SplitFrame, LMFrame
│   ├── layout/              # AppBar, Navigator, SideDrawer
│   ├── status/              # ErrorBoundary, NoData, NotFound, Forbidden
│   ├── graphics/            # Icon & illustration factories
│   └── line-manager/        # C01–C02 domain UI (LineToolBox, Wizard, Scope)
├── contexts/                # DialogsProvider, SnackbarProvider, DeploymentProfile
├── stores/                  # Zustand (themeMode, drawer, lmScope)
├── hooks/                   # useDialogs, useSnackbar, useLanguage, …
├── pages/                   # Route pages ($prefix folders)
├── routes/                  # createBrowserRouter + lazy + withSuspense
├── themes/                  # MUI theme extensions & tokens
├── utils/                   # createQueryKey, date formatting
└── assets/                  # icons/, illustrations/
```

### Skill ↔ component mapping (Line Manager)

| Spec | `src/` implementation |
|------|------------------------|
| C01 LineToolBox | `src/components/line-manager/LineToolBox/` |
| C02 ActivityPanel / Wizard | `src/components/line-manager/StepBreadcrumb/`, `LMFrame` wizard config |
| C03 Shared state | `src/stores/lmScope.ts`, deployment profile context |
| C04 Plugin navigation | `src/routes/`, `src/navigation.tsx` |
| C05 Notifications | `src/hooks/useSnackbar.ts`, `useDialogs` |
| C06 Barcode scanner | `src/components/line-manager/MobileBarcodePanel/` |

### Dev-guide ↔ component mapping

| Skill topic | `src/` path |
|-------------|-------------|
| Form system | `src/components/basic/Form/` |
| Grid system | `src/components/basic/Grid/` |
| Dialogs | `src/components/basic/Dialog/` + `src/hooks/useDialogs.ts` |
| Page shells | `src/components/frames/` |
| i18n | `src/core/i18n/`, `public/locales/` |

---

## Translation & Backup Status

| Artifact | Path | Status |
|----------|------|--------|
| **Original Chinese backup** | `.claude/skills-backup-zh-original/` | **Complete** — 55 files, 1:1 match with `.claude/skills/` |
| **English Cursor skills** | `.cursor/skills/` | **Complete** — 55 files including both `SKILL.md` entry points |
| **English dev-guide references** | `.cursor/skills/dev-guide/references/` | Translated (locale JSON samples in `i18n.md` retain zh-TW/zh-CN values by design) |
| **line-manager-sa references** | `.cursor/skills/line-manager-sa/references/` | **Translated to English** (A01–A04, PRD, F01–F20, B01–B07, C01–C06) |
| **Claude Code originals** | `.claude/skills/` | Traditional Chinese (unchanged; restore from backup if needed) |

**Backup verification (2026-06-22):** `Compare-Object` on relative paths shows zero differences between `.claude/skills/` and `.claude/skills-backup-zh-original/`.

To restore originals:

```powershell
Remove-Item .claude\skills -Recurse -Force
Copy-Item .claude\skills-backup-zh-original .claude\skills -Recurse
```

---

## Compatibility Checklist for a New Project

- [ ] Node.js 20+ and **pnpm** installed
- [ ] `package.json` scripts: `dev`, `build`, `lint-check`
- [ ] Vite 6 + `@/` path alias configured
- [ ] `src/core/api/` fetch wrapper present
- [ ] `AppProvider` provider stack matches dev-guide order
- [ ] `public/locales/commons/common.*.json` for navigation keys
- [ ] Skills copied to `.cursor/skills/` or `.claude/skills/`
- [ ] `CLAUDE.md` / `AGENTS.md` copied for agent orientation
- [ ] Backend proxy env `VITE_BACKEND_ORIGIN` set if calling APIs

---

## Common Mistakes

1. **Copying only SKILL.md** — Reference files under `references/` are required for deep answers.
2. **Using npm/yarn** — Project enforces pnpm.
3. **Missing `src/components/basic/`** — Form/Grid/Dialog patterns in the skill will not compile.
4. **Wrong skill folder for IDE** — Cursor reads `.cursor/skills/`, not `.claude/skills/`.
5. **Skipping `basename`** — Routes use `import.meta.env.BASE_URL` (`/cplm/` in dev).

---

## Related Documentation

- `CLAUDE.md` — Repo overview, tech stack, API references
- `AGENTS.md` — Codex agent rules and source-of-truth order
- `.cursor/skills/dev-guide/SKILL.md` — Full English dev guide
- `.cursor/skills/line-manager-sa/SKILL.md` — Full English LM spec index
