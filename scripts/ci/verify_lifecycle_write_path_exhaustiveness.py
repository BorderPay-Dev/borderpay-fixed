#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MATRIX_PATH = ROOT / "scripts/ci/lifecycle_write_matrix.json"

LIFECYCLE_TABLES = ("pending_events", "bridge_webhook_events", "bridge_transfers", "webhook_logs")

TS_PATTERN = re.compile(
    r"from\(\s*\"(?P<table>pending_events|bridge_webhook_events|bridge_transfers|webhook_logs)\"\s*\)\s*\.\s*(?P<op>insert|update|upsert|delete)\s*\(",
    re.IGNORECASE | re.MULTILINE,
)

SQL_PATTERN = re.compile(
    r"(?P<kw>insert\s+into|update|delete\s+from)\s+public\.(?P<table>pending_events|bridge_webhook_events|bridge_transfers|webhook_logs)\b",
    re.IGNORECASE,
)


@dataclass
class WriteHit:
    path: str
    line: int
    table: str
    op: str
    source_kind: str
    fields: list[str] | None = None
    category: str = "unclassified"


def load_matrix() -> dict:
    if not MATRIX_PATH.exists():
        raise FileNotFoundError(f"missing matrix: {MATRIX_PATH}")
    return json.loads(MATRIX_PATH.read_text(encoding="utf-8"))


def line_for_offset(text: str, idx: int) -> int:
    return text.count("\n", 0, idx) + 1


def scan_ts(paths: list[Path]) -> list[WriteHit]:
    out: list[WriteHit] = []
    for p in paths:
        text = p.read_text(encoding="utf-8")
        rel = str(p.relative_to(ROOT))
        for m in TS_PATTERN.finditer(text):
            table = m.group("table").lower()
            op = m.group("op").lower()
            fields = extract_fields_from_call_arg(text, m.end())
            category = categorize_write(table=table, op=op, source_kind="ts", fields=fields)
            out.append(WriteHit(
                path=rel,
                line=line_for_offset(text, m.start()),
                table=table,
                op=op,
                source_kind="ts",
                fields=fields,
                category=category,
            ))
    return out


def scan_sql(paths: list[Path]) -> list[WriteHit]:
    out: list[WriteHit] = []
    for p in paths:
        text = p.read_text(encoding="utf-8")
        rel = str(p.relative_to(ROOT))
        for m in SQL_PATTERN.finditer(text):
            kw = m.group("kw").lower().strip()
            if kw.startswith("insert"):
                op = "insert"
            elif kw.startswith("delete"):
                op = "delete"
            else:
                op = "update"
            table = m.group("table").lower()
            category = categorize_write(table=table, op=op, source_kind="sql", fields=None)
            out.append(WriteHit(path=rel, line=line_for_offset(text, m.start()), table=table, op=op, source_kind="sql", category=category))
    return out


def extract_fields_from_call_arg(text: str, idx_after_open_paren: int) -> list[str]:
    # idx_after_open_paren points just after the opening "(" in .update( / .insert( / .upsert(
    i = idx_after_open_paren
    n = len(text)
    while i < n and text[i].isspace():
        i += 1
    if i >= n or text[i] != "{":
        return []

    depth = 0
    j = i
    while j < n:
        ch = text[j]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    if j >= n:
        return []
    blob = text[i : j + 1]
    return [m.group(1) for m in re.finditer(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*:", blob)]


def categorize_write(table: str, op: str, source_kind: str, fields: list[str] | None) -> str:
    fields_set = {f.lower() for f in (fields or [])}

    if table == "pending_events":
        return "lifecycle"
    if table == "bridge_transfers":
        return "lifecycle"
    if table == "webhook_logs":
        if fields_set & {"status", "attempts", "last_error", "completed_at"}:
            return "observability"
        return "event_ledger"
    if table == "bridge_webhook_events":
        lifecycle_fields = {"processing_status", "processed_at", "queued_at", "attempts", "last_error"}
        attribution_fields = {"target_entity_type", "target_entity_id", "pending_event_id"}
        ledger_fields = {"event_id", "event_type", "signature_ok", "payload", "payload_hash", "received_at"}
        if fields_set & lifecycle_fields:
            return "lifecycle"
        if fields_set and fields_set <= attribution_fields:
            return "attribution"
        if fields_set & ledger_fields:
            return "event_ledger"
        return "observability"
    return "unclassified"


def compile_rules(matrix: dict):
    rules = []
    for r in matrix.get("rules", []):
        rules.append({
            "id": r["id"],
            "path_re": re.compile(r["path_regex"]),
            "table": str(r["table"]).lower(),
            "ops": {str(x).lower() for x in r.get("ops", [])},
            "classification": r.get("classification", ""),
        })
    return rules


def matches_rule(hit: WriteHit, rule: dict) -> bool:
    if not rule["path_re"].search(hit.path):
        return False
    if hit.table != rule["table"]:
        return False
    if hit.op not in rule["ops"]:
        return False
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", choices=["A", "B", "C"], default="A")
    ap.add_argument("--runtime-only", action="store_true", help="Scan supabase/functions only")
    args = ap.parse_args()

    matrix = load_matrix()
    rules = compile_rules(matrix)
    block_tables = {t.lower() for t in matrix.get("runtime_phase_c_block_tables", [])}
    bwe_allowed_runtime_columns = {
        str(c).lower() for c in matrix.get("bridge_webhook_events_runtime_direct_allowed_columns", [])
    }
    bwe_forbidden_runtime_columns = {
        str(c).lower() for c in matrix.get("bridge_webhook_events_runtime_forbidden_columns", [])
    }

    ts_paths = sorted((ROOT / "supabase/functions").rglob("*.ts"))
    hits = scan_ts(ts_paths)

    if not args.runtime_only:
        sql_paths = sorted((ROOT / "supabase/migrations").rglob("*.sql"))
        hits.extend(scan_sql(sql_paths))

    unmatched: list[WriteHit] = []
    matched = 0
    for h in hits:
        if any(matches_rule(h, r) for r in rules):
            matched += 1
        else:
            unmatched.append(h)

    phase_c_violations: list[WriteHit] = []
    phase_c_column_allowlist_violations: list[tuple[WriteHit, str]] = []
    phase_c_counts: dict[str, int] = {t: 0 for t in block_tables}
    phase_c_category_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    if args.phase == "C":
        for h in hits:
            if h.source_kind == "ts" and h.table in block_tables:
                phase_c_category_counts[h.table][h.category] += 1
                phase_c_counts[h.table] = phase_c_counts.get(h.table, 0) + 1
                # Phase C blocks only on lifecycle mutations.
                if h.category == "lifecycle":
                    phase_c_violations.append(h)
                if h.table == "bridge_webhook_events" and h.op in {"update", "upsert", "insert"}:
                    fields = {f.lower() for f in (h.fields or [])}
                    if not fields:
                        phase_c_column_allowlist_violations.append((h, "unknown_fields"))
                        continue
                    forbidden = sorted(fields & bwe_forbidden_runtime_columns)
                    if forbidden:
                        phase_c_column_allowlist_violations.append((h, f"forbidden_columns={','.join(forbidden)}"))
                        continue
                    disallowed = sorted(fields - bwe_allowed_runtime_columns)
                    if disallowed:
                        phase_c_column_allowlist_violations.append((h, f"disallowed_columns={','.join(disallowed)}"))

    print("verify_lifecycle_write_path_exhaustiveness:")
    print(f"  scanned_hits={len(hits)} matched={matched} unmatched={len(unmatched)} phase={args.phase}")
    if args.phase == "C":
        # Hard objective counters for rollout sign-off.
        print("  phase_c_direct_write_counts:")
        for t in sorted(block_tables):
            print(f"    - {t}={phase_c_counts.get(t, 0)}")
        if "bridge_webhook_events" in phase_c_category_counts:
            cats = phase_c_category_counts["bridge_webhook_events"]
            print("  bridge_webhook_events_category_breakdown:")
            for c in ("lifecycle", "attribution", "event_ledger", "observability", "unclassified"):
                print(f"    - {c}={cats.get(c, 0)}")

    if unmatched:
        print("\nUnmatched write paths (must be classified in lifecycle_write_matrix.json):")
        for h in unmatched[:200]:
            print(f"  - {h.path}:{h.line} table={h.table} op={h.op} source={h.source_kind}")

    if phase_c_violations:
        grouped: dict[str, list[WriteHit]] = defaultdict(list)
        for h in phase_c_violations:
            grouped[h.table].append(h)
        print("\nPhase C violations (runtime lifecycle writes must be zero):")
        for table in sorted(grouped.keys()):
            hits = grouped[table]
            print(f"  {table}={len(hits)}")
            for h in hits[:200]:
                fields = ",".join(h.fields or [])
                print(f"    - {h.path}:{h.line} op={h.op} category={h.category} fields=[{fields}]")

    if phase_c_column_allowlist_violations:
        print("\nPhase C violations (bridge_webhook_events direct runtime column allowlist):")
        for h, reason in phase_c_column_allowlist_violations[:200]:
            fields = ",".join(h.fields or [])
            print(f"  - {h.path}:{h.line} op={h.op} fields=[{fields}] reason={reason}")

    if unmatched or phase_c_violations or phase_c_column_allowlist_violations:
        return 1

    print("\nPASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
