# CPLM Web UI Agent Guide

## Purpose

- `AGENTS.md` is the short Codex entry guide for the `cplm-web-ui` repository.
- Keep this file focused on orientation, source priority, high-level boundaries, and prohibited practices.
- Do not duplicate the full development guide here.

## Source of Truth

- `CLAUDE.md` is the shared repository overview and the source for shared API References guidance.
- `.codex/skills/dev-guide/SKILL.md` is the primary detailed guide for Codex tasks.
- `.codex/skills/line-manager-sa/SKILL.md` is the Codex Line Manager domain, WinForms migration, and source-evidence guide.
- `.claude/skills/dev-guide/` is Claude Code guidance owned by Claude users; treat it as read-only unless explicitly requested.
- `.claude/skills/line-manager-sa/` is Claude Code Line Manager domain guidance owned by Claude users; treat it as read-only unless explicitly requested.
- `package.json` is the source of truth for available scripts and dependencies.
- The dev-guide owns detailed rules for architecture, pages, routes, components, services, i18n, theming, Form/Grid, CRUD, and testing.
- If `AGENTS.md` conflicts with the dev-guide, follow the dev-guide.

## Package Manager

- Use `pnpm` only.
- Do not use `npm` or `yarn`.
- Do not add or change dependencies without explicit approval.

## Development Rules

- Before frontend development, load the Codex dev-guide skill and read only the relevant dev-guide references.
- For Line Manager, WinForms migration, legacy behavior, SMT domain, FE/BE boundary, or API/DTO planning tasks, load the Codex dev-guide first, then load the Codex line-manager-sa skill.
- Follow nearby source patterns and existing project architecture before introducing new abstractions.
- Keep changes scoped to the requested area.
- Use validation appropriate to the change; if a task forbids build, test, lint, preview, or dev server commands, use static inspection only.

## External Migration Wiki

- This frontend repo may depend on external migration knowledge from the Line Manager WinForm LLM Wiki.
- When a task asks about Line Manager, WinForm migration, legacy feature behavior, feature scope, FE/BE boundary, API/DTO planning, source-verified legacy behavior, or migration implementation planning, read the external wiki before answering or implementing.
- Primary wiki path from `cplm-web-ui`:

  `../document/line-manager-winform/line-manager/wiki/`

- Generic entry points:
  - `../document/line-manager-winform/line-manager/wiki/index.md`
  - `../document/line-manager-winform/line-manager/wiki/README.md`
  - `../document/line-manager-winform/line-manager/wiki/decisions/README.md`
  - `../document/line-manager-winform/line-manager/wiki/migration/README.md`
  - `../document/line-manager-winform/line-manager/wiki/implementation/README.md`
  - `../document/line-manager-winform/line-manager/wiki/migration/risks/open-questions.md`

- For feature-specific tasks, use `index.md`, folder README pages, and relevant ADRs to locate the correct feature pages.
- Do not hard-code feature-specific scope decisions in this root guide.
- Do not answer legacy feature questions by searching only inside `cplm-web-ui`.
- If the external wiki is missing, insufficient, or conflicts with code, say so and ask whether to run source verification in the Line Manager WinForm repo.
- The external wiki is a migration knowledge source. It does not replace source code evidence when source verification is required.

## Frontend Boundaries

- Frontend may own UI state, input state, selection, sort/filter display, loading/error/empty states, confirmations, pending command state, and result presentation.
- Frontend must not own database queries, workflow transactions, status transitions, backend ownership rules, runtime calculations, event publishing, or line/machine integration logic.
- React Query owns server state.
- Zustand is for shared UI state only.

## API References

- `CLAUDE.md` defines the shared API References model.
- `src/api-refs/api-skills/` contains generated progressive API reference docs, not a Codex skill.
- For API integration, start from the relevant level 1 index, then open only the required level 2 endpoint and level 3 schema files.
- Do not copy generated API reference details into `SKILL.md`; keep them discoverable through the API reference indexes.

## API / Service Rules

- Use the project API client from `src/core/api`; do not call APIs directly from React components.
- Keep service modules UI-agnostic.
- Keep navigation, dialogs, snackbars, query invalidation, and mutation side effects in pages or callers.
- Define DTOs, request/response types, query keys, fetchers, mappers, and mutations in service-owned modules following the dev-guide.
- Keep mock APIs replaceable by real services and follow existing mock patterns.

## Migration Feature Rules

- For migrated legacy features, implement only source-verified or explicitly approved capabilities.
- Do not infer missing behavior, UI, DTOs, mocks, or tests from guesswork.
- Follow canonical feature specifications, API references, migration wiki notes, and ADRs when they exist.
- When a migrated feature is backed by an external LLM Wiki, follow that wiki's canonical ADRs, API/DTO contracts, and capability evidence rules.
- If evidence is unclear, stop and ask for verification.

## Prohibited Practices

- Do not modify product code when the task is limited to documentation.
- Do not modify `CLAUDE.md`, `.claude/skills/dev-guide/`, `.claude/skills/line-manager-sa/`, or `.codex/skills/dev-guide/SKILL.md` unless explicitly requested.
- Do not modify WinForm, backend, database, installer, wiki, or unrelated project files from frontend implementation tasks unless the task explicitly requests documentation updates.
- Do not bypass the custom Form/Grid, dialog, snackbar, routing, i18n, or service patterns defined by the dev-guide.
- Do not add feature-specific scope decisions to this root guide.
- Do not change the route permission model without explicit approval.
