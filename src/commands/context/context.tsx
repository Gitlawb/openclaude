import { feature } from 'bun:bundle';
import * as React from 'react';
import type { LocalJSXCommandContext } from '../../commands.js';
import { ContextVisualization } from '../../components/ContextVisualization.js';
import { microcompactMessages } from '../../services/compact/microCompact.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import type { Message } from '../../types/message.js';
import { analyzeContextUsage } from '../../utils/analyzeContext.js';
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js';
import { renderToAnsiString } from '../../utils/staticRender.js';

/**
 * Apply the same context transforms query.ts does before the API call, so
 * /context shows what the model actually sees rather than the REPL's raw
 * history. Without projectView the token count overcounts by however much
 * was collapsed — user sees "180k, 3 spans collapsed" when the API sees 120k.
 */
function toApiView(messages: Message[]): Message[] {
  let view = getMessagesAfterCompactBoundary(messages);
  if (feature('CONTEXT_COLLAPSE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const {
      projectView
    } = require('../../services/contextCollapse/operations.js') as typeof import('../../services/contextCollapse/operations.js');
    /* eslint-enable @typescript-eslint/no-require-imports */
    view = projectView(view);
  }
  return view;
}
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  const {
    messages,
    getAppState,
    options: {
      mainLoopModel,
      tools
    }
  } = context;
  const apiView = toApiView(messages);

  // Apply microcompact to get accurate representation of messages sent to API
  const {
    messages: compactedMessages
  } = await microcompactMessages(apiView);

  // Get terminal width for responsive sizing
  const terminalWidth = process.stdout.columns || 80;
  const appState = getAppState();

  // Analyze context with compacted messages
  // Pass original messages as last parameter for accurate API usage extraction
  const data = await analyzeContextUsage(compactedMessages, mainLoopModel, async () => appState.toolPermissionContext, tools, appState.agentDefinitions, terminalWidth, context,
  // Pass full context for system prompt calculation
  undefined,
  // mainThreadAgentDefinition
  apiView // Original messages for API usage extraction
  );

  // Render to ANSI string to preserve colors and pass to onDone like local commands do
  const output = await renderToAnsiString(<ContextVisualization data={data} />);
  onDone(output);
  return null;
}
