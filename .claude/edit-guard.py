#!/usr/bin/env python3
"""
Block Claude from editing files/folders listed in .claude/edit-blocklist.
One pattern per line. Lines starting with # are comments.
Supports:
  - Exact relative paths:  docs/GAME_SPEC.md
  - Folder prefix:         docs/
  - Glob patterns:         *.lock, src/generated/**
"""
import json, sys, fnmatch, os
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.resolve()
BLOCKLIST_FILE = Path(__file__).parent / "edit-blocklist"

def load_blocklist():
    if not BLOCKLIST_FILE.exists():
        return []
    lines = BLOCKLIST_FILE.read_text().splitlines()
    return [l.strip() for l in lines if l.strip() and not l.startswith("#")]

def is_blocked(file_path: str, patterns: list[str]) -> str | None:
    try:
        rel = str(Path(file_path).resolve().relative_to(REPO_ROOT))
    except ValueError:
        rel = file_path

    for pat in patterns:
        # Folder prefix: "docs/" blocks anything under docs/
        if pat.endswith("/"):
            if rel.startswith(pat) or rel == pat.rstrip("/"):
                return pat
        # Glob match against full relative path
        if fnmatch.fnmatch(rel, pat):
            return pat
        # Glob match against basename only (e.g. "*.lock" matches "package-lock.json")
        if fnmatch.fnmatch(os.path.basename(rel), pat):
            return pat
        # Exact suffix match (e.g. "GAME_SPEC.md" matches "docs/GAME_SPEC.md")
        if rel == pat or rel.endswith("/" + pat):
            return pat
    return None

def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # can't parse — don't block

    tool_input = data.get("tool_input", {})
    # Edit, Write, MultiEdit all have file_path; MultiEdit also has edits[].file_path
    paths = []
    if "file_path" in tool_input:
        paths.append(tool_input["file_path"])
    if "edits" in tool_input:
        for e in tool_input["edits"]:
            if "file_path" in e:
                paths.append(e["file_path"])

    if not paths:
        sys.exit(0)

    patterns = load_blocklist()
    if not patterns:
        sys.exit(0)

    for p in paths:
        matched = is_blocked(p, patterns)
        if matched:
            print(f"BLOCKED by edit-guard: '{p}' matches pattern '{matched}'", file=sys.stderr)
            sys.exit(2)

    sys.exit(0)

if __name__ == "__main__":
    main()
