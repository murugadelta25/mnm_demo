# CPLM UI Reference (read-only pointers)

This folder documents which CPLM `src/` paths to reference when evolving Titan UI.

| CPLM path | Use for |
|-----------|---------|
| `src/components/layout/` | AppBar, Navigator, shell patterns |
| `src/components/frames/SimpleFrame` | Page title + actions layout |
| `src/components/basic/Form/` | Future form standardization |
| `src/components/basic/Grid/` | Future data grid standardization |
| `src/themes/` | MUI theme tokens (reference only — Titan uses ThemeContext) |
| `src/navigation.tsx` | Navigation ↔ routes split pattern |

**CPLM source repo:** `d:\19-06-2026_c-drive_backup\Downloads\cplm-web-ui-main\cplm-web-ui-main`

**Skills:** `.cursor/skills/dev-guide/references/layout.md`, `architecture.md`

Do not copy CPLM services or pages into Titan — Titan keeps its own `api/` and `pages/` logic.
