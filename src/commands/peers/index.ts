// Stub — peers command not included in source snapshot.
// isEnabled() → false keeps it out of the command list, matching the previous
// behavior where the missing module resolved to a null command.
import type { Command } from '../../commands.js'

const peers = {
  type: 'local',
  name: 'peers',
  description: 'List connected peer sessions',
  isEnabled: () => false,
  isHidden: true,
  supportsNonInteractive: false,
  load: async () => ({
    call: async () => ({
      type: 'text' as const,
      value: '/peers is not available in this build',
    }),
  }),
} satisfies Command

export default peers
