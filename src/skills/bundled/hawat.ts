import { registerBundledSkill } from '../bundledSkills.js'
import {
  CHECKPOINT_CONTENT,
  DOC_SYNC_CONTENT,
  EXPLORE_CONTENT,
  HAWAT_FILES,
  INCREMENTAL_REFACTOR_CONTENT,
  LSP_CONTENT,
  ORCHESTRATE_CONTENT,
  REFACTOR_CONTENT,
  SKILL_CONTENT,
  TDD_CONTENT,
  VALIDATE_CONTENT,
} from './hawatContent.js'

export function registerHawatSkills(): void {
  registerBundledSkill({
    name: 'hawat-explore',
    description:
      'Isolated codebase exploration with optional parallel search (forked context)',
    allowedTools: ['Read', 'Glob', 'Grep', 'Agent', 'WebFetch', 'WebSearch'],
    context: 'fork',
    agent: 'Explore',
    userInvocable: true,
    async getPromptForCommand(args) {
      const prompt = args
        ? `${EXPLORE_CONTENT}\n\n## Exploration Query\n\n${args}`
        : EXPLORE_CONTENT
      return [{ type: 'text', text: prompt }]
    },
  })

  registerBundledSkill({
    name: 'hawat-validate',
    description: 'Pre-completion quality verification and validation gate',
    allowedTools: ['Read', 'Bash', 'Glob', 'Grep'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const prompt = args
        ? `${VALIDATE_CONTENT}\n\n## Validation Target\n\n${args}`
        : VALIDATE_CONTENT
      return [{ type: 'text', text: prompt }]
    },
  })

  registerBundledSkill({
    name: 'hawat-orchestrate',
    description: 'Main orchestration skill for systematic workflow execution',
    allowedTools: [
      'Read',
      'Glob',
      'Grep',
      'Edit',
      'Write',
      'Bash',
      'Agent',
    ],
    userInvocable: true,
    async getPromptForCommand(args) {
      const prompt = args
        ? `${ORCHESTRATE_CONTENT}\n\n## Task\n\n${args}`
        : ORCHESTRATE_CONTENT
      return [{ type: 'text', text: prompt }]
    },
  })

  registerBundledSkill({
    name: 'hawat-refactor',
    description: 'Structural code refactoring using ast-grep patterns',
    allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
    context: 'fork',
    userInvocable: true,
    async getPromptForCommand(args) {
      const prompt = args
        ? `${REFACTOR_CONTENT}\n\n## Refactoring Target\n\n${args}`
        : REFACTOR_CONTENT
      return [{ type: 'text', text: prompt }]
    },
  })

  registerBundledSkill({
    name: 'hawat-tdd',
    description: 'Test-driven development workflow automation',
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob'],
    context: 'fork',
    userInvocable: true,
    async getPromptForCommand(args) {
      const prompt = args
        ? `${TDD_CONTENT}\n\n## TDD Target\n\n${args}`
        : TDD_CONTENT
      return [{ type: 'text', text: prompt }]
    },
  })

  registerBundledSkill({
    name: 'hawat-checkpoint',
    description: 'Session state checkpointing and recovery',
    allowedTools: ['Read', 'Write', 'Bash'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const prompt = args
        ? `${CHECKPOINT_CONTENT}\n\n## Checkpoint Context\n\n${args}`
        : CHECKPOINT_CONTENT
      return [{ type: 'text', text: prompt }]
    },
  })

  registerBundledSkill({
    name: 'hawat-doc-sync',
    description: 'Documentation synchronization with code changes',
    allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const prompt = args
        ? `${DOC_SYNC_CONTENT}\n\n## Sync Target\n\n${args}`
        : DOC_SYNC_CONTENT
      return [{ type: 'text', text: prompt }]
    },
  })

  registerBundledSkill({
    name: 'hawat-incremental-refactor',
    description: 'Per-file incremental refactoring with verification',
    allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
    context: 'fork',
    userInvocable: true,
    async getPromptForCommand(args) {
      const prompt = args
        ? `${INCREMENTAL_REFACTOR_CONTENT}\n\n## Refactoring Target\n\n${args}`
        : INCREMENTAL_REFACTOR_CONTENT
      return [{ type: 'text', text: prompt }]
    },
  })

  registerBundledSkill({
    name: 'hawat-lsp',
    description: 'Semantic code operations using LSP MCP or CLI fallbacks',
    allowedTools: ['Bash', 'Read', 'Grep', 'Glob'],
    context: 'fork',
    userInvocable: true,
    async getPromptForCommand(args) {
      const prompt = args
        ? `${LSP_CONTENT}\n\n## LSP Query\n\n${args}`
        : LSP_CONTENT
      return [{ type: 'text', text: prompt }]
    },
  })

  // Main Hawat skill (SKILL.md) — includes reference.md as extractable file
  registerBundledSkill({
    name: 'hawat',
    description:
      'Hawat orchestration framework for systematic workflows, agent delegation, and error recovery',
    allowedTools: [
      'Read',
      'Glob',
      'Grep',
      'Edit',
      'Write',
      'Bash',
      'Agent',
    ],
    userInvocable: true,
    files: HAWAT_FILES,
    async getPromptForCommand(args) {
      const prompt = args
        ? `${SKILL_CONTENT}\n\n## Task\n\n${args}`
        : SKILL_CONTENT
      return [{ type: 'text', text: prompt }]
    },
  })
}
