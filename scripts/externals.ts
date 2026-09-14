/**
 * Shared external dependency lists for CLI and SDK bundles.
 *
 * Used by build.ts and validate-externals.ts.
 * When adding a new dependency to package.json, check if it should be
 * added here (large packages, native modules, or packages with many exports).
 */

// Packages that should be kept external in ALL bundles (CLI + SDK).
// NOTE: some entries here are ALSO in OPTIONAL_RUNTIME_EXTERNALS below
// (google-auth-library, @aws-sdk/*, @azure/identity) or in
// SHIPPED_OPTIONAL_EXTERNALS (sharp). That overlap is intentional: membership
// here means "never inline into the bundle". OPTIONAL_RUNTIME_EXTERNALS
// additionally means "not shipped in the default install — loaded on demand".
// SHIPPED_OPTIONAL_EXTERNALS means "shipped via optionalDependencies so
// published installs get the native module, but a failed native install does
// not fail the parent package". A package can be in COMMON_EXTERNALS and
// exactly one of those two sets.
export const COMMON_EXTERNALS: string[] = [
  // Native image processing
  'sharp',
  // Optional Sentry error reporting — dynamically required in utils/sentry.ts
  // only when SENTRY_DSN is set. Not shipped by default; kept external so
  // esbuild doesn't try to inline it.
  '@sentry/node',
  // Cloud provider SDKs
  '@aws-sdk/client-bedrock',
  '@aws-sdk/client-bedrock-runtime',
  '@aws-sdk/client-sts',
  '@aws-sdk/credential-provider-node',
  '@aws-sdk/credential-providers',
  '@smithy/core',
  '@smithy/node-http-handler',
  '@azure/identity',
  'google-auth-library',
  // @vscode/ripgrep ships a platform-specific binary alongside its
  // index.js and resolves the path via __dirname at runtime. Bundling
  // would freeze the build host's absolute path into dist/cli.mjs, so we
  // keep it external and rely on the npm package being installed.
  '@vscode/ripgrep',
  // Orama search engine
  '@orama/orama',
  '@orama/plugin-data-persistence',
  // web-tree-sitter ships a WASM file alongside its JS and resolves the
  // path via require.resolve at runtime; bundling would freeze the build
  // host's absolute path, so keep it external.
  'web-tree-sitter',
  // tree-sitter-wasms ships per-language .wasm files resolved via
  // require.resolve at runtime — same bundling concern as web-tree-sitter.
  'tree-sitter-wasms',
]

// Additional packages external only in the SDK bundle (TUI + heavy deps)
export const SDK_ONLY_EXTERNALS: string[] = [
  'react',
  'react-reconciler',
  '@anthropic-ai/sdk',
  '@modelcontextprotocol/sdk',
]

// Optional runtime packages: dynamically imported only when a provider/feature
// needs them, and NOT listed in package.json `dependencies`, so a default
// `npm install -g @gitlawb/openclaude` stays small and warning-free.
//
// Two shapes (see RUNTIME_INDIRECTION_ONLY_EXTERNALS below):
//   - Most stay external in both bundles (in COMMON_EXTERNALS) so esbuild never
//     inlines them — they ARE referenced where esbuild can see them.
//   - The indirection-only subset (@anthropic-ai/{bedrock,foundry}-sdk) is the
//     opposite: loaded purely via the runtime importer, so esbuild never sees a
//     static reference and they must stay OUT of the externals lists.
export const OPTIONAL_RUNTIME_EXTERNALS: string[] = [
  // Cloud provider SDKs (dynamically imported per-provider)
  '@aws-sdk/client-bedrock',
  '@aws-sdk/client-bedrock-runtime',
  '@aws-sdk/client-sts',
  '@aws-sdk/credential-provider-node',
  '@aws-sdk/credential-providers',
  '@smithy/core',
  '@smithy/node-http-handler',
  '@azure/identity',
  // Anthropic Bedrock client — loaded via the runtime importer in
  // services/api/client.ts. Not bundled (it statically imports @aws-sdk) and
  // not shipped; Bedrock users install it on demand (it pulls @aws-sdk itself).
  '@anthropic-ai/bedrock-sdk',
  // Anthropic Foundry client — also loaded only via the runtime importer in
  // services/api/client.ts (CLAUDE_CODE_USE_FOUNDRY). The Function indirection
  // means esbuild never sees it, so it is not bundled; Foundry users install it
  // on demand. (It is NOT in COMMON_EXTERNALS for the same reason as bedrock.)
  '@anthropic-ai/foundry-sdk',
  // GCP/Vertex auth — loaded via runtime import in services/api/client.ts.
  // Optional: only Vertex users need it. Its transitive tree (gaxios →
  // node-fetch → fetch-blob → node-domexception) is what triggered the
  // deprecation warning on install, so we no longer ship it by default.
  'google-auth-library',
  // Sentry error reporting — loaded via require() in utils/sentry.ts only
  // when SENTRY_DSN is set. Optional: most users never enable this.
  '@sentry/node',
]

// Native modules that stay external (never bundled) AND are shipped to
// published installs via package.json `optionalDependencies`.
//
// Why optionalDependencies rather than `dependencies`: sharp has an `install`
// script (`node install/check.js || npm run build`) and a funding field.
// Listing it in `dependencies` would break the zero-warning install contract
// (RUNTIME_DEPENDENCY_CONTRACT's exact-pin set + verify-clean-install, which
// forbids consumer-visible install-script chatter and scans the installed
// tree for install hooks). optionalDependencies still installs for default
// `npm install -g` so clipboard paste / image reads work, but a failed native
// compile does not fail the parent package.
//
// Do NOT move these to OPTIONAL_RUNTIME_EXTERNALS (that list is the unshipped
// on-demand set). Do NOT leave them only in devDependencies (#2224).
export const SHIPPED_OPTIONAL_EXTERNALS: string[] = [
  // Native image processing — loaded via dynamic import in the image tools.
  'sharp',
]

// OPTIONAL_RUNTIME_EXTERNALS that are loaded ONLY through the runtime importer
// (the `new Function` indirection in src/utils/optionalRuntimeModule.ts), so
// esbuild never sees a static reference to them. These must NOT appear in the
// externals lists: marking @anthropic-ai/bedrock-sdk external would let esbuild
// keep (and at startup evaluate) its static `@aws-sdk/client-bedrock-runtime`
// import, which is exactly the default-install crash this design avoids. Every
// OTHER optional external IS referenced somewhere esbuild can see (e.g. the
// remaining cloud-provider SDKs) and therefore must stay external. sharp is
// the same shape (dynamic import in imageProcessor.ts) but lives in
// SHIPPED_OPTIONAL_EXTERNALS because published installs must include it.
export const RUNTIME_INDIRECTION_ONLY_EXTERNALS: string[] = [
  '@anthropic-ai/bedrock-sdk',
  '@anthropic-ai/foundry-sdk',
]

// OPTIONAL_RUNTIME_EXTERNALS that are NOT direct devDependencies because they
// are pulled transitively by another optional package's dependency tree, so
// source builds/tests still resolve them. Every OTHER optional external must be
// a direct devDependency (validated) so `bun install` source/dev builds keep
// working.
export const TRANSITIVE_OPTIONAL_EXTERNALS: string[] = [
  '@aws-sdk/client-bedrock-runtime',
  '@aws-sdk/credential-providers',
]

// Computed full lists
export const CLI_EXTERNALS: string[] = COMMON_EXTERNALS
export const SDK_EXTERNALS: string[] = [...COMMON_EXTERNALS, ...SDK_ONLY_EXTERNALS]

// Packages intentionally bundled (not external, not flagged by validation)
// These are small utilities that are fine to inline into the output bundle.
export const INTENTIONALLY_BUNDLED: string[] = [
  // Anthropic provider variants (bundled, not the main SDK).
  // NOTE: @anthropic-ai/bedrock-sdk AND @anthropic-ai/foundry-sdk are
  // intentionally NOT bundled — they are loaded only via the runtime importer in
  // services/api/client.ts (esbuild never sees the specifier), so they live in
  // OPTIONAL_RUNTIME_EXTERNALS / RUNTIME_INDIRECTION_ONLY_EXTERNALS and Bedrock /
  // Foundry users install them on demand. @anthropic-ai/sandbox-runtime IS
  // statically imported (utils/sandbox/sandbox-adapter.ts), so esbuild bundles it.
  '@anthropic-ai/sandbox-runtime',
  // CLI / TUI utilities
  '@alcalzone/ansi-tokenize',
  '@commander-js/extra-typings',
  'bidi-js',
  'chalk',
  'cli-boxes',
  'cli-highlight',
  'commander',
  'emoji-regex',
  'env-paths',
  'figures',
  'get-east-asian-width',
  'indent-string',
  'supports-hyperlinks',
  'wrap-ansi',
  // Data formats
  'jsonc-parser',
  'yaml',
  'marked',
  'turndown',
  'xss',
  // Data utilities
  'ajv',
  'auto-bind',
  'diff',
  'fflate',
  'fuse.js',
  'ignore',
  'lodash-es',
  'lru-cache',
  'p-map',
  'picomatch',
  'proper-lockfile',
  'qrcode',
  'semver',
  'shell-quote',
  'signal-exit',
  'type-fest',
  // Networking
  'axios',
  'cross-spawn',
  'duck-duck-scrape',
  'execa',
  'https-proxy-agent',
  'tree-kill',
  'undici',
  'ws',
  // React ecosystem (react/react-reconciler are SDK_ONLY_EXTERNALS, bundled in CLI)
  'react',
  'react-compiler-runtime',
  'react-reconciler',
  'usehooks-ts',
  // Anthropic SDK (external in SDK bundle, bundled in CLI)
  '@anthropic-ai/sdk',
  // MCP SDK (external in SDK bundle, bundled in CLI)
  '@modelcontextprotocol/sdk',
  // Schema validation
  'zod',
    // gRPC (bundled into CLI, not external)
  '@grpc/grpc-js',
  '@grpc/proto-loader',
  // Language server protocol
  'vscode-languageserver-protocol',
  // File watching
  'chokidar',
  // Graph algorithms (repo map PageRank)
  'graphology',
  'graphology-metrics',
  // Tokenizer for repo map token budgeting
  'js-tiktoken',
]
