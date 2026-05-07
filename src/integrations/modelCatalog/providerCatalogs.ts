import anthropic from './providers/anthropic.json'
import codex from './providers/codex.json'
import deepseek from './providers/deepseek.json'
import gemini from './providers/gemini.json'
import githubCopilot from './providers/github-copilot.json'
import minimax from './providers/minimax.json'
import moonshot from './providers/moonshot.json'
import nvidiaNim from './providers/nvidia-nim.json'
import ollama from './providers/ollama.json'
import openai from './providers/openai.json'
import opencodeGo from './providers/opencode-go.json'
import xai from './providers/xai.json'
import zai from './providers/zai.json'
import type { ProviderCatalog } from './types.js'

export const PROVIDER_CATALOGS = [
  anthropic,
  openai,
  codex,
  githubCopilot,
  gemini,
  minimax,
  nvidiaNim,
  ollama,
  xai,
  moonshot,
  deepseek,
  zai,
  opencodeGo,
] as ProviderCatalog[]
