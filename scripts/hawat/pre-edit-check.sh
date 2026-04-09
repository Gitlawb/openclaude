#!/bin/bash
# pre-edit-check.sh
# Validates files before editing
# Exit 1 to block, Exit 0 to allow
#
# Arguments:
#   $1 - File path (optional, falls back to TOOL_INPUT env var)

set -euo pipefail

# Accept $1 argument or fall back to TOOL_INPUT env var
FILE="${1:-${TOOL_INPUT:-}}"

# If no file provided, allow
if [[ -z "$FILE" ]]; then
  exit 0
fi

# Convert to lowercase for case-insensitive matching
FILE_LOWER=$(echo "$FILE" | tr '[:upper:]' '[:lower:]')

# === BLOCKED FILES ===

# Environment files with secrets (case-insensitive)
if [[ "$FILE_LOWER" =~ \.env$ ]] || \
   [[ "$FILE_LOWER" =~ \.env\. ]] || \
   [[ "$FILE_LOWER" =~ /\.env$ ]] || \
   [[ "$FILE_LOWER" =~ \.envrc$ ]]; then
  echo "BLOCKED: Cannot edit .env/.envrc files - may contain secrets"
  exit 1
fi

# Secrets directories
if [[ "$FILE" =~ /secrets/ ]] || \
   [[ "$FILE" =~ /\.secrets/ ]]; then
  echo "BLOCKED: Cannot edit files in secrets directory"
  exit 1
fi

# Private keys
if [[ "$FILE" =~ \.pem$ ]] || \
   [[ "$FILE" =~ \.key$ ]] || \
   [[ "$FILE" =~ id_rsa ]] || \
   [[ "$FILE" =~ id_ed25519 ]]; then
  echo "BLOCKED: Cannot edit private key files"
  exit 1
fi

# Credential files
if [[ "$FILE" =~ credentials\.json$ ]] || \
   [[ "$FILE" =~ service-account\.json$ ]] || \
   [[ "$FILE" =~ \.credentials$ ]]; then
  echo "BLOCKED: Cannot edit credential files"
  exit 1
fi

# Additional secrets/credentials files
if [[ "$FILE" =~ secrets\.json$ ]] || \
   [[ "$FILE" =~ secrets\.yaml$ ]] || \
   [[ "$FILE" =~ secrets\.yml$ ]] || \
   [[ "$FILE" =~ credentials\.yaml$ ]] || \
   [[ "$FILE" =~ credentials\.yml$ ]]; then
  echo "BLOCKED: Cannot edit secrets/credentials files"
  exit 1
fi

# SSH config
if [[ "$FILE" =~ \.ssh/config ]]; then
  echo "BLOCKED: Cannot edit SSH config file"
  exit 1
fi

# Cloud provider credentials
if [[ "$FILE" =~ \.aws/credentials ]] || \
   [[ "$FILE" =~ \.aws/config ]]; then
  echo "BLOCKED: Cannot edit AWS credential files"
  exit 1
fi

# Package manager auth files
if [[ "$FILE" =~ \.npmrc$ ]] || \
   [[ "$FILE" =~ \.pypirc$ ]] || \
   [[ "$FILE" =~ \.yarnrc$ ]]; then
  echo "BLOCKED: Cannot edit package manager auth files"
  exit 1
fi

# Terraform/Kubernetes sensitive files (MED-4 additions)
if [[ "$FILE" =~ kubeconfig ]] || \
   [[ "$FILE" =~ \.tfvars$ ]] || \
   [[ "$FILE" =~ \.tfstate$ ]] || \
   [[ "$FILE" =~ \.tfstate\. ]]; then
  echo "BLOCKED: Cannot edit infrastructure secrets file"
  exit 1
fi

# === WARNINGS ===

# New file creation
if [[ ! -f "$FILE" ]]; then
  echo "INFO: Creating new file: $FILE"
fi

# Lock files
if [[ "$FILE" =~ \.lock$ ]] || \
   [[ "$FILE" =~ lock\.json$ ]]; then
  echo "WARNING: Editing lock file - may cause dependency issues"
fi

# Config files
if [[ "$FILE" =~ package\.json$ ]] || \
   [[ "$FILE" =~ tsconfig\.json$ ]]; then
  echo "INFO: Editing configuration file"
fi

# Allow the edit
exit 0
