const HY3_PARAMETER_RE = /<parameter\s+name=["']([^"'>\s]+)["']\s*>([\s\S]*?)<\/parameter>/g

function extractBalancedJson(text: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]!
    if (escape) { escape = false; continue }
    if (char === '\\' && inString) { escape = true; continue }
    if (char === '"') { inString = !inString; continue }
    if (inString) continue
    if (char === '{') depth++
    else if (char === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  return null
}
const HY3_NAMED_ARGUMENT_LINE_RE = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*$/gm
const HY3_ARG_PAIR_RE = /<arg_key(?::[^>\s]+)?>([\s\S]*?)<\/arg_key(?::[^>\s]+)?>\s*<arg_value(?::[^>\s]+)?>([\s\S]*?)<\/arg_value(?::[^>\s]+)?>/g

export function coerceXmlToolValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  try {
    return JSON.parse(trimmed)
  } catch {
    return raw
  }
}

export function parseHy3ToolCallInner(inner: string): {
  name?: string
  args: Record<string, unknown>
} {
  const args: Record<string, unknown> = {}
  const trimmed = inner.trim()
  const name = trimmed.split(/[\n<]/, 1)[0]?.trim().replace(/[\s`*_]+$/, '')
  let hasStructuredArguments = false
  for (const parameter of inner.matchAll(HY3_PARAMETER_RE)) {
    const key = parameter[1]
    if (key) { hasStructuredArguments = true; args[key] = coerceXmlToolValue(parameter[2] ?? '') }
  }
  for (const line of inner.matchAll(HY3_NAMED_ARGUMENT_LINE_RE)) {
    const key = line[1]
    if (key) { hasStructuredArguments = true; args[key] = coerceXmlToolValue(line[2] ?? '') }
  }
  for (const pair of inner.matchAll(HY3_ARG_PAIR_RE)) {
    const key = pair[1]?.trim()
    if (key) { hasStructuredArguments = true; args[key] = coerceXmlToolValue(pair[2] ?? '') }
  }
  return {
    name: name && /^[A-Za-z_][\w.-]*$/.test(name) && (hasStructuredArguments || trimmed === name) ? name : undefined,
    args,
  }
}

export interface ParsedXmlToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}
let xmlToolCallCounter = 0

const XML_TOOL_CALL_OPEN = '<tool_call>'
const HY3_TOOL_CALLS_OPEN = '<tool_calls:'
const HY3_TOOL_CALL_OPEN = '<tool_call:'
const XML_TOOL_CALL_OPENERS = [
  XML_TOOL_CALL_OPEN,
  HY3_TOOL_CALLS_OPEN,
  HY3_TOOL_CALL_OPEN,
]
// Non-greedy block matcher; the `$` alternative tolerates a truncated final
// block (stream cut off before the closing tag).
const XML_TOOL_CALL_BLOCK_RE = /<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/g
const HY3_TOOL_CALLS_BLOCK_RE = /<tool_calls:[^>\s]+>([\s\S]*?)(?:<\/tool_calls(?::[^>\s]+)?>|$)/g
const HY3_TOOL_CALL_BLOCK_RE = /<tool_call:[^>\s]+>([\s\S]*?)(?:<\/tool_call(?::[^>\s]+)?>|$)/g
const XML_FUNCTION_NAME_RE = /<function=([^>\s]+)\s*>/
const XML_PARAMETER_RE = /<parameter=([^>\s]+)\s*>([\s\S]*?)<\/parameter>/g
const XML_ARG_PAIR_RE = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g
export function isHy3Model(model: string): boolean {
  return model.split('?', 1)[0]?.toLowerCase() === 'tencent/hy3'
}

/**
 * Returns the length of the longest suffix of `s` that is a (proper) prefix of
 * the `<tool_call>` opener. Used by the stream to hold back a trailing partial
 * opener split across SSE deltas so it is never emitted as visible text.
 */
export function trailingXmlOpenerPrefixLen(s: string, allowHy3: boolean): number {
  let longest = 0
  const openers = allowHy3 ? XML_TOOL_CALL_OPENERS : [XML_TOOL_CALL_OPEN]
  for (const opener of openers) {
    const max = Math.min(s.length, opener.length - 1)
    for (let len = max; len > 0; len--) {
      if (opener.startsWith(s.slice(s.length - len))) {
        longest = Math.max(longest, len)
        break
      }
    }
  }
  return longest
}

export function findXmlToolCallOpener(text: string, allowHy3: boolean): number {
  const openers = allowHy3 ? XML_TOOL_CALL_OPENERS : [XML_TOOL_CALL_OPEN]
  return openers.reduce((first, opener) => {
    const index = text.indexOf(opener)
    return index === -1 ? first : first === -1 ? index : Math.min(first, index)
  }, -1)
}

/** Exported for unit testing only. */
export function parseXmlToolCalls(text: string, allowHy3 = false): {
  calls: ParsedXmlToolCall[]
  toolCallRanges: Array<[number, number]>
} {
  const results: ParsedXmlToolCall[] = []
  const seen = new Set<string>()
  const ranges: Array<[number, number]> = []

  const addCall = (name: string, args: Record<string, unknown>) => {
    const dedupKey = `${name}:${JSON.stringify(args)}`
    if (seen.has(dedupKey)) return
    seen.add(dedupKey)
    results.push({ id: `xml_tc_${++xmlToolCallCounter}`, name, arguments: args })
  }

  const hy3Blocks = allowHy3
    ? [...text.matchAll(HY3_TOOL_CALL_BLOCK_RE)].map(block => ({
      range: [block.index!, block.index! + block[0].length] as [number, number],
      parsed: parseHy3ToolCallInner(block[1] ?? ''),
    }))
    : []
  const hy3WrapperRanges = allowHy3
    ? [...text.matchAll(HY3_TOOL_CALLS_BLOCK_RE)]
      .filter(wrapper => {
        const range: [number, number] = [
          wrapper.index!,
          wrapper.index! + wrapper[0].length,
        ]
        return hy3Blocks.some(
          block => block.parsed.name && range[0] <= block.range[0] && block.range[1] <= range[1],
        )
      })
      .map(wrapper => [
        wrapper.index!,
        wrapper.index! + wrapper[0].length,
      ] as [number, number])
    : []

  for (const block of hy3Blocks) {
    const { name, args } = block.parsed
    if (!name) continue
    const range = block.range
    if (!hy3WrapperRanges.some(wrapper => wrapper[0] <= range[0] && range[1] <= wrapper[1])) {
      ranges.push(range)
    }
    addCall(name, args)
  }

  ranges.push(...hy3WrapperRanges)

  for (const block of text.matchAll(XML_TOOL_CALL_BLOCK_RE)) {
    const inner = block[1] ?? ''
    const range: [number, number] = [
      block.index!,
      block.index! + block[0].length,
    ]
    let name: string | undefined
    const args: Record<string, unknown> = {}

    const fnMatch = inner.match(XML_FUNCTION_NAME_RE)
    if (fnMatch) {
      // Dialect A: <function=NAME><parameter=KEY>VALUE</parameter>…
      name = fnMatch[1]
      for (const p of inner.matchAll(XML_PARAMETER_RE)) {
        const key = p[1]
        if (key) args[key] = coerceXmlToolValue(p[2] ?? '')
      }
    } else {
      const trimmedInner = inner.trim()
      const argPairs = [...inner.matchAll(XML_ARG_PAIR_RE)]
      if (argPairs.length > 0 && !trimmedInner.startsWith('{')) {
        // Dialect B: leading token is the function name, then arg_key/arg_value.
        const nameTok = trimmedInner.split(/[\n<]/, 1)[0]?.trim()
        if (nameTok) name = nameTok
        for (const p of argPairs) {
          const key = (p[1] ?? '').trim()
          if (key) args[key] = coerceXmlToolValue(p[2] ?? '')
        }
      } else {
        // Dialect C: a JSON tool-call object inside the tags.
        const jsonStart = trimmedInner.indexOf('{')
        if (jsonStart !== -1) {
          const jsonRaw = extractBalancedJson(trimmedInner, jsonStart)
          if (jsonRaw) {
            try {
              const obj = JSON.parse(jsonRaw) as Record<string, unknown>
              if (typeof obj['name'] === 'string') {
                name = obj['name'] as string
                const rawArgs = obj['arguments']
                if (typeof rawArgs === 'string') {
                  try {
                    Object.assign(args, JSON.parse(rawArgs))
                  } catch {}
                } else if (rawArgs && typeof rawArgs === 'object') {
                  Object.assign(args, rawArgs as Record<string, unknown>)
                }
              }
            } catch {}
          }
        }
      }
    }

    if (!name) continue
    ranges.push(range)
    addCall(name, args)
  }

  return { calls: results, toolCallRanges: ranges }
}
