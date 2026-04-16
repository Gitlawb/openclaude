#!/usr/bin/env python3
"""
Find remaining USER-FACING "Claude" occurrences in .ts/.tsx files.
Only looks at string literals (quotes, backticks) — skips identifiers,
function names, type names, imports, etc.
"""

import os
import re
import sys

BASE = r"C:\Users\User\Documents\Project\GitHub\openclaude"

SKIP_FILES = {
    os.path.normcase(os.path.join(BASE, p))
    for p in [
        r"src\constants\prompts.ts",
        r"src\constants\promptIdentity.ts",
        r"src\constants\promptIdentity.test.ts",
        r"src\utils\undercover.ts",
        r"src\tools\BashTool\prompt.ts",
        r"src\tools\AgentTool\prompt.ts",
        r"src\tools\ScheduleCronTool\prompt.ts",
        r"src\tools\RemoteTriggerTool\prompt.ts",
        r"src\tools\ConfigTool\prompt.ts",
        r"src\tools\FileReadTool\prompt.ts",
        r"src\commands\init.ts",
        r"src\commands\init-verifiers.ts",
    ]
}

SKIP_DIRS = {"node_modules", "dist", r"src\tools\AgentTool\built-in"}

# Protected product names (keep as-is)
PROTECTED_PATTERNS = [
    re.compile(r'\bClaude\s+(3|3\.5|3\.7|Sonnet|Haiku|Opus)\b'),
    re.compile(r'\bClaude\s+(Sonnet|Haiku|Opus)\s+\d'),
    re.compile(r'\bClaude\s+Desktop\b'),
    re.compile(r'\bClaude\s+GitHub\s+App\b'),
    re.compile(r'\bClaude\s+PR\s+Assistant\b'),
    re.compile(r'\bNative\s+Claude\s+API\b'),
    re.compile(r'https?://[^\s"\']*claude\.(ai|app)', re.IGNORECASE),
]

COMMENT_RE = re.compile(r'^\s*(/\*|\*|//)')

# String literal patterns: match content inside quotes/backticks that contains "Claude"
# We want to find Claude appearing INSIDE string values
STRING_WITH_CLAUDE = re.compile(
    r'''(?:'([^']*)'|("([^"]*)")|`([^`]*)`)'''
)


def should_skip_dir(dirpath):
    norm = os.path.normcase(dirpath)
    for s in SKIP_DIRS:
        full = os.path.normcase(os.path.join(BASE, s))
        if norm == full or norm.startswith(full + os.sep):
            return True
    return False


def should_skip_file(fpath):
    return os.path.normcase(fpath) in SKIP_FILES


def has_protected(text):
    return any(p.search(text) for p in PROTECTED_PATTERNS)


def is_ui_string(line):
    """Check if 'Claude' appears inside a user-facing string context.
    This looks for string literals that contain Claude and are likely
    shown to users (JSX text, description fields, error messages, etc.)
    """
    # Skip pure code identifier lines (no quotes around Claude)
    # Look for Claude inside string delimiters
    strings = STRING_WITH_CLAUDE.findall(line)
    for match in strings:
        # match is a tuple: groups 1, 2+3, or 4
        content = match[0] or match[2] or match[3]
        if 'Claude' in content and not has_protected(content):
            # This Claude occurrence is inside a string literal
            return True, content
    return False, None


def collect_files(base):
    results = []
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if not should_skip_dir(os.path.join(root, d))]
        for fname in files:
            if fname.endswith('.ts') or fname.endswith('.tsx'):
                fpath = os.path.join(root, fname)
                if not should_skip_file(fpath):
                    results.append(fpath)
    return results


def main():
    files = collect_files(BASE)
    print(f"Scanning {len(files)} TypeScript files for UI strings...\n")

    findings = []
    for fpath in sorted(files):
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                lines = f.readlines()
        except Exception:
            continue

        for lineno, line in enumerate(lines, 1):
            stripped = line.rstrip('\n')
            if COMMENT_RE.match(stripped):
                continue
            if 'Claude' not in stripped:
                continue

            is_ui, content = is_ui_string(stripped)
            if is_ui:
                rel = os.path.relpath(fpath, BASE)
                findings.append((rel, lineno, content, stripped.strip()))

    if findings:
        print(f"Found {len(findings)} UI string(s) with 'Claude':\n")
        for rel, lineno, content, full_line in findings:
            print(f"  {rel}:{lineno}")
            print(f"    STRING: '{content}'")
            print()
    else:
        print("No user-facing 'Claude' strings found. Clean!")


if __name__ == '__main__':
    main()
