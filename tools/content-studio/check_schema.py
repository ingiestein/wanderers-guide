#!/usr/bin/env python3
"""Compare upstream Postgres schema → Content Studio SQLite columns → frontend Zod.

Run after pulling `data/schema.sql` / `data/data.sql` (or any upstream merge) to see
what Content Studio and the frontend types need to absorb.

Exit codes:
  0 — no blocking drift (CS TABLES cover every non-generated SQL column)
  1 — CS is missing SQL columns or a tracked table vanished
  2 — could not parse inputs
"""

from __future__ import annotations

import argparse
import importlib.util
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SCHEMA_SQL = ROOT / "data" / "schema.sql"
CONTENT_TS = ROOT / "frontend" / "src" / "schemas" / "content.ts"
BUILD_DB = HERE / "build_db.py"

# Generated / non-content columns we never mirror into SQLite.
IGNORE_SQL_COLS = {"search_tsv"}

# Map dump table → Zod schema export name(s) in content.ts (best-effort).
TABLE_TO_ZOD: dict[str, list[str]] = {
    "ability_block": ["AbilityBlockSchema"],
    "spell": ["SpellSchema"],
    "item": ["ItemSchema"],
    "class": ["ClassSchema"],
    "ancestry": ["AncestrySchema"],
    "archetype": ["ArchetypeSchema"],
    "trait": ["TraitSchema"],
    "creature": ["CreatureSchema", "HazardSchema"],
    "content_source": ["ContentSourceSchema"],
}


def load_cs_tables() -> dict[str, list[str]]:
    spec = importlib.util.spec_from_file_location("cs_build_db", BUILD_DB)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {BUILD_DB}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    tables = getattr(mod, "TABLES", None)
    if not isinstance(tables, dict):
        raise RuntimeError("build_db.TABLES missing")
    return {str(k): list(v) for k, v in tables.items()}


def parse_schema_sql(path: Path) -> dict[str, list[str]]:
    """Extract public.<table> column names from pg_dump schema.sql."""
    text = path.read_text(encoding="utf-8", errors="replace")
    tables: dict[str, list[str]] = {}
    # CREATE TABLE public.foo (\n  col type,\n ...\n);
    for match in re.finditer(
        r"CREATE TABLE public\.(\w+)\s*\((.*?)\);",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    ):
        name = match.group(1)
        body = match.group(2)
        cols: list[str] = []
        for raw_line in body.splitlines():
            line = raw_line.strip().rstrip(",")
            if not line or line.startswith("--"):
                continue
            # Skip constraints / table-level keys.
            upper = line.upper()
            if upper.startswith(
                ("CONSTRAINT", "PRIMARY KEY", "UNIQUE", "CHECK", "FOREIGN KEY", "EXCLUDE")
            ):
                continue
            # column_name type ...
            m = re.match(r'^"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+', line)
            if not m:
                continue
            col = m.group(1)
            if col.lower() in IGNORE_SQL_COLS:
                continue
            cols.append(col)
        if cols:
            tables[name] = cols
    return tables


def _object_block_at(text: str, open_brace: int) -> str:
    depth = 1
    i = open_brace + 1
    while i < len(text) and depth:
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        i += 1
    return text[open_brace + 1 : i - 1]


def _keys_from_object_block(block: str) -> set[str]:
    keys: set[str] = set()
    for km in re.finditer(r"(?m)^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:", block):
        key = km.group(1)
        if key in {"refine", "superRefine", "transform", "pipe"}:
            continue
        keys.add(key)
    return keys


def parse_zod_keys(path: Path, schema_names: list[str]) -> set[str]:
    """Heuristic: top-level keys in named Zod schemas, following .extend(Base) once."""
    text = path.read_text(encoding="utf-8", errors="replace")
    keys: set[str] = set()

    def collect(schema: str, seen: set[str]) -> None:
        if schema in seen:
            return
        seen.add(schema)
        # export const FooSchema = ... = Base.extend({ ... }) | z.object({ ... }) | z.lazy(() => z.object({ ... }))
        m = re.search(
            rf"export const {re.escape(schema)}\s*(?::[^=]+)?=\s*",
            text,
        )
        if not m:
            return
        rest = text[m.end() :]
        # Follow One-level extend parent: LivingEntitySchema.extend({
        ext = re.match(r"([A-Za-z_][A-Za-z0-9_]*)\.extend\(\s*\{", rest)
        if ext:
            collect(ext.group(1), seen)
            brace = m.end() + ext.end() - 1
            keys.update(_keys_from_object_block(_object_block_at(text, brace)))
            return
        # z.lazy(() => z.object({ ... })) / z\n  .object({ ... }) / z.object({ ... })
        obj = re.search(r"z(?:\s*\n\s*)?\.object\(\s*\{", rest)
        if obj:
            brace = m.end() + obj.end() - 1
            keys.update(_keys_from_object_block(_object_block_at(text, brace)))

    for schema in schema_names:
        collect(schema, set())
    return keys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--schema",
        type=Path,
        default=SCHEMA_SQL,
        help="Path to data/schema.sql (default: repo data/schema.sql)",
    )
    parser.add_argument(
        "--zod",
        action="store_true",
        default=True,
        help="Also compare Zod schema keys (default on)",
    )
    parser.add_argument("--no-zod", action="store_true", help="Skip Zod comparison")
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable JSON summary on stdout",
    )
    args = parser.parse_args()
    do_zod = args.zod and not args.no_zod

    if not args.schema.exists():
        print(f"error: schema file not found: {args.schema}", file=sys.stderr)
        return 2

    try:
        cs_tables = load_cs_tables()
        sql_tables = parse_schema_sql(args.schema)
    except Exception as exc:  # noqa: BLE001 — CLI surface
        print(f"error: {exc}", file=sys.stderr)
        return 2

    report: dict[str, object] = {
        "schema": str(args.schema),
        "cs_tables": sorted(cs_tables),
        "blocking": [],
        "warnings": [],
        "tables": {},
    }
    blocking: list[str] = []
    warnings: list[str] = []

    print("Content Studio schema drift check")
    print(f"  schema: {args.schema}")
    print(f"  CS tables: {', '.join(sorted(cs_tables))}")
    print()

    for table, cs_cols in sorted(cs_tables.items()):
        sql_cols = sql_tables.get(table)
        entry: dict[str, object] = {"sql": None, "cs": cs_cols}
        if sql_cols is None:
            msg = f"{table}: missing from schema.sql (table dropped or renamed upstream?)"
            blocking.append(msg)
            print(f"✗ {msg}")
            report["tables"][table] = {**entry, "status": "missing_table"}
            continue

        sql_set = set(sql_cols)
        cs_set = set(cs_cols)
        missing_in_cs = sorted(sql_set - cs_set)
        extra_in_cs = sorted(cs_set - sql_set)
        entry["sql"] = sql_cols
        entry["missing_in_cs"] = missing_in_cs
        entry["extra_in_cs"] = extra_in_cs

        if missing_in_cs:
            msg = f"{table}: SQL has columns CS does not import: {', '.join(missing_in_cs)}"
            blocking.append(msg)
            print(f"✗ {msg}")
            print(f"    → add to tools/content-studio/build_db.py TABLES['{table}']")
            print(f"      then rebuild: npm run content-studio:rebuild")
        elif extra_in_cs:
            msg = f"{table}: CS lists columns not in SQL (stale?): {', '.join(extra_in_cs)}"
            warnings.append(msg)
            print(f"⚠ {msg}")
        else:
            print(f"✓ {table}: {len(cs_cols)} columns match schema.sql")

        if do_zod and table in TABLE_TO_ZOD:
            zod_keys = parse_zod_keys(CONTENT_TS, TABLE_TO_ZOD[table])
            entry["zod_schemas"] = TABLE_TO_ZOD[table]
            entry["zod_keys"] = sorted(zod_keys)
            # SQL cols not present as Zod keys — may be intentional (LivingEntity split, etc.)
            sql_not_in_zod = sorted(c for c in sql_cols if c not in zod_keys and c not in {"created_at", "updated_at", "uuid", "deprecated", "version", "search_tsv"})
            zod_not_in_sql = sorted(k for k in zod_keys if k not in sql_set and k not in {"type"})  # hazard.type literal
            entry["sql_not_in_zod"] = sql_not_in_zod
            entry["zod_not_in_sql"] = zod_not_in_sql
            if sql_not_in_zod:
                msg = (
                    f"{table}: SQL columns absent from {', '.join(TABLE_TO_ZOD[table])} "
                    f"keys: {', '.join(sql_not_in_zod)}"
                )
                warnings.append(msg)
                print(f"⚠ {msg}")
                print("    → review frontend/src/schemas/content.ts after dump updates")
            if zod_not_in_sql:
                # Often nested reshape (details, inventory) — informational only.
                print(
                    f"  · {table}: Zod-only keys (nested/derived OK): "
                    f"{', '.join(zod_not_in_sql[:12])}"
                    + ("…" if len(zod_not_in_sql) > 12 else "")
                )

        report["tables"][table] = entry
        print()

    # New content tables upstream that CS ignores entirely.
    interesting_new = sorted(
        t
        for t in sql_tables
        if t not in cs_tables
        and t
        in {
            "ability_block",
            "spell",
            "item",
            "class",
            "ancestry",
            "archetype",
            "trait",
            "creature",
            "content_source",
            "background",
            "language",
            "versatile_heritage",
            "class_archetype",
        }
    )
    if interesting_new:
        msg = f"upstream content tables not imported by CS: {', '.join(interesting_new)}"
        warnings.append(msg)
        print(f"⚠ {msg}")
        print("    → add to build_db.TABLES if Content Studio should browse them")
        print()

    report["blocking"] = blocking
    report["warnings"] = warnings

    if args.json:
        import json

        print(json.dumps(report, indent=2))

    print("Summary")
    print(f"  blocking: {len(blocking)}")
    print(f"  warnings: {len(warnings)}")
    if blocking:
        print("\nFix blocking items, then: npm run content-studio:rebuild")
        return 1
    print("\nNo blocking drift.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
