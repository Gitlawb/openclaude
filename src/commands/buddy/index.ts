import type { Command } from '../../commands.js'

const buddy = {
  type: 'local-jsx',
  name: 'buddy',
  description: 'Hatch, pet, and manage your Companion',
  immediate: true,
  argumentHint: '[status|show|hide|mute|unmute|help]',
  load: () => import('./buddy.js'),
} satisfies Command

export default buddy
