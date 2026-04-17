/**
 * openaiContextWindows.ts
 * Context window sizes for OpenAI-compatible models used via the shim.
 * Fixes: auto-compact and warnings using wrong 200k default for OpenAI models.
 *
 * When CLAUDE_CODE_USE_OPENAI=1, getContextWindowForModel() falls through to
 * MODEL_CONTEXT_WINDOW_DEFAULT (200k). This causes the warning and blocking
 * thresholds to be set at 200k even for models like gpt-4o (128k) or llama3 (8k),
 * meaning users get no warning before hitting a hard API error.
 *
 * Prices in tokens as of April 2026 — update as needed.
 */

const OPENAI_CONTEXT_WINDOWS: Record<string, number> = {
  // GitHub Copilot — values from https://api.githubcopilot.com/models (2026-04-09)
  // Namespaced so they don't collide with bare model names from other providers.
  'github:copilot':                           128_000,
  // Claude
  'github:copilot:claude-sonnet-4':           216_000,
  'github:copilot:claude-haiku-4':            200_000,
  'github:copilot:claude-haiku-4.5':          144_000,
  'github:copilot:claude-sonnet-4.5':         200_000,
  'github:copilot:claude-sonnet-4.6':         200_000,
  'github:copilot:claude-opus-4':             200_000,
  'github:copilot:claude-opus-4.6':           200_000,
  // GPT
  'github:copilot:gpt-3.5-turbo':             16_384,
  'github:copilot:gpt-4':                     32_768,
  'github:copilot:gpt-4-0125-preview':       128_000,
  'github:copilot:gpt-4-o-preview':          128_000,
  'github:copilot:gpt-4.1':                  128_000,
  'github:copilot:gpt-4o':                   128_000,
  'github:copilot:gpt-4o-2024-08-06':        128_000,
  'github:copilot:gpt-4o-2024-11-20':        128_000,
  'github:copilot:gpt-4o-mini':              128_000,
  'github:copilot:gpt-5-mini':               264_000,
  'github:copilot:gpt-5.1':                  264_000,
  'github:copilot:gpt-5.2':                  400_000,
  'github:copilot:gpt-5.2-codex':            400_000,
  'github:copilot:gpt-5.3-codex':            400_000,
  'github:copilot:gpt-5.4':                  400_000,
  'github:copilot:gpt-5.4-mini':             400_000,
  // Gemini
  'github:copilot:gemini-2.5-pro':           128_000,
  'github:copilot:gemini-3-flash-preview':   128_000,
  'github:copilot:gemini-3.1-pro-preview':   200_000,
  // Grok
  'github:copilot:grok-code-fast-1':         256_000,

  // LiteLLM format — when OpenClaude talks to a LiteLLM proxy, Copilot models
  // keep their "<provider>/<model>" naming convention (standard LiteLLM routing)
  // instead of the "github:copilot:<model>" namespaced form used by /onboard-github.
  // Entries below cover the aliases currently exposed by LiteLLM's github_copilot
  // provider — this is a curated subset, not an exhaustive mirror of the
  // namespaced entries above. Values are sourced from copilotModels.ts to stay
  // consistent with the /onboard-github path.
  'github_copilot/claude-sonnet-4.6':        200_000,
  'github_copilot/claude-opus-4.6':          200_000,
  'github_copilot/claude-haiku-4.5':         144_000,
  'github_copilot/gpt-4.1':                  128_000,
  'github_copilot/gpt-4o':                   128_000,
  'github_copilot/gpt-5-mini':               264_000,
  'github_copilot/gpt-5.4':                  400_000,
  'github_copilot/gpt-5.4-mini':             400_000,
  'github_copilot/gemini-2.5-pro':           128_000,
  'github_copilot/gemini-3-flash':           128_000,
  'github_copilot/grok-code-fast-1':         256_000,

  // NOTE: bare Claude model names (e.g. 'claude-sonnet-4') are intentionally
  // omitted. Different OpenAI-compatible providers may impose different context
  // limits for the same model name, so we cannot safely hardcode values here.

  // OpenAI
  'gpt-5.4':               1_050_000,
  'gpt-5.4-mini':            400_000,
  'gpt-5.4-nano':            400_000,
  'gpt-4o':                   128_000,
  'gpt-4o-mini':              128_000,
  'gpt-4.1':                  1_047_576,
  'gpt-4.1-mini':             1_047_576,
  'gpt-4.1-nano':             1_047_576,
  'gpt-4-turbo':              128_000,
  'gpt-4':                     8_192,
  'o1':                       200_000,
  'o1-mini':                  128_000,
  'o1-preview':               128_000,
  'o1-pro':                   200_000,
  'o3':                       200_000,
  'o3-mini':                  200_000,
  'o4-mini':                  200_000,

  // DeepSeek (V3: 128k context per official docs)
  'deepseek-chat':            128_000,
  'deepseek-reasoner':        128_000,

  // Groq (fast inference)
  'llama-3.3-70b-versatile':  128_000,
  'llama-3.1-8b-instant':     128_000,
  'mixtral-8x7b-32768':        32_768,

  // Mistral
  'mistral-large-latest':     256_000,
  'mistral-small-latest':     256_000,
  'devstral-latest':          256_000,
  'ministral-3b-latest':      256_000,

  // NVIDIA NIM - popular models
  'nvidia/llama-3.1-nemotron-70b-instruct': 128_000,
  'nvidia/llama-3.1-nemotron-ultra-253b-v1': 128_000,
  'nvidia/nemotron-mini-4b-instruct': 32_768,
  'meta/llama-3.1-405b-instruct': 128_000,
  'meta/llama-3.1-70b-instruct': 128_000,
  'meta/llama-3.1-8b-instruct': 128_000,
  'meta/llama-3.2-90b-instruct': 128_000,
  'meta/llama-3.2-1b-instruct': 128_000,
  'meta/llama-3.2-3b-instruct': 128_000,
  'meta/llama-3.3-70b-instruct': 128_000,
  // Google Gemma via NVIDIA NIM
  'google/gemma-2-27b-it': 8_192,
  'google/gemma-2-9b-it': 8_192,
  'google/gemma-3-27b-it': 131_072,
  'google/gemma-3-12b-it': 131_072,
  'google/gemma-3-4b-it': 131_072,
  // DeepSeek via NVIDIA NIM
  'deepseek-ai/deepseek-r1': 128_000,
  'deepseek-ai/deepseek-v3': 128_000,
  'deepseek-ai/deepseek-v3.2': 128_000,
  // Qwen via NVIDIA NIM
  'qwen/qwen3-32b': 128_000,
  'qwen/qwen3-8b': 128_000,
  'qwen/qwen2.5-7b-instruct': 32_768,
  // Mistral via NVIDIA NIM
  'mistralai/mistral-large-3-675b-instruct-2512': 256_000,
  'mistralai/mistral-large-2-instruct': 256_000,
  'mistralai/mistral-small-3.1-24b-instruct-2503': 32_768,
  'mistralai/mixtral-8x7b-instruct-v0.1': 32_768,
  // Microsoft Phi via NVIDIA NIM
  'microsoft/phi-4-mini-instruct': 16_384,
  'microsoft/phi-3.5-mini-instruct': 16_384,
  'microsoft/phi-3-mini-128k-instruct': 128_000,
  // IBM Granite via NVIDIA NIM
  'ibm/granite-3.3-8b-instruct': 8_192,
  'ibm/granite-8b-code-instruct': 8_192,
  // GLM models via NVIDIA NIM
  'z-ai/glm5': 200_000,
  'z-ai/glm4.7': 128_000,
  // Kimi models via NVIDIA NIM
  'moonshotai/kimi-k2.5': 200_000,
  'moonshotai/kimi-k2-instruct': 128_000,
  // DBRX via NVIDIA NIM
  'databricks/dbrx-instruct': 131_072,
  // Jamba via NVIDIA NIM
  'ai21labs/jamba-1.5-large-instruct': 256_000,
  'ai21labs/jamba-1.5-mini-instruct': 256_000,
  // Yi via NVIDIA NIM
  '01-ai/yi-large': 32_768,

  // MiniMax (all M2.x variants share 204,800 context, 131,072 max output)
  'MiniMax-M2.7':             204_800,
  'MiniMax-M2.7-highspeed':   204_800,
  'MiniMax-M2.5':             204_800,
  'MiniMax-M2.5-highspeed':   204_800,
  'MiniMax-M2.1':             204_800,
  'MiniMax-M2.1-highspeed':   204_800,
  'minimax-m2.7':             204_800,
  'minimax-m2.7-highspeed':   204_800,
  'minimax-m2.5':             204_800,
  'minimax-m2.5-highspeed':   204_800,
  'minimax-m2.1':             204_800,
  'minimax-m2.1-highspeed':   204_800,

  // MiniMax new models
  'MiniMax-Text-01':          524_288,
  'MiniMax-Text-01-Preview':  262_144,
  'MiniMax-Vision-01':        32_768,
  'MiniMax-Vision-01-Fast':   16_384,
  'MiniMax-M2':               204_800,

  // Google (via OpenRouter)
  'google/gemini-2.0-flash':       1_048_576,
  'google/gemini-2.5-pro':         1_048_576,
  'google/gemini-3-flash-preview': 2_000_000, 
  'google/gemini-3.1-pro-preview': 2_000_000,

  // Google (native via CLAUDE_CODE_USE_GEMINI)
  'gemini-2.0-flash':       1_048_576,
  'gemini-2.5-pro':         1_048_576,
  'gemini-2.5-flash':       1_048_576,
  'gemini-3-flash-preview': 2_000_000,
  'gemini-3.1-pro-preview': 2_000_000,

  // Ollama local models
  // Llama 3.1+ models support 128k context natively (Meta official specs).
  // Ollama defaults to num_ctx=8192 but users can configure higher values.
  'llama3.3:70b':             128_000,
  'llama3.1:8b':              128_000,
  'llama3.2:3b':              128_000,
  'qwen2.5-coder:32b':        32_768,
  'qwen2.5-coder:7b':         32_768,
  'deepseek-coder-v2:16b':    163_840,
  'deepseek-r1:14b':           65_536,
  'mistral:7b':                32_768,
  'phi4:14b':                  16_384,
  'gemma2:27b':                 8_192,
  'codellama:13b':              16_384,
  'llama3.2:1b':              128_000,
  'qwen3:8b':                 128_000,
  'codestral':                 32_768,
}

/**
 * Max output (completion) tokens per model.
 * This is separate from the context window (input limit).
 * Fixes: 400 error "max_tokens is too large" when default 32k exceeds model limit.
 */
const OPENAI_MAX_OUTPUT_TOKENS: Record<string, number> = {
  // GitHub Copilot — values from https://api.githubcopilot.com/models (2026-04-09)
  'github:copilot':                            16_384,
  // Claude
  'github:copilot:claude-sonnet-4':            16_000,
  'github:copilot:claude-haiku-4':             64_000,
  'github:copilot:claude-haiku-4.5':           32_768,
  'github:copilot:claude-sonnet-4.5':          32_000,
  'github:copilot:claude-sonnet-4.6':          32_000,
  'github:copilot:claude-opus-4':              32_000,
  'github:copilot:claude-opus-4.6':            32_000,
  // GPT
  'github:copilot:gpt-3.5-turbo':              4_096,
  'github:copilot:gpt-4':                      4_096,
  'github:copilot:gpt-4-0125-preview':         4_096,
  'github:copilot:gpt-4-o-preview':            4_096,
  'github:copilot:gpt-4.1':                   16_384,
  'github:copilot:gpt-4o':                     4_096,
  'github:copilot:gpt-4o-2024-08-06':         16_384,
  'github:copilot:gpt-4o-2024-11-20':         16_384,
  'github:copilot:gpt-4o-mini':                4_096,
  'github:copilot:gpt-5-mini':                64_000,
  'github:copilot:gpt-5.1':                   64_000,
  'github:copilot:gpt-5.2':                  128_000,
  'github:copilot:gpt-5.2-codex':            128_000,
  'github:copilot:gpt-5.3-codex':            128_000,
  'github:copilot:gpt-5.4':                  128_000,
  'github:copilot:gpt-5.4-mini':             128_000,
  // Gemini
  'github:copilot:gemini-2.5-pro':            64_000,
  'github:copilot:gemini-3-flash-preview':    64_000,
  'github:copilot:gemini-3.1-pro-preview':    64_000,
  // Grok
  'github:copilot:grok-code-fast-1':          64_000,

  // LiteLLM format — see note on context windows above.
  'github_copilot/claude-sonnet-4.6':         32_000,
  'github_copilot/claude-opus-4.6':           32_000,
  'github_copilot/claude-haiku-4.5':          32_768,
  'github_copilot/gpt-4.1':                   16_384,
  'github_copilot/gpt-4o':                     4_096,
  'github_copilot/gpt-5-mini':                64_000,
  'github_copilot/gpt-5.4':                  128_000,
  'github_copilot/gpt-5.4-mini':             128_000,
  'github_copilot/gemini-2.5-pro':            64_000,
  'github_copilot/gemini-3-flash':            64_000,
  'github_copilot/grok-code-fast-1':          64_000,

  // NOTE: bare Claude model names omitted — see context windows comment above.

  // OpenAI
  'gpt-5.4':                 128_000,
  'gpt-5.4-mini':            128_000,
  'gpt-5.4-nano':            128_000,
  'gpt-4o':                   16_384,
  'gpt-4o-mini':              16_384,
  'gpt-4.1':                  32_768,
  'gpt-4.1-mini':             32_768,
  'gpt-4.1-nano':             32_768,
  'gpt-4-turbo':               4_096,
  'gpt-4':                     4_096,
  'o1':                       100_000,
  'o1-mini':                   65_536,
  'o1-preview':                32_768,
  'o1-pro':                   100_000,
  'o3':                       100_000,
  'o3-mini':                  100_000,
  'o4-mini':                  100_000,

  // DeepSeek
  'deepseek-chat':              8_192,
  'deepseek-reasoner':         32_768,

  // Groq
  'llama-3.3-70b-versatile':  32_768,
  'llama-3.1-8b-instant':      8_192,
  'mixtral-8x7b-32768':       32_768,

  // Mistral
  'mistral-large-latest':     32_768,
  'mistral-small-latest':     32_768,

  // MiniMax (all M2.x variants share 131,072 max output)
  'MiniMax-M2.7':            131_072,
  'MiniMax-M2.7-highspeed':  131_072,
  'MiniMax-M2.5':            131_072,
  'MiniMax-M2.5-highspeed':  131_072,
  'MiniMax-M2.1':            131_072,
  'MiniMax-M2.1-highspeed':  131_072,
  'minimax-m2.7':            131_072,
  'minimax-m2.7-highspeed':  131_072,
  'minimax-m2.5':            131_072,
  'minimax-m2.5-highspeed':  131_072,
  'minimax-m2.1':            131_072,
  'minimax-m2.1-highspeed':  131_072,
  // New MiniMax models
  'MiniMax-M2':              131_072,
  'MiniMax-Text-01':          65_536,
  'MiniMax-Text-01-Preview':  65_536,
  'MiniMax-Vision-01':        16_384,
  'MiniMax-Vision-01-Fast':    16_384,

  // Google (via OpenRouter)
  'google/gemini-2.0-flash':       8_192,
  'google/gemini-2.5-pro':         65_536,
  'google/gemini-3-flash-preview': 65_536,
  'google/gemini-3.1-pro-preview': 65_536,

  // Google (native via CLAUDE_CODE_USE_GEMINI)
  'gemini-2.0-flash':          8_192,
  'gemini-2.5-pro':           65_536,
  'gemini-2.5-flash':         65_536,
  'gemini-3-flash-preview':   65_536,
  'gemini-3.1-pro-preview':   65_536,

  // Ollama local models (conservative safe defaults)
  'llama3.3:70b':               4_096,
  'llama3.1:8b':                4_096,
  'llama3.2:3b':                4_096,
  'qwen2.5-coder:32b':         8_192,
  'qwen2.5-coder:7b':          8_192,
  'deepseek-coder-v2:16b':     8_192,
  'deepseek-r1:14b':            8_192,
  'mistral:7b':                 4_096,
  'phi4:14b':                   4_096,

  // NVIDIA NIM models
  'nvidia/llama-3.1-nemotron-70b-instruct': 32_768,
  'nvidia/nemotron-mini-4b-instruct': 8_192,
  'meta/llama-3.1-405b-instruct': 32_768,
  'meta/llama-3.1-70b-instruct': 32_768,
  'meta/llama-3.2-90b-instruct': 32_768,
  'meta/llama-3.3-70b-instruct': 32_768,
  'google/gemma-2-27b-it': 4_096,
  'google/gemma-3-27b-it': 16_384,
  'google/gemma-3-12b-it': 16_384,
  'deepseek-ai/deepseek-r1': 32_768,
  'deepseek-ai/deepseek-v3': 32_768,
  'deepseek-ai/deepseek-v3.2': 32_768,
  'qwen/qwen3-32b': 32_768,
  'qwen/qwen2.5-7b-instruct': 8_192,
  'mistralai/mistral-large-3-675b-instruct-2512': 32_768,
  'mistralai/mixtral-8x7b-instruct-v0.1': 8_192,
  'microsoft/phi-4-mini-instruct': 4_096,
  'microsoft/phi-3.5-mini-instruct': 4_096,
  'ibm/granite-3.3-8b-instruct': 4_096,
  'z-ai/glm5': 32_768,
  'moonshotai/kimi-k2.5': 32_768,
  'databricks/dbrx-instruct': 32_768,
  'ai21labs/jamba-1.5-large-instruct': 32_768,
  '01-ai/yi-large': 8_192,
}

function lookupByModel<T>(table: Record<string, T>, model: string): T | undefined {
  // Try provider-qualified key first: "{OPENAI_MODEL}:{model}" so that
  // e.g. "github:copilot:claude-haiku-4.5" can have different limits than
  // a bare "claude-haiku-4.5" served by another provider.
  const providerModel = process.env.OPENAI_MODEL?.trim()
  if (providerModel && providerModel !== model) {
    const qualified = `${providerModel}:${model}`
    const qualifiedResult = lookupByKey(table, qualified)
    if (qualifiedResult !== undefined) return qualifiedResult
  }
  return lookupByKey(table, model)
}

function lookupByKey<T>(table: Record<string, T>, model: string): T | undefined {
  if (table[model] !== undefined) return table[model]
  // Sort keys by length descending so the most specific prefix wins.
  // Without this, 'gpt-4-turbo-preview' could match 'gpt-4' (8k) instead
  // of 'gpt-4-turbo' (128k) depending on V8's key iteration order.
  const sortedKeys = Object.keys(table).sort((a, b) => b.length - a.length)
  for (const key of sortedKeys) {
    if (model.startsWith(key)) return table[key]
  }
  return undefined
}

/**
 * Look up the context window for an OpenAI-compatible model.
 * Returns undefined if the model is not in the table.
 *
 * Falls back to prefix matching so dated variants like
 * "gpt-4o-2024-11-20" resolve to the base "gpt-4o" entry.
 */
export function getOpenAIContextWindow(model: string): number | undefined {
  return lookupByModel(OPENAI_CONTEXT_WINDOWS, model)
}

/**
 * Look up the max output tokens for an OpenAI-compatible model.
 * Returns undefined if the model is not in the table.
 */
export function getOpenAIMaxOutputTokens(model: string): number | undefined {
  return lookupByModel(OPENAI_MAX_OUTPUT_TOKENS, model)
}
