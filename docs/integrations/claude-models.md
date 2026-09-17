# Claude model defaults and capabilities

OpenClaude's first-party Anthropic route resolves `opus` to `claude-opus-5`
and `sonnet` to `claude-sonnet-5`. `ANTHROPIC_DEFAULT_OPUS_MODEL` and
`ANTHROPIC_DEFAULT_SONNET_MODEL` override those aliases. Bedrock, Vertex, and
Foundry keep their existing alias defaults; selecting a Claude 5 identifier
does not change a provider's default or guarantee account access to that model.

The catalog declares 1,000,000 context tokens and 128,000 output tokens for
both Claude 5 models. Native Claude 5 context is unconditional: it does not
require an `[1m]` suffix or an extra-usage opt-in. Route-specific runtime
metadata and `CLAUDE_CODE_DISABLE_1M_CONTEXT` still apply; compatible endpoints
can advertise different limits. The PAYG picker omits redundant `[1m]` options
for models that already have unconditional 1M context.

Claude 5 uses adaptive thinking on supported native routes. Vertex excludes
Claude 5 from the built-in adaptive-thinking and effort allowlists; explicit
third-party capability overrides are evaluated first. The effort callout
checks the active route's available effort levels before announcing a medium
default. When Opus 5 thinking is disabled, `max` and `xhigh` effort are reduced
to `high`. Sonnet 5 requests omit temperature, and thinking-related context
edits are included only when thinking is active.

Vertex native web search recognizes `claude-sonnet-5`, including supported
provider suffixes, but rejects near matches such as `claude-sonnet-50`. Claude
5 identity checks require token boundaries on both sides, so arbitrary custom
model names do not inherit Claude 5 pricing or capabilities.

Third-party fallback suggestions map unavailable Claude 5 models to the
route's Opus 4.8 or Sonnet 4.6 identifier, including configured Bedrock inference
profiles. These suggestions are separate from the default alias selection.
Custom Anthropic-compatible teammate launches preserve the configured model
instead of assuming the endpoint serves first-party Opus 5.

Implementation references: [model aliases](../../src/utils/model/model.ts),
[runtime metadata](../../src/integrations/runtimeMetadata.ts),
[thinking](../../src/utils/thinking.ts), and
[reasoning effort](reasoning-effort.md).
