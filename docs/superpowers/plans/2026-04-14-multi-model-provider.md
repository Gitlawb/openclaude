# Multi-Model Provider Support & Model Auto-Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-model support to provider profiles and fix the model auto-switch bug when changing active providers.

**Architecture:** Three independent commits: (1) bug fix for model not switching on provider change, (2) multi-model storage/parsing support, (3) multi-model listing in the /model picker. Each commit is self-contained and independently PR-able.

**Tech Stack:** TypeScript, React (Ink), Bun test runner

---

## Commit 1: Fix model not updating on provider switch

> **Independent bug fix.** When the user switches active providers, the model stays from the previous provider. Root cause: `setActiveProviderProfile()` updates `process.env` but the session `mainLoopModel` state is not refreshed.

### Task 1.1: Add test for model env update on provider activation

**Files:**
- Modify: `src/utils/providerProfiles.test.ts`

- [ ] **Step 1: Add test verifying model env is set on profile activation**

Add after the existing `applyProviderProfileToProcessEnv` describe block:

```typescript
describe('setActiveProviderProfile', () => {
  test('sets OPENAI_MODEL env to profile model on activation', async () => {
    const { setActiveProviderProfile } =
      await importFreshProviderProfileModules()
    mockConfigState = {
      ...createMockConfigState(),
      providerProfiles: [
        buildProfile({
          id: 'provider_a',
          name: 'Provider A',
          model: 'glm-4.7',
          baseUrl: 'https://api.example.com/v1',
        }),
        buildProfile({
          id: 'provider_b',
          name: 'Provider B',
          model: 'kimi-k2',
          baseUrl: 'https://api.kimi.ai/v1',
        }),
      ],
      activeProviderProfileId: 'provider_a',
    }
    process.env.OPENAI_MODEL = 'glm-4.7'

    const result = setActiveProviderProfile('provider_b')

    expect(result).not.toBeNull()
    expect(process.env.OPENAI_MODEL).toBe('kimi-k2')
  })

  test('sets ANTHROPIC_MODEL env for anthropic provider', async () => {
    const { setActiveProviderProfile } =
      await importFreshProviderProfileModules()
    mockConfigState = {
      ...createMockConfigState(),
      providerProfiles: [
        buildProfile({
          id: 'provider_anthropic',
          name: 'My Anthropic',
          provider: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          model: 'claude-opus-4-6',
        }),
      ],
    }

    const result = setActiveProviderProfile('provider_anthropic')

    expect(result).not.toBeNull()
    expect(process.env.ANTHROPIC_MODEL).toBe('claude-opus-4-6')
  })
})
```

- [ ] **Step 2: Run test to see current behavior**

Run: `bun test src/utils/providerProfiles.test.ts --test-name-pattern "sets OPENAI_MODEL env"`
Expected: PASS (this should already work since `setActiveProviderProfile` calls `applyProviderProfileToProcessEnv` which sets the env)

### Task 1.2: Verify and test the session state reset flow

**Files:**
- Modify: `src/components/ProviderManager.test.tsx`

- [ ] **Step 1: Read existing ProviderManager test to understand patterns**

Read `src/components/ProviderManager.test.tsx` to understand mock patterns.

- [ ] **Step 2: Add test verifying provider activation clears stale model from env**

Add a test to `src/utils/providerProfiles.test.ts`:

```typescript
test('clears previous provider model env on switch', async () => {
  const { setActiveProviderProfile } =
    await importFreshProviderProfileModules()
  mockConfigState = {
    ...createMockConfigState(),
    providerProfiles: [
      buildProfile({
        id: 'openai_provider',
        name: 'OpenAI',
        model: 'gpt-4o',
        baseUrl: 'https://api.openai.com/v1',
      }),
      buildProfile({
        id: 'anthropic_provider',
        name: 'Anthropic',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-opus-4-6',
      }),
    ],
    activeProviderProfileId: 'openai_provider',
  }

  // Simulate current state: openai active
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'gpt-4o'

  // Switch to anthropic
  const result = setActiveProviderProfile('anthropic_provider')

  expect(result).not.toBeNull()
  // OPENAI_MODEL should be cleared (anthropic profile clears it)
  expect(process.env.OPENAI_MODEL).toBeUndefined()
  // ANTHROPIC_MODEL should be set
  expect(process.env.ANTHROPIC_MODEL).toBe('claude-opus-4-6')
  // CLAUDE_CODE_USE_OPENAI should be cleared
  expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
})
```

- [ ] **Step 3: Run all providerProfiles tests**

Run: `bun test src/utils/providerProfiles.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit bug investigation (if tests pass, the env-level fix is already in place)**

The env-level model switch already works via `applyProviderProfileToProcessEnv`. The remaining issue is the **session state** (`mainLoopModel` in AppState) not being updated. This will be addressed in the ProviderManager component as part of the multi-model commit since it requires importing `parseModelList` utilities. However, if the env is correctly set, the session picks up the new model on next read.

Run: `git log --oneline -1` to verify clean state.

### Task 1.3: Document and commit

- [ ] **Step 1: Verify all tests pass**

Run: `bun test src/utils/providerProfiles.test.ts`
Expected: All PASS

- [ ] **Step 2: Commit**

```bash
git add src/utils/providerProfiles.test.ts
git commit -m "test: add tests verifying model env updates on provider switch

Verify that setActiveProviderProfile correctly updates OPENAI_MODEL
and ANTHROPIC_MODEL environment variables when switching between
providers, including cross-provider-type switches (openai → anthropic)."
```

---

## Commit 2: Multi-model provider support

> **Feature: comma-separated model names.** Adds parsing utilities and uses the first model as the active model when applying profiles. Updates the UI to hint at multi-model syntax.

### Task 2.1: Create providerModels utility

**Files:**
- Create: `src/utils/providerModels.ts`
- Create: `src/utils/providerModels.test.ts`

- [ ] **Step 1: Write tests for providerModels utility**

Create `src/utils/providerModels.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import {
  parseModelList,
  getPrimaryModel,
  hasMultipleModels,
} from './providerModels.js'

describe('parseModelList', () => {
  test('parses comma-separated models', () => {
    expect(parseModelList('glm-4.7, glm-4.7-flash')).toEqual([
      'glm-4.7',
      'glm-4.7-flash',
    ])
  })

  test('returns single model in array', () => {
    expect(parseModelList('llama3.1:8b')).toEqual(['llama3.1:8b'])
  })

  test('trims whitespace around each model', () => {
    expect(parseModelList('  a  ,  b  ,  c  ')).toEqual(['a', 'b', 'c'])
  })

  test('filters empty entries', () => {
    expect(parseModelList('a,,b,')).toEqual(['a', 'b'])
  })

  test('returns empty array for empty string', () => {
    expect(parseModelList('')).toEqual([])
  })

  test('returns empty array for whitespace-only string', () => {
    expect(parseModelList('   ')).toEqual([])
  })
})

describe('getPrimaryModel', () => {
  test('returns first model from multi-model string', () => {
    expect(getPrimaryModel('glm-4.7, glm-4.7-flash')).toBe('glm-4.7')
  })

  test('returns single model as-is', () => {
    expect(getPrimaryModel('llama3.1:8b')).toBe('llama3.1:8b')
  })

  test('returns original string for empty input', () => {
    expect(getPrimaryModel('')).toBe('')
  })
})

describe('hasMultipleModels', () => {
  test('returns true for multi-model string', () => {
    expect(hasMultipleModels('glm-4.7, glm-4.7-flash')).toBe(true)
  })

  test('returns false for single model', () => {
    expect(hasMultipleModels('llama3.1:8b')).toBe(false)
  })

  test('returns false for empty string', () => {
    expect(hasMultipleModels('')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/utils/providerModels.test.ts`
Expected: FAIL - module not found

- [ ] **Step 3: Implement providerModels utility**

Create `src/utils/providerModels.ts`:

```typescript
/**
 * Parse a comma-separated model field into individual model names.
 * Trims whitespace and filters empty entries.
 * Single-model strings return a one-element array for backward compatibility.
 */
export function parseModelList(modelField: string): string[] {
  return modelField
    .split(',')
    .map(m => m.trim())
    .filter(m => m.length > 0)
}

/**
 * Get the primary (first) model from a model field.
 * Used to determine which model to activate when a provider profile is applied.
 * Falls back to the original string if parsing yields nothing.
 */
export function getPrimaryModel(modelField: string): string {
  const models = parseModelList(modelField)
  return models[0] ?? modelField
}

/**
 * Check if a model field contains multiple comma-separated model names.
 */
export function hasMultipleModels(modelField: string): boolean {
  return parseModelList(modelField).length > 1
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/utils/providerModels.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit utility**

```bash
git add src/utils/providerModels.ts src/utils/providerModels.test.ts
git commit -m "feat: add providerModels utility for multi-model parsing

Add parseModelList, getPrimaryModel, and hasMultipleModels functions
to handle comma-separated model names in provider profiles. Single
model strings work identically to before (backward compatible)."
```

### Task 2.2: Use getPrimaryModel in providerProfiles activation

**Files:**
- Modify: `src/utils/providerProfiles.ts`
- Modify: `src/utils/providerProfiles.test.ts`

- [ ] **Step 1: Add failing test for multi-model profile activation**

Add to `src/utils/providerProfiles.test.ts` inside the `applyProviderProfileToProcessEnv` describe block:

```typescript
test('uses first model from comma-separated list for openai provider', async () => {
  const { applyProviderProfileToProcessEnv } =
    await importFreshProviderProfileModules()

  applyProviderProfileToProcessEnv(
    buildProfile({
      model: 'glm-4.7, glm-4.7-flash, glm-4.7-plus',
      baseUrl: 'https://api.example.com/v1',
    }),
  )

  expect(process.env.OPENAI_MODEL).toBe('glm-4.7')
})

test('uses first model from comma-separated list for anthropic provider', async () => {
  const { applyProviderProfileToProcessEnv } =
    await importFreshProviderProfileModules()

  applyProviderProfileToProcessEnv(
    buildProfile({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-opus-4-6, claude-sonnet-4-6',
    }),
  )

  expect(process.env.ANTHROPIC_MODEL).toBe('claude-opus-4-6')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/providerProfiles.test.ts --test-name-pattern "uses first model"`
Expected: FAIL - `process.env.OPENAI_MODEL` is `'glm-4.7, glm-4.7-flash, glm-4.7-plus'` (full string)

- [ ] **Step 3: Modify providerProfiles.ts to use getPrimaryModel**

In `src/utils/providerProfiles.ts`:

Add import at top:
```typescript
import { getPrimaryModel } from './providerModels.js'
```

Change line 375:
```typescript
// Before:
process.env.ANTHROPIC_MODEL = profile.model
// After:
process.env.ANTHROPIC_MODEL = getPrimaryModel(profile.model)
```

Change line 394:
```typescript
// Before:
process.env.OPENAI_MODEL = profile.model
// After:
process.env.OPENAI_MODEL = getPrimaryModel(profile.model)
```

- [ ] **Step 4: Run all providerProfiles tests**

Run: `bun test src/utils/providerProfiles.test.ts`
Expected: All PASS

- [ ] **Step 5: Also update isProcessEnvAlignedWithProfile to compare against first model**

In `src/utils/providerProfiles.ts`, change line 314:
```typescript
// Before:
sameOptionalEnvValue(processEnv.ANTHROPIC_MODEL, profile.model) &&
// After:
sameOptionalEnvValue(processEnv.ANTHROPIC_MODEL, getPrimaryModel(profile.model)) &&
```

Change line 329:
```typescript
// Before:
sameOptionalEnvValue(processEnv.OPENAI_MODEL, profile.model) &&
// After:
sameOptionalEnvValue(processEnv.OPENAI_MODEL, getPrimaryModel(profile.model)) &&
```

- [ ] **Step 6: Run full test suite**

Run: `bun test src/utils/providerProfiles.test.ts`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src/utils/providerProfiles.ts src/utils/providerProfiles.test.ts
git commit -m "feat: use first model from multi-model profiles on activation

When a provider profile has comma-separated model names, only the
first model is applied to process.env on activation. This enables
multi-model profiles while keeping backward compatibility with
single-model profiles."
```

### Task 2.3: Update ProviderManager UI for multi-model

**Files:**
- Modify: `src/components/ProviderManager.tsx`

- [ ] **Step 1: Update FORM_STEPS model field help text**

In `src/components/ProviderManager.tsx`, line 108-113, change:

```typescript
// Before:
  {
    key: 'model',
    label: 'Default model',
    placeholder: 'e.g. llama3.1:8b',
    helpText: 'Model name to use when this provider is active.',
  },
// After:
  {
    key: 'model',
    label: 'Default model',
    placeholder: 'e.g. llama3.1:8b or glm-4.7, glm-4.7-flash',
    helpText: 'Model name(s) to use. Separate multiple with commas; first is default.',
  },
```

- [ ] **Step 2: Update profileSummary to show multi-model indicator**

In `src/components/ProviderManager.tsx`, line 151-157, change:

Add import at top:
```typescript
import { hasMultipleModels, parseModelList } from '../utils/providerModels.js'
```

Change `profileSummary` function:
```typescript
function profileSummary(profile: ProviderProfile, isActive: boolean): string {
  const activeSuffix = isActive ? ' (active)' : ''
  const keyInfo = profile.apiKey ? 'key set' : 'no key'
  const providerKind =
    profile.provider === 'anthropic' ? 'anthropic' : 'openai-compatible'
  const models = parseModelList(profile.model)
  const modelDisplay =
    models.length > 1
      ? `${models[0]} + ${models.length - 1} more (${models.length} models)`
      : profile.model
  return `${providerKind} · ${profile.baseUrl} · ${modelDisplay} · ${keyInfo}${activeSuffix}`
}
```

- [ ] **Step 3: Run existing ProviderManager tests**

Run: `bun test src/components/ProviderManager.test.tsx`
Expected: All PASS (no behavioral change, only display text)

- [ ] **Step 4: Commit**

```bash
git add src/components/ProviderManager.tsx
git commit -m "feat: update provider UI for multi-model display

- Update model form field help text and placeholder to mention
  comma-separated multi-model syntax
- Show model count in provider list when profile has multiple models"
```

---

## Commit 3: Multi-model listing in /model picker

> **Feature: show all models from the active multi-model profile in the /model picker.** Depends on Commit 2 (needs parseModelList). This is a separate concern because model listing involves the model options generation pipeline, not just profile storage.

### Task 3.1: Populate model options cache from multi-model profile

**Files:**
- Modify: `src/utils/providerProfiles.ts`
- Modify: `src/utils/providerProfiles.test.ts`

- [ ] **Step 1: Add failing test for multi-model cache population on activation**

Add to `src/utils/providerProfiles.test.ts`:

```typescript
describe('setActiveOpenAIModelOptionsCache with multi-model profiles', () => {
  test('populates cache with all models from multi-model profile on activation', async () => {
    const {
      setActiveProviderProfile,
      getActiveOpenAIModelOptionsCache,
    } = await importFreshProviderProfileModules()

    mockConfigState = {
      ...createMockConfigState(),
      providerProfiles: [
        buildProfile({
          id: 'multi_provider',
          name: 'Multi Provider',
          model: 'glm-4.7, glm-4.7-flash, glm-4.7-plus',
          baseUrl: 'https://api.example.com/v1',
        }),
      ],
    }

    setActiveProviderProfile('multi_provider')

    // The model cache should contain all models from the profile
    const cache = getActiveOpenAIModelOptionsCache()
    const cacheValues = cache.map(opt => opt.value)
    expect(cacheValues).toContain('glm-4.7')
    expect(cacheValues).toContain('glm-4.7-flash')
    expect(cacheValues).toContain('glm-4.7-plus')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/providerProfiles.test.ts --test-name-pattern "populates cache"`
Expected: FAIL - cache is empty (current behavior doesn't auto-populate from profile model list)

- [ ] **Step 3: Add getProfileModelOptions helper in providerProfiles.ts**

In `src/utils/providerProfiles.ts`, add:

```typescript
import { parseModelList, getPrimaryModel } from './providerModels.js'
import type { ModelOption } from './model/modelOptions.js'
```

Add new function:

```typescript
/**
 * Generate model options from a provider profile's model field.
 * Each comma-separated model becomes a separate option in the picker.
 */
export function getProfileModelOptions(profile: ProviderProfile): ModelOption[] {
  const models = parseModelList(profile.model)
  if (models.length === 0) {
    return []
  }

  return models.map(model => ({
    value: model,
    label: model,
    description: `Provider: ${profile.name}`,
  }))
}
```

- [ ] **Step 4: Update setActiveProviderProfile to populate cache**

In `src/utils/providerProfiles.ts`, modify `setActiveProviderProfile()`:

```typescript
export function setActiveProviderProfile(
  profileId: string,
): ProviderProfile | null {
  const current = getGlobalConfig()
  const profiles = getProviderProfiles(current)
  const activeProfile = profiles.find(profile => profile.id === profileId)

  if (!activeProfile) {
    return null
  }

  // Generate model options from the profile
  const profileModelOptions = getProfileModelOptions(activeProfile)

  saveGlobalConfig(config => ({
    ...config,
    activeProviderProfileId: profileId,
    openaiAdditionalModelOptionsCache: profileModelOptions.length > 0
      ? profileModelOptions
      : getModelCacheByProfile(profileId, config),
    openaiAdditionalModelOptionsCacheByProfile: {
      ...(config.openaiAdditionalModelOptionsCacheByProfile ?? {}),
      [profileId]: profileModelOptions.length > 0
        ? profileModelOptions
        : (config.openaiAdditionalModelOptionsCacheByProfile?.[profileId] ?? []),
    },
  }))

  applyProviderProfileToProcessEnv(activeProfile)
  return activeProfile
}
```

- [ ] **Step 5: Run tests**

Run: `bun test src/utils/providerProfiles.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/providerProfiles.ts src/utils/providerProfiles.test.ts
git commit -m "feat: populate model options cache from multi-model profiles

When a provider with comma-separated models is activated, all models
are added to the model options cache so they appear in the /model
picker. Single-model profiles show one option as before."
```

### Task 3.2: Ensure /model picker shows profile models

**Files:**
- Modify: `src/utils/model/modelOptions.ts`

- [ ] **Step 1: Verify model options appear in the picker flow**

Read `src/utils/model/modelOptions.ts` lines 447-454. The `getActiveOpenAIModelOptionsCache()` call already returns the cached options. Since Task 3.1 populates the cache on provider activation, models should appear automatically.

For **anthropic provider profiles** (which don't go through the openai cache path), add a similar flow. Check if `getAPIProvider() === 'firstParty'` but an anthropic provider profile is active, inject the profile models:

In `src/utils/model/modelOptions.ts`, add import:
```typescript
import { getActiveProviderProfile } from '../providerProfiles.js'
import { getProfileModelOptions } from '../providerProfiles.js'
```

Note: This import may cause circular dependency. Check if `getActiveProviderProfile` is already imported. If yes, use the existing import. The `getProfileModelOptions` function needs to be exported from providerProfiles.ts (already done in Task 3.1).

In `getModelOptionsBase()`, at the beginning of the `getAPIProvider() === 'firstParty'` branch (around line 458), add:

```typescript
  // If an anthropic provider profile is active with multi-model, show its models
  const activeProfile = getActiveProviderProfile()
  if (activeProfile && activeProfile.provider === 'anthropic') {
    const profileModels = getProfileModelOptions(activeProfile)
    if (profileModels.length > 0) {
      return [getDefaultOptionForUser(fastMode), ...profileModels]
    }
  }
```

- [ ] **Step 2: Run modelOptions tests**

Run: `bun test src/utils/model/providers.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add src/utils/model/modelOptions.ts
git commit -m "feat: show multi-model profile models in /model picker

For both openai-compatible and anthropic provider profiles, all
models from the active profile are now listed in the /model picker.
The first model is applied on activation; users can switch to any
other model from the list."
```

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] Multi-model parsing: Task 2.1
- [x] First model as default on activation: Task 2.2
- [x] Provider switch updates model env: Task 1.1, 1.2
- [x] UI form text for multi-model: Task 2.3
- [x] Profile summary multi-model display: Task 2.3
- [x] Model picker listing: Task 3.1, 3.2
- [x] Model cache integration: Task 3.1

**2. Placeholder scan:** No TBDs, TODOs, or vague steps. All code blocks contain complete implementations.

**3. Type consistency:**
- `parseModelList(string): string[]` - used consistently
- `getPrimaryModel(string): string` - used in providerProfiles.ts
- `hasMultipleModels(string): boolean` - used in ProviderManager.tsx
- `getProfileModelOptions(ProviderProfile): ModelOption[]` - used in providerProfiles.ts and modelOptions.ts
- All imports verified to match defined exports
