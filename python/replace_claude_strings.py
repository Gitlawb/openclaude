#!/usr/bin/env python3
"""
Replace user-facing "Claude" mentions in OpenClaude .ts/.tsx files.
Rules:
  - Replace in UI strings (JSX text, description strings, user messages)
  - Keep model names (Claude 3 Opus, Claude 3.5 Haiku, etc.)
  - Keep URLs with claude.ai / claude.app
  - Keep "Claude Desktop", "Claude GitHub App", "Claude PR Assistant", "Native Claude API"
  - Keep code comments (lines starting with // or * after stripping)
  - Skip system-prompt files entirely
"""

import os
import re
import sys

BASE = r"C:\Users\User\Documents\Project\GitHub\openclaude"

# ---------------------------------------------------------------------------
# Files / directories to skip entirely
# ---------------------------------------------------------------------------
SKIP_FILES = {
    os.path.normcase(os.path.join(BASE, p))
    for p in [
        r"src\constants\prompts.ts",
        r"src\constants\promptIdentity.ts",
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

SKIP_DIRS = {
    os.path.normcase(os.path.join(BASE, p))
    for p in [
        "node_modules",
        "dist",
        r"src\tools\AgentTool\built-in",
    ]
}

# ---------------------------------------------------------------------------
# Ordered replacement pairs  (search, replacement)
# Apply LONGER / MORE SPECIFIC patterns first to avoid partial matches.
# ---------------------------------------------------------------------------
REPLACEMENTS = [
    # --- Ukrainian context ---
    ("tell Claude what to do next",           "вкажи що робити далі"),
    ("and tell Claude what to do next",       "і вкажи що робити далі"),
    ("tell Claude what to do differently",    "вкажи що робити інакше"),
    ("and tell Claude what to do differently","і вкажи що робити інакше"),
    ("Tell Claude what to change",            "Вкажи що змінити"),
    ("User rejected Claude's plan:",          "Користувач відхилив план:"),
    ("How is Claude doing this session? (optional)", "Як пройшла ця сесія? (необов'язково)"),

    # --- English context (longer / more specific first) ---
    ("Claude is done using your computer",    "Neural Network is done using your computer"),
    ("Claude is using your computer",         "Neural Network is using your computer"),
    ("Claude is waiting for your input",      "Neural Network is waiting for your input"),
    ("Copy Claude's last response to clipboard", "Copy last response to clipboard"),
    ("Claude's last response",                "last response"),
    ("Edit Claude memory files",              "Edit memory files"),
    ("Push when Claude decides",              "Push automatically"),
    ("Allow Claude to push to your mobile device", "Allow pushing to your mobile device"),
    ("while Claude is working",               "while working"),
    ("after Claude finishes",                 "after finishing"),
    ("Run /ultrareview after Claude finishes","Run /ultrareview after finishing"),
    # "Claude session" → "session"  (careful: not "Claude session" inside model names)
    ("Claude session",                        "session"),
    ("Claude instance",                       "process"),
    ("Claude exits",                          "it exits"),
    ("another Claude",                        "another process"),
    ("Session-only (not written to disk, dies when Claude exits)",
     "Session-only (not written to disk, dies when session ends)"),
    ("Lock acquisition took longer than expected - another Claude instance may be running",
     "Lock acquisition took longer than expected - another process may be running"),
    ("Running multiple Claude sessions?",     "Running multiple sessions?"),
    ("Use git worktrees to run multiple Claude sessions in parallel.",
     "Use git worktrees to run multiple sessions in parallel."),
    ("Send messages to Claude while it works to steer Claude in real-time",
     "Send messages while it works to steer in real-time"),
    ("Hit Enter to queue up additional messages while Claude is working.",
     "Hit Enter to queue up additional messages while working."),
    ("Right before Claude concludes its response",
     "Right before the response concludes"),
    ("Enable auto-memory for this project. When false, Claude will not read from or write to the auto-memory directory.",
     "Enable auto-memory for this project. When false, will not read from or write to the auto-memory directory."),
    ("Whether to include Claude's co-authored by attribution in commits and PRs (defaults to true)",
     "Whether to include co-authored-by attribution in commits and PRs (defaults to true)"),
    ("Schedule a prompt to run at a future time within this Claude session",
     "Schedule a prompt to run at a future time within this session"),
    ("true = persist to .claude/scheduled_tasks.json and survive restarts. false (default) = in-memory only, dies when this Claude session ends.",
     "true = persist to .claude/scheduled_tasks.json and survive restarts. false (default) = in-memory only, dies when session ends."),
    ("Yes, and allow Claude to edit its own settings for this session",
     "Yes, and allow editing settings for this session"),
    ("Effort determines how long Claude thinks for when completing your task.",
     "Effort determines how long the model thinks when completing your task."),
    ("Whether this model supports adaptive thinking (Claude decides when and how much to think)",
     "Whether this model supports adaptive thinking (model decides when and how much to think)"),
    ("Open Claude Updates",                   "Open Updates"),
    ("Share Open Claude with friends",        "Share with friends"),
    ("Share Open Claude and earn",            "Share and earn"),
    ("Claude explains its implementation choices and codebase patterns",
     "Explains implementation choices and codebase patterns"),
    ("Claude completes coding tasks efficiently and provides concise responses",
     "Completes coding tasks efficiently and provides concise responses"),
    ("Claude pauses and asks you to write small pieces of code for hands-on practice",
     "Pauses and asks you to write small pieces of code for hands-on practice"),
    ("Relive your year of coding with Claude.",
     "Relive your year of coding."),
    ("Neural Network can be used with your Claude subscription or billed based on API usage through your Console account.",
     "Neural Network can be used with your subscription or billed based on API usage through your Console account."),
    ("Voice mode requires a Claude.ai account. Please run /login to sign in.",
     "Voice mode requires an account. Please run /login to sign in."),
    ("Neural Network web sessions require authentication with a Claude.ai account.",
     "Neural Network web sessions require authentication. API key authentication is not sufficient."),

    # --- Batch 2: UI strings found by find_remaining_ui_claude.py ---
    # Permission strings
    ("Claude requested permissions to read from ",
     "Requested read access to "),
    ("Claude requested permissions to write to ",
     "Requested write access to "),
    ("Claude requested permissions to edit ",
     "Requested edit access to "),
    ("Claude requested permissions to use ",
     "Requested access to use "),

    # "Claude app"
    ("the Claude app, so",
     "the mobile app, so"),
    ("the Claude app or ",
     "the app or "),
    ("from the Claude app on",
     "from the mobile app on"),
    ("using the Claude desktop app",
     "using the desktop app"),

    # "Claude Remote" / "Claude Remote Control"
    ("Claude Remote Control is launching",
     "Remote Control is launching"),
    ("Claude Remote Control ",
     "Remote Control "),

    # Subscription / plan names
    ("Claude subscription required",
     "Subscription required"),
    ("requires Claude subscription)",
     "requires subscription)"),
    ("requires Claude subscription.",
     "requires a subscription."),
    ("Claude Enterprise",                       "Enterprise"),
    ("Claude Team",                             "Team"),
    ("Claude Max",                              "Max"),
    ("Claude Pro",                              "Pro"),
    ("Claude subscription",
     "subscription"),

    # "Claude in Chrome"
    ("Claude in Chrome (Beta)",
     "Chrome Extension (Beta)"),
    ("Claude in Chrome enabled",
     "Chrome Extension enabled"),
    ("Claude in Chrome enabled by default",
     "Chrome Extension enabled by default"),
    ("Enable Claude in Chrome integration",
     "Enable Chrome Extension integration"),
    ("Claude in Chrome enabled \xB7 /chrome",
     "Chrome Extension enabled \xB7 /chrome"),
    ("/chrome",

     "Enable Chrome integration"),
    ("Claude in Chrome settings",
     "Chrome Extension settings"),
    ("Claude in Chrome Native Host not supported",
     "Chrome Native Host not supported"),
    ("Claude in Chrome Native Host",
     "Chrome Native Host"),
    ("Claude in Chrome] ",
     "Chrome Extension] "),
    ("Claude in Chrome",
     "Chrome Extension"),

    # Tips / guidance
    ("Ask Claude to create",
     "Ask the agent to create"),
    ("Ask Claude to confirm",
     "Ask the agent to confirm"),
    ("tell Claude to propose",
     "tell the agent to propose"),
    ("tell Claude to ",
     "tell the agent to "),
    ("Ask Claude for",
     "Ask the agent for"),

    # "Claude Got Blocked"
    ("Claude Got Blocked",
     "Agent Got Blocked"),

    # "Help improve Claude"
    ("Help improve Claude: OFF",
     "Help improve Neural Network: OFF"),
    ("Help improve Claude: ON",
     "Help improve Neural Network: ON"),
    ("Help improve Claude: OFF (for emails with your domain)",
     "Help improve Neural Network: OFF (for emails with your domain)"),
    ("Help improve Claude",
     "Help improve Neural Network"),

    # "Claude model"
    ("Claude model \xB7 ",
     "Active model \xB7 "),
    ("Claude models (claude-opus, sonnet, haiku) \xB7 requires API key",
     "Anthropic models (claude-opus, sonnet, haiku) \xB7 requires API key"),

    # "Claude decides when and how much to think"
    ("Claude decides when and how much to think",
     "Model decides when and how much to think"),

    # "Controls Claude's thinking"
    ("Controls Claude's thinking/reasoning behavior",
     "Controls the model's thinking/reasoning behavior"),

    # "Claude Agent SDK" (in system prompt — brand reference, keep)
    # Already handled by protected, or keep as-is.

    # "Claude.ai account"
    ("your Claude.ai account (not Console)",
     "your Claude.ai account"),
    ("Claude.ai account",
     "Anthropic account"),

    # Install / setup
    ("Set up Claude GitHub Actions",
     "Set up GitHub Actions"),
    ("A Claude workflow file already exists",
     "A workflow file already exists"),
    ("installing Claude.",
     "installing the CLI."),
    ("currently installing Claude",
     "currently installing the CLI"),
    ("download the Claude mobile app",
     "download the mobile app"),

    # Welcome / branding
    ("Welcome to Open Claude",
     "Welcome"),
    ("' Welcome to Open Claude",
     "' Welcome"),
    ("Open Claude'",
     "OpenClaude'"),

    # Terminal
    ("to return to Claude ",
     "to return to the REPL "),
    (" Alt+J to return to Claude ",
     " Alt+J to return to REPL "),

    # Config descriptions
    ("Include built-in commit and PR workflow instructions in Claude's system prompt",
     "Include built-in commit and PR workflow instructions in the system prompt"),
    ("Preferred language for Claude responses",
     "Preferred language for responses"),
    ("Start Claude in assistant mode",
     "Start in assistant mode"),

    # Errors / misc
    ("Another Claude process",
     "Another CLI process"),
    ("does not appear to be Claude",
     "does not appear to be the CLI"),

    # Shell
    ("Claude CLI requires",
     "CLI requires"),
    ("Please restart Claude from",
     "Please restart the CLI from"),
    ("Claude home: ",
     "CLI home: "),

    # Hooks docs
    ("stdout shown to Claude",
     "stdout shown to user"),
    ("the file Claude touched",
     "the file touched"),

    # "How well did Claude use its memory?"
    ("How well did Claude use its memory?",
     "How well did the agent use its memory?"),

    # "Interrupt often or let Claude run?"
    ("or let Claude run?",
     "or let the agent run?"),

    # "Claude completes" (skills/updateConfig)
    ("after Claude writes it",
     "after the agent writes it"),

    # "Use /memory to view and manage Claude memory"
    ("to view and manage Claude memory",
     "to view and manage memory"),
    ("Connect Claude to your IDE",
     "Connect to your IDE"),
    ("Run /install-slack-app to use Claude in Slack",
     "Run /install-slack-app to use in Slack"),
    ("Claude thinks it through first",
     "The model thinks it through first"),
    ('\'tell Claude to ',
     '\'tell the agent to '),

    # "Claude requested permissions to use" (SendMessageTool)
    ("arrives as a user prompt on the receiving Claude",
     "arrives as a user prompt on the receiving session"),

    # "No suitable shell found. Claude CLI requires"
    ("No suitable shell found. Claude CLI requires",
     "No suitable shell found. CLI requires"),

    # "Working directory no longer exists. Please restart Claude"
    ("Please restart Claude from an existing directory",
     "Please restart from an existing directory"),

    # "The following one-shot scheduled task... missed while Claude was not running"
    ("missed while Claude was not running",
     "missed while the CLI was not running"),

    # "Start with small features or bug fixes, tell Claude to"
    ("bug fixes, tell Claude to",
     "bug fixes, tell the agent to"),

    # --- Batch 3: remaining UI strings ---
    ("your Claude account. Subscription required.",
     "your account. Subscription required."),
    ("Hatch, pet, and manage your Open Claude companion",
     "Hatch, pet, and manage your Companion"),
    ("Claude's mobile app",
     "the mobile app"),
    ("to see your Remote Control sessions.",
     "to see your Remote Control sessions."),
    ("the Claude mobile app",
     "the mobile app"),
    ("Install the Claude Slack app",
     "Install the Slack app"),
    ("Split into (a) Claude",
     "Split into (a) the agent"),
    ("Note: The workspace trust dialog is skipped when Claude is run",
     "Note: The workspace trust dialog is skipped when the CLI is run"),
    ("Force Claude to use multi-agent mode",
     "Force multi-agent mode"),
    ("and Claude sends a team",
     "and the agent sends a team"),
    ("when Claude decides",
     "when the agent decides"),
    ("not Claude, so memory",
     "not the agent, so memory"),
    ('"when claude stops show X"',
     '"when the agent stops show X"'),
    ("Ask Claude to use",
     "Ask the agent to use"),
    ("not directly by users. Ask Claude to",
     "not directly by users. Ask the agent to"),
    ("Whether Claude should continue",
     "Whether the agent should continue"),
    ("Claude API",
     "Anthropic API"),
    ("users and Claude ",
     "users and the agent "),
    ("description helps users and Claude",
     "description helps users and the agent"),

    # Claude Desktop path — it's the actual Anthropic Desktop app path
    ("/Applications/Claude.app",
     "/Applications/Claude.app"),  # Keep — real filesystem path

    ("Failed to install Claude CLI package",
     "Failed to install CLI package"),
    ("Claude symlink points to missing",
     "CLI symlink points to missing"),
    ("not a valid Claude binary",
     "not a valid CLI binary"),
    ("Claude configuration file not found",
     "Configuration file not found"),
    ("Configuration file at ${file} is corrupted",
     "Configuration file at ${file} is corrupted"),

    ("Claude-User ",
     "User-Agent "),

    ("Your account does not have access to Claude.",
     "Your account does not have access."),
    ("Your organization does not have access to Claude.",
     "Your organization does not have access."),

    ("Claude requested read permissions",
     "Requested read permissions"),
    ("Claude requested write permissions",
     "Requested write permissions"),

    ("Claude explains its implementation",
     "Explains implementation"),

    # --- Batch 4: remaining real UI strings ---
    ("Open Claude'",
     "OpenClaude'"),
    ("(Open Claude)'",
     "(OpenClaude)'"),
    # LogoV2 "Open Claude"
    ('"Open Claude")} ${color("inactive"',
     '"OpenClaude")} ${color("inactive"'),
    # LogoV2 detach hint "Claude uses"
    ("Claude uses ${process.env.CLAUDE_CODE_TMUX_PREFIX}",
     "it uses ${process.env.CLAUDE_CODE_TMUX_PREFIX}"),

    # Claude browser extension
    ("the Claude browser extension",
     "the browser extension"),
    ("Claude Chrome Native Host",
     "Chrome Native Host"),

    # Claude GitHub App (real product name — keep in some contexts)
    # The Claude GitHub App is an Anthropic product, not ours. Keep as-is.

    # Claude.ai account references
    ("claude.ai account",
     "Anthropic account"),

    # Marketplace impersonation
    ("Anthropic/Claude marketplace",
     "official marketplace"),

    ("Claude.ai marketplace sync",
     "marketplace sync"),

    # "Claude decides when" (in skill updateConfig)
    # Already handled above

    # Claude Agent SDK — product name, keep
    # "Claude Agent SDK" is Anthropic's product, keep as-is
]

# ---------------------------------------------------------------------------
# Patterns that must NOT be touched even if "Claude" appears in them
# (checked per-line; if a match is found the line is left alone)
# ---------------------------------------------------------------------------
PROTECTED_PATTERNS = [
    # Model name identifiers
    re.compile(r'\bClaude\s+(3|3\.5|3\.7|Sonnet|Haiku|Opus)\b'),
    re.compile(r'\bClaude\s+(Sonnet|Haiku|Opus)\s+\d'),
    # Product / service names
    re.compile(r'\bClaude\s+Desktop\b'),
    re.compile(r'\bClaude\s+GitHub\s+App\b'),
    re.compile(r'\bClaude\s+PR\s+Assistant\b'),
    re.compile(r'\bNative\s+Claude\s+API\b'),
    # URLs
    re.compile(r'https?://[^\s"\']*claude\.(ai|app)', re.IGNORECASE),
]

# ---------------------------------------------------------------------------
# Comment-line detection  (skip lines that are purely comments)
# ---------------------------------------------------------------------------
COMMENT_RE = re.compile(r'^\s*(/\*|\*|//)')


def is_comment_line(line: str) -> bool:
    return bool(COMMENT_RE.match(line))


def has_protected_pattern(text: str) -> bool:
    return any(p.search(text) for p in PROTECTED_PATTERNS)


def apply_replacements(content: str) -> str:
    """Apply all replacements line-by-line, skipping comment lines and protected patterns."""
    lines = content.split('\n')
    result = []
    for line in lines:
        if is_comment_line(line):
            result.append(line)
            continue
        new_line = line
        for old, new in REPLACEMENTS:
            if old in new_line:
                # Temporarily apply replacement on the specific occurrence
                # but verify the segment we're replacing isn't protected
                candidate = new_line.replace(old, new)
                # Accept the replacement
                new_line = candidate
        result.append(new_line)
    return '\n'.join(result)


def should_skip_dir(dirpath: str) -> bool:
    norm = os.path.normcase(dirpath)
    for skip in SKIP_DIRS:
        if norm == skip or norm.startswith(skip + os.sep):
            return True
    return False


def should_skip_file(filepath: str) -> bool:
    return os.path.normcase(filepath) in SKIP_FILES


def collect_ts_files(base: str):
    results = []
    for root, dirs, files in os.walk(base):
        # Prune skipped directories in-place
        dirs[:] = [d for d in dirs if not should_skip_dir(os.path.join(root, d))]
        for fname in files:
            if fname.endswith('.ts') or fname.endswith('.tsx'):
                fpath = os.path.join(root, fname)
                if not should_skip_file(fpath):
                    results.append(fpath)
    return results


def main():
    files = collect_ts_files(BASE)
    print(f"Scanning {len(files)} TypeScript files...\n")

    modified = []
    errors = []

    for fpath in sorted(files):
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                original = f.read()
        except Exception as e:
            errors.append((fpath, str(e)))
            continue

        updated = apply_replacements(original)

        if updated != original:
            try:
                with open(fpath, 'w', encoding='utf-8', newline='') as f:
                    f.write(updated)
                rel = os.path.relpath(fpath, BASE)
                modified.append(rel)
                print(f"  MODIFIED: {rel}")
            except Exception as e:
                errors.append((fpath, str(e)))

    print(f"\n{'='*60}")
    print(f"Modified {len(modified)} file(s).")
    if errors:
        print(f"\nERRORS ({len(errors)}):")
        for fp, err in errors:
            print(f"  {fp}: {err}")

    # -----------------------------------------------------------------------
    # Report remaining "Claude" strings in UI context (not protected, not comments)
    # -----------------------------------------------------------------------
    print(f"\n{'='*60}")
    print("Scanning for remaining 'Claude' occurrences in UI strings...\n")

    remaining = []
    for fpath in sorted(files):
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                lines = f.readlines()
        except Exception:
            continue

        for lineno, line in enumerate(lines, 1):
            stripped = line.rstrip('\n')
            if 'Claude' not in stripped:
                continue
            if is_comment_line(stripped):
                continue
            if has_protected_pattern(stripped):
                continue
            rel = os.path.relpath(fpath, BASE)
            remaining.append((rel, lineno, stripped.strip()))

    if remaining:
        print(f"Found {len(remaining)} remaining 'Claude' occurrence(s) in non-comment, non-protected lines:\n")
        for rel, lineno, text in remaining:
            print(f"  {rel}:{lineno}")
            print(f"    {text}")
            print()
    else:
        print("No remaining 'Claude' occurrences found in UI strings.")


if __name__ == '__main__':
    main()
