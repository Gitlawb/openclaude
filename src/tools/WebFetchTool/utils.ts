/**
 * WebFetch shared utilities — Haiku summarization + content helpers.
 * Fetching logic lives in providers/.
 */
import { queryHaiku } from '../../services/api/claude.js'
import { AbortError } from '../../utils/errors.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { isPreapprovedHost } from './preapproved.js'
import { makeSecondaryModelPrompt } from './prompt.js'

export const MAX_MARKDOWN_LENGTH = 2_000_000

export function isPreapprovedUrl(url: string): boolean {
  try { return isPreapprovedHost(new URL(url).hostname, new URL(url).pathname) }
  catch { return false }
}

export async function applyPromptToMarkdown(
  prompt: string, markdownContent: string, signal: AbortSignal,
  isNonInteractiveSession: boolean, isPreapprovedDomain: boolean,
): Promise<string> {
  const wasTruncated = markdownContent.length > MAX_MARKDOWN_LENGTH
  const truncated = wasTruncated
    ? markdownContent.slice(0, MAX_MARKDOWN_LENGTH) + '\n\n[Content truncated due to length...]'
    : markdownContent

  const assistantMessage = await queryHaiku({
    systemPrompt: asSystemPrompt([]),
    userPrompt: makeSecondaryModelPrompt(truncated, prompt, isPreapprovedDomain),
    signal,
    options: { querySource: 'web_fetch_apply', agents: [], isNonInteractiveSession, hasAppendSystemPrompt: false, mcpTools: [] },
  })

  if (signal.aborted) throw new AbortError()

  const { content } = assistantMessage.message
  let result: string
  if (content.length > 0 && content[0] && 'text' in content[0]) result = content[0].text
  else result = 'No response from model'

  if (wasTruncated) result += '\n\n[NOTE: The fetched content was truncated before processing because it exceeded the size limit. Some content at the end was not included.]'
  return result
}
