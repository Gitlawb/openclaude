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

	// Undercover is implemented in src/utils/undercover.ts and should NOT
	// be stubbed for the open build — keep the real module intact so the
	// /undercover slash command and default-on behaviour work.
	// (Left intentionally empty; the shim entry was removed.)

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
