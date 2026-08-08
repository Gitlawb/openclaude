import { Box, Text } from '../../ink.js'
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js'

// Rendered by Message.tsx when a snip_boundary message is displayed. Mirrors
// CompactBoundaryMessage: a single dimmed line marking where the model snipped
// stale history, with the count of removed messages and the transcript shortcut.
export function SnipBoundaryMessage({
  message,
}: {
  message: { snipMetadata?: { removedUuids?: string[] } }
}) {
  const historyShortcut = useShortcutDisplay(
    'app:toggleTranscript',
    'Global',
    'ctrl+o',
  )
  const count = message?.snipMetadata?.removedUuids?.length ?? 0
  const label = count === 1 ? '1 message' : `${count} messages`
  return (
    <Box marginY={1}>
      <Text dimColor={true}>
        ✂ Conversation history snipped ({label}, {historyShortcut} for history)
      </Text>
    </Box>
  )
}
