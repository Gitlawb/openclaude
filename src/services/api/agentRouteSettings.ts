import type { OptionWithDescription } from '../../components/CustomSelect/select.js'
import { getAgentModelOptions } from '../../utils/model/agent.js'
import {
  getInitialSettings,
  getSettingsForSource,
  getSettingsWithSources,
  updateSettingsForSource,
  type SettingsWithSources,
} from '../../utils/settings/settings.js'
import { isSettingSourceEnabled } from '../../utils/settings/constants.js'
import type { SettingSource } from '../../utils/settings/constants.js'
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

/**
 * The highest-priority settings source ranked ABOVE userSettings that defines a
 * routing key normalizing to `agentType`, or null. Such a source overrides the
 * user file in the merged settings the runtime resolves from, so a user-level
 * write would be silently shadowed. `sources` is the low-to-high priority list
 * from getSettingsWithSources. Pure.
 */
export function findShadowingSource(
  sources: SettingsWithSources['sources'],
  agentType: string,
): SettingSource | null {
  const target = normalizeAgentKey(agentType)
  // userSettings is the write target; anything after it in the list outranks it.
  // When userSettings is absent (empty file), userIdx is -1 and every source
  // that defines the key still outranks the user write we would create.
  const userIdx = sources.findIndex(s => s.source === 'userSettings')
  for (let i = sources.length - 1; i > userIdx; i--) {
    const routing = sources[i]!.settings.agentRouting
    if (routing && Object.keys(routing).some(k => normalizeAgentKey(k) === target)) {
      return sources[i]!.source
    }
  }
  return null
}

/**
 * The highest-priority settings source ranked ABOVE userSettings that defines
 * `agentModels[modelKey]`, or null. A route saved here points an agent at
 * `modelKey`, but `agentModels` merges by source priority, so a higher source's
 * entry for the same key wins — the user's model-only entry (e.g. the
 * synthesized `{ model: "sonnet" }` for the built-in Sonnet option) is shadowed
 * and the agent resolves to the higher source's (often cross-provider) route
 * instead of the current-provider model the picker promised. `agentModels` keys
 * are exact (not normalized) to match the runtime resolver. Pure.
 */
export function findModelKeyShadowingSource(
  sources: SettingsWithSources['sources'],
  modelKey: string,
): SettingSource | null {
  const userIdx = sources.findIndex(s => s.source === 'userSettings')
  for (let i = sources.length - 1; i > userIdx; i--) {
    const models = sources[i]!.settings.agentModels
    if (models && Object.prototype.hasOwnProperty.call(models, modelKey)) {
      return sources[i]!.source
    }
  }
  return null
}

/**
 * Every agentModels key defined ABOVE userSettings in the effective chain.
 * The offer path (buildRouteOptions shadow flag) and the save guard
 * (setAgentRoute via findModelKeyShadowingSource) must agree on what counts as
 * shadowed; both derive from this same set so they cannot drift. Pure.
 */
export function collectShadowedModelKeys(
  sources: SettingsWithSources['sources'],
): Set<string> {
  const userIdx = sources.findIndex(s => s.source === 'userSettings')
  const keys = new Set<string>()
  for (let i = sources.length - 1; i > userIdx; i--) {
    const models = sources[i]!.settings.agentModels
    if (models) for (const k of Object.keys(models)) keys.add(k)
  }
  return keys
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
 *
 * opts.shadowedModelKeys: agentModels keys defined by a higher-priority source
 * than userSettings. A user-level route to such a key resolves to the higher
 * source's entry (see findModelKeyShadowingSource), so they are flagged here
 * and rejected on save rather than presented as a current-provider model.
 *
 * opts.defaultRouteApplies: whether a `default` agentRouting entry is in effect.
 * When it is, clearing an agent's own key does not inherit the parent model; the
 * default route still applies. The clear label reflects that instead of
 * promising parent inheritance.
 */
export function buildRouteOptions(
  settings: SettingsJson | null,
  current: CurrentAgentRoute,
  opts?: { shadowedModelKeys?: ReadonlySet<string>; defaultRouteApplies?: boolean },
): OptionWithDescription<string>[] {
  const shadowed = opts?.shadowedModelKeys
  const modelOptions: OptionWithDescription<string>[] = getAgentModelOptions(settings)
    .filter(o => o.value !== 'inherit')
    .map(o => {
      const entry = settings?.agentModels?.[o.value]
      // Same validity rule as the runtime resolver: both creds = cross-provider,
      // exactly one = unconfigured (skipped at runtime), neither = model-only.
      const hasBase = Boolean(entry?.base_url?.trim())
      const hasKey = Boolean(entry?.api_key?.trim())
      let label = o.label
      if (shadowed?.has(o.value)) label = `${o.label} (shadowed by higher settings)`
      else if (hasBase && hasKey) label = `${o.label} (cross-provider)`
      else if (hasBase || hasKey) label = `${o.label} (unconfigured, inherits)`
      return {
        value: o.value,
        label,
        description: o.description,
      }
    })

  // Only offer "clear" when the agent has its OWN routing key. A route inherited
  // via `default` has nothing agent-specific to remove.
  if (current.kind !== 'none' && !current.viaDefault) {
    // Clearing only removes the agent's own key. If a `default` route is still
    // in effect the agent falls back to it, not the parent model, so don't
    // promise parent inheritance the runtime won't deliver.
    const defaultApplies = opts?.defaultRouteApplies ?? false
    modelOptions.push({
      value: CLEAR_ROUTE_VALUE,
      label: defaultApplies
        ? 'Clear route (use default route)'
        : 'Clear route (inherit from parent)',
      description: defaultApplies
        ? "Remove this agent's own route; the default route still applies"
        : "Remove this agent's model assignment",
    })
  }
  return modelOptions
}

// --- Thin I/O wrappers over user-global settings (not unit-tested; covered by build + manual) ---

/**
 * Read the EFFECTIVE route for `agentType` from the merged settings chain, the
 * same view the runtime resolver uses. Reading only userSettings would hide a
 * project/local/policy route and wrongly report the agent as inheriting.
 */
export function getAgentRoute(agentType: string): CurrentAgentRoute {
  return readAgentRoute(getInitialSettings(), agentType)
}

/**
 * The settings source that overrides a user-level route for `agentType`, or
 * null when a user write would take effect. The picker uses this to explain why
 * an edit is read-only instead of silently saving an ignored route.
 */
export function getRouteShadowSource(agentType: string): SettingSource | null {
  return findShadowingSource(getSettingsWithSources().sources, agentType)
}

/**
 * The settings source whose `agentModels[modelKey]` would shadow a user-level
 * route to `modelKey`, or null. The picker uses this to refuse saving (and to
 * flag) a route that would resolve to a higher source's entry rather than the
 * current-provider model the option promised.
 */
export function getModelKeyShadowSource(modelKey: string): SettingSource | null {
  return findModelKeyShadowingSource(getSettingsWithSources().sources, modelKey)
}

/** agentModels keys defined above userSettings in the effective chain. */
export function getShadowedModelKeys(): Set<string> {
  return collectShadowedModelKeys(getSettingsWithSources().sources)
}

/**
 * Error for when user settings are not an enabled setting source this session
 * (e.g. launched with `--setting-sources project`). The picker reads and writes
 * userSettings, but the runtime resolves from the enabled chain only, so a write
 * here would be saved to a file that is never loaded — report it instead of
 * claiming a save that does nothing.
 */
function userSettingsDisabledError(): Error {
  return new Error(
    'User settings are disabled in this session (--setting-sources excludes them), ' +
      'so a route saved here would never load. Enable user settings or set the route ' +
      'in an active settings source.',
  )
}

/** Persist a route from `agentType` to `modelKey` in user-global settings. */
export function setAgentRoute(
  agentType: string,
  modelKey: string,
): { error: Error | null } {
  if (!isSettingSourceEnabled('userSettings')) return { error: userSettingsDisabledError() }
  const shadow = getRouteShadowSource(agentType)
  if (shadow) return { error: shadowError(agentType, shadow) }
  // A higher-priority source defining agentModels[modelKey] wins on merge, so a
  // user-level route to it resolves to that entry, not the model the option
  // promised. Refuse rather than silently save a misleading route. This holds
  // even when userSettings also defines the key: the user's entry is the one
  // being shadowed, so the save still would not take effect. Mirrors the
  // shadow flag buildRouteOptions shows for the same keys.
  const modelShadow = getModelKeyShadowSource(modelKey)
  if (modelShadow) return { error: modelKeyShadowError(modelKey, modelShadow) }
  const next = computeSetRouteUpdate(getSettingsForSource('userSettings'), agentType, modelKey)
  return updateSettingsForSource('userSettings', next)
}

/** Remove `agentType`'s route in user-global settings. */
export function clearAgentRoute(agentType: string): { error: Error | null } {
  if (!isSettingSourceEnabled('userSettings')) return { error: userSettingsDisabledError() }
  const shadow = getRouteShadowSource(agentType)
  if (shadow) return { error: shadowError(agentType, shadow) }
  return updateSettingsForSource(
    'userSettings',
    computeClearRouteUpdate(getSettingsForSource('userSettings'), agentType),
  )
}

/**
 * Per-source guidance for a route the user cannot change from user settings.
 * flagSettings has no file to edit (it comes from the --settings flag or SDK
 * inline settings), so point elsewhere for that source.
 */
export function shadowRemediation(source: SettingSource): string {
  return source === 'flagSettings'
    ? 'It comes from the --settings flag or SDK inline settings, not a file you can edit here.'
    : `Edit the ${source} settings to change this route.`
}

function shadowError(agentType: string, source: SettingSource): Error {
  return new Error(
    `${agentType} is routed by ${source} settings, which override your user settings. ` +
      `A user-level change won't take effect. ${shadowRemediation(source)}`,
  )
}

function modelKeyShadowError(modelKey: string, source: SettingSource): Error {
  return new Error(
    `"${modelKey}" is defined in ${source} settings, which override your user settings. ` +
      `A user-level route to it would resolve to that entry, not a current-provider model. ` +
      `${shadowRemediation(source)}`,
  )
}
