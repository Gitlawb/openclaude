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
import { CLI_EXTERNALS, SDK_EXTERNALS } from './externals.js'

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
      JSON.stringify('report the issue at https://github.com/Gitlawb/openclaude/issues'),
    'MACRO.FEEDBACK_CHANNEL':
      JSON.stringify('https://github.com/Gitlawb/openclaude/issues'),
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
  external: CLI_EXTERNALS,
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
    'MACRO.VERSION': JSON.stringify(version),
    'MACRO.DISPLAY_VERSION': JSON.stringify(version),
    'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
    'MACRO.ISSUES_EXPLAINER':
      JSON.stringify('report the issue at https://github.com/Gitlawb/openclaude/issues'),
    'MACRO.FEEDBACK_CHANNEL':
      JSON.stringify('https://github.com/Gitlawb/openclaude/issues'),
    'MACRO.PACKAGE_URL': JSON.stringify('@gitlawb/openclaude'),
    'MACRO.NATIVE_PACKAGE_URL': 'undefined',
  },
  // External: everything TUI-related + native modules
  external: SDK_EXTERNALS,
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
        // Use (\.\.?\/)+ to match multiple ../ prefixes like ../../components/
        build.onResolve({ filter: /^(\.\.?\/)+components\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /^(\.\.?\/)+ink\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /^(\.\.?\/)+commands\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /^(\.\.?\/)+cli\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        // Stub relative imports to state/ directory EXCEPT for store.js and AppStateStore.js
        // which are React-free utilities needed by the SDK for state management.
        build.onResolve({ filter: /^(\.\.?\/)+state\// }, (args) => {
          // Exclude React-free state utilities from stubbing
          const isReactFreeStateModule =
            args.path.endsWith('store.js') ||
            args.path.endsWith('AppStateStore.js') ||
            args.path.endsWith('store.ts') ||
            args.path.endsWith('AppStateStore.ts')
          if (isReactFreeStateModule) {
            return null // Let Bun resolve normally
          }
          return {
            path: args.path,
            namespace: 'sdk-missing-stub',
          }
        })
        build.onResolve({ filter: /^(\.\.?\/)+context\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        // Also stub ./ paths used by re-exports in src/ink.ts, src/components/, etc.
        build.onResolve({ filter: /^\.\/components\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /^\.\/ink\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /^\.\/commands\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /^\.\/cli\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))

        // Stub src/ alias imports that resolve to TUI directories
        // These are used by require('src/components/...') style imports
        build.onResolve({ filter: /^src\/components\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /^src\/ink\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /^src\/commands\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /^src\/cli\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        // src/state/ contains AppState.tsx with React hooks, but store.ts and AppStateStore.ts
        // are React-free utilities needed by the SDK - exclude them from stubbing.
        build.onResolve({ filter: /^src\/state\// }, (args) => {
          // Exclude React-free state utilities from stubbing
          const isReactFreeStateModule =
            args.path.endsWith('store.js') ||
            args.path.endsWith('AppStateStore.js') ||
            args.path.endsWith('store.ts') ||
            args.path.endsWith('AppStateStore.ts')
          if (isReactFreeStateModule) {
            return null // Let Bun resolve normally
          }
          return {
            path: args.path,
            namespace: 'sdk-missing-stub',
          }
        })
        build.onResolve({ filter: /^src\/context\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))

        // Pre-scan: find all named imports for each stubbed module so we can
        // generate matching exports dynamically (avoids the whack-a-mole of
        // static export lists that break whenever a new import is added).
        const fs = require('fs')
        const pathMod = require('path')
        const srcDir = pathMod.resolve(__dirname, '..', 'src')
        const sdkStubExports = new Map<string, Set<string>>() // module path → set of imported names

        function scanSdkStubImports() {
          function register(specifier: string, namedPart: string) {
            const rawNames = namedPart.split(',')
              .map((s: string) => s.trim().replace(/^type\s+/, ''))
              .filter((s: string) => s && !s.startsWith('type '))
            if (rawNames.length === 0) return
            if (!sdkStubExports.has(specifier)) sdkStubExports.set(specifier, new Set())
            const names = sdkStubExports.get(specifier)!
            for (const s of rawNames) {
              // Handle "originalName as localName" — export BOTH names
              // because Bun validates the original export name exists
              const asMatch = s.match(/^(\w+)\s+as\s+(\w+)$/)
              if (asMatch) {
                names.add(asMatch[1]) // original name
                names.add(asMatch[2]) // aliased name
              } else {
                names.add(s)
              }
            }
          }
          const isStubbedSpecifier = (s: string) =>
            missingModules.includes(s) ||
            /^(\.\.?\/)+(components|ink|commands|cli|context|state)\//.test(s) ||
            /^src\/(components|ink|commands|cli|state|context)\//.test(s)
          function walk(dir: string) {
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
              const full = pathMod.join(dir, ent.name)
              if (ent.isDirectory()) { walk(full); continue }
              if (!/\.(ts|tsx)$/.test(ent.name)) continue
              const fileDir = pathMod.dirname(full)
              const rawCode: string = fs.readFileSync(full, 'utf-8')
              // Strip comments
              const code = rawCode
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/\/\/.*$/gm, '')
              // Collect static imports: import { X } from '...'
              for (const m of code.matchAll(/import\s+(?:\{([^}]*)\}|(\w+))?\s*(?:,\s*\{([^}]*)\})?\s*from\s+['"](.*?)['"]/g)) {
                const specifier = m[4]
                if (isStubbedSpecifier(specifier)) {
                  register(specifier, m[1] || m[3] || '')
                }
              }
              // Collect re-exports: export { X, Y } from '...'
              for (const m of code.matchAll(/export\s+\{([^}]*)\}\s*from\s+['"](.*?)['"]/g)) {
                const specifier = m[2]
                if (isStubbedSpecifier(specifier)) {
                  register(specifier, m[1])
                }
              }
              // Collect star re-exports: export * from '...'
              // These re-export all named exports from the source module.
              // For stubbed modules, we need to scan the re-exported module
              // to find its exports and register them under the stubbed specifier.
              for (const m of code.matchAll(/export\s+\*\s+from\s+['"](.*?)['"]/g)) {
                const specifier = m[1]
                if (isStubbedSpecifier(specifier)) {
                  // The re-exported module might itself be stubbed, so we need
                  // to find its exports. Parse the relative path and scan it.
                  const reexportPath = pathMod.resolve(fileDir, specifier)
                  const reexportBase = reexportPath.replace(/\.js$/, '')
                  const candidates = [
                    `${reexportBase}.ts`,
                    `${reexportBase}.tsx`,
                    reexportPath,
                    `${reexportPath}.ts`,
                    `${reexportPath}.tsx`,
                  ]
                  for (const candidate of candidates) {
                    if (fs.existsSync(candidate)) {
                      const reexportCode = fs.readFileSync(candidate, 'utf-8')
                        .replace(/\/\*[\s\S]*?\*\//g, '')
                        .replace(/\/\/.*$/gm, '')
                      // Collect exports from the re-exported module
                      for (const exp of reexportCode.matchAll(/export\s+(?:const|let|var|function|class|type|interface)\s+(\w+)/g)) {
                        register(specifier, exp[1])
                      }
                      for (const exp of reexportCode.matchAll(/export\s+\{([^}]*)\}/g)) {
                        register(specifier, exp[1])
                      }
                      break
                    }
                  }
                }
              }
            }
          }
          walk(srcDir)
        }
        scanSdkStubImports()

        // Special default exports for known modules
        const defaultExportOverrides: Record<string, string> = {
          'stringWidth': '(s) => s?.length || 0',
          'wrapAnsi': '(s) => s',
          'instances': 'new Map()',
          'selectableUserMessagesFilter': '() => true',
          'messagesAfterAreOnlySynthetic': '() => false',
          'SandboxManager': 'class { static isSupportedPlatform = () => false; static create = noop; static Version = \'\'; }',
          'SandboxRuntimeConfigSchema': '{ parse: noop }',
          'SandboxViolationStore': 'null',
          'BaseSandboxManager': 'class { static isSupportedPlatform = () => false; }',
          'ExportResultCode': '{ SUCCESS: 0, FAILED: 1 }',
          'linkifyUrlsInText': '(s) => s',
        }

        build.onLoad({ filter: /.*/, namespace: 'sdk-missing-stub' }, (args) => {
          const names = sdkStubExports.get(args.path) ?? new Set()
          const parts: string[] = []
          for (const n of names) {
            if (n === 'default') continue // handled by `export default noop` below
            const val = defaultExportOverrides[n] ?? 'noop'
            parts.push(`export const ${n} = ${val};`)
          }
          return {
            contents: `
const noop = () => null;
export default noop;
export const __stub = true;
${parts.join('\n')}
`,
            loader: 'js',
          }
        })
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
