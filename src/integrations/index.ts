// src/integrations/index.ts
// Single loader entrypoint for descriptor modules.
// Runtime and tests must import this file before reading registry state.
//
// Loader strategy:
//   Phase 1 bootstrap: manual imports from known descriptor folders.
//   End state: constrained directory discovery (e.g., import.meta.glob) or a
//   generated loader script so adding a gateway does not require hand-editing
//   this file.

import {
  registerBrand,
  registerGateway,
  registerModel,
  registerVendor,
} from './registry.js'

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

import anthropic from './vendors/anthropic.js'
import openai from './vendors/openai.js'
import gemini from './vendors/gemini.js'
import moonshot from './vendors/moonshot.js'
import deepseek from './vendors/deepseek.js'
import minimax from './vendors/minimax.js'
import bankr from './vendors/bankr.js'

registerVendor(anthropic)
registerVendor(openai)
registerVendor(gemini)
registerVendor(moonshot)
registerVendor(deepseek)
registerVendor(minimax)
registerVendor(bankr)

// ---------------------------------------------------------------------------
// Gateways
// ---------------------------------------------------------------------------

import ollama from './gateways/ollama.js'
import lmstudio from './gateways/lmstudio.js'
import atomicChat from './gateways/atomic-chat.js'
import openrouter from './gateways/openrouter.js'
import together from './gateways/together.js'
import groq from './gateways/groq.js'
import azureOpenai from './gateways/azure-openai.js'
import dashscopeCn from './gateways/dashscope-cn.js'
import dashscopeIntl from './gateways/dashscope-intl.js'
import nvidiaNim from './gateways/nvidia-nim.js'
import custom from './gateways/custom.js'
import kimiCode from './gateways/kimi-code.js'
import github from './gateways/github.js'
import bedrock from './gateways/bedrock.js'
import vertex from './gateways/vertex.js'
import mistral from './gateways/mistral.js'

registerGateway(ollama)
registerGateway(lmstudio)
registerGateway(atomicChat)
registerGateway(openrouter)
registerGateway(together)
registerGateway(groq)
registerGateway(azureOpenai)
registerGateway(dashscopeCn)
registerGateway(dashscopeIntl)
registerGateway(nvidiaNim)
registerGateway(custom)
registerGateway(kimiCode)
registerGateway(github)
registerGateway(bedrock)
registerGateway(vertex)
registerGateway(mistral)

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

import claudeBrand from './brands/claude.js'
import deepseekBrand from './brands/deepseek.js'
import gptBrand from './brands/gpt.js'
import kimiBrand from './brands/kimi.js'
import llamaBrand from './brands/llama.js'
import qwenBrand from './brands/qwen.js'

registerBrand(claudeBrand)
registerBrand(deepseekBrand)
registerBrand(gptBrand)
registerBrand(kimiBrand)
registerBrand(llamaBrand)
registerBrand(qwenBrand)

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

import claudeModels from './models/claude.js'
import gptModels from './models/gpt.js'
import kimiModels from './models/kimi.js'
import deepseekModels from './models/deepseek.js'
import llamaModels from './models/llama.js'
import qwenModels from './models/qwen.js'

for (const model of claudeModels) registerModel(model)
for (const model of gptModels) registerModel(model)
for (const model of kimiModels) registerModel(model)
for (const model of deepseekModels) registerModel(model)
for (const model of llamaModels) registerModel(model)
for (const model of qwenModels) registerModel(model)

// ---------------------------------------------------------------------------
// Anthropic Proxies (placeholder — future)
// ---------------------------------------------------------------------------

// TODO: Import and register anthropic proxy descriptors when needed.

export {
  registerBrand,
  registerVendor,
  registerGateway,
  registerAnthropicProxy,
  registerModel,
  getBrand,
  getVendor,
  getGateway,
  getAnthropicProxy,
  getModel,
  getAllBrands,
  getAllVendors,
  getAllGateways,
  getAllAnthropicProxies,
  getAllModels,
  getCatalogForGateway,
  getCatalogForVendor,
  getCatalogEntriesForRoute,
  getModelsForBrand,
  getModelsForGateway,
  getModelsForVendor,
  getBrandsForVendor,
  validateIntegrationRegistry,
  _clearRegistryForTesting,
} from './registry.js'

export { routeForPreset, vendorIdForPreset, gatewayIdForPreset } from './compatibility.js'
export { resolveProfileRoute } from './profileResolver.js'
export type { ResolvedProfileRoute } from './profileResolver.js'
