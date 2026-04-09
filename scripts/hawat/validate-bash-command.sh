#!/bin/bash
#
# validate-bash-command.sh
#
# PreToolUse hook for Bash commands
# Validates commands against security rules before execution
#
# Exit codes:
#   0 - Command allowed
#   1 - Command blocked
#   2 - Error in validation

set -euo pipefail

# Get the command from environment or argument
COMMAND="${1:-${TOOL_INPUT:-}}"

if [ -z "$COMMAND" ]; then
    printf 'No command provided\n'
    exit 2
fi

# ============================================================================
# Command Normalization
# Decode various obfuscation techniques to detect hidden dangerous commands
# ============================================================================

normalize_command() {
    local cmd="$1"

    decode_escapes() {
        local input="$1"
        printf '%b' "$input"
    }

    # 1. URL decode (%XX hex sequences)
    # Handles patterns like %72m -> rm, %2F -> /
    cmd=$(printf '%s' "$cmd" | sed 's/%\([0-9A-Fa-f][0-9A-Fa-f]\)/\\x\1/g')
    cmd=$(decode_escapes "$cmd")

    # 2. Normalize control characters: convert newlines/tabs to spaces, remove others
    cmd=$(printf '%s' "$cmd" | tr '\r\n\t' '   ')
    cmd=$(printf '%s' "$cmd" | tr -d '\000-\010\013\014\016-\037\177')

    # 3. Collapse multiple spaces/tabs to single space
    cmd=$(printf '%s' "$cmd" | tr -s '[:space:]' ' ')

    # 4. Remove backslash continuations (\ at end of segments)
    cmd=$(printf '%s' "$cmd" | sed 's/\\[[:space:]]*$//g; s/\\[[:space:]]\+/ /g')

    # 4a. Remove mid-word backslashes used to obfuscate commands (e.g., r\m -> rm)
    cmd=$(printf '%s' "$cmd" | sed 's/\\//g')

    # 5. Decode common hex escapes (\xNN)
    cmd=$(printf '%s' "$cmd" | sed 's/\\x\([0-9A-Fa-f][0-9A-Fa-f]\)/\\x\1/g')
    cmd=$(decode_escapes "$cmd")

    # 6. Decode octal escapes (\NNN)
    cmd=$(printf '%s' "$cmd" | sed 's/\\\([0-7][0-7][0-7]\)/\\0\1/g')
    cmd=$(decode_escapes "$cmd")

    # 7. Remove single quotes used to break up commands (e.g., r'm' -> rm)
    # This handles obfuscation like: r'm' -rf / or 'r''m' -rf /
    cmd=$(printf '%s' "$cmd" | sed "s/'\([^']*\)'/\1/g")

    # 8. Remove double quotes used to break up commands
    cmd=$(printf '%s' "$cmd" | sed 's/"\([^"]*\)"/\1/g')

    # 9. Handle $'\xNN' bash quoting style
    cmd=$(printf '%s' "$cmd" | sed "s/\\\$'\\\\x\([0-9A-Fa-f][0-9A-Fa-f]\)'/\\\\x\1/g")
    cmd=$(decode_escapes "$cmd")

    printf '%s' "$cmd"
}

# Sanitize command by stripping shell metacharacters
sanitize_command() {
    local cmd="$1"
    cmd=$(printf '%s' "$cmd" | tr -d '`$;&|<>')
    cmd=$(printf '%s' "$cmd" | tr -s '[:space:]' ' ')
    printf '%s' "$cmd"
}

# Normalize the command for security checking
NORMALIZED_COMMAND=$(normalize_command "$COMMAND")
SANITIZED_COMMAND=$(sanitize_command "$NORMALIZED_COMMAND")

# Check if normalization revealed hidden content
if [ "$NORMALIZED_COMMAND" != "$COMMAND" ]; then
    # Log that obfuscation was detected (for debugging)
    : # Silent - we'll catch it in the pattern check
fi

# Blocked patterns (case-insensitive)
BLOCKED_SUBSTRINGS=(
    "rm -rf /"
    "rm -rf ~"
    "rm -rf \$HOME"
    "> /dev/sd"
    "mkfs"
    "dd if="
    ":(){:|:&};:"  # Fork bomb
    "chmod -R 777 /"
)

BLOCKED_REGEXES=(
    'curl[^|]*\|[[:space:]]*bash'
    'curl[^|]*\|[[:space:]]*sh'
    'wget[^|]*\|[[:space:]]*bash'
    'wget[^|]*\|[[:space:]]*sh'
    'eval[[:space:]]*\$\('
)

# Check against blocked patterns
# Check both original and normalized command
COMMAND_LOWER=$(printf '%s' "$COMMAND" | tr '[:upper:]' '[:lower:]')
NORMALIZED_LOWER=$(printf '%s' "$NORMALIZED_COMMAND" | tr '[:upper:]' '[:lower:]')
SANITIZED_LOWER=$(printf '%s' "$SANITIZED_COMMAND" | tr '[:upper:]' '[:lower:]')

for pattern in "${BLOCKED_SUBSTRINGS[@]}"; do
    pattern_lower=$(printf '%s' "$pattern" | tr '[:upper:]' '[:lower:]')

    # Check original command
    if [[ "$COMMAND_LOWER" == *"$pattern_lower"* ]]; then
        printf 'BLOCKED: Command matches dangerous pattern: %s\n' "$pattern"
        exit 1
    fi

    # Check normalized command (catches obfuscated attacks)
    if [[ "$NORMALIZED_LOWER" == *"$pattern_lower"* ]]; then
        printf 'BLOCKED: Command matches dangerous pattern: %s\n' "$pattern"
        exit 1
    fi

    # Check sanitized command (strips metacharacters)
    if [[ "$SANITIZED_LOWER" == *"$pattern_lower"* ]]; then
        printf 'BLOCKED: Command matches dangerous pattern: %s\n' "$pattern"
        exit 1
    fi
done

for regex in "${BLOCKED_REGEXES[@]}"; do
    if [[ "$COMMAND_LOWER" =~ $regex ]] || [[ "$NORMALIZED_LOWER" =~ $regex ]]; then
        printf 'BLOCKED: Command matches dangerous pattern: %s\n' "$regex"
        exit 1
    fi
done

# Warn about potentially risky commands (but allow)
WARN_PATTERNS=(
    "sudo"
    "chmod"
    "chown"
    "rm -rf"
    "git push --force"
    "git reset --hard"
)

for pattern in "${WARN_PATTERNS[@]}"; do
    pattern_lower=$(printf '%s' "$pattern" | tr '[:upper:]' '[:lower:]')
    if [[ "$COMMAND_LOWER" == *"$pattern_lower"* ]] || [[ "$NORMALIZED_LOWER" == *"$pattern_lower"* ]]; then
        printf 'WARNING: Command contains potentially risky operation: %s\n' "$pattern"
        # Don't block, just warn
    fi
done

# Command is allowed
exit 0
