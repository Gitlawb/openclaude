/**
 * Generates TypeScript type exports from Zod schemas defined in
 * src/entrypoints/sdk/coreSchemas.ts.
 *
 * Usage:
 *   bun scripts/generate-sdk-types.ts
 *
 * Output:
 *   src/entrypoints/sdk/coreTypes.generated.ts
 *
 * The script walks the Zod v4 schema AST (schema.def.type) and emits
 * equivalent TypeScript type literals. Placeholder schemas (z.unknown())
 * are replaced via TypeOverrideMap with real TS type references.
 */

import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as schemas from '../src/entrypoints/sdk/coreSchemas.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outPath = resolve(
  __dirname, '..', 'src', 'entrypoints', 'sdk', 'coreTypes.generated.ts',
)

// ---------------------------------------------------------------------------
// Type override map — placeholder schemas → real TypeScript type references
// ---------------------------------------------------------------------------

// Override map keyed by schema variable name — applied when the schema is
// exported directly (top-level export) or encountered as a field in another
// schema (detected by identity comparison via placeholderInstances).
const TypeOverrideMap: Record<string, string> = {
  APIUserMessagePlaceholder:
    'Record<string, unknown> & { role: "user", content: string | Array<unknown> }',
  APIAssistantMessagePlaceholder:
    'Record<string, unknown> & { role: "assistant", content: Array<unknown> }',
  RawMessageStreamEventPlaceholder:
    'Record<string, unknown>',
  UUIDPlaceholder: 'string',
  NonNullableUsagePlaceholder:
    'Record<string, number>',
}

// Materialize placeholder schemas once so we can detect them by identity (===)
// when they appear as fields inside other schemas.
const placeholderInstances = new Map<any, string>()
for (const name of Object.keys(TypeOverrideMap)) {
  const thunk = (schemas as any)[name]
  if (typeof thunk === 'function') {
    try {
      placeholderInstances.set(thunk(), TypeOverrideMap[name])
    } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Schema variable name → exported type name
// ---------------------------------------------------------------------------

function toTypeName(schemaVar: string): string {
  return schemaVar.replace(/Schema$/, '')
}

// ---------------------------------------------------------------------------
// Ordered list of schemas to export
// ---------------------------------------------------------------------------

const EXPORT_ORDER = [
  // Usage & Model
  'ModelUsageSchema',
  // Output Format
  'OutputFormatTypeSchema',
  'BaseOutputFormatSchema',
  'JsonSchemaOutputFormatSchema',
  'OutputFormatSchema',
  // Config
  'ApiKeySourceSchema',
  'ConfigScopeSchema',
  'SdkBetaSchema',
  'ThinkingAdaptiveSchema',
  'ThinkingEnabledSchema',
  'ThinkingDisabledSchema',
  'ThinkingConfigSchema',
  // MCP
  'McpStdioServerConfigSchema',
  'McpSSEServerConfigSchema',
  'McpHttpServerConfigSchema',
  'McpSdkServerConfigSchema',
  'McpServerConfigForProcessTransportSchema',
  'McpClaudeAIProxyServerConfigSchema',
  'McpServerStatusConfigSchema',
  'McpServerStatusSchema',
  'McpSetServersResultSchema',
  // Permission
  'PermissionUpdateDestinationSchema',
  'PermissionBehaviorSchema',
  'PermissionRuleValueSchema',
  'PermissionUpdateSchema',
  'PermissionDecisionClassificationSchema',
  'PermissionResultSchema',
  'PermissionModeSchema',
  // Hook event schemas
  'HookEventSchema',
  'BaseHookInputSchema',
  'PreToolUseHookInputSchema',
  'PostToolUseHookInputSchema',
  'PostToolUseFailureHookInputSchema',
  'PermissionDeniedHookInputSchema',
  'NotificationHookInputSchema',
  'UserPromptSubmitHookInputSchema',
  'SessionStartHookInputSchema',
  'SessionEndHookInputSchema',
  'StopHookInputSchema',
  'StopFailureHookInputSchema',
  'SubagentStartHookInputSchema',
  'SubagentStopHookInputSchema',
  'PreCompactHookInputSchema',
  'PostCompactHookInputSchema',
  'PermissionRequestHookInputSchema',
  'SetupHookInputSchema',
  'TeammateIdleHookInputSchema',
  'TaskCreatedHookInputSchema',
  'TaskCompletedHookInputSchema',
  'ElicitationHookInputSchema',
  'ElicitationResultHookInputSchema',
  'ConfigChangeHookInputSchema',
  'InstructionsLoadedHookInputSchema',
  'WorktreeCreateHookInputSchema',
  'WorktreeRemoveHookInputSchema',
  'CwdChangedHookInputSchema',
  'FileChangedHookInputSchema',
  'HookInputSchema',
  // Hook output schemas
  'AsyncHookJSONOutputSchema',
  'PreToolUseHookSpecificOutputSchema',
  'UserPromptSubmitHookSpecificOutputSchema',
  'SessionStartHookSpecificOutputSchema',
  'SetupHookSpecificOutputSchema',
  'SubagentStartHookSpecificOutputSchema',
  'PostToolUseHookSpecificOutputSchema',
  'PostToolUseFailureHookSpecificOutputSchema',
  'PermissionDeniedHookSpecificOutputSchema',
  'NotificationHookSpecificOutputSchema',
  'PermissionRequestHookSpecificOutputSchema',
  'CwdChangedHookSpecificOutputSchema',
  'FileChangedHookSpecificOutputSchema',
  'ElicitationHookSpecificOutputSchema',
  'ElicitationResultHookSpecificOutputSchema',
  'WorktreeCreateHookSpecificOutputSchema',
  'SyncHookJSONOutputSchema',
  'HookJSONOutputSchema',
  // Prompt
  'PromptRequestOptionSchema',
  'PromptRequestSchema',
  'PromptResponseSchema',
  // Skill/Command
  'SlashCommandSchema',
  'AgentInfoSchema',
  'ModelInfoSchema',
  'AccountInfoSchema',
  // Agent Definition
  'AgentMcpServerSpecSchema',
  'AgentDefinitionSchema',
  // Settings
  'SettingSourceSchema',
  'SdkPluginConfigSchema',
  // Rewind
  'RewindFilesResultSchema',
  // SDK Message Types
  'SDKAssistantMessageErrorSchema',
  'SDKStatusSchema',
  'SDKUserMessageSchema',
  'SDKUserMessageReplaySchema',
  'SDKRateLimitInfoSchema',
  'SDKAssistantMessageSchema',
  'SDKRateLimitEventSchema',
  'SDKStreamlinedTextMessageSchema',
  'SDKStreamlinedToolUseSummaryMessageSchema',
  'SDKPermissionDenialSchema',
  'SDKResultSuccessSchema',
  'SDKResultErrorSchema',
  'SDKResultMessageSchema',
  'SDKSystemMessageSchema',
  'SDKPartialAssistantMessageSchema',
  'SDKCompactBoundaryMessageSchema',
  'SDKStatusMessageSchema',
  'SDKPostTurnSummaryMessageSchema',
  'SDKAPIRetryMessageSchema',
  'SDKLocalCommandOutputMessageSchema',
  'SDKHookStartedMessageSchema',
  'SDKHookProgressMessageSchema',
  'SDKHookResponseMessageSchema',
  'SDKToolProgressMessageSchema',
  'SDKAuthStatusMessageSchema',
  'SDKFilesPersistedEventSchema',
  'SDKTaskNotificationMessageSchema',
  'SDKTaskStartedMessageSchema',
  'SDKTaskProgressMessageSchema',
  'SDKSessionStateChangedMessageSchema',
  'SDKToolUseSummaryMessageSchema',
  'SDKElicitationCompleteMessageSchema',
  'SDKPromptSuggestionMessageSchema',
  // Session
  'SDKSessionInfoSchema',
  'SDKMessageSchema',
  // Misc
  'FastModeStateSchema',
  'ExitReasonSchema',
]

// ---------------------------------------------------------------------------
// Zod v4 schema → TypeScript type string
// ---------------------------------------------------------------------------

// Zod v4 uses schema.def.type as the discriminator (lowercase strings).
// All schemas have .def with { type: string, ... }.

function convert(schema: any, depth = 0): string {
  if (!schema || !schema.def) return 'unknown'

  // Check if this schema is a known placeholder (identity comparison)
  const override = placeholderInstances.get(schema)
  if (override) return override

  const def = schema.def
  const type: string = def.type

  switch (type) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'undefined':
      return 'undefined'
    case 'any':
      return 'any'
    case 'unknown':
      return 'unknown'
    case 'void':
      return 'void'
    case 'never':
      return 'never'
    case 'literal': {
      // def.values is an array of literal values
      const vals = def.values as any[]
      return vals.map(v => JSON.stringify(v)).join(' | ')
    }
    case 'enum': {
      // def.entries is { key: value } or an array
      const entries = def.entries
      if (Array.isArray(entries)) {
        return entries.map((v: any) => JSON.stringify(v)).join(' | ')
      }
      return Object.values(entries)
        .filter((v): v is string => typeof v === 'string')
        .map(v => JSON.stringify(v))
        .join(' | ')
    }
    case 'nativeEnum': {
      const enumObj = def.entries as Record<string, string | number>
      return Object.values(enumObj)
        .filter((v): v is string => typeof v === 'string')
        .map(v => JSON.stringify(v))
        .join(' | ')
    }
    case 'array':
      return `${convert(def.element, depth)}[]`
    case 'tuple': {
      const items = (def.items as any[]).map(t => convert(t, depth))
      return `[${items.join(', ')}]`
    }
    case 'record':
      return `Record<${convert(def.keyType, depth)}, ${convert(def.valueType, depth)}>`
    case 'object':
      return convertObject(def, depth)
    case 'union':
    case 'discriminated_union': {
      // def.options for discriminated, def.options for plain union
      const members = (def.options as any[]).map(t => {
        const ts = convert(t, depth)
        return needsParens(ts) ? `(${ts})` : ts
      })
      return members.join(' | ')
    }
    case 'intersection':
      return `${convert(def.left, depth)} & ${convert(def.right, depth)}`
    case 'optional':
      return convert(def.innerType, depth)
    case 'nullable':
      return `${convert(def.innerType, depth)} | null`
    case 'default':
      return convert(def.innerType, depth)
    case 'lazy':
      return convert(def.getter(), depth)
    case 'transform':
    case 'effects':
      return convert(def.schema, depth)
    case 'catch':
      return convert(def.innerType, depth)
    case 'pipe':
      return convert(def.in, depth)
    case 'preprocess':
      return convert(def.schema, depth)
    case 'branded':
      return convert(def.type, depth)
    case 'readonly':
      return `Readonly<${convert(def.innerType, depth)}>`
    case 'success':
      return 'true'
    case 'failure':
      return 'false'
    default:
      console.error(`  ⚠ Unknown Zod def.type: "${type}"`)
      return 'unknown'
  }
}

function convertObject(def: any, depth: number): string {
  let shape: Record<string, any>
  if (typeof def.shape === 'function') {
    shape = def.shape()
  } else if (typeof def.shape === 'object' && def.shape !== null) {
    shape = def.shape
  } else {
    return 'Record<string, unknown>'
  }

  const entries = Object.entries(shape)
  if (entries.length === 0) return '{}'

  const indent = '  '.repeat(depth + 1)
  const closeIndent = '  '.repeat(depth)

  const fields = entries.map(([key, value]) => {
    const ts = convert(value, depth + 1)
    const opt = isOptional(value)
    return `${indent}${key}${opt ? '?' : ''}: ${ts}`
  })

  return '{\n' + fields.join('\n') + '\n' + closeIndent + '}'
}

function isOptional(schema: any): boolean {
  if (!schema?.def) return false
  return schema.def.type === 'optional' || schema.def.type === 'default'
}

function needsParens(ts: string): boolean {
  return ts.includes('\n') || ts.includes(' & ')
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function generate(): string {
  const lines: string[] = [
    '// AUTO-GENERATED — do not edit manually.',
    '// Regenerate with: bun scripts/generate-sdk-types.ts',
    '//',
    '// Generated from Zod schemas in coreSchemas.ts',
    '',
  ]

  let errors = 0

  for (const schemaName of EXPORT_ORDER) {
    const thunk = (schemas as any)[schemaName]
    if (typeof thunk !== 'function') {
      console.warn(`  ⚠ Not found: ${schemaName}`)
      errors++
      continue
    }

    // Check type override first
    if (TypeOverrideMap[schemaName]) {
      const typeName = toTypeName(schemaName)
      lines.push(`export type ${typeName} = ${TypeOverrideMap[schemaName]}`)
      lines.push('')
      continue
    }

    let schema: any
    try {
      schema = thunk()
    } catch (e: any) {
      console.warn(`  ⚠ Materialize failed: ${schemaName}: ${e.message}`)
      errors++
      continue
    }

    const typeName = toTypeName(schemaName)

    try {
      const ts = convert(schema)
      // Check for top-level description
      const desc = Reflect.get(schema, 'description') as string | undefined
      if (desc) {
        lines.push(`/** ${desc} */`)
      }
      lines.push(`export type ${typeName} = ${ts}`)
      lines.push('')
    } catch (e: any) {
      console.warn(`  ⚠ Convert failed: ${schemaName}: ${e.message}`)
      errors++
      lines.push(`// ⚠ Failed: ${schemaName}`)
      lines.push(`export type ${typeName} = any`)
      lines.push('')
    }
  }

  if (errors > 0) {
    console.warn(`\n  ⚠ ${errors} schema(s) had errors`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('Generating SDK types from Zod schemas...')
const output = generate()
writeFileSync(outPath, output, 'utf-8')
console.log(`✓ Written to ${outPath}`)
