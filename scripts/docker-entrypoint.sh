#!/bin/sh
set -e

CONFIG_DIR="${CLAUDE_CONFIG_DIR:-/home/node/.openclaude}"
LEGACY_CONFIG_FILE="${CLAUDE_LEGACY_CONFIG_FILE:-/home/node/.claude.json}"
mkdir -p "$CONFIG_DIR"
chown -R node:node "$CONFIG_DIR" 2>/dev/null || true

unset_empty_env() {
  name="$1"
  eval "value=\${$name-}"
  if [ -z "$value" ]; then
    unset "$name"
  fi
}

for env_name in \
  WEB_PROVIDER WEB_KEY WEB_SEARCH_API WEB_QUERY_PARAM WEB_METHOD WEB_PARAMS \
  WEB_URL_TEMPLATE WEB_BODY_TEMPLATE WEB_AUTH_HEADER WEB_AUTH_SCHEME WEB_HEADERS \
  WEB_JSON_PATH WEB_CUSTOM_TIMEOUT_SEC WEB_CUSTOM_MAX_BODY_KB \
  OPENAI_BASE_URL OPENAI_MODEL OPENAI_API_KEY ANTHROPIC_BASE_URL ANTHROPIC_MODEL \
  ANTHROPIC_API_KEY GEMINI_BASE_URL GEMINI_MODEL GEMINI_API_KEY GOOGLE_API_KEY \
  MISTRAL_BASE_URL MISTRAL_MODEL MISTRAL_API_KEY CODEX_API_KEY CHATGPT_ACCOUNT_ID \
  CODEX_ACCOUNT_ID; do
  unset_empty_env "$env_name"
done

normalize_provider_env() {
  provider="$(printf '%s' "${OPENCLAUDE_PROVIDER:-}" | tr '[:upper:]' '[:lower:]')"

  case "$provider" in
    openai|onlysq|ollama|lmstudio|lm-studio|openrouter|deepseek|groq|together|fireworks|nvidia-nim|minimax|atomic-chat)
      export CLAUDE_CODE_USE_OPENAI="${CLAUDE_CODE_USE_OPENAI:-1}"
      [ -n "${OPENCLAUDE_BASE_URL:-}" ] && [ -z "${OPENAI_BASE_URL:-}" ] && export OPENAI_BASE_URL="$OPENCLAUDE_BASE_URL"
      [ -n "${OPENCLAUDE_MODEL:-}" ] && [ -z "${OPENAI_MODEL:-}" ] && export OPENAI_MODEL="$OPENCLAUDE_MODEL"
      [ -n "${OPENCLAUDE_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ] && export OPENAI_API_KEY="$OPENCLAUDE_API_KEY"
      ;;
    gemini|google-gemini)
      export CLAUDE_CODE_USE_GEMINI="${CLAUDE_CODE_USE_GEMINI:-1}"
      [ -n "${OPENCLAUDE_BASE_URL:-}" ] && [ -z "${GEMINI_BASE_URL:-}" ] && export GEMINI_BASE_URL="$OPENCLAUDE_BASE_URL"
      [ -n "${OPENCLAUDE_MODEL:-}" ] && [ -z "${GEMINI_MODEL:-}" ] && export GEMINI_MODEL="$OPENCLAUDE_MODEL"
      [ -n "${OPENCLAUDE_API_KEY:-}" ] && [ -z "${GEMINI_API_KEY:-}" ] && export GEMINI_API_KEY="$OPENCLAUDE_API_KEY"
      ;;
    mistral)
      export CLAUDE_CODE_USE_MISTRAL="${CLAUDE_CODE_USE_MISTRAL:-1}"
      [ -n "${OPENCLAUDE_BASE_URL:-}" ] && [ -z "${MISTRAL_BASE_URL:-}" ] && export MISTRAL_BASE_URL="$OPENCLAUDE_BASE_URL"
      [ -n "${OPENCLAUDE_MODEL:-}" ] && [ -z "${MISTRAL_MODEL:-}" ] && export MISTRAL_MODEL="$OPENCLAUDE_MODEL"
      [ -n "${OPENCLAUDE_API_KEY:-}" ] && [ -z "${MISTRAL_API_KEY:-}" ] && export MISTRAL_API_KEY="$OPENCLAUDE_API_KEY"
      ;;
    anthropic|claude|firstparty|first-party)
      [ -n "${OPENCLAUDE_BASE_URL:-}" ] && [ -z "${ANTHROPIC_BASE_URL:-}" ] && export ANTHROPIC_BASE_URL="$OPENCLAUDE_BASE_URL"
      [ -n "${OPENCLAUDE_MODEL:-}" ] && [ -z "${ANTHROPIC_MODEL:-}" ] && export ANTHROPIC_MODEL="$OPENCLAUDE_MODEL"
      [ -n "${OPENCLAUDE_API_KEY:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ] && export ANTHROPIC_API_KEY="$OPENCLAUDE_API_KEY"
      ;;
    github|copilot|github-copilot)
      export CLAUDE_CODE_USE_GITHUB="${CLAUDE_CODE_USE_GITHUB:-1}"
      [ -n "${OPENCLAUDE_MODEL:-}" ] && [ -z "${OPENAI_MODEL:-}" ] && export OPENAI_MODEL="$OPENCLAUDE_MODEL"
      ;;
  esac
}

normalize_provider_env

export OPENCLAUDE_AGENT_GATEWAY_COMMAND="${OPENCLAUDE_AGENT_GATEWAY_COMMAND:-node /app/dist/cli.mjs}"

if [ ! -f "$LEGACY_CONFIG_FILE" ]; then
  latest_backup="$(ls -1t "$CONFIG_DIR"/backups/.claude.json.backup.* 2>/dev/null | head -n 1 || true)"
  if [ -f "$CONFIG_DIR/.claude.json" ]; then
    cp "$CONFIG_DIR/.claude.json" "$LEGACY_CONFIG_FILE"
  elif [ -n "$latest_backup" ] && [ -f "$latest_backup" ]; then
    cp "$latest_backup" "$LEGACY_CONFIG_FILE"
  else
    printf '{}\n' > "$LEGACY_CONFIG_FILE"
  fi
  chmod 600 "$LEGACY_CONFIG_FILE" 2>/dev/null || true
  chown node:node "$LEGACY_CONFIG_FILE" 2>/dev/null || true
fi

if [ "$(id -u)" = "0" ]; then
  exec gosu node node /app/dist/cli.mjs "$@"
fi

exec node /app/dist/cli.mjs "$@"
