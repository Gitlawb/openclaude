/**
 * NVIDIA NIM model list for the /model picker.
 * Full model catalog from NVIDIA NIM API.
 */

import type { ModelOption } from './modelOptions.js'
import { getAPIProvider } from './providers.js'
import { isEnvTruthy } from '../envUtils.js'

export function isNvidiaNimProvider(): boolean {
  // Check if explicitly set via NVIDIA_NIM or via provider flag
  if (isEnvTruthy(process.env.NVIDIA_NIM)) {
    return true
  }
  // Also check if using NVIDIA NIM endpoint
  const baseUrl = process.env.OPENAI_BASE_URL ?? ''
  if (baseUrl.includes('nvidia') || baseUrl.includes('integrate.api.nvidia')) {
    return true
  }
  return getAPIProvider() === 'nvidia-nim'
}

function getNvidiaNimModels(): ModelOption[] {
  return [
    // AGENTIC SECURITY MODELS
    { value: 'nvidia/llama-3.1-nemotron-safety-guard-8b-v3', label: 'Nemotron Safety Guard 8B v3', description: 'AGENTIC SECURITY' },
    { value: 'nvidia/llama-3.1-nemoguard-8b-content-safety', label: 'NemoGuard Content Safety 8B', description: 'AGENTIC SECURITY' },
    { value: 'nvidia/llama-3.1-nemoguard-8b-topic-control', label: 'NemoGuard Topic Control 8B', description: 'AGENTIC SECURITY' },
    { value: 'nvidia/nemotron-content-safety-reasoning-4b', label: 'Nemotron Content Safety Reasoning 4B', description: 'AGENTIC SECURITY' },
    { value: 'meta/llama-guard-4-12b', label: 'Llama Guard 4 12B', description: 'AGENTIC SECURITY' },
    { value: 'google/shieldgemma-9b', label: 'ShieldGemma 9B', description: 'AGENTIC SECURITY' },
    { value: 'ibm/granite-guardian-3.0-8b', label: 'Granite Guardian 3.0 8B', description: 'AGENTIC SECURITY' },
    { value: 'nvidia/gliner-pii', label: 'GLiNER PII Detection', description: 'AGENTIC SECURITY' },
    // AGENTIC REASONING MODELS
    { value: 'nvidia/cosmos-reason2-8b', label: 'Cosmos Reason 2 8B', description: 'AGENTIC REASONING' },
    { value: 'microsoft/phi-4-mini-flash-reasoning', label: 'Phi 4 Mini Flash Reasoning', description: 'AGENTIC REASONING' },
    { value: 'qwen/qwen3-next-80b-a3b-thinking', label: 'Qwen 3 Next 80B Thinking', description: 'AGENTIC REASONING' },
    { value: 'deepseek-ai/deepseek-r1-distill-qwen-32b', label: 'DeepSeek R1 Qwen 32B', description: 'AGENTIC REASONING' },
    { value: 'deepseek-ai/deepseek-r1-distill-qwen-14b', label: 'DeepSeek R1 Qwen 14B', description: 'AGENTIC REASONING' },
    { value: 'deepseek-ai/deepseek-r1-distill-qwen-7b', label: 'DeepSeek R1 Qwen 7B', description: 'AGENTIC REASONING' },
    { value: 'deepseek-ai/deepseek-r1-distill-llama-8b', label: 'DeepSeek R1 Llama 8B', description: 'AGENTIC REASONING' },
    { value: 'qwen/qwq-32b', label: 'QwQ 32B Reasoning', description: 'AGENTIC REASONING' },
    // AGENTIC CODE SECURITY MODELS
    { value: 'meta/codellama-70b', label: 'CodeLlama 70B', description: 'AGENTIC CODE SECURITY' },
    { value: 'bigcode/starcoder2-15b', label: 'StarCoder2 15B', description: 'AGENTIC CODE SECURITY' },
    { value: 'bigcode/starcoder2-7b', label: 'StarCoder2 7B', description: 'AGENTIC CODE SECURITY' },
    { value: 'mistralai/codestral-22b-instruct-v0.1', label: 'Codestral 22B', description: 'AGENTIC CODE SECURITY' },
    { value: 'mistralai/mamba-codestral-7b-v0.1', label: 'Mamba Codestral 7B', description: 'AGENTIC CODE SECURITY' },
    { value: 'deepseek-ai/deepseek-coder-6.7b-instruct', label: 'DeepSeek Coder 6.7B', description: 'AGENTIC CODE SECURITY' },
    { value: 'google/codegemma-7b', label: 'CodeGemma 7B', description: 'AGENTIC CODE SECURITY' },
    { value: 'google/codegemma-1.1-7b', label: 'CodeGemma 1.1 7B', description: 'AGENTIC CODE SECURITY' },
    { value: 'qwen/qwen2.5-coder-32b-instruct', label: 'Qwen 2.5 Coder 32B', description: 'AGENTIC CODE SECURITY' },
    { value: 'qwen/qwen2.5-coder-7b-instruct', label: 'Qwen 2.5 Coder 7B', description: 'AGENTIC CODE SECURITY' },
    { value: 'qwen/qwen3-coder-480b-a35b-instruct', label: 'Qwen 3 Coder 480B', description: 'AGENTIC CODE SECURITY' },
    { value: 'ibm/granite-34b-code-instruct', label: 'Granite 34B Code', description: 'AGENTIC CODE SECURITY' },
    { value: 'ibm/granite-8b-code-instruct', label: 'Granite 8B Code', description: 'AGENTIC CODE SECURITY' },
    // EMBEDDING & RETRIEVAL MODELS
    { value: 'nvidia/nv-embedcode-7b-v1', label: 'NV EmbedCode 7B', description: 'AGENTIC SECURITY' },
    { value: 'nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1', label: 'NemoRetriever 1B VL Embed', description: 'AGENTIC SECURITY' },
    { value: 'nvidia/llama-3.2-nemoretriever-300m-embed-v1', label: 'NemoRetriever 300M Embed', description: 'AGENTIC SECURITY' },
    { value: 'nvidia/llama-3.2-nv-embedqa-1b-v1', label: 'NV EmbedQA 1B v1', description: 'AGENTIC SECURITY' },
    { value: 'nvidia/llama-3.2-nv-embedqa-1b-v2', label: 'NV EmbedQA 1B v2', description: 'AGENTIC SECURITY' },
    { value: 'nvidia/llama-nemotron-embed-1b-v2', label: 'Nemotron Embed 1B v2', description: 'AGENTIC SECURITY' },
    { value: 'nvidia/llama-nemotron-embed-vl-1b-v2', label: 'Nemotron Embed VL 1B v2', description: 'AGENTIC SECURITY' },
    { value: 'nvidia/nv-embed-v1', label: 'NV Embed v1', description: 'AGENTIC SECURITY' },
    { value: 'nvidia/nv-embedqa-e5-v5', label: 'NV EmbedQA E5 v5', description: 'AGENTIC SECURITY' },
    { value: 'nvidia/nv-embedqa-mistral-7b-v2', label: 'NV EmbedQA Mistral 7B v2', description: 'AGENTIC SECURITY' },
    { value: 'snowflake/arctic-embed-l', label: 'Arctic Embed L', description: 'AGENTIC SECURITY' },
    { value: 'nvidia/nemoretriever-parse', label: 'NemoRetriever Parse', description: 'AGENTIC SECURITY' },
    { value: 'nvidia/nemotron-parse', label: 'Nemotron Parse', description: 'AGENTIC SECURITY' },
    // REWARD MODELS
    { value: 'nvidia/llama-3.1-nemotron-70b-reward', label: 'Nemotron 70B Reward', description: 'AGENTIC SECURITY' },
    { value: 'nvidia/nemotron-4-340b-reward', label: 'Nemotron 340B Reward', description: 'AGENTIC SECURITY' },
    // NEMOTRON MODELS - NVIDIA Flagship
    { value: 'nvidia/llama-3.1-nemotron-70b-instruct', label: 'Nemotron 70B Instruct', description: 'NVIDIA Flagship' },
    { value: 'nvidia/llama-3.1-nemotron-51b-instruct', label: 'Nemotron 51B Instruct', description: 'NVIDIA Flagship' },
    { value: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', label: 'Nemotron Ultra 253B', description: 'NVIDIA Flagship' },
    { value: 'nvidia/llama-3.3-nemotron-super-49b-v1', label: 'Nemotron Super 49B v1', description: 'NVIDIA Flagship' },
    { value: 'nvidia/llama-3.3-nemotron-super-49b-v1.5', label: 'Nemotron Super 49B v1.5', description: 'NVIDIA Flagship' },
    { value: 'nvidia/nemotron-4-340b-instruct', label: 'Nemotron 4 340B', description: 'NVIDIA Flagship' },
    { value: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B', description: 'NVIDIA Flagship' },
    { value: 'nvidia/nemotron-3-nano-30b-a3b', label: 'Nemotron 3 Nano 30B', description: 'NVIDIA Flagship' },
    { value: 'nvidia/nemotron-mini-4b-instruct', label: 'Nemotron Mini 4B', description: 'NVIDIA Flagship' },
    { value: 'nvidia/llama-3.1-nemotron-nano-8b-v1', label: 'Nemotron Nano 8B', description: 'NVIDIA Flagship' },
    { value: 'nvidia/llama-3.1-nemotron-nano-4b-v1.1', label: 'Nemotron Nano 4B v1.1', description: 'NVIDIA Flagship' },
    { value: 'nvidia/llama-3.1-nemotron-nano-vl-8b-v1', label: 'Nemotron Nano VL 8B', description: 'NVIDIA Flagship' },
    { value: 'nvidia/nemotron-nano-12b-v2-vl', label: 'Nemotron Nano 12B VL v2', description: 'NVIDIA Flagship' },
    { value: 'nvidia/nvidia-nemotron-nano-9b-v2', label: 'Nemotron Nano 9B v2', description: 'NVIDIA Flagship' },
    // CHATQA MODELS
    { value: 'nvidia/llama3-chatqa-1.5-70b', label: 'Llama3 ChatQA 1.5 70B', description: 'ChatQA' },
    { value: 'nvidia/llama3-chatqa-1.5-8b', label: 'Llama3 ChatQA 1.5 8B', description: 'ChatQA' },
    // META LLAMA MODELS
    { value: 'meta/llama-3.1-405b-instruct', label: 'Llama 3.1 405B', description: 'Meta Llama' },
    { value: 'meta/llama-3.1-70b-instruct', label: 'Llama 3.1 70B', description: 'Meta Llama' },
    { value: 'meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B', description: 'Meta Llama' },
    { value: 'meta/llama-3.2-90b-vision-instruct', label: 'Llama 3.2 90B Vision', description: 'Meta Llama' },
    { value: 'meta/llama-3.2-11b-vision-instruct', label: 'Llama 3.2 11B Vision', description: 'Meta Llama' },
    { value: 'meta/llama-3.2-3b-instruct', label: 'Llama 3.2 3B', description: 'Meta Llama' },
    { value: 'meta/llama-3.2-1b-instruct', label: 'Llama 3.2 1B', description: 'Meta Llama' },
    { value: 'meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', description: 'Meta Llama' },
    { value: 'meta/llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick 17B', description: 'Meta Llama' },
    { value: 'meta/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B', description: 'Meta Llama' },
    // GOOGLE GEMMA MODELS
    { value: 'google/gemma-4-31b-it', label: 'Gemma 4 31B', description: 'Google Gemma' },
    { value: 'google/gemma-3-27b-it', label: 'Gemma 3 27B', description: 'Google Gemma' },
    { value: 'google/gemma-3-12b-it', label: 'Gemma 3 12B', description: 'Google Gemma' },
    { value: 'google/gemma-3-4b-it', label: 'Gemma 3 4B', description: 'Google Gemma' },
    { value: 'google/gemma-3-1b-it', label: 'Gemma 3 1B', description: 'Google Gemma' },
    { value: 'google/gemma-3n-e4b-it', label: 'Gemma 3N E4B', description: 'Google Gemma' },
    { value: 'google/gemma-3n-e2b-it', label: 'Gemma 3N E2B', description: 'Google Gemma' },
    { value: 'google/gemma-2-27b-it', label: 'Gemma 2 27B', description: 'Google Gemma' },
    { value: 'google/gemma-2-9b-it', label: 'Gemma 2 9B', description: 'Google Gemma' },
    { value: 'google/gemma-2-2b-it', label: 'Gemma 2 2B', description: 'Google Gemma' },
    { value: 'google/paligemma', label: 'PaliGemma Vision', description: 'Google Gemma' },
    { value: 'google/deplot', label: 'DePlot Charts', description: 'Google Gemma' },
    // MISTRAL MODELS
    { value: 'mistralai/mistral-large-3-675b-instruct-2512', label: 'Mistral Large 3 675B', description: 'Mistral' },
    { value: 'mistralai/mistral-large-2-instruct', label: 'Mistral Large 2', description: 'Mistral' },
    { value: 'mistralai/mistral-large', label: 'Mistral Large', description: 'Mistral' },
    { value: 'mistralai/mistral-medium-3-instruct', label: 'Mistral Medium 3', description: 'Mistral' },
    { value: 'mistralai/mistral-small-4-119b-2603', label: 'Mistral Small 4 119B', description: 'Mistral' },
    { value: 'mistralai/mistral-small-3.1-24b-instruct-2503', label: 'Mistral Small 3.1 24B', description: 'Mistral' },
    { value: 'mistralai/mistral-small-24b-instruct', label: 'Mistral Small 24B', description: 'Mistral' },
    { value: 'mistralai/mistral-7b-instruct-v0.3', label: 'Mistral 7B v0.3', description: 'Mistral' },
    { value: 'mistralai/mistral-7b-instruct-v0.2', label: 'Mistral 7B v0.2', description: 'Mistral' },
    { value: 'mistralai/mixtral-8x22b-instruct-v0.1', label: 'Mixtral 8x22B', description: 'Mistral' },
    { value: 'mistralai/mixtral-8x22b-v0.1', label: 'Mixtral 8x22B Base', description: 'Mistral' },
    { value: 'mistralai/mixtral-8x7b-instruct-v0.1', label: 'Mixtral 8x7B', description: 'Mistral' },
    { value: 'mistralai/mistral-nemotron', label: 'Mistral Nemotron', description: 'Mistral' },
    { value: 'mistralai/mathstral-7b-v0.1', label: 'Mathstral 7B', description: 'Mistral' },
    { value: 'mistralai/ministral-14b-instruct-2512', label: 'Ministral 14B', description: 'Mistral' },
    { value: 'mistralai/devstral-2-123b-instruct-2512', label: 'Devstral 2 123B', description: 'Mistral' },
    { value: 'mistralai/magistral-small-2506', label: 'Magistral Small', description: 'Mistral' },
    // MICROSOFT PHI MODELS
    { value: 'microsoft/phi-4-multimodal-instruct', label: 'Phi 4 Multimodal', description: 'Microsoft Phi' },
    { value: 'microsoft/phi-4-mini-instruct', label: 'Phi 4 Mini', description: 'Microsoft Phi' },
    { value: 'microsoft/phi-3.5-vision-instruct', label: 'Phi 3.5 Vision', description: 'Microsoft Phi' },
    { value: 'microsoft/phi-3.5-moe-instruct', label: 'Phi 3.5 MoE', description: 'Microsoft Phi' },
    { value: 'microsoft/phi-3.5-mini-instruct', label: 'Phi 3.5 Mini', description: 'Microsoft Phi' },
    { value: 'microsoft/phi-3-vision-128k-instruct', label: 'Phi 3 Vision 128K', description: 'Microsoft Phi' },
    { value: 'microsoft/phi-3-small-128k-instruct', label: 'Phi 3 Small 128K', description: 'Microsoft Phi' },
    { value: 'microsoft/phi-3-small-8k-instruct', label: 'Phi 3 Small 8K', description: 'Microsoft Phi' },
    { value: 'microsoft/phi-3-medium-128k-instruct', label: 'Phi 3 Medium 128K', description: 'Microsoft Phi' },
    { value: 'microsoft/phi-3-medium-4k-instruct', label: 'Phi 3 Medium 4K', description: 'Microsoft Phi' },
    { value: 'microsoft/phi-3-mini-128k-instruct', label: 'Phi 3 Mini 128K', description: 'Microsoft Phi' },
    { value: 'microsoft/phi-3-mini-4k-instruct', label: 'Phi 3 Mini 4K', description: 'Microsoft Phi' },
    { value: 'microsoft/kosmos-2', label: 'Kosmos 2 Multimodal', description: 'Microsoft Phi' },
    // QWEN MODELS
    { value: 'qwen/qwen3.5-397b-a17b', label: 'Qwen 3.5 397B', description: 'Qwen' },
    { value: 'qwen/qwen3.5-122b-a10b', label: 'Qwen 3.5 122B', description: 'Qwen' },
    { value: 'qwen/qwen3-next-80b-a3b-instruct', label: 'Qwen 3 Next 80B', description: 'Qwen' },
    { value: 'qwen/qwen2.5-7b-instruct', label: 'Qwen 2.5 7B', description: 'Qwen' },
    { value: 'qwen/qwen2-7b-instruct', label: 'Qwen 2 7B', description: 'Qwen' },
    // DEEPSEEK MODELS
    { value: 'deepseek-ai/deepseek-v3.2', label: 'DeepSeek V3.2', description: 'DeepSeek' },
    { value: 'deepseek-ai/deepseek-v3.1-terminus', label: 'DeepSeek V3.1 Terminus', description: 'DeepSeek' },
    { value: 'deepseek-ai/deepseek-v3.1', label: 'DeepSeek V3.1', description: 'DeepSeek' },
    // IBM GRANITE MODELS
    { value: 'ibm/granite-3.3-8b-instruct', label: 'Granite 3.3 8B', description: 'IBM Granite' },
    { value: 'ibm/granite-3.0-8b-instruct', label: 'Granite 3.0 8B', description: 'IBM Granite' },
    { value: 'ibm/granite-3.0-3b-a800m-instruct', label: 'Granite 3.0 3B', description: 'IBM Granite' },
    // OTHER MODELS
    { value: 'databricks/dbrx-instruct', label: 'DBRX Instruct', description: 'Other' },
    { value: '01-ai/yi-large', label: 'Yi Large', description: 'Other' },
    { value: 'ai21labs/jamba-1.5-large-instruct', label: 'Jamba 1.5 Large', description: 'Other' },
    { value: 'ai21labs/jamba-1.5-mini-instruct', label: 'Jamba 1.5 Mini', description: 'Other' },
    { value: 'writer/palmyra-creative-122b', label: 'Palmyra Creative 122B', description: 'Other' },
    { value: 'writer/palmyra-fin-70b-32k', label: 'Palmyra Fin 70B 32K', description: 'Other' },
    { value: 'writer/palmyra-med-70b', label: 'Palmyra Med 70B', description: 'Other' },
    { value: 'writer/palmyra-med-70b-32k', label: 'Palmyra Med 70B 32K', description: 'Other' },
    { value: 'z-ai/glm5', label: 'GLM-5', description: 'Z-AI' },
    { value: 'z-ai/glm4.7', label: 'GLM-4.7', description: 'Z-AI' },
    { value: 'minimaxai/minimax-m2.5', label: 'MiniMax M2.5', description: 'MiniMax' },
    { value: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5', description: 'Moonshot' },
    { value: 'moonshotai/kimi-k2-instruct', label: 'Kimi K2 Instruct', description: 'Moonshot' },
    { value: 'moonshotai/kimi-k2-thinking', label: 'Kimi K2 Thinking', description: 'Moonshot' },
    { value: 'moonshotai/kimi-k2.5-thinking', label: 'Kimi K2.5 Thinking', description: 'Moonshot' },
    { value: 'moonshotai/kimi-k2-instruct-0905', label: 'Kimi K2 Instruct 0905', description: 'Moonshot' },
    // NVIDIA VISION MODELS
    { value: 'nvidia/neva-22b', label: 'Neva 22B Vision', description: 'Vision' },
    { value: 'nvidia/vila', label: 'VILA Vision', description: 'Vision' },
    { value: 'nvidia/nvclip', label: 'NVCLIP Vision', description: 'Vision' },
    { value: 'nvidia/riva-translate-4b-instruct', label: 'Riva Translate 4B', description: 'Translation' },
    { value: 'nvidia/streampetr', label: 'StreamPETR', description: 'Speech' },
  ]
}

let cachedNvidiaNimOptions: ModelOption[] | null = null

export function getCachedNvidiaNimModelOptions(): ModelOption[] {
  if (!cachedNvidiaNimOptions) {
    cachedNvidiaNimOptions = getNvidiaNimModels()
  }
  return cachedNvidiaNimOptions
}