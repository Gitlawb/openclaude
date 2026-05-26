import React from 'react';
import { ExportDialog } from '../../components/ExportDialog.js';
import type { ToolUseContext } from '../../Tool.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import type { Message } from '../../types/message.js';
import { getCwd } from '../../utils/cwd.js';
import type { ExportFormat } from '../../utils/exportFormats.js';
import { ensureExportFilenameExtension, inferExportFormatFromFilename, parseExportArgs, resolveExportFilepath } from '../../utils/exportFormats.js';
import { renderMessagesForExport } from '../../utils/exportRenderer.js';
import { writeFileSync_DEPRECATED } from '../../utils/slowOperations.js';
function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}-${hours}${minutes}${seconds}`;
}
export function extractFirstPrompt(messages: Message[]): string {
  const firstUserMessage = messages.find(msg => msg.type === 'user');
  if (!firstUserMessage || firstUserMessage.type !== 'user') {
    return '';
  }
  const content = firstUserMessage.message?.content;
  let result = '';
  if (typeof content === 'string') {
    result = content.trim();
  } else if (Array.isArray(content)) {
    const textContent = content.find(item => item.type === 'text');
    if (textContent && 'text' in textContent) {
      result = textContent.text.trim();
    }
  }

  // Take first line only and limit length
  result = result.split('\n')[0] || '';
  if (result.length > 50) {
    result = result.substring(0, 49) + '…';
  }
  return result;
}
export function sanitizeFilename(text: string): string {
  // Replace special characters with hyphens
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '') // Remove special chars
  .replace(/\s+/g, '-') // Replace spaces with hyphens
  .replace(/-+/g, '-') // Replace multiple hyphens with single
  .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}
export async function call(onDone: LocalJSXCommandOnDone, context: ToolUseContext, args: string): Promise<React.ReactNode> {
  const tools = context.options.tools || [];

  // Parse arguments for --format flag and filename
  const parsed = parseExportArgs(args);
  if (parsed.error) {
    onDone(parsed.error);
    return null;
  }

  // Determine format: --format flag > filename extension > text default
  const format: ExportFormat = parsed.format
    ?? (parsed.filename ? inferExportFormatFromFilename(parsed.filename) : null)
    ?? 'text';

  // If args are provided, render and write directly to file
  if (parsed.filename) {
    try {
      const content = await renderMessagesForExport(context.messages, tools, { format });
      const finalFilename = ensureExportFilenameExtension(parsed.filename, format, {
        preserveMarkdownExtension: parsed.format === undefined,
      });
      const filepath = resolveExportFilepath(getCwd(), finalFilename);
      writeFileSync_DEPRECATED(filepath, content, {
        encoding: 'utf-8',
        flush: true
      });
      onDone(`Conversation exported to: ${filepath}`);
      return null;
    } catch (error) {
      onDone(`Failed to export conversation: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }

  // Generate default filename from first prompt or timestamp
  const firstPrompt = extractFirstPrompt(context.messages);
  const timestamp = formatTimestamp(new Date());
  const sanitized = firstPrompt ? sanitizeFilename(firstPrompt) : '';
  const defaultFilename = sanitized
    ? `${timestamp}-${sanitized}.txt`
    : `conversation-${timestamp}.txt`;

  // Return the dialog component when no args provided
  return <ExportDialog defaultFilename={defaultFilename} defaultFormat={format} getContent={async (f) => {
    return renderMessagesForExport(context.messages, tools, { format: f });
  }} onDone={result => {
    onDone(result.message);
  }} />;
}
