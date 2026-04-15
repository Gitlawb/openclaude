import type { Command } from '../types/command.js'

const promote: Command = {
  type: 'prompt',
  name: 'promote',
  description: 'Promote changes from the active worktree to the host repo',
  progressMessage: 'checking worktree status',
  contentLength: 300,
  source: 'builtin',
  async getPromptForCommand(_args, _context) {
    // Lazy imports to avoid heavy dependency loading at startup
    const { getCurrentWorktreeSession } = await import('../utils/worktree.js')

    const session = getCurrentWorktreeSession()

    if (!session) {
      return [
        {
          type: 'text' as const,
          text: 'No active worktree session. You are working directly in the host repo.\n\nTo use workspace isolation, start a full lifecycle feature request — bridge-ai will automatically create a worktree for the execute phase.',
        },
      ]
    }

    // We're in a worktree — present promotion options
    const prompt = `## Worktree Promotion

You are currently in a worktree: \`${session.slug}\`

Please help the user promote their changes. First, show them what changed:
1. Run \`git status\` to show changed files
2. Run \`git diff --stat\` to show a summary

Then ask the user which promotion method they prefer:
- **patch**: Generate a \`.patch\` file with \`git diff > {slug}.patch\` and copy it to the host repo
- **commit**: Commit all changes in this worktree, then cherry-pick the commit(s) to the host branch
- **push**: Push this worktree's branch to the remote for PR review
- **abandon**: Discard all changes and exit the worktree

Wait for the user's choice before proceeding. After promotion (or abandonment), use \`ExitWorktree\` to clean up.`

    return [{ type: 'text' as const, text: prompt }]
  },
}

export default promote
