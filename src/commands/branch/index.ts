import type { Command } from '../../commands.js'

const branch = {
  type: 'local-jsx',
  name: 'branch',
  // /branch always owns the 'fork' alias: the dedicated /fork slash command is
  // not part of this build (unmirrored source), and FORK_SUBAGENT's forking is
  // implicit (omitting subagent_type), not a slash command.
  aliases: ['fork'],
  description: 'Create a branch of the current conversation at this point',
  argumentHint: '[name]',
  load: () => import('./branch.js'),
} satisfies Command

export default branch
