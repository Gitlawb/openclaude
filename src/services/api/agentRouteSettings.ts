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

/** The route currently assigned to an agent type in user settings. */
export type CurrentAgentRoute =
  | { kind: 'none' }
  | { kind: 'model-only'; routeKey: string; model: string }
  | { kind: 'cross-provider'; routeKey: string; model: string; baseURL: string }
  | { kind: 'dangling'; routeKey: string }

/** Read the route assigned to `agentType` from a settings value. Pure. */
export function readAgentRoute(
  settings: SettingsJson | null,
  agentType: string,
): CurrentAgentRoute {
  const routeKey = settings?.agentRouting?.[agentType]
  if (!routeKey) return { kind: 'none' }
  const entry = settings?.agentModels?.[routeKey]
  if (!entry) return { kind: 'dangling', routeKey }
  const model = entry.model?.trim() || routeKey
  // Mirror the runtime resolver (toAgentRoute): cross-provider needs BOTH
  // base_url and api_key. A partial entry is skipped at runtime and inherits,
  // so surface it as unconfigured rather than claiming a route that won't run.
  const baseURL = entry.base_url?.trim()
  const apiKey = entry.api_key?.trim()
  if (!baseURL && !apiKey) return { kind: 'model-only', routeKey, model }
  if (baseURL && apiKey) {
    return { kind: 'cross-provider', routeKey, model, baseURL }
  }
  return { kind: 'dangling', routeKey }
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
  const agentRouting = { ...(settings?.agentRouting ?? {}), [agentType]: modelKey }
  return { agentModels, agentRouting } as unknown as SettingsJson
}

/**
 * Next settings to clear `agentType`'s route. The explicit `undefined` is what
 * makes updateSettingsForSource delete the key on merge. Pure.
 */
export function computeClearRouteUpdate(agentType: string): SettingsJson {
  return { agentRouting: { [agentType]: undefined } } as unknown as SettingsJson
}

/** Human-readable one-line route summary for the AgentDetail view. Pure. */
export function describeRouteLine(current: CurrentAgentRoute): string {
  switch (current.kind) {
    case 'none':
      return 'Route: inherits parent model'
    case 'model-only':
      return `Route: ${current.model} (current provider)`
    case 'cross-provider':
      return `Route: ${current.model} (cross-provider)`
    case 'dangling':
      return `Route: ${current.routeKey} (unconfigured, inherits)`
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

  if (current.kind !== 'none') {
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
  return updateSettingsForSource('userSettings', computeClearRouteUpdate(agentType))
}
