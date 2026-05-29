import type { ClientOptions } from '@anthropic-ai/sdk'
import type { MessageCreateParamsBase } from '@anthropic-ai/sdk/resources/messages/messages'

type AccessTokenProvider = () => Promise<string>

type GeminiVertexClientOptions = {
  project: string
  location: string
  model: string
  getAccessToken: AccessTokenProvider
  fetch?: NonNullable<ClientOptions['fetch']>
}

type GeminiVertexPart = { text: string }
type GeminiVertexContent = { role: 'user' | 'model'; parts: GeminiVertexPart[] }
type GeminiVertexSystemInstruction = { parts: GeminiVertexPart[] }

type GeminiVertexSafetyRating = {
  category?: string
  probability?: string
  blocked?: boolean
}

type GeminiVertexResponse = {
  candidates?: Array<{
    content?: {
      role?: string
      parts?: Array<{ text?: string }>
    }
    finishReason?: string
    safetyRatings?: GeminiVertexSafetyRating[]
  }>
  promptFeedback?: {
    blockReason?: string
    blockReasonMessage?: string
    safetyRatings?: GeminiVertexSafetyRating[]
  }
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
    thoughtsTokenCount?: number
  }
}

function summarizeBlockedSafetyRatings(
  ratings: GeminiVertexSafetyRating[] | undefined,
): string {
  if (!ratings?.length) return ''
  const blocked = ratings
    .filter(r => r.blocked || r.probability === 'HIGH' || r.probability === 'MEDIUM')
    .map(r => `${r.category ?? '?'}=${r.probability ?? '?'}`)
  return blocked.length ? ` (${blocked.join(', ')})` : ''
}

// Thinking-capable Vertex Gemini models spend a chunk of maxOutputTokens on
// internal reasoning (thoughtsTokenCount) before emitting any visible text.
// If openclaude passes a tight budget — common for the first turn of a chat —
// the model burns the entire allotment thinking and the response comes back
// with finishReason=MAX_TOKENS and no `parts`. Boost the floor for these
// families so a simple greeting actually produces a reply.
const THINKING_MODEL_PREFIXES = ['gemini-3.', 'gemini-2.5-pro']
const THINKING_MODEL_MIN_OUTPUT_TOKENS = 8192

function isThinkingModel(model: string): boolean {
  const lower = model.toLowerCase()
  return THINKING_MODEL_PREFIXES.some(prefix => lower.startsWith(prefix))
}

type GeminiVertexMessage = {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  stop_reason: 'end_turn'
  stop_sequence: null
  usage: { input_tokens: number; output_tokens: number }
  content: Array<{ type: 'text'; text: string }>
}

export type GeminiVertexStreamEvent =
  | { type: 'message_start'; message: GeminiVertexMessage }
  | { type: 'content_block_start'; index: number; content_block: { type: 'text'; text: string } }
  | { type: 'content_block_delta'; index: number; delta: { type: 'text_delta'; text: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: 'end_turn'; stop_sequence: null }; usage: { output_tokens: number } }
  | { type: 'message_stop' }

type GeminiVertexWithResponseResult = {
  data: AsyncGenerator<GeminiVertexStreamEvent>
  response: Response
  request_id: string
}

type GeminiVertexPromise = Promise<GeminiVertexMessage> & {
  withResponse(): Promise<GeminiVertexWithResponseResult>
}

function toGeminiContents(
  messages: MessageCreateParamsBase['messages'],
): GeminiVertexContent[] {
  return messages.map(message => {
    const text = typeof message.content === 'string'
      ? message.content
      : message.content
          .map(block => ('text' in block && typeof block.text === 'string' ? block.text : ''))
          .filter(Boolean)
          .join('\n')

    return {
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text }],
    }
  })
}

// openclaude ships a large coding-agent system prompt as params.system. Vertex
// expects it in the top-level `systemInstruction` field — passing it inside
// `contents` would lose its role and confuse the model. Returns undefined if
// the caller didn't send one (so we don't emit an empty instruction object).
function toGeminiSystemInstruction(
  system: MessageCreateParamsBase['system'],
): GeminiVertexSystemInstruction | undefined {
  if (!system) {
    return undefined
  }
  const text = typeof system === 'string'
    ? system
    : system
        .map(block => ('text' in block && typeof block.text === 'string' ? block.text : ''))
        .filter(Boolean)
        .join('\n')
  if (!text.trim()) {
    return undefined
  }
  return { parts: [{ text }] }
}

function extractText(response: GeminiVertexResponse): string {
  return response.candidates?.[0]?.content?.parts
    ?.map(part => part.text ?? '')
    .join('') ?? ''
}

async function* toAnthropicStream(message: GeminiVertexMessage): AsyncGenerator<GeminiVertexStreamEvent> {
  const text = message.content[0]?.text ?? ''
  yield { type: 'message_start', message }
  yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
  if (text) {
    yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }
  }
  yield { type: 'content_block_stop', index: 0 }
  yield {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: message.usage.output_tokens },
  }
  yield { type: 'message_stop' }
}

export function createGeminiVertexClient(options: GeminiVertexClientOptions) {
  const fetchImpl = options.fetch ?? fetch

  const create = (params: MessageCreateParamsBase & { stream?: boolean }): GeminiVertexPromise => {
    let capturedResponse: Response | undefined
    const promise = (async (): Promise<GeminiVertexMessage> => {
      const model = options.model
      const token = await options.getAccessToken()
      const host = options.location === 'global'
        ? 'aiplatform.googleapis.com'
        : `${options.location}-aiplatform.googleapis.com`
      const url = `https://${host}/v1/projects/${options.project}/locations/${options.location}/publishers/google/models/${model}:generateContent`

      // For thinking models, raise the floor so the model has room to think
      // *and* still emit visible output. Honor the caller's value when it's
      // already large enough — only boost when the requested budget would
      // certainly be eaten by the thinking phase.
      const requestedMaxTokens = params.max_tokens
      const effectiveMaxTokens = isThinkingModel(model)
        ? Math.max(requestedMaxTokens ?? 0, THINKING_MODEL_MIN_OUTPUT_TOKENS)
        : requestedMaxTokens

      const systemInstruction = toGeminiSystemInstruction(params.system)

      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-goog-user-project': options.project,
        },
        body: JSON.stringify({
          contents: toGeminiContents(params.messages),
          ...(systemInstruction ? { systemInstruction } : {}),
          generationConfig: {
            ...(effectiveMaxTokens !== undefined
              ? { maxOutputTokens: effectiveMaxTokens }
              : {}),
            ...(params.temperature !== undefined
              ? { temperature: params.temperature }
              : {}),
          },
        }),
      })
      capturedResponse = response

      if (!response.ok) {
        const body = await response.text()
        throw new Error(`Gemini Vertex request failed: ${response.status} ${body}`)
      }

      const json = (await response.json()) as GeminiVertexResponse
      const text = extractText(json)
      const candidate = json.candidates?.[0]
      const finishReason = candidate?.finishReason
      const thoughtsTokenCount = json.usageMetadata?.thoughtsTokenCount ?? 0

      // Surface every silent-empty-response path explicitly. Without these
      // guards an empty assistant message (text === '') is filtered out
      // downstream by isNotEmptyMessage and the user sees nothing at all —
      // no chat reply, no error, no clue. We'd rather raise a descriptive
      // error so the failure mode is visible and actionable.
      if (!text) {
        // 1. Prompt-level block: Vertex refuses to process the input before
        //    producing any candidate (safety filter at the prompt layer).
        const promptBlock = json.promptFeedback?.blockReason
        if (promptBlock) {
          const detail =
            json.promptFeedback?.blockReasonMessage ??
            summarizeBlockedSafetyRatings(json.promptFeedback?.safetyRatings)
          throw new Error(
            `Gemini Vertex blocked the prompt (${promptBlock})${detail ? `: ${detail}` : ''}. ` +
              `Try a less sensitive prompt or another Vertex model.`,
          )
        }

        // 2. Thinking model exhausted its output budget on internal reasoning.
        if (finishReason === 'MAX_TOKENS') {
          const usedForThinking = thoughtsTokenCount > 0
            ? ` (${thoughtsTokenCount} tokens consumed by internal thinking)`
            : ''
          throw new Error(
            `Gemini Vertex returned no visible text: hit MAX_TOKENS${usedForThinking}. ` +
              `Model "${model}" likely needs a larger maxOutputTokens budget. ` +
              `Try a non-thinking model (e.g. gemini-2.5-flash) or raise the budget.`,
          )
        }

        // 3. Candidate-level safety / recitation / blocklist refusal.
        if (
          finishReason === 'SAFETY' ||
          finishReason === 'RECITATION' ||
          finishReason === 'BLOCKLIST' ||
          finishReason === 'PROHIBITED_CONTENT' ||
          finishReason === 'SPII'
        ) {
          const detail = summarizeBlockedSafetyRatings(candidate?.safetyRatings)
          throw new Error(
            `Gemini Vertex refused to answer (${finishReason})${detail}. ` +
              `Try rephrasing or another Vertex model.`,
          )
        }

        // 4. Catch-all: model finished normally (STOP / OTHER / undefined)
        //    but produced no text. Surface it instead of swallowing.
        throw new Error(
          `Gemini Vertex returned an empty response from "${model}"` +
            `${finishReason ? ` (finishReason: ${finishReason})` : ''}. ` +
            `This usually means the model couldn't generate output for this prompt — try another model or rephrase.`,
        )
      }

      return {
        id: `gemini-vertex-${Date.now()}`,
        type: 'message',
        role: 'assistant',
        model,
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: json.usageMetadata?.promptTokenCount ?? 0,
          output_tokens: json.usageMetadata?.candidatesTokenCount ?? 0,
        },
        content: [{ type: 'text', text }],
      }
    })()

    const typed = promise as GeminiVertexPromise
    typed.withResponse = async () => {
      const data = await promise
      const response = capturedResponse ?? new Response()
      return {
        data: toAnthropicStream(data),
        response,
        request_id: response.headers.get('x-request-id') ?? data.id,
      }
    }

    return typed
  }

  const messages = { create }

  return {
    messages,
    beta: { messages },
  }
}
