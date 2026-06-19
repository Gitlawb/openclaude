// Seeded from src/skills/bundledSkills.ts + src/i18n/languages/en.ts.

export interface Skill {
  name: string
  invocation: string
  description: string
}

export const skills: Skill[] = [
  {
    name: 'batch',
    invocation: '/batch',
    description:
      'Research and plan a large-scale change, then execute it in parallel across 5–30 isolated worktree agents that each open a PR. Use for sweeping, mechanical changes (migrations, refactors, bulk renames) that decompose into independent units.',
  },
  {
    name: 'loop',
    invocation: '/loop',
    description:
      'Run a prompt on a fixed interval or dynamically reschedule it. Use to poll for status, babysit a workflow, or keep re-running a prompt within the current session.',
  },
  {
    name: 'simplify',
    invocation: '/simplify',
    description:
      'Review changed code for reuse, quality, and efficiency, then fix any issues found.',
  },
  {
    name: 'debug',
    invocation: '/debug',
    description: 'Enable debug logging for this session and help diagnose issues.',
  },
  {
    name: 'update-config',
    invocation: '/update-config',
    description:
      'Configure the harness via settings.json: permissions, env vars, hooks, and automated behaviors ("from now on when X…").',
  },
  {
    name: 'keybindings-help',
    invocation: '/keybindings-help',
    description:
      'Customize keyboard shortcuts: rebind keys, add chord bindings, or modify your keybindings file (default: ~/.openclaude/keybindings.json; override via OPENCLAUDE_CONFIG_DIR).',
  },
]
