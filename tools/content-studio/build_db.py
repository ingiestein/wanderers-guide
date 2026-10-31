#!/usr/bin/env python3
"""Build tools/content-studio/content.sqlite from data/data.sql (pg_dump COPY).

Rebuilds when the dump is newer than the sqlite file, or when --force is passed.
"""

from __future__ import annotations

import argparse
import hashlib
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DUMP = ROOT / "data" / "data.sql"
DB_PATH = Path(__file__).resolve().parent / "content.sqlite"
STAMP_PATH = Path(__file__).resolve().parent / "content.sqlite.stamp"

# Tables Content Studio browse + drawers need.
TABLES: dict[str, list[str]] = {
    "content_source": [
        "id",
        "created_at",
        "name",
        "foundry_id",
        "url",
        "description",
        "operations",
        "user_id",
        "contact_info",
        "require_key",
        "is_published",
        "required_content_sources",
        "group",
        "meta_data",
        "artwork_url",
        "keys",
        "deprecated",
        "updated_at",
    ],
    "ability_block": [
        "id",
        "created_at",
        "operations",
        "name",
        "actions",
        "level",
        "rarity",
        "prerequisites",
        "frequency",
        "cost",
        "trigger",
        "requirements",
        "access",
        "description",
        "special",
        "type",
        "meta_data",
        "traits",
        "content_source_id",
        "version",
        "uuid",
        "availability",
        "updated_at",
    ],
    "spell": [
        "id",
        "created_at",
        "name",
        "rank",
        "traditions",
        "rarity",
        "cast",
        "traits",
        "defense",
        "cost",
        "trigger",
        "requirements",
        "range",
        "area",
        "targets",
        "duration",
        "description",
        "meta_data",
        "content_source_id",
        "version",
        "uuid",
        "heightened",
        "availability",
        "updated_at",
    ],
    "item": [
        "id",
        "created_at",
        "name",
        "bulk",
        "level",
        "rarity",
        "description",
        "group",
        "hands",
        "size",
        "craft_requirements",
        "usage",
        "meta_data",
        "operations",
        "content_source_id",
        "version",
        "uuid",
        "price",
        "traits",
        "availability",
        "updated_at",
    ],
    "class": [
        "id",
        "created_at",
        "name",
        "rarity",
        "description",
        "operations",
        "trait_id",
        "artwork_url",
        "content_source_id",
        "version",
        "uuid",
        "skill_training_base",
        "deprecated",
        "updated_at",
        "meta_data",
    ],
    "ancestry": [
        "id",
        "created_at",
        "name",
        "rarity",
        "description",
        "trait_id",
        "artwork_url",
        "content_source_id",
        "version",
        "operations",
        "uuid",
        "deprecated",
        "updated_at",
        "meta_data",
    ],
    "archetype": [
        "id",
        "created_at",
        "name",
        "rarity",
        "description",
        "trait_id",
        "artwork_url",
        "content_source_id",
        "version",
        "dedication_feat_id",
        "uuid",
        "deprecated",
        "updated_at",
        "meta_data",
    ],
    "trait": [
        "id",
        "created_at",
        "name",
        "description",
        "meta_data",
        "content_source_id",
        "uuid",
        "updated_at",
    ],
    # Creatures and hazards share this table (`type` = creature | hazard).
    "creature": [
        "id",
        "created_at",
        "name",
        "level",
        "rarity",
        "meta_data",
        "content_source_id",
        "version",
        "uuid",
        "inventory",
        "notes",
        "details",
        "roll_history",
        "operations",
        "abilities_base",
        "spells",
        "deprecated",
        "abilities_added",
        "experience",
        "hp_current",
        "hp_temp",
        "stamina_current",
        "resolve_current",
        "operation_data",
        "updated_at",
        "type",
    ],
}


def dump_fingerprint(path: Path) -> str:
    """Fast stale check: size + mtime + short hash of head/tail."""
    st = path.stat()
    with path.open("rb") as f:
        head = f.read(64 * 1024)
        if st.st_size > 128 * 1024:
            f.seek(-64 * 1024, 2)
            tail = f.read(64 * 1024)
        else:
            tail = b""
    h = hashlib.sha256(head + tail + str(st.st_size).encode()).hexdigest()[:16]
    return f"{st.st_mtime_ns}:{st.st_size}:{h}"


def needs_rebuild(force: bool) -> bool:
    if force or not DB_PATH.exists() or not STAMP_PATH.exists():
        return True
    if not DUMP.exists():
        raise SystemExit(f"Missing dump: {DUMP}")
    return STAMP_PATH.read_text().strip() != dump_fingerprint(DUMP)


def unescape_copy_field(raw: str) -> str | None:
    if raw == r"\N":
        return None
    out: list[str] = []
    i = 0
    while i < len(raw):
        ch = raw[i]
        if ch == "\\" and i + 1 < len(raw):
            nxt = raw[i + 1]
            mapping = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "\\": "\\"}
            out.append(mapping.get(nxt, nxt))
            i += 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def split_copy_line(line: str, ncol: int) -> list[str | None]:
    """Split a Postgres text COPY row on tabs (fields themselves may contain escaped tabs)."""
    fields: list[str | None] = []
    buf: list[str] = []
    i = 0
    while i < len(line):
        ch = line[i]
        if ch == "\\" and i + 1 < len(line):
            buf.append(ch)
            buf.append(line[i + 1])
            i += 2
            continue
        if ch == "\t":
            fields.append(unescape_copy_field("".join(buf)))
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    fields.append(unescape_copy_field("".join(buf)))
    if len(fields) != ncol:
        # Pad / trim defensively — some rows can be messy; skip bad ones upstream.
        if len(fields) < ncol:
            fields.extend([None] * (ncol - len(fields)))
        else:
            fields = fields[:ncol]
    return fields


def iter_copy_rows(dump_text: str, table: str, columns: list[str]):
    # Match both quoted and unquoted group column forms in the header.
    needle = f"COPY public.{table} ("
    start = dump_text.find(needle)
    if start < 0:
        raise RuntimeError(f"COPY block not found for {table}")
    header_end = dump_text.find("\n", start)
    body_start = header_end + 1
    end = dump_text.find("\n\\.\n", body_start)
    if end < 0:
        end = dump_text.find("\n\\.", body_start)
    if end < 0:
        raise RuntimeError(f"COPY terminator not found for {table}")
    body = dump_text[body_start:end]
    ncol = len(columns)
    for line in body.split("\n"):
        if not line:
            continue
        yield split_copy_line(line, ncol)


def create_table(conn: sqlite3.Connection, table: str, columns: list[str]) -> None:
    # Store everything as TEXT except known integer ids / levels for indexing.
    int_cols = {
        "id",
        "level",
        "rank",
        "content_source_id",
        "trait_id",
        "dedication_feat_id",
        "skill_training_base",
        "uuid",
        "experience",
        "hp_current",
        "hp_temp",
        "stamina_current",
        "resolve_current",
    }
    defs = []
    for col in columns:
        sql_name = f'"{col}"'
        if col in int_cols:
            defs.append(f"{sql_name} INTEGER")
        else:
            defs.append(f"{sql_name} TEXT")
    conn.execute(f'DROP TABLE IF EXISTS "{table}"')
    conn.execute(f'CREATE TABLE "{table}" ({", ".join(defs)})')
    if "id" in columns:
        conn.execute(f'CREATE INDEX IF NOT EXISTS "idx_{table}_id" ON "{table}" (id)')
    if "name" in columns:
        conn.execute(f'CREATE INDEX IF NOT EXISTS "idx_{table}_name" ON "{table}" (name)')
    if "content_source_id" in columns:
        conn.execute(
            f'CREATE INDEX IF NOT EXISTS "idx_{table}_cs" ON "{table}" (content_source_id)'
        )
    if table == "ability_block" and "type" in columns:
        conn.execute(f'CREATE INDEX IF NOT EXISTS "idx_{table}_type" ON "{table}" (type)')
    if table == "creature" and "type" in columns:
        conn.execute(f'CREATE INDEX IF NOT EXISTS "idx_{table}_type" ON "{table}" (type)')
        if "level" in columns:
            conn.execute(f'CREATE INDEX IF NOT EXISTS "idx_{table}_level" ON "{table}" (level)')


def to_sqlite_value(col: str, value: str | None):
    if value is None:
        return None
    int_cols = {
        "id",
        "level",
        "rank",
        "content_source_id",
        "trait_id",
        "dedication_feat_id",
        "skill_training_base",
        "uuid",
        "experience",
        "hp_current",
        "hp_temp",
        "stamina_current",
        "resolve_current",
    }
    if col in int_cols:
        try:
            return int(value)
        except ValueError:
            return None
    return value


def build(force: bool = False) -> Path:
    if not DUMP.exists():
        raise SystemExit(f"Missing dump: {DUMP}")
    if not needs_rebuild(force):
        print(f"SQLite up to date: {DB_PATH}")
        return DB_PATH

    print(f"Building {DB_PATH} from {DUMP} …")
    dump_text = DUMP.read_text(encoding="utf-8", errors="replace")
    tmp = DB_PATH.with_suffix(".sqlite.tmp")
    if tmp.exists():
        tmp.unlink()

    conn = sqlite3.connect(tmp)
    try:
        conn.execute("PRAGMA journal_mode=OFF")
        conn.execute("PRAGMA synchronous=OFF")
        for table, columns in TABLES.items():
            create_table(conn, table, columns)
            placeholders = ",".join("?" for _ in columns)
            col_sql = ",".join(f'"{c}"' for c in columns)
            insert = f'INSERT INTO "{table}" ({col_sql}) VALUES ({placeholders})'
            batch = []
            count = 0
            for row in iter_copy_rows(dump_text, table, columns):
                batch.append([to_sqlite_value(c, v) for c, v in zip(columns, row)])
                if len(batch) >= 1000:
                    conn.executemany(insert, batch)
                    count += len(batch)
                    batch = []
            if batch:
                conn.executemany(insert, batch)
                count += len(batch)
            conn.commit()
            print(f"  {table}: {count} rows")
        conn.execute("ANALYZE")
        conn.commit()
    finally:
        conn.close()

    if DB_PATH.exists():
        DB_PATH.unlink()
    tmp.rename(DB_PATH)
    STAMP_PATH.write_text(dump_fingerprint(DUMP) + "\n")
    print(f"Wrote {DB_PATH}")
    return DB_PATH


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="Rebuild even if stamp matches")
    args = parser.parse_args()
    build(force=args.force)


if __name__ == "__main__":
    main()
