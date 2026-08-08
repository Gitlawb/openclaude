import { useEffect } from 'react'
import { Select } from '../../../components/CustomSelect/select.js'
import { Box, Text } from '../../../ink.js'
import type { ToolPermissionContext } from '../../../Tool.js'
import { useTabHeaderFocus } from '../../design-system/Tabs.js'
import {
  getPermissionModeOptions,
  type ManageablePermissionMode,
} from './permissionModeOptions.js'

type Props = {
  toolPermissionContext: ToolPermissionContext
  onSelectMode: (mode: ManageablePermissionMode) => void
  onCancel: () => void
  onHeaderFocusChange?: (focused: boolean) => void
  statusMessage?: string
}

export function PermissionModeTab({
  toolPermissionContext,
  onSelectMode,
  onCancel,
  onHeaderFocusChange,
  statusMessage,
}: Props) {
  const { headerFocused, focusHeader } = useTabHeaderFocus()

  useEffect(() => {
    onHeaderFocusChange?.(headerFocused)
  }, [headerFocused, onHeaderFocusChange])

  const options = getPermissionModeOptions(toolPermissionContext)
  const currentMode = options.some(
    option => option.value === toolPermissionContext.mode,
  )
    ? (toolPermissionContext.mode as ManageablePermissionMode)
    : undefined

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1} gap={1}>
        <Text>Change the current session permission mode.</Text>
        <Text dimColor={true}>
          Dangerous modes may require a one-time confirmation before they are
          enabled.
        </Text>
        {statusMessage ? <Text color="error">{statusMessage}</Text> : null}
      </Box>
      <Select
        options={options}
        onChange={onSelectMode}
        onCancel={onCancel}
        visibleOptionCount={Math.min(10, options.length)}
        layout="compact-vertical"
        defaultFocusValue={currentMode}
        onUpFromFirstItem={focusHeader}
        isDisabled={headerFocused}
      />
    </Box>
  )
}
