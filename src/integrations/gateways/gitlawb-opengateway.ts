import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'gitlawb-opengateway',
  // ─── Transport workarounds ────────────────────────────────────────────────
  // These are declared here in the descriptor (not hard-coded in the shared
  // shim) so they are scoped to this gateway and easy to remove when the
  // server-side bugs are fixed.
  //
  // 1. dnsResultOrder: 'ipv4first' — Fly.io infrastructure can fail to
  //    authenticate connections arriving over IPv6 before the auth middleware
  //    runs, returning 401 "api_key_required" even with a valid key. The
  //    Cloudflare-fronted IPv4 path works correctly. Confirmed on Windows
  //    (WSL2) and Chromebook Crostini. Remove when Fly.io fixes IPv6 routing.
  //
  // 2. forceRequestHeaders: { Accept-Encoding: identity } — A Z_DATA_ERROR
  //    decompression crash was observed on authenticated streaming requests
  //    from a Chromebook Crostini container. The reviewer could not reproduce
  //    on unauthenticated routes (curl showed valid gzip). The fix is harmless
  //    (standard HTTP) and kept here with reduced confidence until confirmed
  //    server-side. Remove if the gateway confirms its gzip behavior is correct.
  // ────────────────────────────────────────────────────────────────────────────
  label: 'Gitlawb Opengateway',
  category: 'aggregating',
  defaultBaseUrl: 'https://opengateway.gitlawb.com/v1',
  defaultModel: 'mimo-v2.5-pro',
  supportsModelRouting: true,
  vendorId: 'openai',
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['OPENGATEWAY_API_KEY', 'OPENAI_API_KEY'],
  },
  validation: {
    kind: 'credential-env',
    // OPENGATEWAY_API_KEY first so users who set both don't get their generic
    // OpenAI key sent to opengateway by accident. OPENAI_API_KEY kept as a
    // fallback because that's where existing openclaude configs already hold it.
    credentialEnvVars: ['OPENGATEWAY_API_KEY', 'OPENAI_API_KEY'],
    missingCredentialMessage:
      'OPENGATEWAY_API_KEY is required to use Gitlawb Opengateway.\n' +
      'Mint a free API key at https://gitlawb.com/opengateway/keys and set it as OPENGATEWAY_API_KEY (or OPENAI_API_KEY when OPENAI_BASE_URL points at opengateway).',
    routing: {
      matchBaseUrlHosts: ['opengateway.gitlawb.com', 'opengateway.fly.dev'],
    },
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      // Opengateway expects `Authorization: Bearer ogw_live_...`. Previous
      // `api-key` raw header was a leftover from the direct-Xiaomi era.
      defaultAuthHeader: {
        name: 'authorization',
        scheme: 'bearer',
      },
      maxTokensField: 'max_completion_tokens',
      removeBodyFields: ['store', 'stream_options'],
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
      // Fly.io IPv6 paths can fail auth before the middleware runs; IPv4 via
      // Cloudflare works correctly. Uses a scoped undici Agent with a custom
      // connect.lookup — no global dns.setDefaultResultOrder mutation.
      dnsResultOrder: 'ipv4first',
      // Precautionary: a Z_DATA_ERROR was observed on authenticated streaming
      // requests from a Crostini container. Unauthenticated routes showed valid
      // gzip, so confidence is limited. Harmless to keep; remove if confirmed
      // unnecessary.
      forceRequestHeaders: { 'Accept-Encoding': 'identity' },
    },
  },
  preset: {
    id: 'gitlawb-opengateway',
    description: 'Gitlawb Opengateway — free hosted Xiaomi MiMo + GMI Cloud partner models (API key required, mint at https://gitlawb.com/opengateway/keys)',
    apiKeyEnvVars: ['OPENGATEWAY_API_KEY'],
    label: 'Gitlawb Opengateway',
    name: 'Gitlawb Opengateway',
    vendorId: 'openai',
    modelEnvVars: ['OPENAI_MODEL'],
    baseUrlEnvVars: ['OPENGATEWAY_BASE_URL', 'OPENAI_BASE_URL'],
    fallbackBaseUrl: 'https://opengateway.gitlawb.com/v1',
    fallbackModel: 'mimo-v2.5-pro',
    badge: { text: 'FREE', color: 'success' },
  },
  catalog: {
    source: 'static',
    models: [
      {
        id: 'opengateway-mimo-v2.5-pro',
        apiName: 'mimo-v2.5-pro',
        label: 'MiMo V2.5 Pro (via Opengateway)',
        modelDescriptorId: 'mimo-v2.5-pro',
      },
      {
        id: 'opengateway-mimo-v2-pro',
        apiName: 'mimo-v2-pro',
        label: 'MiMo V2 Pro (via Opengateway)',
        modelDescriptorId: 'mimo-v2-pro',
      },
      {
        id: 'opengateway-mimo-v2.5',
        apiName: 'mimo-v2.5',
        label: 'MiMo V2.5 (via Opengateway)',
        modelDescriptorId: 'mimo-v2.5',
      },
      {
        id: 'opengateway-mimo-v2-omni',
        apiName: 'mimo-v2-omni',
        label: 'MiMo V2 Omni (via Opengateway)',
        modelDescriptorId: 'mimo-v2-omni',
      },
      {
        id: 'opengateway-mimo-v2-flash',
        apiName: 'mimo-v2-flash',
        label: 'MiMo V2 Flash (via Opengateway)',
        modelDescriptorId: 'mimo-v2-flash',
      },
      // Non-Xiaomi models reachable through the same gateway endpoint. The
      // gateway routes by model name (see opengateway/src/providers.ts), so
      // the gateway URL stays unchanged; only the apiName the client sends
      // determines the upstream.
      {
        id: 'opengateway-gemini-3.1-flash-lite-preview',
        apiName: 'google/gemini-3.1-flash-lite-preview',
        label: 'Gemini 3.1 Flash Lite Preview (via Opengateway)',
        modelDescriptorId: 'gemini-3.1-flash-lite-preview',
      },
    ],
  },
  usage: { supported: false },
})
