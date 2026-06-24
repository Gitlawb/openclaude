# Reasoning and /effort Metadata

OpenClaude treats reasoning support as a per-model capability. Provider and gateway catalogs can contain a mix of reasoning and non-reasoning models, so reasoning controls must never be inferred provider-wide.

## Concepts

`capabilities.supportsReasoning` means the model is known to support reasoning or thinking behavior. It is safe capability metadata, but by itself it does not authorize OpenClaude to mutate API requests.

`reasoning` describes the request control surface OpenClaude can safely use for that exact model entry or model descriptor.

```ts
reasoning: {
  mode: 'levels' | 'toggle' | 'always-on'
  levels?: ['low', 'medium', 'high', 'xhigh', 'max']
  defaultLevel?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  wireFormat?:
    | 'reasoning_effort'
    | 'reasoning_object'
    | 'thinking_type'
    | 'deepseek_compatible'
    | 'zai_compatible'
    | 'none'
  disableFormat?: 'thinking_type_disabled'
}
```

## Backward Compatibility

The `/effort` resolver is intentionally conservative:

1. Explicit per-model `reasoning` metadata wins.
2. Existing hardcoded legacy effort support remains unchanged.
3. `supportsReasoning: true` without `reasoning` metadata is treated as reasoning-capable but not controllable.
4. Unknown models do not receive new reasoning request fields.

This means existing OpenAI, Codex, Claude, Gemini, and configured 3P override behavior remains active, while catalogs can safely mark models with `supportsReasoning` before their exact request shape has been audited.

## Provider and Gateway Rules

Annotate reasoning per exact model on the route where it was verified. Aggregating gateways must not add reasoning controls at the provider level because different upstream models accept different parameters and levels.

Prefer catalog-entry metadata when a gateway route differs from the canonical model descriptor. For example, a model may support reasoning directly from its vendor but reject `reasoning_effort` through a gateway.

Use `mode: 'always-on'` with `wireFormat: 'none'` for models that emit reasoning but do not have a verified control parameter on that route.

## Adding Support

Before adding `reasoning` metadata for a model:

1. Probe the exact route and model ID OpenClaude will send.
2. Record accepted levels and rejected levels.
3. Check whether disabling thinking is supported and what request shape is required.
4. Confirm whether accepted parameters actually change behavior or are silent no-ops.
5. Add focused tests for the resolver and request serialization path.

Do not use `supportsReasoning: true` alone as evidence that `reasoning_effort` or any other effort field is accepted.