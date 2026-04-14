/**
 * No-Telemetry Build Plugin for OpenClaude
 *
 * Replaces all analytics, telemetry, and phone-home modules with no-op stubs
 * at compile time. Zero runtime cost, zero network calls to Anthropic.
 *
 * This file is NOT tracked upstream — merge conflicts are impossible.
 * Only build.ts needs a one-line import + one-line array entry.
 *
 * Kills:
 *   - GrowthBook remote feature flags (api.anthropic.com)
 *   - Datadog event intake
 *   - 1P event logging (api.anthropic.com/api/event_logging/batch)
 *   - BigQuery metrics exporter (api.anthropic.com/api/claude_code/metrics)
 *   - Perfetto / OpenTelemetry session tracing
 *   - Auto-updater (storage.googleapis.com, npm registry)
 *   - Plugin fetch telemetry
 *   - Transcript / feedback sharing
 */

import type { BunPlugin } from 'bun'

// Module path (relative to src/, without extension) → stub source
const stubs: Record<string, string> = {

	// ─── Analytics core ─────────────────────────────────────────────

	'services/analytics/index': `
export function stripProtoFields(metadata) { return metadata; }
export function attachAnalyticsSink() {}
export function logEvent() {}
export async function logEventAsync() {}
export function _resetForTesting() {}
`,

	'services/analytics/growthbook': `
import _fs from 'node:fs';
import _path from 'node:path';
import _os from 'node:os';

let _flags = undefined;

// ── Open-build GrowthBook overrides ───────────────────────────────────
// Override upstream defaultValue for runtime gates tied to build-time
// features. Only keys that DIFFER from upstream belong here — the
// catalog below is pure documentation and does NOT affect resolution.
//
// Priority: ~/.claude/feature-flags.json > _openBuildDefaults > defaultValue
//
// To override at runtime, create ~/.claude/feature-flags.json:
//   { "tengu_some_flag": true }
const _openBuildDefaults = {
  // ── Features (upstream defaults to false, overridden to true) ────────
  'tengu_sedge_lantern': true,      // AWAY_SUMMARY — "while you were away" recap
  'tengu_hive_evidence': true,      // VERIFICATION_AGENT — read-only test/verification agent
  'tengu_passport_quail': true,     // EXTRACT_MEMORIES — enable memory extraction
  'tengu_coral_fern': true,         // EXTRACT_MEMORIES — enable memory search in past context

  // ── KAIROS assistant mode ───────────────────────────────────────────
  'tengu_kairos': true,             // KAIROS runtime gate (isKairosEnabled)
  'tengu_kairos_brief': true,       // Brief tool in KAIROS mode
  'tengu_herring_clock': true,      // Team memory paths

  // ── Bridge (local server, upstream defaults to false) ───────────────
  'tengu_ccr_bridge': true,         // isBridgeEnabled() — local bridge server
  'tengu_bridge_repl_v2': true,     // Force v2 (env-less) path — simpler
  'tengu_scratch': true,            // Coordinator scratchpad filesystem access
};

/* ── Known runtime feature keys (reference only) ───────────────────────
 * This catalog does NOT participate in flag resolution. It documents
 * the known GrowthBook keys and their upstream default values, scraped
 * from src/ call sites. It is NOT exhaustive — new keys may be added
 * upstream between catalog updates.
 *
 * Some keys have different defaults at different call sites — this is
 * intentional upstream (the server unifies the value at runtime).
 *
 * To activate any of these, add them to ~/.claude/feature-flags.json
 * or to _openBuildDefaults above.
 *
 * ── Reasoning & thinking ──────────────────────────────────────────────
 *   tengu_turtle_carbon            = true       ULTRATHINK deep thinking runtime gate
 *   tengu_thinkback                = gate       /thinkback replay command
 *
 * ── Agents & orchestration ────────────────────────────────────────────
 *   tengu_amber_flint              = true       Agent swarms coordination
 *   tengu_amber_stoat              = true       Built-in agent availability (Explore, Plan, etc.)
 *   tengu_agent_list_attach        = true       Attach file context to agent list
 *   tengu_auto_background_agents   = false      Auto-spawn background agents
 *   tengu_slim_subagent_claudemd   = true       Lighter ClaudeMD for subagents
 *   tengu_hive_evidence            = false      Verification agent / evidence tracking (4 call sites)
 *   tengu_ultraplan_model          = model cfg  ULTRAPLAN model selection (dynamic config)
 *
 * ── Memory & context ──────────────────────────────────────────────────
 *   tengu_passport_quail           = false      EXTRACT_MEMORIES main gate (isExtractModeActive)
 *   tengu_coral_fern               = false      EXTRACT_MEMORIES search in past context
 *   tengu_slate_thimble            = false      Memory dir paths (non-interactive sessions)
 *   tengu_herring_clock            = true/false Team memory paths (varies by call site)
 *   tengu_bramble_lintel           = null       Extract memories throttle (null → every turn)
 *   tengu_sedge_lantern            = false      AWAY_SUMMARY "while you were away" recap
 *   tengu_session_memory           = false      Session memory service
 *   tengu_sm_config                = {}         Session memory config (dynamic)
 *   tengu_sm_compact_config        = {}         Session memory compaction config (dynamic)
 *   tengu_cobalt_raccoon           = false      Reactive compaction (suppress auto-compact)
 *   tengu_pebble_leaf_prune        = false      Session storage pruning
 *
 * ── Kairos & cron ─────────────────────────────────────────────────────
 *   tengu_kairos_brief             = false      Brief layout mode (KAIROS)
 *   tengu_kairos_brief_config      = {}         Brief config (dynamic)
 *   tengu_kairos_cron              = true       Cron scheduler enable
 *   tengu_kairos_cron_durable      = true       Durable (disk-persistent) cron tasks
 *   tengu_kairos_cron_config       = {}         Cron jitter config (dynamic)
 *
 * ── Bridge & remote (require Anthropic infra) ─────────────────────────
 *   tengu_ccr_bridge               = false      CCR bridge connection
 *   tengu_ccr_bridge_multi_session = gate       Multi-session spawn mode
 *   tengu_ccr_mirror               = false      CCR session mirroring
 *   tengu_ccr_bundle_seed_enabled  = gate       Git bundle seeding for CCR
 *   tengu_ccr_bundle_max_bytes     = null       Bundle size limit (null → default)
 *   tengu_bridge_repl_v2           = false      Environment-less REPL bridge v2
 *   tengu_bridge_repl_v2_cse_shim_enabled = true CSE→Session tag retag shim
 *   tengu_bridge_min_version       = {min:'0'}  Min CLI version for bridge (dynamic)
 *   tengu_bridge_initial_history_cap = 200      Initial history cap for bridge
 *   tengu_bridge_system_init       = false      Bridge system initialization
 *   tengu_cobalt_harbor            = false      Auto-connect CCR at startup
 *   tengu_cobalt_lantern           = false      Remote setup preconditions
 *   tengu_remote_backend           = false      Remote TUI backend
 *   tengu_surreal_dali             = false      Remote agent tasks / triggers
 *
 * ── Prompt & API ──────────────────────────────────────────────────────
 *   tengu_attribution_header       = true       Attribution header in API requests
 *   tengu_basalt_3kr               = true       MCP instructions delta
 *   tengu_slate_prism              = true/false Message formatting (varies by call site)
 *   tengu_amber_prism              = false      Message content formatting
 *   tengu_amber_json_tools         = false      JSON format for tool schemas
 *   tengu_fgts                     = false      API feature gates
 *   tengu_otk_slot_v1              = false      One-time key slots for API auth
 *   tengu_cicada_nap_ms            = 0          Background GrowthBook refresh throttle (ms)
 *   tengu_miraculo_the_bard        = false      Service initialization gate
 *   tengu_immediate_model_command  = false      Immediate /model command execution
 *   tengu_chomp_inflection         = false      Prompt suggestions after responses
 *   tengu_tool_pear                = gate       API betas for tool use
 *   tengu-off-switch               = {act:false} Service kill switch (dynamic; uses dash)
 *
 * ── Permissions & security ────────────────────────────────────────────
 *   tengu_birch_trellis            = true       Bash auto-mode permissions config
 *   tengu_auto_mode_config         = {}         Auto-mode configuration (dynamic, many call sites)
 *   tengu_iron_gate_closed         = true       Permission iron gate (with refresh)
 *   tengu_destructive_command_warning = false    Warning for destructive bash commands
 *   tengu_disable_bypass_permissions_mode = security Security killswitch (always false in open build)
 *
 * ── UI & UX ───────────────────────────────────────────────────────────
 *   tengu_willow_mode              = 'off'      REPL rendering mode
 *   tengu_terminal_panel           = false      Terminal panel keybinding
 *   tengu_terminal_sidebar         = false      Terminal sidebar in REPL/config
 *   tengu_marble_sandcastle        = false      Fast mode gate
 *   tengu_jade_anvil_4             = false      Rate limit options UI ordering
 *   tengu_collage_kaleidoscope     = true       Native clipboard image paste (macOS)
 *   tengu_lapis_finch              = false      Plugin/hint recommendation
 *   tengu_lodestone_enabled        = false      Deep links claude-cli:// protocol
 *   tengu_copper_panda             = false      Skill improvement suggestions
 *   tengu_desktop_upsell           = {}         Desktop app upsell config (dynamic)
 *   tengu-top-of-feed-tip          = {}         Emergency tip of feed (dynamic; uses dash)
 *
 * ── File operations ───────────────────────────────────────────────────
 *   tengu_quartz_lantern           = false      File read/write dedup optimization
 *   tengu_moth_copse               = false      Attachments handling (variant A)
 *   tengu_marble_fox               = false      Attachments handling (variant B)
 *   tengu_scratch                  = gate       Scratchpad filesystem access / coordinator
 *
 * ── MCP & plugins ─────────────────────────────────────────────────────
 *   tengu_harbor                   = false      MCP channel allowlist verification
 *   tengu_harbor_permissions       = false      MCP channel permissions enforcement
 *   tengu_copper_bridge            = false      Chrome MCP bridge
 *   tengu_chrome_auto_enable       = false      Auto-enable Chrome MCP on startup
 *   tengu_glacier_2xr              = false      Enhanced tool search / ToolSearchTool
 *   tengu_malort_pedway            = {}         Computer-use (Chicago) config (dynamic)
 *
 * ── VSCode / IDE ──────────────────────────────────────────────────────
 *   tengu_quiet_fern               = false      VSCode browser support
 *   tengu_vscode_cc_auth           = false      VSCode in-band OAuth via claude_authenticate
 *   tengu_vscode_review_upsell     = gate       VSCode review upsell
 *   tengu_vscode_onboarding        = gate       VSCode onboarding experience
 *
 * ── Voice ─────────────────────────────────────────────────────────────
 *   tengu_amber_quartz_disabled    = false      VOICE_MODE kill-switch (false = voice allowed)
 *
 * ── Auto-updater (stubbed in open build) ──────────────────────────────
 *   tengu_version_config           = {min:'0'}  Min version enforcement (dynamic)
 *   tengu_max_version_config       = {}         Max version / deprecation config (dynamic)
 *
 * ── Telemetry & tracing ───────────────────────────────────────────────
 *   tengu_trace_lantern            = false      Beta session tracing
 *   tengu_chair_sermon             = gate       Analytics / message formatting gate
 *   tengu_strap_foyer              = false      Settings sync to cloud
 */

function _loadFlags() {
  if (_flags !== undefined) return;
  try {
    const flagsPath = process.env.CLAUDE_FEATURE_FLAGS_FILE
      || _path.join(_os.homedir(), '.claude', 'feature-flags.json');
    const parsed = JSON.parse(_fs.readFileSync(flagsPath, 'utf-8'));
    _flags = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
  } catch {
    _flags = null;
  }
}

function _getFlagValue(key, defaultValue) {
  _loadFlags();
  if (_flags != null && Object.hasOwn(_flags, key)) return _flags[key];
  if (Object.hasOwn(_openBuildDefaults, key)) return _openBuildDefaults[key];
  return defaultValue;
}

const noop = () => {};
export function onGrowthBookRefresh() { return noop; }
export function hasGrowthBookEnvOverride() { return false; }
export function getAllGrowthBookFeatures() { _loadFlags(); return _flags || {}; }
export function getGrowthBookConfigOverrides() { return {}; }
export function setGrowthBookConfigOverride() {}
export function clearGrowthBookConfigOverrides() {}
export function getApiBaseUrlHost() { return undefined; }
export const initializeGrowthBook = async () => null;
export async function getFeatureValue_DEPRECATED(feature, defaultValue) { return _getFlagValue(feature, defaultValue); }
export function getFeatureValue_CACHED_MAY_BE_STALE(feature, defaultValue) { return _getFlagValue(feature, defaultValue); }
export function getFeatureValue_CACHED_WITH_REFRESH(feature, defaultValue) { return _getFlagValue(feature, defaultValue); }
export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE(gate) { return Boolean(_getFlagValue(gate, false)); }
// Security killswitch — always false in the open build. Anthropic uses this
// gate to remotely disable bypassPermissions mode; exposing it via local flags
// would let users accidentally lock themselves out of --dangerously-skip-permissions.
export async function checkSecurityRestrictionGate(gate) { return false; }
export async function checkGate_CACHED_OR_BLOCKING(gate) { return Boolean(_getFlagValue(gate, false)); }
export function refreshGrowthBookAfterAuthChange() {}
export function resetGrowthBook() { _flags = undefined; }
export async function refreshGrowthBookFeatures() { _flags = undefined; }
export function setupPeriodicGrowthBookRefresh() {}
export function stopPeriodicGrowthBookRefresh() {}
export async function getDynamicConfig_BLOCKS_ON_INIT(configName, defaultValue) { return _getFlagValue(configName, defaultValue); }
export function getDynamicConfig_CACHED_MAY_BE_STALE(configName, defaultValue) { return _getFlagValue(configName, defaultValue); }
`,

	'services/analytics/sink': `
export function initializeAnalyticsGates() {}
export function initializeAnalyticsSink() {}
`,

	'services/analytics/config': `
export function isAnalyticsDisabled() { return true; }
export function isFeedbackSurveyDisabled() { return true; }
`,

	'services/analytics/datadog': `
export const initializeDatadog = async () => false;
export async function shutdownDatadog() {}
export async function trackDatadogEvent() {}
`,

	'services/analytics/firstPartyEventLogger': `
export function getEventSamplingConfig() { return {}; }
export function shouldSampleEvent() { return null; }
export async function shutdown1PEventLogging() {}
export function is1PEventLoggingEnabled() { return false; }
export function logEventTo1P() {}
export function logGrowthBookExperimentTo1P() {}
export function initialize1PEventLogging() {}
export async function reinitialize1PEventLoggingIfConfigChanged() {}
`,

	'services/analytics/firstPartyEventLoggingExporter': `
export class FirstPartyEventLoggingExporter {
	constructor() {}
	async export(logs, resultCallback) { resultCallback({ code: 0 }); }
	async getQueuedEventCount() { return 0; }
	async shutdown() {}
	async forceFlush() {}
}
`,

	'services/analytics/metadata': `
export function sanitizeToolNameForAnalytics(toolName) { return toolName; }
export function isToolDetailsLoggingEnabled() { return false; }
export function isAnalyticsToolDetailsLoggingEnabled() { return false; }
export function mcpToolDetailsForAnalytics() { return {}; }
export function extractMcpToolDetails() { return undefined; }
export function extractSkillName() { return undefined; }
export function extractToolInputForTelemetry() { return undefined; }
export function getFileExtensionForAnalytics() { return undefined; }
export function getFileExtensionsFromBashCommand() { return undefined; }
export async function getEventMetadata() { return {}; }
export function to1PEventFormat() { return {}; }
`,

	// ─── Telemetry subsystems ───────────────────────────────────────

	'utils/telemetry/bigqueryExporter': `
export class BigQueryMetricsExporter {
	constructor() {}
	async export(metrics, resultCallback) { resultCallback({ code: 0 }); }
	async shutdown() {}
	async forceFlush() {}
	selectAggregationTemporality() { return 0; }
}
`,

	'utils/telemetry/perfettoTracing': `
export function initializePerfettoTracing() {}
export function isPerfettoTracingEnabled() { return false; }
export function registerAgent() {}
export function unregisterAgent() {}
export function startLLMRequestPerfettoSpan() { return ''; }
export function endLLMRequestPerfettoSpan() {}
export function startToolPerfettoSpan() { return ''; }
export function endToolPerfettoSpan() {}
export function startUserInputPerfettoSpan() { return ''; }
export function endUserInputPerfettoSpan() {}
export function emitPerfettoInstant() {}
export function emitPerfettoCounter() {}
export function startInteractionPerfettoSpan() { return ''; }
export function endInteractionPerfettoSpan() {}
export function getPerfettoEvents() { return []; }
export function resetPerfettoTracer() {}
export async function triggerPeriodicWriteForTesting() {}
export function evictStaleSpansForTesting() {}
export const MAX_EVENTS_FOR_TESTING = 0;
export function evictOldestEventsForTesting() {}
`,

	'utils/telemetry/sessionTracing': `
const noopSpan = {
	end() {}, setAttribute() {}, setStatus() {},
	recordException() {}, addEvent() {}, isRecording() { return false; },
};
export function isBetaTracingEnabled() { return false; }
export function isEnhancedTelemetryEnabled() { return false; }
export function startInteractionSpan() { return noopSpan; }
export function endInteractionSpan() {}
export function startLLMRequestSpan() { return noopSpan; }
export function endLLMRequestSpan() {}
export function startToolSpan() { return noopSpan; }
export function startToolBlockedOnUserSpan() { return noopSpan; }
export function endToolBlockedOnUserSpan() {}
export function startToolExecutionSpan() { return noopSpan; }
export function endToolExecutionSpan() {}
export function endToolSpan() {}
export function addToolContentEvent() {}
export function getCurrentSpan() { return null; }
export async function executeInSpan(spanName, fn) { return fn(noopSpan); }
export function startHookSpan() { return noopSpan; }
export function endHookSpan() {}
`,

	// ─── Auto-updater (phones home to GCS + npm) ──────────────────

	'utils/autoUpdater': `
export async function assertMinVersion() {}
export async function getMaxVersion() { return undefined; }
export async function getMaxVersionMessage() { return undefined; }
export function shouldSkipVersion() { return true; }
export function getLockFilePath() { return '/tmp/openclaude-update.lock'; }
export async function checkGlobalInstallPermissions() { return { hasPermissions: false, npmPrefix: null }; }
export async function getLatestVersion() { return null; }
export async function getNpmDistTags() { return { latest: null, stable: null }; }
export async function getLatestVersionFromGcs() { return null; }
export async function getGcsDistTags() { return { latest: null, stable: null }; }
export async function getVersionHistory() { return []; }
export async function installGlobalPackage() { return 'success'; }
`,

	// ─── Plugin fetch telemetry (not the marketplace itself) ───────

	'utils/plugins/fetchTelemetry': `
export function logPluginFetch() {}
export function classifyFetchError() { return 'disabled'; }
`,

	// ─── Transcript / feedback sharing ─────────────────────────────

	'components/FeedbackSurvey/submitTranscriptShare': `
export async function submitTranscriptShare() { return { success: false }; }
`,

	// ─── Internal employee logging (not needed in the external build) ─────

	'services/internalLogging': `
export async function logPermissionContextForAnts() {}
export const getContainerId = async () => null;
`,

	// ─── Deleted Anthropic-internal modules ───────────────────────────────

	'services/api/dumpPrompts': `
export function createDumpPromptsFetch() { return undefined; }
export function getDumpPromptsPath() { return ''; }
export function getLastApiRequests() { return []; }
export function clearApiRequestCache() {}
export function clearDumpState() {}
export function clearAllDumpState() {}
export function addApiRequestToCache() {}
`,

	'utils/undercover': `
export function isUndercover() { return false; }
export function getUndercoverInstructions() { return ''; }
export function shouldShowUndercoverAutoNotice() { return false; }
`,

	'types/generated/events_mono/claude_code/v1/claude_code_internal_event': `
export const ClaudeCodeInternalEvent = {
  fromJSON: value => value,
  toJSON: value => value,
  create: value => value ?? {},
  fromPartial: value => value ?? {},
};
`,

	'types/generated/events_mono/growthbook/v1/growthbook_experiment_event': `
export const GrowthbookExperimentEvent = {
  fromJSON: value => value,
  toJSON: value => value,
  create: value => value ?? {},
  fromPartial: value => value ?? {},
};
`,

	'types/generated/events_mono/common/v1/auth': `
export const PublicApiAuth = {
  fromJSON: value => value,
  toJSON: value => value,
  create: value => value ?? {},
  fromPartial: value => value ?? {},
};
`,

	'types/generated/google/protobuf/timestamp': `
export const Timestamp = {
  fromJSON: value => value,
  toJSON: value => value,
  create: value => value ?? {},
  fromPartial: value => value ?? {},
};
`,
}

function escapeForResolvedPathRegex(modulePath: string): string {
	return modulePath
		.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
		.replace(/\//g, '[/\\\\]')
}

export const noTelemetryPlugin: BunPlugin = {
	name: 'no-telemetry',
	setup(build) {
		for (const [modulePath, contents] of Object.entries(stubs)) {
			// Build regex that matches the resolved file path on any OS
			// e.g. "services/analytics/growthbook" → /services[/\\]analytics[/\\]growthbook\.(ts|js)$/
			const escaped = escapeForResolvedPathRegex(modulePath)
			const filter = new RegExp(`${escaped}\\.(ts|js)$`)

			build.onLoad({ filter }, () => ({
				contents,
				loader: 'js',
			}))
		}

		console.log(`  🔇 no-telemetry: stubbed ${Object.keys(stubs).length} modules`)
	},
}
