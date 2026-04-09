import { feature } from '../../config/forgeFeatureFlags.js'
import * as React from 'react';
import { useMemo } from 'react';
import { Box, Text } from 'src/ink.js';
import { useAppState } from 'src/state/AppState.js';
import type { AppState } from 'src/state/AppState.js';
import { STATUS_TAG, SUMMARY_TAG, TASK_NOTIFICATION_TAG } from '../../constants/xml.js';
import { QueuedMessageProvider } from '../../context/QueuedMessageContext.js';
import { useCommandQueue } from '../../hooks/useCommandQueue.js';
import type { QueuedCommand } from '../../types/textInputTypes.js';
import { isQueuedCommandEditable, isQueuedCommandVisible } from '../../utils/messageQueueManager.js';
import { createUserMessage, EMPTY_LOOKUPS, normalizeMessages } from '../../utils/messages.js';
import { jsonParse } from '../../utils/slowOperations.js';
import { Message } from '../Message.js';
const EMPTY_SET = new Set<string>();

/**
 * Check if a command value is an idle notification that should be hidden.
 * Idle notifications are processed silently without showing to the user.
 */
function isIdleNotification(value: string): boolean {
  try {
    const parsed = jsonParse(value);
    return parsed?.type === 'idle_notification';
  } catch {
    return false;
  }
}

// Maximum number of task notification lines to show
const MAX_VISIBLE_NOTIFICATIONS = 3;

/**
 * Create a synthetic overflow notification message for capped task notifications.
 */
function createOverflowNotificationMessage(count: number): string {
  return `<${TASK_NOTIFICATION_TAG}>
<${SUMMARY_TAG}>+${count} more tasks completed</${SUMMARY_TAG}>
<${STATUS_TAG}>completed</${STATUS_TAG}>
</${TASK_NOTIFICATION_TAG}>`;
}

/**
 * Process queued commands to cap task notifications at MAX_VISIBLE_NOTIFICATIONS lines.
 * Other command types are always shown in full.
 * Idle notifications are filtered out entirely.
 */
function processQueuedCommands(queuedCommands: QueuedCommand[]): QueuedCommand[] {
  // Filter out idle notifications - they are processed silently
  const filteredCommands = queuedCommands.filter(cmd => typeof cmd.value !== 'string' || !isIdleNotification(cmd.value));

  // Separate task notifications from other commands
  const taskNotifications = filteredCommands.filter(cmd => cmd.mode === 'task-notification');
  const otherCommands = filteredCommands.filter(cmd => cmd.mode !== 'task-notification');

  // If notifications fit within limit, return all commands as-is
  if (taskNotifications.length <= MAX_VISIBLE_NOTIFICATIONS) {
    return [...otherCommands, ...taskNotifications];
  }

  // Show first (MAX_VISIBLE_NOTIFICATIONS - 1) notifications, then a summary
  const visibleNotifications = taskNotifications.slice(0, MAX_VISIBLE_NOTIFICATIONS - 1);
  const overflowCount = taskNotifications.length - (MAX_VISIBLE_NOTIFICATIONS - 1);

  // Create synthetic overflow message
  const overflowCommand: QueuedCommand = {
    value: createOverflowNotificationMessage(overflowCount),
    mode: 'task-notification'
  };
  return [...otherCommands, ...visibleNotifications, overflowCommand];
}
function PromptInputQueuedCommandsImpl(): React.ReactNode {
  const queuedCommands = useCommandQueue();
  const viewingAgent = useAppState((s: AppState) => !!s.viewingAgentTaskId);
  // Brief layout: dim queue items + skip the paddingX (brief messages
  // already indent themselves). Gate mirrors the brief-spinner/message
  // check elsewhere — no teammate-view override needed since this
  // component early-returns when viewing a teammate.
  const useBriefLayout = feature('KAIROS') || feature('KAIROS_BRIEF') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useAppState((s_0: AppState) => s_0.isBriefOnly) : false;

  // createUserMessage mints a fresh UUID per call; without memoization, streaming
  // re-renders defeat Message's areMessagePropsEqual (compares uuid) → flicker.
  const queuedPromptCount = useMemo(
    () =>
      queuedCommands.filter(
        cmd => isQueuedCommandEditable(cmd) && cmd.mode === 'prompt',
      ).length,
    [queuedCommands],
  );

  const messages = useMemo(() => {
    if (queuedCommands.length === 0) return null;
    // task-notification is shown via useInboxNotification; most isMeta commands
    // (scheduled tasks, proactive ticks) are system-generated and hidden.
    // Channel messages are the exception — isMeta but shown so the keyboard
    // user sees what arrived.
    const visibleCommands = queuedCommands.filter(isQueuedCommandVisible);
    if (visibleCommands.length === 0) return null;
    const processedCommands = processQueuedCommands(visibleCommands);
    return normalizeMessages(processedCommands.map(cmd => {
      let content = cmd.value;
      if (cmd.mode === 'bash' && typeof content === 'string') {
        content = `<bash-input>${content}</bash-input>`;
      }
      // [Image #N] placeholders are inline in the text value (inserted at
      // paste time), so the queue preview shows them without stub blocks.
      return createUserMessage({
        content
      });
    }));
  }, [queuedCommands]);

  // Don't show leader's queued commands when viewing any agent's transcript
  if (viewingAgent || messages === null) {
    return null;
  }
  return <Box marginTop={1} flexDirection="column">
      {queuedPromptCount > 0 && <Box marginLeft={2} marginBottom={1}>
          <Text dimColor>
            {queuedPromptCount === 1 ? '1 message queued for next turn' : `${queuedPromptCount} messages queued for next turn`}
          </Text>
        </Box>}
      {messages.map((message, i) => <QueuedMessageProvider key={i} isFirst={i === 0} useBriefLayout={useBriefLayout}>
          <Message message={message} lookups={EMPTY_LOOKUPS} addMargin={false} tools={[]} commands={[]} verbose={false} inProgressToolUseIDs={EMPTY_SET} progressMessagesForMessage={[]} shouldAnimate={false} shouldShowDot={false} isTranscriptMode={false} isStatic={true} />
        </QueuedMessageProvider>)}
    </Box>;
}
export const PromptInputQueuedCommands = React.memo(PromptInputQueuedCommandsImpl);
