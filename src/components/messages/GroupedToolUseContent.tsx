import type { ToolResultBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import * as React from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useAppStateMaybeOutsideOfProvider } from '../../state/AppState.js';
import { isLocalAgentTask } from '../../tasks/LocalAgentTask/LocalAgentTask.js';
import { filterToolProgressMessages, findToolByNameOrUniquePrefix, type Tools } from '../../Tool.js';
import type { GroupedToolUseMessage } from '../../types/message.js';
import type { buildMessageLookups } from '../../utils/messages.js';
type Props = {
  message: GroupedToolUseMessage;
  tools: Tools;
  lookups: ReturnType<typeof buildMessageLookups>;
  inProgressToolUseIDs: Set<string>;
  shouldAnimate: boolean;
};
export function GroupedToolUseContent({
  message,
  tools,
  lookups,
  inProgressToolUseIDs,
  shouldAnimate
}: Props): React.ReactNode {
  const terminalSize = useTerminalSize();
  const tasks = useAppStateMaybeOutsideOfProvider(state => state.tasks);
  const tool = findToolByNameOrUniquePrefix(tools, message.toolName);
  if (!tool?.renderGroupedToolUse) {
    return null;
  }

  // Build a map from tool_use_id to result data
  const resultsByToolUseId = new Map<string, {
    param: ToolResultBlockParam;
    output: unknown;
  }>();
  for (const resultMsg of message.results) {
    for (const content of resultMsg.message.content) {
      if (content.type === 'tool_result') {
        resultsByToolUseId.set(content.tool_use_id, {
          param: content,
          output: resultMsg.toolUseResult
        });
      }
    }
  }
  const toolUsesData = message.messages.map(msg => {
    const content = msg.message.content[0];
    let result = resultsByToolUseId.get(content.id);
    const outputAgentId = (result?.output as { agentId?: string } | undefined)?.agentId;
    const task = outputAgentId ? tasks?.[outputAgentId] : Object.values(tasks ?? {}).find(task => isLocalAgentTask(task) && task.toolUseId === content.id);
    const liveAgent = isLocalAgentTask(task) ? task : undefined;
    const progressMessages = filterToolProgressMessages(lookups.progressMessagesByToolUseID.get(content.id) ?? []);
    if (liveAgent?.progress) progressMessages.push({ type: 'progress', uuid: `agent_usage_${liveAgent.id}`, data: { type: 'agent_usage', agentId: liveAgent.id, ...liveAgent.progress } });
    if (result && liveAgent && liveAgent.status !== 'running') result = { ...result, output: { ...result.output as object, ...liveAgent.result, completionReason: liveAgent.status === 'completed' ? liveAgent.result?.completionReason ?? 'completed' : liveAgent.status } };
    return {
      param: content as ToolUseBlockParam,
      isResolved: liveAgent ? liveAgent.status !== 'running' : lookups.resolvedToolUseIDs.has(content.id),
      isError: liveAgent?.status === 'failed' || lookups.erroredToolUseIDs.has(content.id),
      isInProgress: liveAgent?.status === 'running' || inProgressToolUseIDs.has(content.id),
      progressMessages,
      result
    };
  });
  const anyInProgress = toolUsesData.some(d => d.isInProgress);
  return tool.renderGroupedToolUse(toolUsesData, {
    shouldAnimate: shouldAnimate && anyInProgress,
    terminalSize,
    activeGroupCount: Math.max(1, Math.ceil(inProgressToolUseIDs.size / Math.max(1, toolUsesData.length))),
    tools
  });
}
