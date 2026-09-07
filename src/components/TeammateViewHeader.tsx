import * as React from 'react'
import { Box, Text } from '../ink.js'
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js'
import { useAppState } from '../state/AppState.js'
import { getViewedTeammateTask } from '../state/selectors.js'
import { hasActiveSessionTasks } from '../tasks/cancelSessionTasks.js'
import { toInkColor } from '../utils/ink.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { OffscreenFreeze } from './OffscreenFreeze.js'

/** Header shown when viewing a teammate's transcript. */
export function TeammateViewHeader({ isLoading = false }: { isLoading?: boolean }) {
  const viewedTeammate = useAppState(getViewedTeammateTask)
  const hasActiveTasks = useAppState(s => hasActiveSessionTasks(s.tasks))
  const shortcut = useShortcutDisplay('chat:cancel', 'Chat', 'esc').toLowerCase()
  if (!viewedTeammate) return null

  return <OffscreenFreeze>
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text>Viewing </Text>
        <Text color={toInkColor(viewedTeammate.identity.color)} bold>
          @{viewedTeammate.identity.agentName}
        </Text>
        <Text dimColor>{' · '}<KeyboardShortcutHint shortcut={shortcut}
          action={isLoading || hasActiveTasks ? 'stop all' : 'return'} /></Text>
      </Box>
      <Text dimColor>{viewedTeammate.prompt}</Text>
    </Box>
  </OffscreenFreeze>
}
