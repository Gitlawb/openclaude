/**
 * PIF-C escape-hatch barrel.
 */
export type {
  ToolResult,
  NeedsInput,
  ToolError,
  Resolution,
} from './contract.js'
export {
  createResolverContext,
  resolveNeedsInput,
  type ResolverContext,
  type CreateResolverContextOptions,
} from './resolver.js'
export {
  createReadlineProvider,
  createStubProvider,
  createForbiddenProvider,
  type PromptProvider,
} from './promptProvider.js'
export { appendDevConfirmed, appendDevAborted } from './log.js'
