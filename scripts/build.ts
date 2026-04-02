/**
 * OpenClaude build script — bundles the TypeScript source into a single
 * distributable JS file using Bun's bundler.
 *
 * Handles:
 * - bun:bundle feature() flags → all false (disables internal-only features)
 * - MACRO.* globals → inlined version/build-time constants
 * - src/ path aliases
 */

import { readFileSync } from 'fs'
import { noTelemetryPlugin } from './no-telemetry-plugin'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const version = pkg.version

// Feature flags — all disabled for the open build.
// These gate Anthropic-internal features (voice, proactive, kairos, etc.)
const featureFlags: Record<string, boolean> = {
  VOICE_MODE: false,
  PROACTIVE: false,
  KAIROS: false,
  BRIDGE_MODE: false,
  DAEMON: false,
  AGENT_TRIGGERS: false,
  MONITOR_TOOL: false,
  ABLATION_BASELINE: false,
  DUMP_SYSTEM_PROMPT: false,
  CACHED_MICROCOMPACT: false,
  COORDINATOR_MODE: false,
  CONTEXT_COLLAPSE: false,
  COMMIT_ATTRIBUTION: false,
  TEAMMEM: false,
  UDS_INBOX: false,
  BG_SESSIONS: false,
  AWAY_SUMMARY: false,
  TRANSCRIPT_CLASSIFIER: false,
  WEB_BROWSER_TOOL: false,
  MESSAGE_ACTIONS: false,
  BUDDY: false,
  CHICAGO_MCP: false,
  COWORKER_TYPE_TELEMETRY: false,
}

const result = await Bun.build({
  entrypoints: ['./src/entrypoints/cli.tsx'],
  outdir: './dist',
  target: 'node',
  format: 'esm',
  splitting: false,
  sourcemap: 'external',
  minify: false,
  naming: 'cli.mjs',
  define: {
    // MACRO.* build-time constants
    // Keep the internal compatibility version high enough to pass
    // first-party minimum-version guards, but expose the real package
    // version separately in Open Claude branding.
    'MACRO.VERSION': JSON.stringify('99.0.0'),
    'MACRO.DISPLAY_VERSION': JSON.stringify(version),
    'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
    'MACRO.ISSUES_EXPLAINER':
      JSON.stringify('report the issue at https://github.com/anthropics/claude-code/issues'),
    'MACRO.PACKAGE_URL': JSON.stringify('@gitlawb/openclaude'),
    'MACRO.NATIVE_PACKAGE_URL': 'undefined',
  },
  plugins: [
    noTelemetryPlugin,
    // Fix react-reconciler bug: flushPassiveEffects doesn't wrap executionContext
    // restoration in try-finally. If any passive effect throws, executionContext
    // leaks CommitContext permanently, killing all subsequent state updates.
    // Bug exists in react-reconciler <=0.34.0-canary, fixed in internal 0.34.5.
    {
      name: 'fix-reconciler-execution-context',
      setup(build) {
        build.onLoad({ filter: /react-reconciler/ }, async (args) => {
          let src = await Bun.file(args.path).text()
          // Match the flushPassiveEffects pattern using regex to handle whitespace
          const pattern = /(startTime = executionContext;\s*executionContext \|= CommitContext;\s*)(var finishedWork = priority\.current;\s*resetComponentEffectTimers\(\);\s*commitPassiveUnmountOnFiber\(finishedWork\);[\s\S]*?commitDoubleInvokeEffectsInDEV\(priority\);\s*)(executionContext = startTime;)/
          if (pattern.test(src)) {
            src = src.replace(pattern, '$1try { $2} finally { $3 }')
            console.log('  🔧 fix-reconciler: patched flushPassiveEffects executionContext leak')
          }
          return { contents: src, loader: 'js' }
        })
      },
    },
    {
      name: 'bun-bundle-shim',
      setup(build) {
        const internalFeatureStubModules = new Map([
          [
            '../daemon/workerRegistry.js',
            'export async function runDaemonWorker() { throw new Error("Daemon worker is unavailable in the open build."); }',
          ],
          [
            '../daemon/main.js',
            'export async function daemonMain() { throw new Error("Daemon mode is unavailable in the open build."); }',
          ],
          [
            '../cli/bg.js',
            `
export async function psHandler() { throw new Error("Background sessions are unavailable in the open build."); }
export async function logsHandler() { throw new Error("Background sessions are unavailable in the open build."); }
export async function attachHandler() { throw new Error("Background sessions are unavailable in the open build."); }
export async function killHandler() { throw new Error("Background sessions are unavailable in the open build."); }
export async function handleBgFlag() { throw new Error("Background sessions are unavailable in the open build."); }
`,
          ],
          [
            '../cli/handlers/templateJobs.js',
            'export async function templatesMain() { throw new Error("Template jobs are unavailable in the open build."); }',
          ],
          [
            '../environment-runner/main.js',
            'export async function environmentRunnerMain() { throw new Error("Environment runner is unavailable in the open build."); }',
          ],
          [
            '../self-hosted-runner/main.js',
            'export async function selfHostedRunnerMain() { throw new Error("Self-hosted runner is unavailable in the open build."); }',
          ],
        ] as const)

        // Resolve `import { feature } from 'bun:bundle'` to a shim
        build.onResolve({ filter: /^bun:bundle$/ }, () => ({
          path: 'bun:bundle',
          namespace: 'bun-bundle-shim',
        }))
        build.onLoad(
          { filter: /.*/, namespace: 'bun-bundle-shim' },
          () => ({
            contents: `export function feature(name) { return false; }`,
            loader: 'js',
          }),
        )

        build.onResolve(
          { filter: /^\.\.\/(daemon\/workerRegistry|daemon\/main|cli\/bg|cli\/handlers\/templateJobs|environment-runner\/main|self-hosted-runner\/main)\.js$/ },
          args => {
            if (!internalFeatureStubModules.has(args.path)) return null
            return {
              path: args.path,
              namespace: 'internal-feature-stub',
            }
          },
        )
        build.onLoad(
          { filter: /.*/, namespace: 'internal-feature-stub' },
          args => ({
            contents:
              internalFeatureStubModules.get(args.path) ??
              'export {}',
            loader: 'js',
          }),
        )

        // Resolve react/compiler-runtime to the standalone package
        build.onResolve({ filter: /^react\/compiler-runtime$/ }, () => ({
          path: 'react/compiler-runtime',
          namespace: 'react-compiler-shim',
        }))
        build.onLoad(
          { filter: /.*/, namespace: 'react-compiler-shim' },
          () => ({
            contents: `export function c(size) { return new Array(size).fill(Symbol.for('react.memo_cache_sentinel')); }`,
            loader: 'js',
          }),
        )

        // NOTE: @opentelemetry/* kept as external deps (too many named exports to stub)

        // Resolve native addon and missing snapshot imports to stubs
        for (const mod of [
          'audio-capture-napi',
          'audio-capture.node',
          'image-processor-napi',
          'modifiers-napi',
          'url-handler-napi',
          'color-diff-napi',
          'sharp',
          '@anthropic-ai/mcpb',
          '@ant/claude-for-chrome-mcp',
          '@anthropic-ai/sandbox-runtime',
          '@ant/computer-use-swift',
          '@ant/computer-use-mcp',
          '@ant/computer-use-mcp/sentinelApps',
          '@ant/computer-use-mcp/types',
          '@ant/computer-use-input',
          'asciichart',
          'plist',
          'cacache',
          'fuse',
          'code-excerpt',
          'stack-utils',
        ]) {
          build.onResolve({ filter: new RegExp(`^${mod}$`) }, () => ({
            path: mod,
            namespace: 'native-stub',
          }))
        }
        build.onLoad(
          { filter: /.*/, namespace: 'native-stub' },
          () => ({
            // Comprehensive stub that handles any named export via Proxy
            contents: `
const noop = () => null;
const noopClass = class {};
const handler = {
  get(_, prop) {
    if (prop === '__esModule') return true;
    if (prop === 'default') return new Proxy({}, handler);
    if (prop === 'ExportResultCode') return { SUCCESS: 0, FAILED: 1 };
    if (prop === 'resourceFromAttributes') return () => ({});
    if (prop === 'SandboxRuntimeConfigSchema') return { parse: () => ({}) };
    return noop;
  }
};
const stub = new Proxy(noop, handler);
export default stub;
export const __stub = true;
// Named exports for all known imports
export const SandboxViolationStore = null;
export const SandboxManager = new Proxy({}, { get: () => noop });
export const SandboxRuntimeConfigSchema = { parse: () => ({}) };
export const BROWSER_TOOLS = [];
export const getMcpConfigForManifest = noop;
export const ColorDiff = null;
export const ColorFile = null;
export const getSyntaxTheme = noop;
export const plot = noop;
export const createClaudeForChromeMcpServer = noop;
// OpenTelemetry exports
export const ExportResultCode = { SUCCESS: 0, FAILED: 1 };
export const resourceFromAttributes = noop;
export const Resource = noopClass;
export const SimpleSpanProcessor = noopClass;
export const BatchSpanProcessor = noopClass;
export const NodeTracerProvider = noopClass;
export const BasicTracerProvider = noopClass;
export const OTLPTraceExporter = noopClass;
export const OTLPLogExporter = noopClass;
export const OTLPMetricExporter = noopClass;
export const PrometheusExporter = noopClass;
export const LoggerProvider = noopClass;
export const SimpleLogRecordProcessor = noopClass;
export const BatchLogRecordProcessor = noopClass;
export const MeterProvider = noopClass;
export const PeriodicExportingMetricReader = noopClass;
export const trace = { getTracer: () => ({ startSpan: () => ({ end: noop, setAttribute: noop, setStatus: noop, recordException: noop }) }) };
export const context = { active: noop, with: (_, fn) => fn() };
export const SpanStatusCode = { OK: 0, ERROR: 1, UNSET: 2 };
export const ATTR_SERVICE_NAME = 'service.name';
export const ATTR_SERVICE_VERSION = 'service.version';
export const SEMRESATTRS_SERVICE_NAME = 'service.name';
export const SEMRESATTRS_SERVICE_VERSION = 'service.version';
export const AggregationTemporality = { CUMULATIVE: 0, DELTA: 1 };
export const DataPointType = { HISTOGRAM: 0, SUM: 1, GAUGE: 2 };
export const InstrumentType = { COUNTER: 0, HISTOGRAM: 1, UP_DOWN_COUNTER: 2 };
export const PushMetricExporter = noopClass;
export const SeverityNumber = {};
export const API_RESIZE_PARAMS = {};
export const targetImageSize = noop;
export const ComputerUseInput = noopClass;
export const getSentinelCategory = noop;
export const DEFAULT_GRANT_FLAGS = {};
export const bindSessionContext = noop;
export const buildComputerUseTools = noop;
export const createComputerUseMcpServer = noop;
`,
            loader: 'js',
          }),
        )

        // Stub missing internal Anthropic modules
        const missingInternalModules = [
          'proactive/index', 'assistant/gate', 'assistant/index', 'assistant/sessionDiscovery',
          'coordinator/workerAgent', 'services/compact/cachedMCConfig', 'services/compact/snipProjection',
          'services/compact/reactiveCompact', 'services/sessionTranscript/sessionTranscript',
          'services/skillSearch/featureCheck', 'services/skillSearch/prefetch', 'services/skillSearch/localSearch',
          'tools/DiscoverSkillsTool/prompt', 'tools/SnipTool/prompt', 'tools/SnipTool/SnipTool',
          'tools/OverflowTestTool/OverflowTestTool', 'tools/TerminalCaptureTool/prompt',
          'tools/TerminalCaptureTool/TerminalCaptureTool', 'tools/VerifyPlanExecutionTool/constants',
          'tools/SendUserFileTool/prompt', 'tools/SendUserFileTool/SendUserFileTool',
          'tools/MonitorTool/MonitorTool', 'tools/SleepTool/SleepTool', 'tools/WebBrowserTool/WebBrowserTool',
          'tools/PushNotificationTool/PushNotificationTool', 'tools/ListPeersTool/ListPeersTool',
          'tools/CtxInspectTool/CtxInspectTool', 'tools/SubscribePRTool/SubscribePRTool',
          'tools/WorkflowTool/WorkflowTool', 'tools/WorkflowTool/bundled/index', 'tools/WorkflowTool/createWorkflowCommand',
          'commands/assistant/index', 'commands/buddy/index', 'commands/force-snip',
          'commands/fork/index', 'commands/peers/index', 'commands/proactive',
          'commands/remoteControlServer/index', 'commands/subscribe-pr', 'commands/torch',
          'commands/workflows/index', 'utils/attributionHooks', 'utils/systemThemeWatcher',
          'utils/taskSummary', 'attributionTrailer', 'skills/mcpSkills',
          'server/backends/dangerousBackend', 'server/connectHeadless', 'server/lockfile',
          'server/parseConnectUrl', 'server/server', 'server/serverBanner', 'server/serverLog',
          'server/sessionManager', 'ssh/createSSHSession', 'jobs/classifier',
          'sessionTranscript/sessionTranscript',
          'tasks/MonitorMcpTask/MonitorMcpTask',
          'components/tasks/MonitorMcpDetailDialog',
          'messages/SnipBoundaryMessage',
          './WorkflowDetailDialog',
          '../udsMessaging',
          'MonitorMcpDetailDialog',
          './tasks/LocalWorkflowTask/LocalWorkflowTask',
          './UserCrossSessionMessage',
          './UserForkBoilerplateMessage',
          './UserGitHubWebhookMessage',
          './MonitorPermissionRequest/MonitorPermissionRequest',
          '../../tools/WorkflowTool/WorkflowPermissionRequest',
          './ReviewArtifactPermissionRequest/ReviewArtifactPermissionRequest',
          '../../tools/ReviewArtifactTool/ReviewArtifactTool',
          '../skillSearch/localSearch',
          './memoryShapeTelemetry',
          '../memdir/memoryShapeTelemetry',
          '../../utils/udsClient',
          '../../bridge/peerSessions',
          '../../services/skillSearch/telemetry',
          '../../services/skillSearch/remoteSkillLoader',
          '../../services/contextCollapse/operations',
          '../../services/skillSearch/remoteSkillState',
          '../tools/WebBrowserTool/WebBrowserPanel',
          '../proactive/useProactive',
          '../SendUserFileTool/prompt',
          '../services/contextCollapse/persist',
          './runSkillGenerator',
          './hunter',
          './dream',
          './utils/udsMessaging',
        ]
        const missingPattern = missingInternalModules.map(m => m.replace(/\//g, '\\/')).join('|')
        build.onResolve({ filter: new RegExp(`(${missingPattern})\\.js$`) }, (args) => ({
          path: args.path,
          namespace: 'missing-internal-stub',
        }))
        build.onLoad(
          { filter: /.*/, namespace: 'missing-internal-stub' },
          () => ({
            contents: `export default null; export const __stub = true;`,
            loader: 'js',
          }),
        )

        // Resolve .md and .txt file imports to empty string stubs
        build.onResolve({ filter: /\.(md|txt)$/ }, (args) => ({
          path: args.path,
          namespace: 'text-stub',
        }))
        build.onLoad(
          { filter: /.*/, namespace: 'text-stub' },
          () => ({
            contents: `export default '';`,
            loader: 'js',
          }),
        )
      },
    },
  ],
  external: [
    // OpenTelemetry — too many named exports to stub, kept external
    '@opentelemetry/api',
    '@opentelemetry/api-logs',
    '@opentelemetry/core',
    '@opentelemetry/exporter-trace-otlp-grpc',
    '@opentelemetry/exporter-trace-otlp-http',
    '@opentelemetry/exporter-trace-otlp-proto',
    '@opentelemetry/exporter-logs-otlp-http',
    '@opentelemetry/exporter-logs-otlp-proto',
    '@opentelemetry/exporter-logs-otlp-grpc',
    '@opentelemetry/exporter-metrics-otlp-proto',
    '@opentelemetry/exporter-metrics-otlp-grpc',
    '@opentelemetry/exporter-metrics-otlp-http',
    '@opentelemetry/exporter-prometheus',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-trace-base',
    '@opentelemetry/sdk-trace-node',
    '@opentelemetry/sdk-logs',
    '@opentelemetry/sdk-metrics',
    '@opentelemetry/semantic-conventions',
    // Cloud provider SDKs
    '@aws-sdk/client-bedrock',
    '@aws-sdk/client-bedrock-runtime',
    '@aws-sdk/client-sts',
    '@aws-sdk/credential-providers',
    '@azure/identity',
    'google-auth-library',
  ],
})

if (!result.success) {
  console.error('Build failed:')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log(`✓ Built openclaude v${version} → dist/cli.mjs`)
