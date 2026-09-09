/** Serializable agent consumption. Estimates never enter confirmed usage/cost fields. */
export type AgentTokenUsage = {
  confirmed: number
  estimated: number
  state: 'pending' | 'estimated' | 'reported'
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}
export type AgentUsageUpdate = { executionId: string; usage: AgentTokenUsage; final?: boolean }

type RecordValue = Record<string, unknown>
function object(value: unknown): RecordValue {
  return typeof value === 'object' && value !== null ? value as RecordValue : {}
}
function validNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
function hasInputUsage(value: RecordValue): boolean {
  return validNumber(value.input_tokens)
}
function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}
export function emptyAgentUsage(): AgentTokenUsage {
  return { confirmed: 0, estimated: 0, state: 'pending', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
}
export function combineAgentUsage(values: Iterable<AgentTokenUsage>): AgentTokenUsage {
  const total = emptyAgentUsage()
  let seen = false
  let unreported = false
  for (const value of values) {
    seen = true
    total.inputTokens += value.inputTokens
    total.outputTokens += value.outputTokens
    total.cacheReadTokens += value.cacheReadTokens
    total.cacheCreationTokens += value.cacheCreationTokens
    total.estimated += value.estimated
    unreported ||= value.state !== 'reported'
  }
  total.confirmed = total.inputTokens + total.outputTokens + total.cacheReadTokens + total.cacheCreationTokens
  total.state = seen && !unreported ? 'reported' : total.estimated || total.confirmed ? 'estimated' : 'pending'
  return total
}

type ResponseUsage = {
  usage: RecordValue
  inputKnown: boolean
  reported: boolean
  outputKnown: boolean
  characters: number
  inputEstimate: number
  streamed: boolean
  blocks: Set<string>
}

/** Consume events before runAgent filters streaming deltas. One entry per response attempt. */
export class AgentUsageAccumulator {
  private responses: ResponseUsage[] = []
  private byId = new Map<string, ResponseUsage>()
  private active: ResponseUsage | undefined
  constructor(private inputEstimate = 0) {}

  observe(value: unknown): void {
    const item = object(value)
    if (item.type === 'stream_request_start') { this.active = undefined; return }
    if (item.type === 'stream_event') {
      const event = object(item.event)
      if (event.type === 'message_start') {
        const message = object(event.message)
        this.active = this.create(true)
        if (typeof message.id === 'string') this.byId.set(message.id, this.active)
        if (message.usageReported !== false && message.usage != null) {
          this.active.usage = object(message.usage)
          this.active.inputKnown = message.usageInputReported !== false && hasInputUsage(object(message.usage))
        }
      } else if (this.active && event.type === 'content_block_delta') {
        const delta = object(event.delta)
        for (const key of ['text', 'thinking', 'partial_json']) {
          if (typeof delta[key] === 'string') this.active.characters += delta[key].length
        }
      } else if (this.active && event.type === 'message_delta' && event.usage != null) {
        // Usage is cumulative within a response, never an additive delta.
        const usage = object(event.usage)
        for (const key of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) {
          this.active.usage[key] = Math.max(number(this.active.usage[key]), number(usage[key]))
        }
        this.active.inputKnown ||= event.usageInputReported !== false && hasInputUsage(usage)
        this.active.outputKnown ||= event.usageOutputReported !== false && validNumber(usage.output_tokens)
        this.active.reported = this.active.inputKnown && this.active.outputKnown
      }
      return
    }
    if (item.type !== 'assistant' || item.isVirtual || item.isApiErrorMessage) return
    const message = object(item.message)
    if (message.model === '<synthetic>') return
    const id = typeof message.id === 'string' ? message.id : String(item.uuid ?? this.responses.length)
    let response = this.byId.get(id)
    if (!response) {
      response = this.create(false)
      this.byId.set(id, response)
    }
    // Finalized/replayed records carry usage; live content_block_stop records do not yet.
    if (message.usageReported !== false && message.usage != null) {
      const usage = object(message.usage)
      if (!response.streamed) {
        for (const key of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) {
          response.usage[key] = Math.max(number(response.usage[key]), number(usage[key]))
        }
        response.inputKnown ||= message.usageInputReported !== false && hasInputUsage(usage)
        response.outputKnown ||= message.usageOutputReported !== false && validNumber(usage.output_tokens)
        response.reported = response.inputKnown && response.outputKnown
      }
    }
    if (!response.streamed && Array.isArray(message.content)) {
      for (const [index, raw] of message.content.entries()) {
        const block = object(raw)
        const key = String(block.id ?? `${item.uuid ?? id}:${index}`)
        if (response.blocks.has(key)) continue
        response.blocks.add(key)
        const text = typeof block.text === 'string' ? block.text : typeof block.thinking === 'string' ? block.thinking : JSON.stringify(block.input ?? '')
        response.characters += text.length
      }
    }
  }

  private create(streamed: boolean): ResponseUsage {
    const response: ResponseUsage = { usage: {}, inputKnown: false, reported: false, outputKnown: false, characters: 0, inputEstimate: this.inputEstimate, streamed, blocks: new Set() }
    this.responses.push(response)
    return response
  }

  snapshot(): AgentTokenUsage {
    return combineAgentUsage(this.responses.map(response => {
      const result = emptyAgentUsage()
      result.inputTokens = number(response.usage.input_tokens)
      result.outputTokens = number(response.usage.output_tokens)
      result.cacheReadTokens = number(response.usage.cache_read_input_tokens)
      result.cacheCreationTokens = number(response.usage.cache_creation_input_tokens)
      result.confirmed = result.inputTokens + result.outputTokens + result.cacheReadTokens + result.cacheCreationTokens
      if (!response.reported && response.characters) {
        result.estimated = Math.max(0, Math.ceil(response.characters / 4) - result.outputTokens) + (response.inputKnown ? 0 : Math.max(0, response.inputEstimate - result.inputTokens - result.cacheReadTokens - result.cacheCreationTokens))
      }
      result.state = response.reported ? 'reported' : result.estimated || result.confirmed ? 'estimated' : 'pending'
      return result
    }))
  }
}

/** Legacy transcripts can split one response across several assistant records. */
export function agentUsageFromMessages(messages: readonly unknown[]): AgentTokenUsage {
  const accumulator = new AgentUsageAccumulator()
  for (const message of messages) accumulator.observe(message)
  return accumulator.snapshot()
}

export function agentUsageDisplay(usage: AgentTokenUsage | undefined, legacyTokens?: number | null, format: (n: number) => string = String): string {
  if (!usage) return legacyTokens == null ? 'Awaiting response' : `${format(legacyTokens)} tokens`
  if (usage.state === 'pending') return 'Awaiting response'
  return `${usage.state === 'estimated' ? '~' : ''}${format(usage.confirmed + usage.estimated)} tokens`
}

/** Coalesce paints, including the last delta of a stream that then stalls. */
export function createUsagePublisher(callback: ((update: AgentUsageUpdate) => void) | undefined) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: AgentUsageUpdate | undefined
  let previous = ''
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (!pending) return
    const update = pending
    pending = undefined
    const signature = JSON.stringify(update)
    if (signature !== previous) { previous = signature; callback?.(update) }
  }
  return {
    update(value: AgentUsageUpdate, immediate = false) {
      pending = value
      if (immediate) flush()
      else if (!timer) { timer = setTimeout(flush, 100); timer.unref?.() }
    },
    flush,
  }
}
