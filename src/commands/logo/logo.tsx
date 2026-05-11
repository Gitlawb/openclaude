import * as React from 'react'
import { LogoPicker } from '../../components/LogoPicker.js'
import {
  DEFAULT_LOGO_PALETTE,
  LOGO_PALETTE_LABELS,
  isLogoPaletteName,
  type LogoPaletteName,
} from '../../components/StartupScreen.palettes.js'
import type {
  LocalJSXCommandCall,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'

type Props = {
  onDone: LocalJSXCommandOnDone
}

function LogoPickerCommand({ onDone }: Props): React.ReactElement {
  const initial = React.useMemo<LogoPaletteName>(() => {
    const current = getGlobalConfig().logoColor
    return isLogoPaletteName(current) ? current : DEFAULT_LOGO_PALETTE
  }, [])

  const handleSelect = React.useCallback(
    (chosen: LogoPaletteName) => {
      saveGlobalConfig(c => ({ ...c, logoColor: chosen }))
      onDone(
        `Startup logo set to ${LOGO_PALETTE_LABELS[chosen]}. Visible on next launch.`,
      )
    },
    [onDone],
  )

  const handleCancel = React.useCallback(() => {
    onDone('Logo picker dismissed', { display: 'system' })
  }, [onDone])

  return (
    <LogoPicker
      initial={initial}
      onSelect={handleSelect}
      onCancel={handleCancel}
    />
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context) => {
  return <LogoPickerCommand onDone={onDone} />
}
