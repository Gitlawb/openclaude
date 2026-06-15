import type { OptionWithDescription } from '../../components/CustomSelect/select.js'
import { getAgentModelOptions } from '../../utils/model/agent.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'

/** Sentinel Select value: open inline input for a custom model id. */
export const CUSTOM_MODEL_VALUE = '__custom_model__'
/** Sentinel Select value: clear the route so the agent inherits the parent model. */
export const CLEAR_ROUTE_VALUE = '__clear_route__'

/**
 * The route currently assigned to an agent type in user settings. `viaDefault`
 * marks a route the agent only gets through the `default` fallback (it has no
 * own routing key), so the menu can show it without claiming it as the agent's
 * own assignment.
 */
export type CurrentAgentRoute =
  | { kind: 'none' }
  | { kind: 'model-only'; routeKey: string; model: string; viaDefault?: boolean }
  | { kind: 'cross-provider'; routeKey: string; model: string; baseURL: string; viaDefault?: boolean }
  | { kind: 'dangling'; routeKey: string; viaDefault?: boolean }

/** Normalize a routing key the same way the runtime resolver does. */
function normalizeAgentKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '')
}

/**
 * The existing `agentRouting` key (original spelling) that the runtime resolver
 * would match for `agentType`, or undefined if none. Mirrors
 * resolveAgentProvider's case-insensitive, hyphen/underscore-insensitive,
 * first-wins lookup. Pure.
 */
function findOwnRouteKey(
  routing: Record<string, string> | undefined,
  agentType: string,
): string | undefined {
  if (!routing) return undefined
  const target = normalizeAgentKey(agentType)
  for (const key of Object.keys(routing)) {
    if (normalizeAgentKey(key) === target) return key
  }
  return undefined
}

/** Build the route descriptor for a resolved model key. Pure. */
function describeModelKey(
  settings: SettingsJson | null,
  modelKey: string,
  viaDefault: boolean,
): CurrentAgentRoute {
  const entry = settings?.agentModels?.[modelKey]
  if (!entry) return { kind: 'dangling', routeKey: modelKey, ...(viaDefault ? { viaDefault } : {}) }
  const model = entry.model?.trim() || modelKey
  // Mirror the runtime resolver (toAgentRoute): cross-provider needs BOTH
  // base_url and api_key. A partial entry is skipped at runtime and inherits,
  // so surface it as unconfigured rather than claiming a route that won't run.
  const baseURL = entry.base_url?.trim()
  const apiKey = entry.api_key?.trim()
  if (!baseURL && !apiKey) return { kind: 'model-only', routeKey: modelKey, model, ...(viaDefault ? { viaDefault } : {}) }
  if (baseURL && apiKey) {
    return { kind: 'cross-provider', routeKey: modelKey, model, baseURL, ...(viaDefault ? { viaDefault } : {}) }
  }
  return { kind: 'dangling', routeKey: modelKey, ...(viaDefault ? { viaDefault } : {}) }
}

/**
 * Read the route assigned to `agentType` from a settings value, mirroring the
 * runtime resolver: a normalized per-agent key wins, otherwise the `default`
 * fallback applies (surfaced with `viaDefault`). Pure.
 */
export function readAgentRoute(
  settings: SettingsJson | null,
  agentType: string,
): CurrentAgentRoute {
  const routing = settings?.agentRouting
  const ownKey = findOwnRouteKey(routing, agentType)
  if (ownKey) return describeModelKey(settings, routing![ownKey], false)
  const defaultModelKey = routing?.default
  if (defaultModelKey) return describeModelKey(settings, defaultModelKey, true)
  return { kind: 'none' }
}

/** The Select value representing the current route, if any. Pure. */
export function currentRouteValue(current: CurrentAgentRoute): string | undefined {
  return current.kind === 'none' ? undefined : current.routeKey
}

/**
 * Next settings to point `agentType` at `modelKey`. Creates a model-only
 * `agentModels[modelKey]` only when absent (never clobbers an existing entry,
 * so selecting a pre-defined cross-provider key just sets routing). Pure.
 */
export function computeSetRouteUpdate(
  settings: SettingsJson | null,
  agentType: string,
  modelKey: string,
): SettingsJson {
  const agentModels = { ...(settings?.agentModels ?? {}) }
  if (!agentModels[modelKey]) {
    agentModels[modelKey] = { model: modelKey }
  }
  // Reuse the existing routing key the runtime would match so we overwrite it
  // in place instead of writing a normalized sibling the resolver's first-wins
  // lookup would ignore (e.g. "general-purpose" beside "general_purpose").
  const routingKey = findOwnRouteKey(settings?.agentRouting, agentType) ?? agentType
  const agentRouting = { ...(settings?.agentRouting ?? {}), [routingKey]: modelKey }
  return { agentModels, agentRouting } as unknown as SettingsJson
}

/**
 * Next settings to clear `agentType`'s route. Clears the effective routing key
 * the runtime would match (not a normalized sibling). The explicit `undefined`
 * is what makes updateSettingsForSource delete the key on merge. Pure.
 */
export function computeClearRouteUpdate(
  settings: SettingsJson | null,
  agentType: string,
): SettingsJson {
  const routingKey = findOwnRouteKey(settings?.agentRouting, agentType) ?? agentType
  return { agentRouting: { [routingKey]: undefined } } as unknown as SettingsJson
}

/** Human-readable one-line route summary for the AgentDetail view. Pure. */
export function describeRouteLine(current: CurrentAgentRoute): string {
  const viaDefault = current.kind !== 'none' && current.viaDefault ? ' (via default)' : ''
  switch (current.kind) {
    case 'none':
      return 'Route: inherits parent model'
    case 'model-only':
      return `Route: ${current.model} (current provider)${viaDefault}`
    case 'cross-provider':
      return `Route: ${current.model} (cross-provider)${viaDefault}`
    case 'dangling':
      return `Route: ${current.routeKey} (unconfigured, inherits)${viaDefault}`
  }
}

/**
 * Build the Select options for the route picker (excluding the inline custom
 * input option, which the component appends with its own onChange). Pure.
 */
export function buildRouteOptions(
  settings: SettingsJson | null,
  current: CurrentAgentRoute,
): OptionWithDescription<string>[] {
  const modelOptions: OptionWithDescription<string>[] = getAgentModelOptions(settings)
    .filter(o => o.value !== 'inherit')
    .map(o => {
      const entry = settings?.agentModels?.[o.value]
      // Same validity rule as the runtime resolver: both creds = cross-provider,
      // exactly one = unconfigured (skipped at runtime), neither = model-only.
      const hasBase = Boolean(entry?.base_url?.trim())
      const hasKey = Boolean(entry?.api_key?.trim())
      let label = o.label
      if (hasBase && hasKey) label = `${o.label} (cross-provider)`
      else if (hasBase || hasKey) label = `${o.label} (unconfigured, inherits)`
      return {
        value: o.value,
        label,
        description: o.description,
      }
    })

  // Only offer "clear" when the agent has its OWN routing key. A route inherited
  // via `default` has nothing agent-specific to remove, and clearing wouldn't
  // make it inherit the parent (default would still apply), so the option would
  // claim a change the runtime ignores.
  if (current.kind !== 'none' && !current.viaDefault) {
    modelOptions.push({
      value: CLEAR_ROUTE_VALUE,
      label: 'Clear route (inherit from parent)',
      description: "Remove this agent's model assignment",
    })
  }
  return modelOptions
}

// --- Thin I/O wrappers over user-global settings (not unit-tested; covered by build + manual) ---

/** Read the user-settings route for `agentType`. */
export function getAgentRoute(agentType: string): CurrentAgentRoute {
  return readAgentRoute(getSettingsForSource('userSettings'), agentType)
}

/** Persist a route from `agentType` to `modelKey` in user-global settings. */
export function setAgentRoute(
  agentType: string,
  modelKey: string,
): { error: Error | null } {
  const next = computeSetRouteUpdate(getSettingsForSource('userSettings'), agentType, modelKey)
  return updateSettingsForSource('userSettings', next)
}

/** Remove `agentType`'s route in user-global settings. */
export function clearAgentRoute(agentType: string): { error: Error | null } {
  return updateSettingsForSource(
    'userSettings',
    computeClearRouteUpdate(getSettingsForSource('userSettings'), agentType),
  )
}
