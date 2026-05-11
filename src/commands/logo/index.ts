import type { Command } from '../../commands.js'
import {
  DEFAULT_LOGO_PALETTE,
  LOGO_PALETTE_LABELS,
  isLogoPaletteName,
} from '../../components/StartupScreen.palettes.js'
import { getGlobalConfig } from '../../utils/config.js'

const logo = {
  type: 'local-jsx',
  name: 'logo',
  get description(): string {
    const current = getGlobalConfig().logoColor
    const shown = isLogoPaletteName(current) ? current : DEFAULT_LOGO_PALETTE
    return `Change the startup logo color scheme (current: ${LOGO_PALETTE_LABELS[shown]})`
  },
  isHidden: false,
  load: () => import('./logo.js'),
} satisfies Command

export default logo
