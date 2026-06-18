// Seeded from src/utils/envValidation.ts, src/utils/config.ts, and the README.

export interface SettingsFile {
  path: string
  scope: string
  notes: string
}

export const settingsFiles: SettingsFile[] = [
  {
    path: '~/.openclaude/settings.json',
    scope: 'user',
    notes: 'Default global settings path for every project on the machine; OPENCLAUDE_CONFIG_DIR moves this under the configured config home.',
  },
  {
    path: '.openclaude/settings.json',
    scope: 'project',
    notes: 'Shared project settings, committed to the repo.',
  },
  {
    path: '.openclaude/settings.local.json',
    scope: 'local',
    notes: 'Per-machine overrides for one project; typically gitignored.',
  },
  {
    path: '~/.openclaude/keybindings.json',
    scope: 'user',
    notes: 'Default keyboard shortcut overrides path; OPENCLAUDE_CONFIG_DIR moves this under the configured config home.',
  },
  {
    path: 'CLAUDE.md / .claude/CLAUDE.md',
    scope: 'project',
    notes: 'Project instructions loaded into context at session start.',
  },
]

export interface SettingOption {
  key: string
  description: string
}

export const settingOptions: SettingOption[] = [
  { key: 'model', description: "Default model (alias like 'sonnet' or a full model name)." },
  { key: 'provider', description: 'Default provider preset for new sessions.' },
  { key: 'effort', description: 'Default effort level: low, medium, high, xhigh, or max.' },
  { key: 'agent', description: 'Default agent for new sessions.' },
  { key: 'permissions', description: 'Allow/deny rules for tools, plus the default permission mode.' },
  { key: 'env', description: 'Environment variables applied to every session.' },
  { key: 'theme', description: 'Terminal color theme.' },
  { key: 'verbose', description: 'Verbose output by default.' },
  { key: 'allowAutoUpdates', description: 'Enable or disable the auto-updater.' },
  { key: 'hooks', description: 'Shell hooks that run on tool events (PreToolUse, PostToolUse, …).' },
]

export interface EnvVar {
  name: string
  description: string
}

export const envVars: EnvVar[] = [
  { name: 'ANTHROPIC_API_KEY', description: 'Anthropic API key (also the strict auth path in --bare mode).' },
  { name: 'ANTHROPIC_AUTH_TOKEN', description: 'Bearer token alternative to an Anthropic API key.' },
  { name: 'OPENAI_API_KEY', description: 'Key for OpenAI-compatible providers and gateways (incl. Opengateway).' },
  { name: 'OPENAI_BASE_URL', description: 'Base URL of an OpenAI-compatible /v1 endpoint (OpenRouter, LM Studio, LiteLLM, …).' },
  { name: 'OPENAI_MODEL', description: 'Model name to request from the OpenAI-compatible endpoint.' },
  { name: 'GOOGLE_API_KEY', description: 'Google Gemini API key.' },
  { name: 'NEARAI_API_KEY', description: 'NEAR AI unified gateway key.' },
  { name: 'MIMO_API_KEY', description: 'Xiaomi MiMo API key.' },
  { name: 'OPENCODE_API_KEY', description: 'OpenCode Zen / Go gateway key.' },
  { name: 'GITHUB_TOKEN', description: 'GitHub token for GitHub Models and PR workflows.' },
  { name: 'OPENCLAUDE_CONFIG_DIR', description: 'Preferred config directory override. Defaults to ~/.openclaude when unset.' },
  { name: 'CLAUDE_CONFIG_DIR', description: 'Legacy config directory override. Used only when OPENCLAUDE_CONFIG_DIR is unset.' },
  { name: 'HTTP_PROXY / HTTPS_PROXY', description: 'Route API traffic through a proxy.' },
  { name: 'NODE_EXTRA_CA_CERTS', description: 'Extra CA certificates for corporate TLS interception.' },
  { name: 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', description: 'Disable non-essential network traffic.' },
]
