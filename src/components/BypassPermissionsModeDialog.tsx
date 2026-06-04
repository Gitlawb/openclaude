import React from 'react'
import { PRODUCT_DISPLAY_NAME } from '../constants/product.js'
import { logEvent } from 'src/services/analytics/index.js'
import { Box, Newline, Text } from '../ink.js'
import { gracefulShutdownSync } from '../utils/gracefulShutdown.js'
import {
  type PermissionMode,
  permissionModeTitle,
} from '../utils/permissions/PermissionMode.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'

type Props = {
  mode?: Extract<PermissionMode, 'bypassPermissions' | 'fullAccess'>
  onAccept(): void
  onDecline?(): void
  onCancel?(): void
}

export function BypassPermissionsModeDialog({
  mode = 'bypassPermissions',
  onAccept,
  onDecline,
  onCancel,
}: Props) {
  React.useEffect(() => {
    logEvent('tengu_bypass_permissions_mode_dialog_shown', {})
  }, [])

  const handleDecline = React.useCallback(() => {
    if (onDecline) {
      onDecline()
      return
    }
    gracefulShutdownSync(1)
  }, [onDecline])

  const handleEscape = React.useCallback(() => {
    if (onCancel) {
      onCancel()
      return
    }
    gracefulShutdownSync(0)
  }, [onCancel])

  const handleChange = React.useCallback(
    (value: 'accept' | 'decline') => {
      if (value === 'accept') {
        logEvent('tengu_bypass_permissions_mode_dialog_accept', {})
        onAccept()
        return
      }

      handleDecline()
    },
    [handleDecline, mode, onAccept],
  )

  const modeTitle = permissionModeTitle(mode)

  return (
    <Dialog
      title={`WARNING: ${PRODUCT_DISPLAY_NAME} running in ${modeTitle} mode`}
      color="error"
      onCancel={handleEscape}
    >
      <Box flexDirection="column" gap={1}>
        <Text>
          In {modeTitle} mode, {PRODUCT_DISPLAY_NAME} will not ask for your approval
          before running potentially dangerous commands.
          <Newline />
          This mode should only be used in a sandboxed container/VM that has
          restricted internet access and can easily be restored if damaged.
        </Text>
        <Text>
          By proceeding, you accept all responsibility for actions taken while
          running in {modeTitle} mode.
        </Text>
      </Box>
      <Select
        options={[
          { label: 'No, exit', value: 'decline' },
          { label: 'Yes, I accept', color: 'error', value: 'accept' },
        ]}
        onChange={value => handleChange(value as 'accept' | 'decline')}
      />
    </Dialog>
  )
}
