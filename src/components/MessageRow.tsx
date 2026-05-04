import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import type { Command } from '../commands.js';
import { Box } from '../ink.js';
import type { Screen } from '../screens/REPL.js';
import type { Tools } from '../Tool.js';
import type { RenderableMessage } from '../types/message.js';
import { getDisplayMessageFromCollapsed, getToolSearchOrReadInfo, getToolUseIdsFromCollapsedGroup, hasAnyToolInProgress } from '../utils/collapseReadSearch.js';
import { type buildMessageLookups, EMPTY_STRING_SET, getProgressMessagesFromLookup, getSiblingToolUseIDsFromLookup, getToolUseID } from '../utils/messages.js';
import { hasThinkingContent, Message } from './Message.js';
import { MessageModel } from './MessageModel.js';
import { shouldRenderStatically } from './Messages.js';
import { MessageTimestamp } from './MessageTimestamp.js';
import { OffscreenFreeze } from './OffscreenFreeze.js';
export type Props = {
  message: RenderableMessage;
  /** Whether the previous message in renderableMessages is also a user message. */
  isUserContinuation: boolean;
  /**
   * Whether there is non-skippable content after this message in renderableMessages.
   * Only needs to be accurate for `collapsed_read_search` messages — used to decide
   * if the collapsed group spinner should stay active. Pass `false` otherwise.
   */
  hasContentAfter: boolean;
  tools: Tools;
  commands: Command[];
  verbose: boolean;
  inProgressToolUseIDs: Set<string>;
  streamingToolUseIDs: Set<string>;
  screen: Screen;
  canAnimate: boolean;
  onOpenRateLimitOptions?: () => void;
  lastThinkingBlockId: string | null;
  latestBashOutputUUID: string | null;
  columns: number;
  isLoading: boolean;
  lookups: ReturnType<typeof buildMessageLookups>;
};

/**
 * Scans forward from `index+1` to check if any "real" content follows. Used to
 * decide whether a collapsed read/search group should stay in its active
 * (grey dot, present-tense "Reading…") state while the query is still loading.
 *
 * Exported so Messages.tsx can compute this once per message and pass the
 * result as a boolean prop — avoids passing the full `renderableMessages` array
 * to each MessageRow (which React Compiler would pin in the fiber's memoCache,
 * accumulating every historical version of the array ≈ 1-2MB over a 7-turn session).
 */
export function hasContentAfterIndex(messages: RenderableMessage[], index: number, tools: Tools, streamingToolUseIDs: Set<string>): boolean {
  for (let i = index + 1; i < messages.length; i++) {
    const msg = messages[i];
    if (msg?.type === 'assistant') {
      const content = msg.message.content[0];
      if (content?.type === 'thinking' || content?.type === 'redacted_thinking') {
        continue;
      }
      if (content?.type === 'tool_use') {
        if (getToolSearchOrReadInfo(content.name, content.input, tools).isCollapsible) {
          continue;
        }
        // Non-collapsible tool uses appear in syntheticStreamingToolUseMessages
        // before their ID is added to inProgressToolUseIDs. Skip while streaming
        // to avoid briefly finalizing the read group.
        if (streamingToolUseIDs.has(content.id)) {
          continue;
        }
      }
      return true;
    }
    if (msg?.type === 'system' || msg?.type === 'attachment') {
      continue;
    }
    // Tool results arrive while the collapsed group is still being built
    if (msg?.type === 'user') {
      const content = msg.message.content[0];
      if (content?.type === 'tool_result') {
        continue;
      }
    }
    // Collapsible grouped_tool_use messages arrive transiently before being
    // merged into the current collapsed group on the next render cycle
    if (msg?.type === 'grouped_tool_use') {
      const firstInput = msg.messages[0]?.message.content[0]?.input;
      if (getToolSearchOrReadInfo(msg.toolName, firstInput, tools).isCollapsible) {
        continue;
      }
    }
    return true;
  }
  return false;
}
function MessageRowImpl(t0) {
  const $ = _c(64);
  const {
    message: msg,
    isUserContinuation,
    hasContentAfter,
    tools,
    commands,
    verbose,
    inProgressToolUseIDs,
    streamingToolUseIDs,
    screen,
    canAnimate,
    onOpenRateLimitOptions,
    lastThinkingBlockId,
    latestBashOutputUUID,
    columns,
    isLoading,
    lookups
  } = t0;
  const isTranscriptMode = screen === "transcript";
  const isGrouped = msg.type === "grouped_tool_use";
  const isCollapsed = msg.type === "collapsed_read_search";
  let t1;
  if ($[0] !== hasContentAfter || $[1] !== inProgressToolUseIDs || $[2] !== isCollapsed || $[3] !== isLoading || $[4] !== msg) {
    t1 = isCollapsed && (hasAnyToolInProgress(msg, inProgressToolUseIDs) || isLoading && !hasContentAfter);
    $[0] = hasContentAfter;
    $[1] = inProgressToolUseIDs;
    $[2] = isCollapsed;
    $[3] = isLoading;
    $[4] = msg;
    $[5] = t1;
  } else {
    t1 = $[5];
  }
  const isActiveCollapsedGroup = t1;
  let t2;
  if ($[6] !== isCollapsed || $[7] !== isGrouped || $[8] !== msg) {
    t2 = isGrouped ? msg.displayMessage : isCollapsed ? getDisplayMessageFromCollapsed(msg) : msg;
    $[6] = isCollapsed;
    $[7] = isGrouped;
    $[8] = msg;
    $[9] = t2;
  } else {
    t2 = $[9];
  }
  const displayMsg = t2;
  let t3;
  if ($[10] !== isCollapsed || $[11] !== isGrouped || $[12] !== lookups || $[13] !== msg) {
    t3 = isGrouped || isCollapsed ? [] : getProgressMessagesFromLookup(msg, lookups);
    $[10] = isCollapsed;
    $[11] = isGrouped;
    $[12] = lookups;
    $[13] = msg;
    $[14] = t3;
  } else {
    t3 = $[14];
  }
  const progressMessagesForMessage = t3;
  let t4;
  if ($[15] !== inProgressToolUseIDs || $[16] !== isCollapsed || $[17] !== isGrouped || $[18] !== lookups || $[19] !== msg || $[20] !== screen || $[21] !== streamingToolUseIDs) {
    const siblingToolUseIDs = isGrouped || isCollapsed ? EMPTY_STRING_SET : getSiblingToolUseIDsFromLookup(msg, lookups);
    t4 = shouldRenderStatically(msg, streamingToolUseIDs, inProgressToolUseIDs, siblingToolUseIDs, screen, lookups);
    $[15] = inProgressToolUseIDs;
    $[16] = isCollapsed;
    $[17] = isGrouped;
    $[18] = lookups;
    $[19] = msg;
    $[20] = screen;
    $[21] = streamingToolUseIDs;
    $[22] = t4;
  } else {
    t4 = $[22];
  }
  const isStatic = t4;
  let shouldAnimate = false;
  if (canAnimate) {
    if (isGrouped) {
      let t5;
      if ($[23] !== inProgressToolUseIDs || $[24] !== msg.messages) {
        let t6;
        if ($[26] !== inProgressToolUseIDs) {
          t6 = m => {
            const content = m.message.content[0];
            return content?.type === "tool_use" && inProgressToolUseIDs.has(content.id);
          };
          $[26] = inProgressToolUseIDs;
          $[27] = t6;
        } else {
          t6 = $[27];
        }
        t5 = msg.messages.some(t6);
        $[23] = inProgressToolUseIDs;
        $[24] = msg.messages;
        $[25] = t5;
      } else {
        t5 = $[25];
      }
      shouldAnimate = t5;
    } else {
      if (isCollapsed) {
        let t5;
        if ($[28] !== inProgressToolUseIDs || $[29] !== msg) {
          t5 = hasAnyToolInProgress(msg, inProgressToolUseIDs);
          $[28] = inProgressToolUseIDs;
          $[29] = msg;
          $[30] = t5;
        } else {
          t5 = $[30];
        }
        shouldAnimate = t5;
      } else {
        let t5;
        if ($[31] !== inProgressToolUseIDs || $[32] !== msg) {
          const toolUseID = getToolUseID(msg);
          t5 = !toolUseID || inProgressToolUseIDs.has(toolUseID);
          $[31] = inProgressToolUseIDs;
          $[32] = msg;
          $[33] = t5;
        } else {
          t5 = $[33];
        }
        shouldAnimate = t5;
      }
    }
  }
  let t5;
  if ($[34] !== displayMsg || $[35] !== isTranscriptMode) {
    t5 = isTranscriptMode && displayMsg.type === "assistant" && displayMsg.message.content.some(_temp) && (displayMsg.timestamp || displayMsg.message.model);
    $[34] = displayMsg;
    $[35] = isTranscriptMode;
    $[36] = t5;
  } else {
    t5 = $[36];
  }
  const hasMetadata = t5;
  const t6 = !hasMetadata;
  const t7 = hasMetadata ? undefined : columns;
  let t8;
  if ($[37] !== commands || $[38] !== inProgressToolUseIDs || $[39] !== isActiveCollapsedGroup || $[40] !== isStatic || $[41] !== isTranscriptMode || $[42] !== isUserContinuation || $[43] !== lastThinkingBlockId || $[44] !== latestBashOutputUUID || $[45] !== lookups || $[46] !== msg || $[47] !== onOpenRateLimitOptions || $[48] !== progressMessagesForMessage || $[49] !== shouldAnimate || $[50] !== t6 || $[51] !== t7 || $[52] !== tools || $[53] !== verbose) {
    t8 = <Message message={msg} lookups={lookups} addMargin={t6} containerWidth={t7} tools={tools} commands={commands} verbose={verbose} inProgressToolUseIDs={inProgressToolUseIDs} progressMessagesForMessage={progressMessagesForMessage} shouldAnimate={shouldAnimate} shouldShowDot={true} isTranscriptMode={isTranscriptMode} isStatic={isStatic} onOpenRateLimitOptions={onOpenRateLimitOptions} isActiveCollapsedGroup={isActiveCollapsedGroup} isUserContinuation={isUserContinuation} lastThinkingBlockId={lastThinkingBlockId} latestBashOutputUUID={latestBashOutputUUID} />;
    $[37] = commands;
    $[38] = inProgressToolUseIDs;
    $[39] = isActiveCollapsedGroup;
    $[40] = isStatic;
    $[41] = isTranscriptMode;
    $[42] = isUserContinuation;
    $[43] = lastThinkingBlockId;
    $[44] = latestBashOutputUUID;
    $[45] = lookups;
    $[46] = msg;
    $[47] = onOpenRateLimitOptions;
    $[48] = progressMessagesForMessage;
    $[49] = shouldAnimate;
    $[50] = t6;
    $[51] = t7;
    $[52] = tools;
    $[53] = verbose;
    $[54] = t8;
  } else {
    t8 = $[54];
  }
  const messageEl = t8;
  if (!hasMetadata) {
    let t9;
    if ($[55] !== messageEl) {
      t9 = <OffscreenFreeze>{messageEl}</OffscreenFreeze>;
      $[55] = messageEl;
      $[56] = t9;
    } else {
      t9 = $[56];
    }
    return t9;
  }
  let t9;
  if ($[57] !== displayMsg || $[58] !== isTranscriptMode) {
    t9 = <Box flexDirection="row" justifyContent="flex-end" gap={1} marginTop={1}><MessageTimestamp message={displayMsg} isTranscriptMode={isTranscriptMode} /><MessageModel message={displayMsg} isTranscriptMode={isTranscriptMode} /></Box>;
    $[57] = displayMsg;
    $[58] = isTranscriptMode;
    $[59] = t9;
  } else {
    t9 = $[59];
  }
  let t10;
  if ($[60] !== columns || $[61] !== messageEl || $[62] !== t9) {
    t10 = <OffscreenFreeze><Box width={columns} flexDirection="column">{t9}{messageEl}</Box></OffscreenFreeze>;
    $[60] = columns;
    $[61] = messageEl;
    $[62] = t9;
    $[63] = t10;
  } else {
    t10 = $[63];
  }
  return t10;
}

/**
 * Checks if a message is "streaming" - i.e., its content may still be changing.
 * Exported for testing.
 */
function _temp(c) {
  return c.type === "text";
}
export function isMessageStreaming(msg: RenderableMessage, streamingToolUseIDs: Set<string>): boolean {
  if (msg.type === 'grouped_tool_use') {
    return msg.messages.some(m => {
      const content = m.message.content[0];
      return content?.type === 'tool_use' && streamingToolUseIDs.has(content.id);
    });
  }
  if (msg.type === 'collapsed_read_search') {
    const toolIds = getToolUseIdsFromCollapsedGroup(msg);
    return toolIds.some(id => streamingToolUseIDs.has(id));
  }
  const toolUseID = getToolUseID(msg);
  return !!toolUseID && streamingToolUseIDs.has(toolUseID);
}

/**
 * Checks if all tools in a message are resolved.
 * Exported for testing.
 */
export function allToolsResolved(msg: RenderableMessage, resolvedToolUseIDs: Set<string>): boolean {
  if (msg.type === 'grouped_tool_use') {
    return msg.messages.every(m => {
      const content = m.message.content[0];
      return content?.type === 'tool_use' && resolvedToolUseIDs.has(content.id);
    });
  }
  if (msg.type === 'collapsed_read_search') {
    const toolIds = getToolUseIdsFromCollapsedGroup(msg);
    return toolIds.every(id => resolvedToolUseIDs.has(id));
  }
  if (msg.type === 'assistant') {
    const block = msg.message.content[0];
    if (block?.type === 'server_tool_use') {
      return resolvedToolUseIDs.has(block.id);
    }
  }
  const toolUseID = getToolUseID(msg);
  return !toolUseID || resolvedToolUseIDs.has(toolUseID);
}

/**
 * Conservative memo comparator that only bails out when we're CERTAIN
 * the message won't change. Fails safe by re-rendering when uncertain.
 *
 * Exported for testing.
 */
export function areMessageRowPropsEqual(prev: Props, next: Props): boolean {
  // Different message reference = content may have changed, must re-render
  if (prev.message !== next.message) return false;

  // Screen mode change = re-render
  if (prev.screen !== next.screen) return false;

  // Verbose toggle changes thinking block visibility
  if (prev.verbose !== next.verbose) return false;

  // collapsed_read_search is never static in prompt mode (matches shouldRenderStatically)
  if (prev.message.type === 'collapsed_read_search' && next.screen !== 'transcript') {
    return false;
  }

  // Width change affects Box layout
  if (prev.columns !== next.columns) return false;

  // latestBashOutputUUID affects rendering (full vs truncated output)
  const prevIsLatestBash = prev.latestBashOutputUUID === prev.message.uuid;
  const nextIsLatestBash = next.latestBashOutputUUID === next.message.uuid;
  if (prevIsLatestBash !== nextIsLatestBash) return false;

  // lastThinkingBlockId affects thinking block visibility — but only for
  // messages that HAVE thinking content. Checking unconditionally busts the
  // memo for every scrollback message whenever thinking starts/stops (CC-941).
  if (prev.lastThinkingBlockId !== next.lastThinkingBlockId && hasThinkingContent(next.message)) {
    return false;
  }

  // Check if this message is still "in flight"
  const isStreaming = isMessageStreaming(prev.message, prev.streamingToolUseIDs);
  const isResolved = allToolsResolved(prev.message, prev.lookups.resolvedToolUseIDs);

  // Only bail out for truly static messages
  if (isStreaming || !isResolved) return false;

  // Static message - safe to skip re-render
  return true;
}
// @ts-expect-error no overload matches
export const MessageRow = React.memo(MessageRowImpl, areMessageRowPropsEqual);
