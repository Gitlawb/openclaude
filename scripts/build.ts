/**
 * OpenClaude build script — bundles the TypeScript source into a single
 * distributable JS file using Bun's bundler.
 *
 * Handles:
 * - bun:bundle feature() flags for the open build
 * - MACRO.* globals → inlined version/build-time constants
 * - src/ path aliases
 */

import { readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { noTelemetryPlugin } from './no-telemetry-plugin'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const version = pkg.version

// Feature flags for the open build.
// Most Anthropic-internal features stay off; open-build features can be
// selectively enabled here when their full source exists in the mirror.
const featureFlags: Record<string, boolean> = {
  VOICE_MODE: false,
  PROACTIVE: false,
  KAIROS: false,
  BRIDGE_MODE: false,
  DAEMON: false,
  AGENT_TRIGGERS: false,
  MONITOR_TOOL: true,
  ABLATION_BASELINE: false,
  DUMP_SYSTEM_PROMPT: false,
  CACHED_MICROCOMPACT: false,
  COORDINATOR_MODE: true,
  BUILTIN_EXPLORE_PLAN_AGENTS: true,
  CONTEXT_COLLAPSE: false,
  COMMIT_ATTRIBUTION: false,
  TEAMMEM: true,
  UDS_INBOX: false,
  BG_SESSIONS: false,
  AWAY_SUMMARY: false,
  TRANSCRIPT_CLASSIFIER: false,
  WEB_BROWSER_TOOL: false,
  MESSAGE_ACTIONS: true,
  BUDDY: true,
  CHICAGO_MCP: false,
  COWORKER_TYPE_TELEMETRY: false,
}

// ── Pre-process: replace feature() calls with boolean literals ──────
// Bun v1.3.9+ resolves `import { feature } from 'bun:bundle'` natively
// before plugins can intercept it via onResolve. The bun: namespace is
// handled by Bun's C++ resolver which runs before the JS plugin phase,
// so the previous onResolve/onLoad shim was silently ineffective — ALL
// feature() calls evaluated to false regardless of the featureFlags map.
//
// Fix: pre-process source files to strip the bun:bundle import and
// replace feature('FLAG') calls with their boolean literal. Files are
// modified in-place before Bun.build() and restored in a finally block.

// Match feature('FLAG') calls, including multi-line: feature(\n  'FLAG',\n)
const featureCallRe = /\bfeature\(\s*['"](\w+)['"][,\s]*\)/gs
const featureImportRe = /import\s*\{[^}]*\bfeature\b[^}]*\}\s*from\s*['"]bun:bundle['"];?\s*\n?/g
const modifiedFiles = new Map<string, string>() // path → original content

function preProcessFeatureFlags(dir: string) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name)
    if (ent.isDirectory()) { preProcessFeatureFlags(full); continue }
    if (!/\.(ts|tsx)$/.test(ent.name)) continue

    const raw = readFileSync(full, 'utf-8')
    if (!raw.includes('feature(')) continue

    let contents = raw
    contents = contents.replace(featureImportRe, '')
    contents = contents.replace(featureCallRe, (_match, name) =>
      String((featureFlags as Record<string, boolean>)[name] ?? false),
    )

    if (contents !== raw) {
      modifiedFiles.set(full, raw)
      writeFileSync(full, contents)
    }
  }
}

function restoreModifiedFiles() {
  for (const [path, original] of modifiedFiles) {
    writeFileSync(path, original)
  }
  modifiedFiles.clear()
}

preProcessFeatureFlags(join(import.meta.dir, '..', 'src'))
const numModified = modifiedFiles.size

// Restore source files on abrupt termination (Ctrl+C, kill, etc.)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    restoreModifiedFiles()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  })
}

try {

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

        // bun:bundle feature() replacement is handled by the source
        // pre-processing step above (see preProcessFeatureFlags).
        // The previous onResolve/onLoad shim was ineffective in Bun
        // v1.3.9+ because the bun: namespace is resolved natively
        // before the JS plugin phase runs.

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
          '@anthropic-ai/mcpb',
          '@ant/claude-for-chrome-mcp',
          '@anthropic-ai/sandbox-runtime',
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
`,
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

        // Pre-scan: find all missing modules that need stubbing
        // (Bun's onResolve corrupts module graph even when returning null,
        //  so we use exact-match resolvers instead of catch-all patterns)
        const fs = require('fs')
        const pathMod = require('path')
        const srcDir = pathMod.resolve(__dirname, '..', 'src')
        const missingModules = new Set<string>()
        const missingModuleExports = new Map<string, Set<string>>()

        // Known missing external packages
        for (const pkg of [
          '@ant/computer-use-mcp',
          '@ant/computer-use-mcp/sentinelApps',
          '@ant/computer-use-mcp/types',
          '@ant/computer-use-swift',
          '@ant/computer-use-input',
        ]) {
          missingModules.add(pkg)
        }

        // Scan source to find imports that can't resolve
        function scanForMissingImports() {
          function checkAndRegister(specifier: string, fileDir: string, namedPart: string) {
                const names = namedPart.split(',')
                  .map((s: string) => s.trim().replace(/^type\s+/, ''))
                  .filter((s: string) => s && !s.startsWith('type '))

                // Check src/tasks/ non-relative imports
                if (specifier.startsWith('src/tasks/')) {
                  const resolved = pathMod.resolve(__dirname, '..', specifier)
                  const candidates = [
                    resolved,
                    `${resolved}.ts`, `${resolved}.tsx`,
                    resolved.replace(/\.js$/, '.ts'), resolved.replace(/\.js$/, '.tsx'),
                    pathMod.join(resolved, 'index.ts'), pathMod.join(resolved, 'index.tsx'),
                  ]
                  if (!candidates.some((c: string) => fs.existsSync(c))) {
                    missingModules.add(specifier)
                  }
                }
                // Check relative .js imports
                else if (specifier.endsWith('.js') && (specifier.startsWith('./') || specifier.startsWith('../'))) {
                  const resolved = pathMod.resolve(fileDir, specifier)
                  const tsVariant = resolved.replace(/\.js$/, '.ts')
                  const tsxVariant = resolved.replace(/\.js$/, '.tsx')
                  if (!fs.existsSync(resolved) && !fs.existsSync(tsVariant) && !fs.existsSync(tsxVariant)) {
                    missingModules.add(specifier)
                  }
                }

                // Track named exports for missing modules
                if (names.length > 0) {
                  if (!missingModuleExports.has(specifier)) missingModuleExports.set(specifier, new Set())
                  for (const n of names) missingModuleExports.get(specifier)!.add(n)
                }
          }

          function walk(dir: string) {
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
              const full = pathMod.join(dir, ent.name)
              if (ent.isDirectory()) { walk(full); continue }
              if (!/\.(ts|tsx)$/.test(ent.name)) continue
              const rawCode: string = fs.readFileSync(full, 'utf-8')
              const fileDir = pathMod.dirname(full)

              // Strip comments before scanning for imports/requires.
              // The regex scanner matches require()/import() patterns
              // inside JSDoc comments, causing false-positive missing
              // module detection that breaks the build with noop stubs.
              const code = rawCode
                .replace(/\/\*[\s\S]*?\*\//g, '')  // block comments
                .replace(/\/\/.*$/gm, '')           // line comments

              // Collect static imports: import { X } from '...'
              for (const m of code.matchAll(/import\s+(?:\{([^}]*)\}|(\w+))?\s*(?:,\s*\{([^}]*)\})?\s*from\s+['"](.*?)['"]/g)) {
                checkAndRegister(m[4], fileDir, m[1] || m[3] || '')
              }

              // Collect dynamic requires: require('...') — these are used
              // behind feature() gates and become live when flags are enabled.
              for (const m of code.matchAll(/require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g)) {
                checkAndRegister(m[1], fileDir, '')
              }

              // Collect dynamic imports: import('...')
              for (const m of code.matchAll(/import\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g)) {
                checkAndRegister(m[1], fileDir, '')
              }
            }
          }
          walk(srcDir)
        }
        scanForMissingImports()

        // Register exact-match resolvers for each missing module
        for (const mod of missingModules) {
          const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          build.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({
            path: mod,
            namespace: 'missing-module-stub',
          }))
        }

        build.onLoad(
          { filter: /.*/, namespace: 'missing-module-stub' },
          (args) => {
            const names = missingModuleExports.get(args.path) ?? new Set()
            const exports = [...names].map(n => `export const ${n} = noop;`).join('\n')
            return {
              contents: `
const noop = () => null;
export default noop;
${exports}
`,
              loader: 'js',
            }
          },
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
    // Native image processing
    'sharp',
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
  process.exitCode = 1
} else {
  console.log(`✓ Built openclaude v${version} → dist/cli.mjs`)
}

// ── SDK Bundle Build ──────────────────────────────────────────────────────
// SDK is a separate bundle for npm consumption - must NOT bundle React/Ink
console.log('Building SDK bundle...')

const sdkResult = await Bun.build({
  entrypoints: ['./src/entrypoints/sdk.ts'],
  outdir: './dist',
  target: 'node',
  format: 'esm',
  splitting: false,
  sourcemap: 'external',
  minify: false,
  naming: 'sdk.mjs',
  define: {
    'MACRO.VERSION': JSON.stringify('99.0.0'),
    'MACRO.DISPLAY_VERSION': JSON.stringify(version),
    'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
    'MACRO.PACKAGE_URL': JSON.stringify('@gitlawb/openclaude'),
    'MACRO.NATIVE_PACKAGE_URL': 'undefined',
  },
  // External: everything TUI-related + native modules
  external: [
    'react', 'ink', 'react-reconciler',
    '@anthropic-ai/sdk', '@modelcontextprotocol/sdk',
    // OpenTelemetry - too many exports, keep external
    '@opentelemetry/api', '@opentelemetry/api-logs', '@opentelemetry/core',
    '@opentelemetry/exporter-trace-otlp-grpc', '@opentelemetry/exporter-trace-otlp-http',
    '@opentelemetry/exporter-trace-otlp-proto',
    '@opentelemetry/exporter-logs-otlp-http', '@opentelemetry/exporter-logs-otlp-proto',
    '@opentelemetry/exporter-logs-otlp-grpc',
    '@opentelemetry/exporter-metrics-otlp-proto', '@opentelemetry/exporter-metrics-otlp-grpc',
    '@opentelemetry/exporter-metrics-otlp-http', '@opentelemetry/exporter-prometheus',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-trace-base', '@opentelemetry/sdk-trace-node',
    '@opentelemetry/sdk-logs', '@opentelemetry/sdk-metrics', '@opentelemetry/semantic-conventions',
    'sharp', 'google-auth-library',
    '@aws-sdk/client-bedrock', '@aws-sdk/client-bedrock-runtime', '@aws-sdk/client-sts',
    '@aws-sdk/credential-providers', '@azure/identity',
  ],
  plugins: [
    noTelemetryPlugin,
    // Stub missing internal/optional modules (same pattern as CLI build)
    {
      name: 'sdk-missing-stub',
      setup(build) {
        const missingModules = [
          '@anthropic-ai/mcpb',
          '@ant/claude-for-chrome-mcp',
          '@ant/computer-use-mcp',
          '@ant/computer-use-swift',
          '@ant/computer-use-input',
          '@anthropic-ai/sandbox-runtime',
          'audio-capture-napi', 'audio-capture.node',
          'image-processor-napi', 'modifiers-napi', 'url-handler-napi', 'color-diff-napi',
          'asciichart', 'plist', 'cacache', 'fuse', 'code-excerpt', 'stack-utils',
        ]
        for (const mod of missingModules) {
          const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          build.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({
            path: mod,
            namespace: 'sdk-missing-stub',
          }))
        }
        // Stub relative imports to TUI directories
        build.onResolve({ filter: /components\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /ink\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /commands\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /cli\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onLoad({ filter: /.*/, namespace: 'sdk-missing-stub' }, () => ({
          contents: `
const noop = () => null;
const noopClass = class {};
const noopArr = [];
const noopObj = {};
const noopStr = '';
const noopBool = false;
const handler = {
  get(_, prop) {
    if (prop === '__esModule') return true;
    if (prop === 'default') return new Proxy({}, handler);
    return noop;
  }
};
const stub = new Proxy(noop, handler);
export default stub;
export const __stub = true;
// Ink/utility exports
export const stringWidth = (s) => s?.length || 0;
export const wrapAnsi = (s) => s;
export const instances = new Map();
export const ctrlOToExpand = noop;
// Sandbox exports
export const SandboxManager = noopClass;
export const SandboxRuntimeConfigSchema = { parse: noop };
export const SandboxViolationStore = null;
// All ink.ts re-exports (SDK shouldn't import ink but init -> gracefulShutdown -> ink chain)
export const color = noopStr;
export const ThemeProvider = noopClass;
export const usePreviewTheme = noop;
export const useTheme = noop;
export const useThemeSetting = noop;
export const createRoot = noop;
export const inkCreateRoot = noop;
export const render = noop;
export const Box = noopClass;
export const Text = noopClass;
export const Ansi = noopClass;
export const NoSelect = noopClass;
export const RawAnsi = noopClass;
export const Spacer = noopClass;
export const Button = noopClass;
export const Link = noopClass;
export const Newline = noopClass;
export const BaseBox = noopClass;
export const BaseText = noopClass;
export const ClickEvent = noopClass;
export const EventEmitter = noopClass;
export const Event = noopClass;
export const InputEvent = noopClass;
export const TerminalFocusEvent = noopClass;
export const FocusManager = noopClass;
export const useAnimationFrame = noop;
export const useApp = noop;
export const useInput = noop;
export const useAnimationTimer = noop;
export const useInterval = noop;
export const useSelection = noop;
export const useStdin = noop;
export const useTabStatus = noop;
export const useTerminalFocus = noop;
export const useTerminalTitle = noop;
export const useTerminalViewport = noop;
export const measureElement = noop;
export const supportsTabStatus = noopBool;
export const supportsHyperlinks = noopBool;
export const wrapText = noopStr;
// Tool UI exports (SDK shouldn't bundle these but tools import them)
export const FallbackToolUseErrorMessage = noopClass;
export const FilePathLink = noopClass;
export const MessageResponse = noopClass;
export const OutputLine = noopClass;
export const ShellTimeDisplay = noopClass;
export const ShellStatusIndicator = noopClass;
export const ProgressBar = noopClass;
export const linkifyUrlsInText = (s) => s;
// Chrome MCP exports (stub)
export const createClaudeForChromeMcpServer = noop;
// All component exports from src/tools UI.tsx imports
export const Markdown = noopClass;
export const Message = noopClass;
export const MessageComponent = noopClass;
export const ToolUseLoader = noopClass;
export const AgentPromptDisplay = noopClass;
export const AgentResponseDisplay = noopClass;
export const KeyboardShortcutHint = noopClass;
export const Byline = noopClass;
export const AgentProgressLine = noopClass;
export const FallbackToolUseRejectedMessage = noopClass;
export const ConfigurableShortcutHint = noopClass;
export const SubAgentProvider = noopClass;
export const RejectedPlanMessage = noopClass;
export const FileEditToolUseRejectedMessage = noopClass;
export const FileEditToolUpdatedMessage = noopClass;
export const HighlightedCode = noopClass;
export const NotebookEditToolUseRejectedMessage = noopClass;
export const ShellProgressMessage = noopClass;
export const FullWidthRow = noopClass;
export const CtrlOToExpand = noopClass;
export const TeleportError = noopClass;
export const getTeleportErrors = noopArr;
export const TeleportLocalErrorType = noopStr;
export const TerminalSizeContext = noopObj;
// Ink termio exports (from gracefulShutdown imports)
export const CLEAR_TAB_STATUS = noopStr;
export const CLEAR_TERMINAL_TITLE = noopStr;
export const CLEAR_ITERM2_PROGRESS = noopStr;
export const wrapForMultiplexer = noop;
export const DISABLE_KITTY_KEYBOARD = noopStr;
export const DISABLE_MODIFY_OTHER_KEYS = noopStr;
export const DBP = noopStr;
export const DFE = noopStr;
export const DISABLE_MOUSE_TRACKING = noopStr;
export const EXIT_ALT_SCREEN = noopStr;
export const SHOW_CURSOR = noopStr;
// More component exports
export const Select = noopClass;
export const Pane = noopClass;
export const Spinner = noopClass;
// Command validation exports
export const addDirHelpMessage = noopStr;
export const validateDirectoryForWorkspace = noopBool;
// More command exports
export const resetLimitsNonInteractive = noop;
export const extraUsage = noop;
export const extraUsageNonInteractive = noop;
export const contextNonInteractive = noop;
export const ultrareview = noop;
export const resetLimits = noop;
export const context = noop;
export const BashModeProgress = noopClass;
export const extractDangerousSettings = noopArr;
export const hasDangerousSettings = noopBool;
export const hasDangerousSettingsChanged = noopBool;
export const ManagedSettingsSecurityDialog = noopClass;
// Catch-all for any other imports - return noop/noopClass
export const catchAll = new Proxy({}, { get: (_, prop) => prop.endsWith('Dialog') || prop.endsWith('Component') || prop.endsWith('Message') ? noopClass : noop });
`,
          loader: 'js',
        }))
      },
    },
  ],
})

if (!sdkResult.success) {
  console.error('SDK build failed:')
  for (const log of sdkResult.logs) {
    console.error(log)
  }
  process.exitCode = 1
} else {
  console.log(`✓ Built SDK bundle → dist/sdk.mjs`)
}

} finally {
  // Always restore source files, even if Bun.build() throws
  restoreModifiedFiles()
  console.log(`  🔄 feature-flags: pre-processed ${numModified} files (restored)`)
}
