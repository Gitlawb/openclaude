/**
 * WebFetch shared utilities.
 *
 * Contains prompt application logic (Haiku summarization) and content
 * helpers used by the tool layer. Fetching logic lives in providers/.
 */

import { queryHaiku } from '../../services/api/claude.js'
import { AbortError } from '../../utils/errors.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { isPreapprovedHost } from './preapproved.js'
import { makeSecondaryModelPrompt } from './prompt.js'

// Truncation limit for content passed to the secondary model (Haiku).
// The secondary model's own context window is the effective ceiling;
// Haiku 3.5 supports ~200K input tokens (~800K chars), so 2M is a safe upper
// bound that still prevents runaway memory use.
export const MAX_MARKDOWN_LENGTH = 2_000_000

/**
 * Check if a URL matches a preapproved host (trusted documentation sites).
 */
export function isPreapprovedUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return isPreapprovedHost(parsedUrl.hostname, parsedUrl.pathname)
  } catch {
    return false
  }
}

/**
 * Apply a user prompt to fetched markdown content via the secondary model (Haiku).
 *
 * - For preapproved domains: Haiku can quote freely
 * - For other domains: strict 125-char quote limit, no exact reproduction
 * - If content exceeds MAX_MARKDOWN_LENGTH: truncates and appends a notice
 */
export async function applyPromptToMarkdown(
  prompt: string,
  markdownContent: string,
  signal: AbortSignal,
  isNonInteractiveSession: boolean,
  isPreapprovedDomain: boolean,
): Promise<string> {
  const wasTruncated = markdownContent.length > MAX_MARKDOWN_LENGTH
  const truncatedContent = wasTruncated
    ? markdownContent.slice(0, MAX_MARKDOWN_LENGTH) +
      '\n\n[Content truncated due to length...]'
    : markdownContent

  const modelPrompt = makeSecondaryModelPrompt(
    truncatedContent,
    prompt,
    isPreapprovedDomain,
  )
  const assistantMessage = await queryHaiku({
    systemPrompt: asSystemPrompt([]),
    userPrompt: modelPrompt,
    signal,
    options: {
      querySource: 'web_fetch_apply',
      agents: [],
      isNonInteractiveSession,
      hasAppendSystemPrompt: false,
      mcpTools: [],
    },
  })

  if (signal.aborted) {
    throw new AbortError()
  }

  const { content } = assistantMessage.message
  let result: string
  if (content.length > 0) {
    const contentBlock = content[0]
    if ('text' in contentBlock!) {
      result = contentBlock.text
    } else {
      result = 'No response from model'
    }
  } else {
    result = 'No response from model'
  }

  // Notify the main model that content was truncated — Haiku may not
  // mention this in its response, but Claude needs to know.
  if (wasTruncated) {
    result +=
      '\n\n[NOTE: The fetched content was truncated before processing because it exceeded the size limit. Some content at the end was not included.]'
  }

  return result
}
