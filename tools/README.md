# Local tools

## Content Studio (no Docker)

```bash
npm run content-studio
```

Builds/refreshes a local SQLite DB from `data/data.sql`, starts a tiny FastAPI that
speaks the same edge-function shapes the app already uses, runs the React UI, and
opens `/admin/content-studio`.

Details: [content-studio/README.md](./content-studio/README.md).
