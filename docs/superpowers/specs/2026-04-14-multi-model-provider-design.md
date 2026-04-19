# Multi-Model Provider Support & Model Auto-Switch

**Date:** 2026-04-14
**Status:** Approved
**Scope:** Provider profiles, model picker, provider switching

## Summary

Add multi-model support to provider profiles (comma-separated model names in the existing `model` field) and fix model auto-switching when changing active providers. A single provider profile can list multiple models; the first model becomes the default when the provider is activated. All existing single-model profiles continue working unchanged.

## Problem

1. **Single model per provider**: Each `ProviderProfile` stores one model name. Users who want to switch between models under the same provider must create duplicate profiles with different model names.
2. **Model not auto-switching on provider change**: When switching providers, the model name from the previous provider persists instead of updating to the new provider's configured model.
3. **Cross-provider model leaks**: An Anthropic provider might incorrectly receive an OpenAI model string (or vice versa), or the default model fallback overrides the user's explicitly configured model.

## Design

### 1. Utility Functions (new file: `src/utils/providerModels.ts`)

```typescript
/** Parse comma-separated model names, trim whitespace, filter empty */
export function parseModelList(modelField: string): string[]

/** Get the primary (first) model from a model field */
export function getPrimaryModel(modelField: string): string

/** Check if a model field contains multiple models */
export function hasMultipleModels(modelField: string): boolean
```

- `parseModelList("glm-4.7, glm-4.7-flash")` → `["glm-4.7", "glm-4.7-flash"]`
- `parseModelList("llama3.1:8b")` → `["llama3.1:8b"]` (backward compatible)
- `getPrimaryModel("a, b, c")` → `"a"`

### 2. Provider Activation - Model Auto-Switch

**File:** `src/utils/providerProfiles.ts`

- `applyProviderProfileToProcessEnv()`: Use `getPrimaryModel(profile.model)` instead of `profile.model` when setting `process.env.OPENAI_MODEL` and `process.env.ANTHROPIC_MODEL`.
- `isProcessEnvAlignedWithProfile()`: Compare against `getPrimaryModel(profile.model)` instead of `profile.model`.
- `addProviderProfile()`: When applying new profile, set the first model as active.
- `setActiveProviderProfile()`: Ensure the first model of the target profile is applied to env.
- `updateProviderProfile()`: After update, re-apply with first model if the profile is active.

**Session state update:** When provider switches, the `mainLoopModel` app state must be updated to reflect the new provider's first model. This requires coordination in the `ProviderManager` component's `activateSelectedProvider()` flow.

### 3. Model Picker - Multi-Model Listing

**File:** `src/utils/model/modelOptions.ts`

- In `getModelOptionsBase()`, when provider profiles are active, read the profile's model list via `parseModelList()`.
- Generate a `ModelOption` for each model in the list, with the first marked as default.
- Each option: `{ value: modelName, label: modelName, description: 'Provider: profileName' }`.

**File:** `src/utils/providerProfiles.ts`

- `getActiveOpenAIModelOptionsCache()` / `setActiveOpenAIModelOptionsCache()`: Integrate with multi-model list. When a profile has multiple models, populate the cache with all models as options.
- On provider activation, populate the model options cache with all models from the profile.

**File:** `src/components/ModelPicker.tsx` (if needed)

- Ensure multi-model options render correctly without duplicates.
- Active model is highlighted.

### 4. ProviderManager UI Updates

**File:** `src/components/ProviderManager.tsx`

- **Form step "model"**: Update `helpText` to mention comma-separated multi-model support: *"Model name(s). Use commas for multiple models (e.g. glm-4.7, glm-4.7-flash). First model is the default."*
- **Update `placeholder`**: `"e.g. llama3.1:8b or glm-4.7, glm-4.7-flash"`
- **`profileSummary()`**: When `hasMultipleModels()`, show model count: `"glm-4.7 + 2 more (3 models)"`
- **Provider list in menu**: Show multi-model indicator.

### 5. Cross-Provider Model Isolation

**File:** `src/utils/model/model.ts`

- `getUserSpecifiedModelSetting()`: When the active provider is managed via a provider profile, the model setting should come from the profile's first model, not from a stale env var or settings from a different provider.
- `getDefaultMainLoopModelSetting()`: For provider-profile-managed providers, use the profile's first model as the default, not the built-in provider defaults (which may not match the user's configured models).

**File:** `src/utils/providerProfiles.ts`

- `persistActiveProviderProfileModel()`: When `/model` changes the model, persist it to the active profile. If the new model is not in the profile's model list, append it.

### 6. Data Flow Summary

```
Provider added (model: "glm-4.7, glm-4.7-flash")
  ↓
parseModelList() → ["glm-4.7", "glm-4.7-flash"]
  ↓
applyProviderProfileToProcessEnv()
  → process.env.OPENAI_MODEL = "glm-4.7"  (first model)
  ↓
/model picker shows:
  - Default (glm-4.7)   ← from profile, first model
  - glm-4.7
  - glm-4.7-flash
  ↓
User picks glm-4.7-flash
  → persistActiveProviderProfileModel("glm-4.7-flash")
  → session updates
```

### 7. Backward Compatibility

- Single-model strings: `"llama3.1:8b"` → `parseModelList()` returns `["llama3.1:8b"]`. No behavior change.
- `getPrimaryModel("single")` returns `"single"`. All existing code paths work.
- `ProviderProfile` type unchanged. No migration needed.
- Existing settings, env vars, and saved profiles work as-is.

### 8. Files to Modify

| File | Change |
|------|--------|
| `src/utils/providerModels.ts` | **New file** - parseModelList, getPrimaryModel, hasMultipleModels |
| `src/utils/providerProfiles.ts` | Use getPrimaryModel in apply/align functions; populate model cache on activation |
| `src/utils/model/modelOptions.ts` | Generate ModelOption[] from multi-model profile |
| `src/components/ProviderManager.tsx` | Update form help text, profileSummary display |
| `src/utils/model/model.ts` | Ensure getUserSpecifiedModelSetting respects profile model on provider switch |

### 9. Testing Strategy

- Unit tests for `parseModelList`, `getPrimaryModel`, `hasMultipleModels`
- Unit tests for `applyProviderProfileToProcessEnv` with multi-model profiles
- Unit tests for `setActiveProviderProfile` ensuring first model is applied
- Unit test for model picker options generation with multi-model profiles
- Integration test: add multi-model provider → activate → verify first model active → switch model → verify persistence
- Integration test: single-model profiles unchanged (backward compat)
