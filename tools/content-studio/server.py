#!/usr/bin/env python3
"""Local FastAPI stand-in for the Supabase edge functions Content Studio needs.

Mimics:
  POST /functions/v1/search-data
  POST /functions/v1/find-{ability-block,spell,item,class,ancestry,archetype,trait,content-source}

Plus soft stubs for other probes so the Vite app can boot without Docker.
"""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

DB_PATH = Path(__file__).resolve().parent / "content.sqlite"

TABLE_BY_FIND = {
    "find-ability-block": "ability_block",
    "find-spell": "spell",
    "find-item": "item",
    "find-class": "class",
    "find-ancestry": "ancestry",
    "find-archetype": "archetype",
    "find-trait": "trait",
    "find-content-source": "content_source",
    "find-creature": "creature",
}

JSON_LIKE_COLS = {
    "operations",
    "meta_data",
    "traits",
    "prerequisites",
    "traditions",
    "required_content_sources",
    "price",
    "heightened",
    "keys",
    "inventory",
    "notes",
    "details",
    "roll_history",
    "spells",
    "operation_data",
    "abilities_base",
    "abilities_added",
}

# jsonb / text[] columns the frontend treats as arrays (never plain objects).
# Dump often stores empty jsonb as `{}` and jsonb[] elements as PG array-of-json-text.
ARRAY_JSON_COLS = {
    "operations",
    "traits",
    "prerequisites",
    "traditions",
    "required_content_sources",
    "keys",
    "heightened",
    "abilities_base",
    "abilities_added",
}

BOOL_COLS = {"is_published", "require_key", "deprecated"}

# List/search payloads skip heavy columns (operations, description, …). Drawer
# loads still go through find-* with SELECT *.
LIST_COLUMNS: dict[str, tuple[str, ...]] = {
    "ability_block": (
        "id",
        "name",
        "type",
        "level",
        "actions",
        "content_source_id",
        "traits",
        "requirements",
        "prerequisites",
        "meta_data",
        "rarity",
    ),
    "spell": (
        "id",
        "name",
        "rank",
        "content_source_id",
        "traits",
        "traditions",
        "meta_data",
    ),
    "item": (
        "id",
        "name",
        "level",
        '"group"',
        "content_source_id",
        "traits",
    ),
    "class": ("id", "name", "content_source_id", "trait_id"),
    "ancestry": ("id", "name", "content_source_id", "trait_id"),
    "archetype": ("id", "name", "content_source_id", "trait_id"),
    # meta_data carries creature_trait / ancestry_trait flags used by filter pickers.
    "trait": ("id", "name", "content_source_id", "meta_data"),
    "creature": ("id", "name", "level", "rarity", "content_source_id", "type", "meta_data"),
}

# Trait ids mirrored from frontend/src/utils/traits.ts for action buckets.
TRAIT_EXPLORATION = 1457
TRAIT_DOWNTIME = 1466
TRAIT_FOCUS_SPELL = 1856

DEFAULT_PAGE_SIZE = 10
MAX_PAGE_SIZE = 200

app = FastAPI(title="WG Content Studio Local API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def db() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise RuntimeError(f"Missing {DB_PATH}; run build_db.py first")
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def parse_pg_array(raw: str) -> list[Any]:
    raw = raw.strip()
    if raw in ("{}", ""):
        return []
    if raw[0] != "{" or raw[-1] != "}":
        return []
    inner = raw[1:-1]
    if not inner:
        return []
    out: list[Any] = []
    for part in re.split(r",(?=(?:[^\"']*[\"'][^\"']*[\"'])*[^\"']*$)", inner):
        part = part.strip()
        if part.startswith('"') and part.endswith('"'):
            out.append(part[1:-1].replace('\\"', '"'))
            continue
        if part == "NULL":
            out.append(None)
            continue
        try:
            out.append(int(part))
        except ValueError:
            try:
                out.append(float(part))
            except ValueError:
                out.append(part)
    return out


def parse_pg_json_array(raw: str) -> list[Any] | None:
    """Parse a Postgres text[] / jsonb[] dump of JSON values.

    Creature `operations` / `abilities_base` look like:
      {"{\\"id\\":1,...}","{\\"id\\":2,...}"}
    Comma-splitting breaks inside nested JSON; walk quoted elements instead.
    """
    raw = raw.strip()
    if raw in ("{}", ""):
        return []
    if not (raw.startswith("{") and raw.endswith("}")):
        return None
    # Real JSON object (single record) — not a PG array.
    if re.match(r'\{\s*"', raw) and ":" in raw[:48] and not raw.startswith('{"{') and not raw.startswith('{"['):
        try:
            json.loads(raw)
            return None
        except json.JSONDecodeError:
            pass

    inner = raw[1:-1]
    out: list[Any] = []
    i = 0
    n = len(inner)
    while i < n:
        while i < n and inner[i] in " \t\n\r,":
            i += 1
        if i >= n:
            break
        if inner[i] == '"':
            i += 1
            buf: list[str] = []
            while i < n:
                ch = inner[i]
                if ch == "\\" and i + 1 < n:
                    buf.append(inner[i + 1])
                    i += 2
                    continue
                if ch == '"':
                    i += 1
                    break
                buf.append(ch)
                i += 1
            s = "".join(buf)
            if s == "NULL":
                out.append(None)
            elif s and s[0] in "{[":
                try:
                    out.append(json.loads(s))
                except json.JSONDecodeError:
                    out.append(s)
            else:
                out.append(s)
            continue
        if inner[i] == "{":
            depth = 0
            start = i
            while i < n:
                if inner[i] == "{":
                    depth += 1
                elif inner[i] == "}":
                    depth -= 1
                    if depth == 0:
                        i += 1
                        chunk = inner[start:i]
                        try:
                            out.append(json.loads(chunk))
                        except json.JSONDecodeError:
                            out.append(chunk)
                        break
                i += 1
            continue
        start = i
        while i < n and inner[i] != ",":
            i += 1
        token = inner[start:i].strip()
        if token == "NULL":
            out.append(None)
        else:
            try:
                out.append(int(token))
            except ValueError:
                try:
                    out.append(float(token))
                except ValueError:
                    out.append(token)
    return out


def _parse_json_object_or_array(raw: str) -> Any:
    """Parse a JSON value, or a Postgres text[] of JSON / scalar elements."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pg_json = parse_pg_json_array(raw)
        if pg_json is not None:
            return pg_json
        return parse_pg_array(raw)


def _normalize_array_json(value: Any) -> list[Any]:
    """Ensure array-shaped jsonb columns are real lists of objects/scalars."""
    if value is None:
        return []
    if isinstance(value, dict):
        # Empty `{}` from the dump, or a single operation object.
        if not value:
            return []
        return [value] if "type" in value or "id" in value else []
    if not isinstance(value, list):
        return []
    out: list[Any] = []
    for item in value:
        if isinstance(item, str):
            s = item.strip()
            if not s:
                continue
            if s[0] in "{[":
                try:
                    item = json.loads(s)
                except json.JSONDecodeError:
                    pass
        out.append(item)
    return out


def coerce_value(col: str, value: Any) -> Any:
    if value is None:
        return None
    if col in BOOL_COLS:
        if isinstance(value, str):
            return value.lower() in ("t", "true", "1")
        return bool(value)
    if col in JSON_LIKE_COLS and isinstance(value, str):
        s = value.strip()
        if not s:
            return [] if col in ARRAY_JSON_COLS else None
        if s[0] in "{[":
            if re.fullmatch(r"\{\s*\}", s):
                return [] if col in ARRAY_JSON_COLS else {}
            if re.fullmatch(r"\[\s*\]", s):
                return []
            if s.startswith("["):
                try:
                    parsed: Any = json.loads(s)
                except json.JSONDecodeError:
                    parsed = value
            elif s.startswith("{") and '"' in s and ":" in s:
                # May be a JSON object OR a PG array of JSON-encoded strings.
                parsed = _parse_json_object_or_array(s)
            elif s.startswith("{"):
                parsed = parse_pg_array(s)
            else:
                parsed = value
            if col in ARRAY_JSON_COLS:
                return _normalize_array_json(parsed)
            return parsed
        return value
    if col in ARRAY_JSON_COLS:
        return _normalize_array_json(value)
    return value


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: coerce_value(key, row[key]) for key in row.keys()}


def success(data: Any) -> JSONResponse:
    return JSONResponse({"status": "success", "data": data})


def ilike(value: str | None, pattern: str) -> bool:
    if value is None:
        return False
    out: list[str] = ["^"]
    for ch in pattern:
        if ch == "%":
            out.append(".*")
        elif ch == "_":
            out.append(".")
        else:
            out.append(re.escape(ch))
    out.append("$")
    return re.search("".join(out), value, re.IGNORECASE) is not None


def parse_simple_search(input_text: str) -> tuple[list[str], list[str]]:
    positive: list[str] = []
    negative: list[str] = []
    token_re = re.compile(r'(-)?("(?:[^"\\]|\\.)*"|\S+)', re.I)
    for match in token_re.finditer(input_text):
        neg = bool(match.group(1))
        raw = match.group(2)
        if raw.startswith('"'):
            token = f"%{raw[1:-1]}%"
        elif "*" in raw:
            token = raw.replace("*", "%")
        else:
            token = f"%{raw}%"
        (negative if neg else positive).append(token)
    return positive, negative


def matches_name(name: str | None, search: str) -> bool:
    positive, negative = parse_simple_search(search)
    for pat in positive:
        if not ilike(name, pat):
            return False
    for pat in negative:
        if ilike(name, pat):
            return False
    return True


def traits_contain(traits: Any, needed: list[int]) -> bool:
    if not isinstance(traits, list):
        return False
    return all(t in traits for t in needed)


def traits_contain_any(traits: Any, needed: list[int]) -> bool:
    if not isinstance(traits, list) or not needed:
        return False
    return any(t in traits for t in needed)


def traditions_overlap(traditions: Any, needed: list[str]) -> bool:
    if not isinstance(traditions, list):
        return False
    lower = {str(t).lower() for t in traditions}
    return any(n.lower() in lower for n in needed)


def sql_placeholders(n: int) -> str:
    return ",".join("?" for _ in range(n))


def _trait_like_clause(tid: int) -> tuple[str, list[Any]]:
    """Match one trait id inside a PG int[] text dump like `{1,2,3}`."""
    return (
        "(traits = ? OR traits LIKE ? OR traits LIKE ? OR traits LIKE ?)",
        [f"{{{tid}}}", f"{{{tid},%", f"%,{tid},%", f"%,{tid}}}"],
    )


def traits_sql_contains(trait_ids: list[int]) -> tuple[str, list[Any]]:
    """Best-effort SQL prefilter: row must contain ALL trait ids."""
    clauses: list[str] = []
    params: list[Any] = []
    for tid in trait_ids:
        clause, p = _trait_like_clause(tid)
        clauses.append(clause)
        params.extend(p)
    return " AND ".join(clauses), params


def traits_sql_contains_any(trait_ids: list[int]) -> tuple[str, list[Any]]:
    """Best-effort SQL prefilter: row must contain ANY of the trait ids."""
    clauses: list[str] = []
    params: list[Any] = []
    for tid in trait_ids:
        clause, p = _trait_like_clause(tid)
        clauses.append(clause)
        params.extend(p)
    return "(" + " OR ".join(clauses) + ")", params


def creature_give_trait_sql_contains(trait_ids: list[int]) -> tuple[str, list[Any]]:
    """
    Match creature rows whose operations include giveTrait for every trait id.

    The SQLite dump stores operations as a Postgres text[] of JSON strings with
    escaped quotes, e.g. ...giveTrait\\",\\"data\\":{\\"traitId\\":2410}...
    """
    clauses: list[str] = []
    params: list[Any] = []
    for tid in trait_ids:
        clauses.append("operations LIKE ?")
        params.append(f'%giveTrait\\",\\"data\\":{{\\"traitId\\":{int(tid)}%')
    return " AND ".join(clauses), params


def hazard_trait_ids_sql_contains(trait_ids: list[int]) -> tuple[str, list[Any]]:
    """AND-match hazard details.trait_ids arrays (JSON in the dump)."""
    clauses: list[str] = []
    params: list[Any] = []
    for tid in trait_ids:
        tid_i = int(tid)
        clauses.append(
            "(details LIKE ? OR details LIKE ? OR details LIKE ? OR details LIKE ?)"
        )
        params.extend(
            [
                f'%"trait_ids": [{tid_i}]%',
                f'%"trait_ids": [{tid_i}, %',
                f'%, {tid_i}]%',
                f'%, {tid_i}, %',
            ]
        )
    return " AND ".join(clauses), params


def matches_action_bucket(row: dict[str, Any], bucket: str) -> bool:
    if bucket in ("", "all"):
        return True
    traits = row.get("traits") if isinstance(row.get("traits"), list) else []
    meta = row.get("meta_data") if isinstance(row.get("meta_data"), dict) else {}
    skill = meta.get("skill")
    has_skill = (isinstance(skill, list) and len(skill) > 0) or (isinstance(skill, str) and bool(skill))
    requirements = row.get("requirements")
    has_requirements = isinstance(requirements, str) and bool(requirements.strip())
    is_exploration = TRAIT_EXPLORATION in traits
    is_downtime = TRAIT_DOWNTIME in traits
    if bucket == "skill":
        return bool(has_skill)
    if bucket == "exploration":
        return is_exploration
    if bucket == "downtime":
        return is_downtime
    if bucket == "specialty-basic":
        return not has_skill and has_requirements
    if bucket == "basic":
        return not has_skill and not has_requirements and not is_exploration and not is_downtime
    return True


def parse_pagination(filters: dict[str, Any]) -> tuple[int | None, int]:
    """Return (limit, offset). limit=None means return the full filtered set."""
    raw_limit = filters.get("limit")
    raw_offset = filters.get("offset") or 0
    try:
        offset = max(0, int(raw_offset))
    except (TypeError, ValueError):
        offset = 0
    if raw_limit is None:
        return DEFAULT_PAGE_SIZE, offset
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        return DEFAULT_PAGE_SIZE, offset
    if limit < 0:
        return None, 0
    return min(limit, MAX_PAGE_SIZE), offset


def paginate(rows: list[dict[str, Any]], limit: int | None, offset: int) -> tuple[list[dict[str, Any]], int]:
    total = len(rows)
    if limit is None:
        return rows, total
    return rows[offset : offset + limit], total


def _build_where(
    *,
    content_sources: list[int] | None = None,
    name: str | None = None,
    extra_sql: str = "",
    extra_params: list[Any] | None = None,
) -> tuple[list[str], list[Any], bool]:
    """Return (where_clauses, params, name_needs_python).

    Simple single-token name searches go into SQL; advanced name syntax still
    needs a Python pass after fetch.
    """
    where: list[str] = []
    params: list[Any] = []
    name_needs_python = False
    if content_sources:
        where.append(f"content_source_id IN ({sql_placeholders(len(content_sources))})")
        params.extend(content_sources)
    if extra_sql:
        where.append(f"({extra_sql})")
        params.extend(extra_params or [])
    if name:
        positive, negative = parse_simple_search(name)
        # Only the common case (one positive LIKE token, no negatives) is pushed to SQL.
        if len(positive) == 1 and not negative and "*" not in name and not name.strip().startswith("-"):
            where.append("name LIKE ? COLLATE NOCASE")
            params.append(positive[0])
        else:
            name_needs_python = True
    return where, params, name_needs_python


def query_rows(
    conn: sqlite3.Connection,
    table: str,
    *,
    content_sources: list[int] | None = None,
    name: str | None = None,
    extra_sql: str = "",
    extra_params: list[Any] | None = None,
    order_sql: str = "name COLLATE NOCASE ASC",
    columns: tuple[str, ...] | None = None,
    fetch_limit: int | None = None,
    fetch_offset: int = 0,
) -> list[dict[str, Any]]:
    where, params, name_needs_python = _build_where(
        content_sources=content_sources,
        name=name,
        extra_sql=extra_sql,
        extra_params=extra_params,
    )
    col_sql = ", ".join(columns) if columns else "*"
    table_sql = f'"{table}"'
    sql = f"SELECT {col_sql} FROM {table_sql}"
    if where:
        sql += " WHERE " + " AND ".join(where)
    if order_sql:
        sql += f" ORDER BY {order_sql}"
    # When name still needs Python filtering we cannot SQL-limit first.
    if fetch_limit is not None and not name_needs_python:
        sql += f" LIMIT {int(fetch_limit)} OFFSET {int(fetch_offset)}"
    rows = [row_to_dict(r) for r in conn.execute(sql, params)]
    if name_needs_python and name:
        rows = [r for r in rows if matches_name(r.get("name"), name)]
        if fetch_limit is not None:
            rows = rows[fetch_offset : fetch_offset + fetch_limit]
    return rows


def query_total(
    conn: sqlite3.Connection,
    table: str,
    *,
    content_sources: list[int] | None = None,
    name: str | None = None,
    extra_sql: str = "",
    extra_params: list[Any] | None = None,
) -> int:
    """COUNT(*) for the same filters as query_rows (exact when name is SQL-simple)."""
    where, params, name_needs_python = _build_where(
        content_sources=content_sources,
        name=name,
        extra_sql=extra_sql,
        extra_params=extra_params,
    )
    if name_needs_python:
        # Fall back to loading ids only — still cheaper than full list columns.
        rows = query_rows(
            conn,
            table,
            content_sources=content_sources,
            name=name,
            extra_sql=extra_sql,
            extra_params=extra_params,
            columns=("id",),
            order_sql="",
        )
        return len(rows)
    table_sql = f'"{table}"'
    sql = f"SELECT COUNT(*) AS n FROM {table_sql}"
    if where:
        sql += " WHERE " + " AND ".join(where)
    row = conn.execute(sql, params).fetchone()
    return int(row["n"] if row else 0)


@app.api_route("/auth/v1/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
async def auth_stub(path: str, request: Request):
    if request.method == "OPTIONS":
        return JSONResponse({})
    return JSONResponse({"error": "not_authenticated", "message": "local content studio"}, status_code=200)


@app.get("/health")
async def health():
    return {"ok": True, "db": DB_PATH.exists()}


@app.post("/functions/v1/search-data")
async def search_data(request: Request):
    body = await request.json()
    filters = body if isinstance(body, dict) else {}
    content_sources = filters.get("content_sources")
    if isinstance(content_sources, list):
        content_sources = [int(x) for x in content_sources]
    type_ = filters.get("type")
    name = filters.get("name")
    traits = filters.get("traits") or []
    traits_any = filters.get("traits_any") or []
    level_min = filters.get("level_min")
    level_max = filters.get("level_max")
    rank_min = filters.get("rank_min")
    rank_max = filters.get("rank_max")
    ab_type = filters.get("ab_type")
    group = filters.get("group")
    traditions = filters.get("traditions") or []
    spell_type = filters.get("spell_type")
    action_bucket = filters.get("action_bucket") or "all"
    limit, offset = parse_pagination(filters)

    empty: dict[str, Any] = {
        "ability_blocks": [],
        "ancestries": [],
        "archetypes": [],
        "backgrounds": [],
        "classes": [],
        "creatures": [],
        "hazards": [],
        "items": [],
        "languages": [],
        "spells": [],
        "traits": [],
        "versatile_heritages": [],
        "class_archetypes": [],
        "total": 0,
        "limit": limit,
        "offset": offset,
    }

    conn = db()
    try:
        if type_ == "ability-block":
            extra = []
            params: list[Any] = []
            if ab_type:
                extra.append("type = ?")
                params.append(ab_type)
            if level_min is not None:
                extra.append("level >= ?")
                params.append(level_min)
            if level_max is not None:
                extra.append("level <= ?")
                params.append(level_max)
            needed_traits = [int(t) for t in traits] if traits else []
            needed_any = [int(t) for t in traits_any] if traits_any else []
            if needed_traits:
                trait_sql, trait_params = traits_sql_contains(needed_traits)
                extra.append(trait_sql)
                params.extend(trait_params)
            if needed_any:
                any_sql, any_params = traits_sql_contains_any(needed_any)
                extra.append(any_sql)
                params.extend(any_params)
            extra_sql = " AND ".join(extra) if extra else ""
            # Action buckets need Python meta/requirements — small corpus, load then page.
            # Otherwise COUNT + LIMIT/OFFSET in SQL so Feats never ships ~11k rows.
            needs_python_bucket = bool(action_bucket and action_bucket != "all")
            if needs_python_bucket or limit is None:
                rows = query_rows(
                    conn,
                    "ability_block",
                    content_sources=content_sources,
                    name=name,
                    extra_sql=extra_sql,
                    extra_params=params,
                    order_sql="level ASC, name COLLATE NOCASE ASC",
                    columns=LIST_COLUMNS["ability_block"],
                )
                if needed_traits:
                    rows = [r for r in rows if traits_contain(r.get("traits"), needed_traits)]
                if needed_any:
                    rows = [r for r in rows if traits_contain_any(r.get("traits"), needed_any)]
                if needs_python_bucket:
                    rows = [r for r in rows if matches_action_bucket(r, str(action_bucket))]
                page, total = paginate(rows, limit, offset)
                empty["ability_blocks"] = page
                empty["total"] = total
            else:
                total = query_total(
                    conn,
                    "ability_block",
                    content_sources=content_sources,
                    name=name,
                    extra_sql=extra_sql,
                    extra_params=params,
                )
                rows = query_rows(
                    conn,
                    "ability_block",
                    content_sources=content_sources,
                    name=name,
                    extra_sql=extra_sql,
                    extra_params=params,
                    order_sql="level ASC, name COLLATE NOCASE ASC",
                    columns=LIST_COLUMNS["ability_block"],
                    fetch_limit=limit,
                    fetch_offset=offset,
                )
                if needed_traits:
                    rows = [r for r in rows if traits_contain(r.get("traits"), needed_traits)]
                if needed_any:
                    rows = [r for r in rows if traits_contain_any(r.get("traits"), needed_any)]
                empty["ability_blocks"] = rows
                empty["total"] = total
        elif type_ == "spell":
            extra = []
            params = []
            if rank_min is not None:
                extra.append("rank >= ?")
                params.append(rank_min)
            if rank_max is not None:
                extra.append("rank <= ?")
                params.append(rank_max)
            if traits:
                trait_sql, trait_params = traits_sql_contains([int(t) for t in traits])
                extra.append(trait_sql)
                params.extend(trait_params)
            rows = query_rows(
                conn,
                "spell",
                content_sources=content_sources,
                name=name,
                extra_sql=" AND ".join(extra) if extra else "",
                extra_params=params,
                order_sql="rank ASC, name COLLATE NOCASE ASC",
                columns=LIST_COLUMNS["spell"],
            )
            filtered = []
            for row in rows:
                if traditions and not traditions_overlap(row.get("traditions"), traditions):
                    continue
                if traits and not traits_contain(row.get("traits"), traits):
                    continue
                meta = row.get("meta_data") if isinstance(row.get("meta_data"), dict) else {}
                traits_list = row.get("traits") if isinstance(row.get("traits"), list) else []
                if spell_type == "FOCUS":
                    if TRAIT_FOCUS_SPELL not in traits_list and not meta.get("focus"):
                        continue
                elif spell_type == "RITUAL":
                    if not meta.get("ritual"):
                        continue
                elif spell_type == "NORMAL":
                    if meta.get("focus") or meta.get("ritual"):
                        continue
                filtered.append(row)
            page, total = paginate(filtered, limit, offset)
            empty["spells"] = page
            empty["total"] = total
        elif type_ == "item":
            extra = []
            params = []
            if group:
                extra.append('"group" = ?')
                params.append(group)
            if level_min is not None:
                extra.append("level >= ?")
                params.append(level_min)
            if level_max is not None:
                extra.append("level <= ?")
                params.append(level_max)
            if traits:
                trait_sql, trait_params = traits_sql_contains([int(t) for t in traits])
                extra.append(trait_sql)
                params.extend(trait_params)
            rows = query_rows(
                conn,
                "item",
                content_sources=content_sources,
                name=name,
                extra_sql=" AND ".join(extra) if extra else "",
                extra_params=params,
                order_sql="level ASC, name COLLATE NOCASE ASC",
                columns=LIST_COLUMNS["item"],
            )
            if traits:
                rows = [r for r in rows if traits_contain(r.get("traits"), traits)]
            page, total = paginate(rows, limit, offset)
            empty["items"] = page
            empty["total"] = total
        elif type_ == "class":
            rows = query_rows(
                conn,
                "class",
                content_sources=content_sources,
                name=name,
                columns=LIST_COLUMNS["class"],
            )
            page, total = paginate(rows, limit, offset)
            empty["classes"] = page
            empty["total"] = total
        elif type_ == "ancestry":
            rows = query_rows(
                conn,
                "ancestry",
                content_sources=content_sources,
                name=name,
                columns=LIST_COLUMNS["ancestry"],
            )
            page, total = paginate(rows, limit, offset)
            empty["ancestries"] = page
            empty["total"] = total
        elif type_ == "archetype":
            rows = query_rows(
                conn,
                "archetype",
                content_sources=content_sources,
                name=name,
                columns=LIST_COLUMNS["archetype"],
            )
            page, total = paginate(rows, limit, offset)
            empty["archetypes"] = page
            empty["total"] = total
        elif type_ == "trait":
            rows = query_rows(
                conn,
                "trait",
                content_sources=content_sources,
                name=name,
                columns=LIST_COLUMNS["trait"],
            )
            # Optional: only traits flagged creature_trait in meta_data (monster tags).
            if filters.get("creature_trait") is True:
                rows = [
                    r
                    for r in rows
                    if isinstance(r.get("meta_data"), dict) and r["meta_data"].get("creature_trait") is True
                ]
            page, total = paginate(rows, limit, offset)
            empty["traits"] = page
            empty["total"] = total
        elif type_ in ("creature", "hazard"):
            # Creatures + hazards share the creature table; filter by type column.
            extra = ["type = ?"]
            params: list[Any] = [type_]
            if level_min is not None:
                extra.append("level >= ?")
                params.append(level_min)
            if level_max is not None:
                extra.append("level <= ?")
                params.append(level_max)
            # Monsters store tags as giveTrait ops (no top-level traits column).
            # Hazards store tags on details.trait_ids.
            if traits:
                needed = [int(t) for t in traits]
                if type_ == "creature":
                    trait_sql, trait_params = creature_give_trait_sql_contains(needed)
                else:
                    trait_sql, trait_params = hazard_trait_ids_sql_contains(needed)
                extra.append(f"({trait_sql})")
                params.extend(trait_params)
            extra_sql = " AND ".join(extra)
            result_key = "creatures" if type_ == "creature" else "hazards"
            if limit is None:
                rows = query_rows(
                    conn,
                    "creature",
                    content_sources=content_sources,
                    name=name,
                    extra_sql=extra_sql,
                    extra_params=params,
                    order_sql="level ASC, name COLLATE NOCASE ASC",
                    columns=LIST_COLUMNS["creature"],
                )
                page, total = paginate(rows, limit, offset)
                empty[result_key] = page
                empty["total"] = total
            else:
                total = query_total(
                    conn,
                    "creature",
                    content_sources=content_sources,
                    name=name,
                    extra_sql=extra_sql,
                    extra_params=params,
                )
                rows = query_rows(
                    conn,
                    "creature",
                    content_sources=content_sources,
                    name=name,
                    extra_sql=extra_sql,
                    extra_params=params,
                    order_sql="level ASC, name COLLATE NOCASE ASC",
                    columns=LIST_COLUMNS["creature"],
                    fetch_limit=limit,
                    fetch_offset=offset,
                )
                empty[result_key] = rows
                empty["total"] = total
        return success(empty)
    finally:
        conn.close()


@app.post("/functions/v1/{fn_name}")
async def find_content(fn_name: str, request: Request):
    if fn_name == "search-data":
        return await search_data(request)
    if fn_name == "get-user":
        return success(None)
    if fn_name == "get-content-versions":
        return success([])

    body = await request.json()
    filters = body if isinstance(body, dict) else {}
    id_ = filters.get("id")
    name = filters.get("name")
    content_sources = filters.get("content_sources")
    traits = filters.get("traits")
    type_ = filters.get("type")
    homebrew = filters.get("homebrew")
    published = filters.get("published")
    group = filters.get("group")
    # Edge find-ability-block: arrayContains on prerequisites (used by FeatDrawer
    # "Prerequisite for" via fetchAllPrereqs). Ignoring this dumped the full table.
    prerequisites = filters.get("prerequisites")

    table = TABLE_BY_FIND.get(fn_name)
    if not table:
        # Content package still probes tables Content Studio may omit
        # (background, language, …). fetchContent throws on list→null; return [].
        if fn_name.startswith("find-") and (id_ is None or isinstance(id_, list)):
            return success([])
        return success(None)

    conn = db()
    try:
        where: list[str] = []
        params: list[Any] = []
        by_id = id_ is not None
        if id_ is not None:
            ids = id_ if isinstance(id_, list) else [id_]
            if len(ids) == 0:
                # App often probes subscribed sources as [] when logged out.
                return success([] if isinstance(id_, list) else None)
            where.append(f"id IN ({sql_placeholders(len(ids))})")
            params.extend(ids)
        if content_sources is not None and table != "content_source":
            cs = content_sources if isinstance(content_sources, list) else [content_sources]
            if len(cs) == 0:
                return success([] if id_ is None or isinstance(id_, list) else None)
            where.append(f"content_source_id IN ({sql_placeholders(len(cs))})")
            params.extend(cs)
        if type_ and table == "ability_block":
            where.append("type = ?")
            params.append(type_)
        # find-creature defaults to type=creature (matches edge find-creature).
        if table == "creature":
            creature_type = type_ if type_ in ("creature", "hazard") else "creature"
            where.append("type = ?")
            params.append(creature_type)
        if group is not None and table == "content_source":
            where.append('"group" = ?')
            params.append(group)
        if published is True and table == "content_source":
            where.append("is_published IN ('t', 'true', '1', 1)")
        if published is False and table == "content_source":
            where.append("is_published IN ('f', 'false', '0', 0)")
        # Narrow in SQL before coerce — prerequisites are stored as PG text arrays.
        if prerequisites and table == "ability_block":
            needed_prereqs = prerequisites if isinstance(prerequisites, list) else [prerequisites]
            for prereq in needed_prereqs:
                where.append("prerequisites LIKE ?")
                params.append(f"%{prereq}%")
        # Push traits into SQL (same helpers as search-data) so ClassDrawer / trait
        # filters don't coerce the entire ability_block table.
        needed_traits: list[int] | None = None
        if traits and table in ("ability_block", "spell", "item"):
            needed_traits = [int(t) for t in (traits if isinstance(traits, list) else [traits])]
            trait_sql, trait_params = traits_sql_contains(needed_traits)
            where.append(trait_sql)
            params.extend(trait_params)

        # By-id (drawer detail) stays SELECT *. Filtered list queries that already
        # narrowed by traits/prerequisites use slim columns — avoids parsing heavy
        # operations JSON for thousands of unrelated rows.
        use_slim = (
            not by_id
            and table in LIST_COLUMNS
            and (needed_traits is not None or (prerequisites and table == "ability_block"))
        )
        col_sql = ", ".join(LIST_COLUMNS[table]) if use_slim else "*"
        sql = f'SELECT {col_sql} FROM "{table}"'
        if where:
            sql += " WHERE " + " AND ".join(where)
        rows = [row_to_dict(r) for r in conn.execute(sql, params)]

        if name:
            rows = [r for r in rows if ilike(r.get("name"), f"%{name}%")]
        if needed_traits is not None:
            rows = [r for r in rows if traits_contain(r.get("traits"), needed_traits)]
        if prerequisites and table == "ability_block":
            needed_prereqs = prerequisites if isinstance(prerequisites, list) else [prerequisites]
            rows = [
                r
                for r in rows
                if isinstance(r.get("prerequisites"), list)
                and all(p in r["prerequisites"] for p in needed_prereqs)
            ]

        if table == "content_source" and id_ is None and (homebrew is None or homebrew is False):
            rows = [r for r in rows if r.get("user_id") is None]

        if id_ is None or isinstance(id_, list):
            return success(rows)
        return success(rows[0] if rows else None)
    finally:
        conn.close()


def main() -> None:
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8765, reload=False, log_level="info")


if __name__ == "__main__":
    main()
