# Content Studio (local, no Docker)

Browse the official content dump with the same React Content Studio UI, without
Supabase or Docker. Tabs cover actions, spells, feats, classes, equipment,
monsters, and hazards (creatures + hazards share the `creature` table).

## One command

From the repo root:

```bash
npm run content-studio
```

Or:

```bash
python3 tools/content-studio/run.py
```

That will:

1. Rebuild `content.sqlite` from `data/data.sql` **only when the dump changed**
2. Start a local FastAPI on `http://127.0.0.1:8765` (edge-function compatible)
3. Start Vite with `VITE_SUPABASE_URL` pointed at that API
4. Open `http://127.0.0.1:5173/admin/content-studio`

### Useful flags

```bash
python3 tools/content-studio/run.py --rebuild   # force DB rebuild
python3 tools/content-studio/run.py --no-open   # don’t open a browser
python3 tools/content-studio/run.py --api-only  # API only
python3 tools/content-studio/build_db.py        # rebuild DB alone (skips if fresh)
python3 tools/content-studio/build_db.py --force
```

### Optional shell alias

```bash
alias wgcs='npm run content-studio'
```

## Update pipeline

| What changed | What happens |
|---|---|
| `data/data.sql` refreshed (repo pull / dump update) | Next `npm run content-studio` detects the new stamp and rebuilds SQLite automatically |
| Content Studio React UI changed | Vite HMR picks it up; no DB rebuild |
| Force a clean DB | `npm run content-studio -- --rebuild` or `build_db.py --force` |
| Upstream schema / dump changed | Run `npm run content-studio:check-schema` then rebuild |

SQLite + stamp files are gitignored under this folder.

## After pulling upstream `main`

```bash
# Prefer rebase so Content Studio stays one commit on top of origin/main
git fetch origin
git rebase origin/main

# Optional: track wanderers-guide/wanderers-guide as upstream
git fetch upstream
git rebase upstream/main

# See what the dump/schema changed relative to our SQLite column lists + Zod
npm run content-studio:check-schema

# If columns were added to build_db.TABLES (or the dump is new):
npm run content-studio:rebuild
```

`check_schema.py` compares:

1. `data/schema.sql` → columns Content Studio imports (`build_db.py` `TABLES`)
2. Those SQL columns → top-level keys in `frontend/src/schemas/content.ts` (heuristic)

Exit code `1` means Content Studio would drop new SQL columns until you update `TABLES`.

## Isolation from the rest of the app

Content Studio is intentionally **soft-isolated**, not a second app:

| Layer | Where it lives | Couples to upstream? |
|---|---|---|
| Local API + SQLite builder | `tools/content-studio/` | Only via `data/data.sql` + `data/schema.sql` |
| Browse UI | `frontend/src/pages/admin_panel/content_studio/` | Uses shared drawers/schemas via imports |
| Thin entry hooks | `main.tsx` route, `AdminPage` button, `package.json` scripts | Tiny; rarely conflicts |
| Shared improvements reused by CS | `foundry-utils`, creature package fetch, `search-data` trait filters, drawer perf | **Yes** — treat carefully on rebase |

**Options if upstream churn starts breaking CS often:**

1. **Keep soft isolation (default)** — CS UI + tools stay in their folders; shared patches stay additive/small; rebase after every upstream sync; run `content-studio:check-schema`.
2. **Freeze shared patches** — move CS-only display transforms into `content_studio/` wrappers so `CreatureDrawer` / `RichText` upstream edits stop colliding.
3. **Hard isolate** — separate Vite package that talks only to `tools/content-studio` API (duplicates Mantine/theme; highest maintenance cost).

Prefer (1) until rebase conflicts on shared files become frequent; then do (2) for the hot files only.

### Shared touchpoints to watch on rebase

- `frontend/src/process/upload/foundry-utils.ts` — `@Check` → prose
- `frontend/src/process/content/content-store.ts` — `fetchCreatureContentPackage`
- `frontend/src/drawers/types/CreatureDrawer.tsx` / `StatBlockSection.tsx`
- `supabase/functions/search-data/index.ts` — creature/hazard trait filters
- Drawer list virtualization / slim fetches in Action/Class drawers

## Requirements

- Python 3.11+
- Node / npm (frontend already installed via `npm --prefix frontend install`)
- No Docker
