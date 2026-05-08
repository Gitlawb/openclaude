import anthropic from './providers/anthropic.json'
import atomicChat from './providers/atomic-chat.json'
import azureOpenai from './providers/azure-openai.json'
import bankr from './providers/bankr.json'
import bedrock from './providers/bedrock.json'
import codex from './providers/codex.json'
import custom from './providers/custom.json'
import dashscopeCn from './providers/dashscope-cn.json'
import dashscopeIntl from './providers/dashscope-intl.json'
import deepseek from './providers/deepseek.json'
import foundry from './providers/foundry.json'
import gemini from './providers/gemini.json'
import githubCopilot from './providers/github-copilot.json'
import github from './providers/github.json'
import groq from './providers/groq.json'
import hicap from './providers/hicap.json'
import kimiCode from './providers/kimi-code.json'
import lmstudio from './providers/lmstudio.json'
import minimax from './providers/minimax.json'
import mistral from './providers/mistral.json'
import moonshot from './providers/moonshot.json'
import nvidiaNim from './providers/nvidia-nim.json'
import ollama from './providers/ollama.json'
import openai from './providers/openai.json'
import opencodeGo from './providers/opencode-go.json'
import openrouter from './providers/openrouter.json'
import together from './providers/together.json'
import vertex from './providers/vertex.json'
import xai from './providers/xai.json'
import zai from './providers/zai.json'
import type { ProviderCatalog } from './types.js'

export const PROVIDER_CATALOGS = [
  anthropic,
  atomicChat,
  azureOpenai,
  bankr,
  bedrock,
  openai,
  codex,
  custom,
  dashscopeCn,
  dashscopeIntl,
  githubCopilot,
  github,
  gemini,
  groq,
  hicap,
  kimiCode,
  lmstudio,
  minimax,
  mistral,
  nvidiaNim,
  ollama,
  openrouter,
  xai,
  moonshot,
  deepseek,
  foundry,
  together,
  vertex,
  zai,
  opencodeGo,
] as ProviderCatalog[]
