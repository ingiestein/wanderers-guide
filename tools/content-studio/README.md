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

SQLite + stamp files are gitignored under this folder.

## Requirements

- Python 3.11+
- Node / npm (frontend already installed via `npm --prefix frontend install`)
- No Docker
