import type { ContentBlockParam } from '@anthropic-ai/sdk/resources'
import { randomUUID } from 'crypto'
import { setPromptId } from 'src/bootstrap/state.js'
import type {
  AttachmentMessage,
  SystemMessage,
  UserMessage,
} from 'src/types/message.js'
import { logEvent } from '../../services/analytics/index.js'
import type { PermissionMode } from '../../types/permissions.js'
import { createUserMessage } from '../messages.js'
import { logOTelEvent, redactIfDisabled } from '../telemetry/events.js'
import { startInteractionSpan } from '../telemetry/sessionTracing.js'
import {
  matchesKeepGoingKeyword,
  matchesNegativeKeyword,
} from '../userPromptKeywords.js'

function getPentestStrictSuffix(): string {
  return '\n\n[PentestStrict] 输出必须工程化：禁止伪代码、禁止 TODO、优先给可运行实现与可验证步骤。'
}

function applyPentestStrictToInput(
  input: string | Array<ContentBlockParam>,
): string | Array<ContentBlockParam> {
  if (process.env.OPENCLAUDE_PENTEST_STRICT !== '1') {
    return input
  }
  if (typeof input === 'string') {
    return `${input}${getPentestStrictSuffix()}`
  }
  return input.map(block => {
    if (block.type !== 'text') return block
    return {
      ...block,
      text: `${block.text}${getPentestStrictSuffix()}`,
    }
  })
}

export function processTextPrompt(
  input: string | Array<ContentBlockParam>,
  imageContentBlocks: ContentBlockParam[],
  imagePasteIds: number[],
  attachmentMessages: AttachmentMessage[],
  uuid?: string,
  permissionMode?: PermissionMode,
  isMeta?: boolean,
): {
  messages: (UserMessage | AttachmentMessage | SystemMessage)[]
  shouldQuery: boolean
} {
  const normalizedInput = applyPentestStrictToInput(input)
  const promptId = randomUUID()
  setPromptId(promptId)

  const userPromptText =
    typeof normalizedInput === 'string'
      ? normalizedInput
      : normalizedInput.find(block => block.type === 'text')?.text || ''
  startInteractionSpan(userPromptText)

  // Emit user_prompt OTEL event for both string (CLI) and array (SDK/VS Code)
  // input shapes. Previously gated on `typeof input === 'string'`, so VS Code
  // sessions never emitted user_prompt (anthropics/claude-code#33301).
  // For array input, use the LAST text block: createUserContent pushes the
  // user's message last (after any <ide_selection>/attachment context blocks),
  // so .findLast gets the actual prompt. userPromptText (first block) is kept
  // unchanged for startInteractionSpan to preserve existing span attributes.
  const otelPromptText =
    typeof normalizedInput === 'string'
      ? normalizedInput
      : normalizedInput.findLast(block => block.type === 'text')?.text || ''
  if (otelPromptText) {
    void logOTelEvent('user_prompt', {
      prompt_length: String(otelPromptText.length),
      prompt: redactIfDisabled(otelPromptText),
      'prompt.id': promptId,
    })
  }

  const isNegative = matchesNegativeKeyword(userPromptText)
  const isKeepGoing = matchesKeepGoingKeyword(userPromptText)
  logEvent('tengu_input_prompt', {
    is_negative: isNegative,
    is_keep_going: isKeepGoing,
  })

  // If we have pasted images, create a message with image content
  if (imageContentBlocks.length > 0) {
    // Build content: text first, then images below
    const textContent =
      typeof normalizedInput === 'string'
        ? normalizedInput.trim()
          ? [{ type: 'text' as const, text: normalizedInput }]
          : []
        : normalizedInput
    const userMessage = createUserMessage({
      content: [...textContent, ...imageContentBlocks],
      uuid: uuid,
      imagePasteIds: imagePasteIds.length > 0 ? imagePasteIds : undefined,
      permissionMode,
      isMeta: isMeta || undefined,
    })

    return {
      messages: [userMessage, ...attachmentMessages],
      shouldQuery: true,
    }
  }

  const userMessage = createUserMessage({
    content: normalizedInput,
    uuid,
    permissionMode,
    isMeta: isMeta || undefined,
  })

  return {
    messages: [userMessage, ...attachmentMessages],
    shouldQuery: true,
  }
}
