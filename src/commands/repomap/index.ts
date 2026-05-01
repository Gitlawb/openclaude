/**
 * /repomap command - minimal metadata only.
 * Implementation is lazy-loaded from repomap.ts to reduce startup time.
 */
import type { Command } from '../../commands.js'

const repomap = {
  type: 'local',
  name: 'repomap',
  description:
    'Show or configure the repository structural map (codebase intelligence)',
  isHidden: false,
  supportsNonInteractive: true,
  load: () => import('./repomap.js'),
} satisfies Command

export default repomap
