import type { Command } from '../types/command.js'

const cleanup: Command = {
  type: 'prompt',
  name: 'cleanup',
  description: 'List and remove stale bridge-ai worktrees',
  progressMessage: 'checking for stale worktrees',
  contentLength: 200,
  source: 'builtin',
  async getPromptForCommand(_args, _context) {
    return [{
      type: 'text' as const,
      text: `## Worktree Cleanup

Please help clean up stale bridge-ai worktrees:

1. Run \`git worktree list\` to find all worktrees
2. Identify bridge-ai worktrees (paths containing \`.claude/worktrees/bridgeai-\` or branches named \`worktree-bridgeai-\`)
3. For each stale worktree (no uncommitted changes):
   - Show the worktree name, branch, and age
   - Ask the user if they want to remove it
4. For worktrees with uncommitted changes, warn before removing
5. Use \`git worktree remove <path>\` to clean up approved worktrees

If no bridge-ai worktrees are found, report "No bridge-ai worktrees found. All clean!"`,
    }]
  },
}

export default cleanup
