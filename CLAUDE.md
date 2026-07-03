# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Dev server on port 3001 (base path: /cplm/)
pnpm build        # TypeScript check + Vite bundle
pnpm lint-check   # ESLint + Prettier via lint-staged
pnpm preview      # Preview production build
pnpm commit       # Interactive conventional commit (commitizen)
```

**Package manager:** pnpm (enforced). Do not use npm or yarn.

## Tech Stack

- React 19 + TypeScript 5.8 + Vite 6
- MUI 7, React Query 5, Zustand 5, React Router 7
- React Hook Form + Yup/Zod, i18next, Keycloak
- AG Grid Enterprise (custom Grid system), custom Form system

## Architecture

### Source Layout

```
src/
├── core/           # Infrastructure: API client (get/post/put/patch/del), i18n, auth, query config
├── services/       # Data layer: types + fetchers + mutations per domain (NO UI deps)
├── components/
│   ├── basic/      # Reusable atoms: Form, Grid, Dialog, Card, TransferList, etc.
│   ├── frames/     # Page shells: SimpleFrame, SplitFrame, LMFrame
│   ├── layout/     # App structure: AppBar, Navigator, SideDrawer
│   └── line-manager/ # Domain UI: ScopeTile, SwitchPanel, Footer, LineToolBox, etc.
├── contexts/       # React Context: Dialogs, Snackbar, DeploymentProfile
├── stores/         # Zustand (UI-only state: drawer, theme, line selection)
├── pages/          # Route pages ($ prefix = route segment)
├── routes/         # React Router config + guards (ProtectedRoute, LineRequiredRoute)
└── themes/         # MUI theme + design tokens
```

### Key Patterns

- **Routing:** `createBrowserRouter` with `basename: import.meta.env.BASE_URL`. All feature pages are `React.lazy()` + `withSuspense()`. `$`-prefixed dirs = route segments (e.g., `$examples/$grid/index.tsx`).

- **Service layer:** Each service module exports `{ keyDefs, fetchers, mutations }`. `keyDefs` uses `createQueryKey()` for React Query cache keys. `fetchers` are async functions using `get<T>()`. `mutations` return `{ mutationFn }` for `useMutation`.

- **State:** React Query for server state, Zustand for UI state (persisted via `localStorage`/`sessionStorage`), React Context for cross-cutting concerns (dialogs, snackbar).

- **Path aliases:** `@/` → `src/`, `@assets/` → `src/assets/`. Always use `@/` imports — no deep relative paths.

- **i18n:** `public/locales/commons/` (preloaded), `public/locales/pages/` (lazy per feature). Three locales: `en-US`, `zh-CN`, `zh-TW`. Components use `useTranslation('namespace')`.

- **CRUD pages:** `index.tsx` (list), `AddPage.tsx` (create), `EditPage.tsx` (edit). Page-specific components live in a `components/` subfolder.

- **Vite config:** Base path `/cplm/` (dev), `/$_BASE_URL_/` (prod runtime substitution). Proxy prefixes: `/factory-server-api`, `/line-server-api`, `/machine-server-api` → `VITE_BACKEND_ORIGIN`. SVG imports use `?react` suffix.

## Skills

- **`dev-guide`** (`/dev-guide`) — Coding conventions, layered architecture rules, component specs, service patterns, i18n, theming, CRUD patterns, and prohibited practices. Load before any development task.
- **`line-manager-sa`** (`/line-manager-sa`) — Line Manager (CPLM) system specification assistant (37 docs, ~450 KB). Covers feature specs F01–F20, backend specs B01–B07, component design C01–C06, business glossary, and C# WinForms → React migration mapping. Load when working on changeover, feeder, reel, work order, or any SMT domain logic.

## API References

This project includes API interfaces for multiple subsystems. To effectively manage and accurately read API specifications, this project adopts a "Progressive Disclosure" architecture.

Level 1: Index (for AI to quickly identify the target API)
Level 2: API Endpoint (describe the API endpoint about path / method / parameters / body / response)
Level 3: Component Schema (describe the schema of the request and response)

- Machine Server API: `src/api-refs/api-skills/machine-server-api/machine-server-api_level1_api_index.md`
- Line Server API: `src/api-refs/api-skills/line-server-api/line-server-api_level1_api_index.md`
- Factory Server API: `src/api-refs/api-skills/factory-server-api/factory-server-api_level1_api_index.md`
