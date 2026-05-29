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

type GeminiVertexResponse = {
  candidates?: Array<{
    content?: {
      role?: string
      parts?: Array<{ text?: string }>
    }
  }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
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

      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-goog-user-project': options.project,
        },
        body: JSON.stringify({
          contents: toGeminiContents(params.messages),
          generationConfig: {
            maxOutputTokens: params.max_tokens,
            temperature: params.temperature,
          },
        }),
      })
      capturedResponse = response

      if (!response.ok) {
        const body = await response.text()
        throw new Error(`Gemini Vertex request failed: ${response.status} ${body}`)
      }

      const json = (await response.json()) as GeminiVertexResponse
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
        content: [{ type: 'text', text: extractText(json) }],
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
