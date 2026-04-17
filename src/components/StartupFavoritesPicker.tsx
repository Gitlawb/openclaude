/**
 * StartupFavoritesPicker -- favorites-based model selection at startup.
 *
 * Flow: show favorites list -> select model to launch, or "Add model" -> wizard
 *
 * NOTE: all useInput handling is in the top-level component only.
 * Ink only routes key events to one useInput listener, so per-screen useInput
 * calls silently conflict.
 */
import React, { useEffect, useState } from 'react'
import { Box, Text, useInput } from '../ink.js'
import {
  addFavoriteModel,
  autoPopulateFavoritesFromHistory,
  getFavoriteModels,
  getModelDisplayName,
  getProviderApiKeys,
  getProviderApiKey,
  removeFavoriteModel,
  saveProviderApiKey,
  setSelectedModelId,
} from '../utils/favorites.js'
import { getProviderPresetDefaults, type ProviderPreset } from '../utils/providerProfiles.js'
import {
  getGlobalConfig,
  saveGlobalConfig,
  type FavoriteModelEntry,
  type FavoriteModelPricing,
} from '../utils/config.js'
import { listOpenRouterModels } from '../utils/openRouterModels.js'

export type FavoritesPickerResult = {
  providerName: string
  model: string
  baseUrl: string
  favoriteId: string
}

type Props = {
  onSelect: (result: FavoritesPickerResult) => void
  onCancel: () => void
}

type Screen =
  | 'favorites'
  | 'add-provider'
  | 'add-key'
  | 'add-new-key-input'
  | 'add-model-select'
  | 'add-loading'
  | 'delete-select'

type WizardModel = {
  id: string
  name: string | null
  /** Short pricing hint (e.g. "$3/$15 per Mtok · 200k ctx"), when known. */
  hint?: string
  /** Structured pricing data to persist on the favorite. */
  pricing?: FavoriteModelPricing
}

// How many rows of the model list to render at once. Kept modest so the
// picker fits inside a typical terminal viewport; cursor navigation scrolls
// the window through the full list.
const MODEL_LIST_VISIBLE_COUNT = 15

function formatOpenRouterHintPrice(value: number): string {
  return value >= 0.1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`
}

function formatOpenRouterHintContext(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return ''
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M ctx`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k ctx`
  return `${tokens} ctx`
}

function buildOpenRouterHint(model: {
  promptPricePerMToken: number | null
  completionPricePerMToken: number | null
  contextLength: number
}): string {
  const parts: string[] = []
  const { promptPricePerMToken: p, completionPricePerMToken: c } = model
  if (p !== null && c !== null) {
    parts.push(`${formatOpenRouterHintPrice(p)} / ${formatOpenRouterHintPrice(c)} per Mtok`)
  } else if (p !== null) {
    parts.push(`${formatOpenRouterHintPrice(p)} per Mtok`)
  } else if (c !== null) {
    parts.push(`${formatOpenRouterHintPrice(c)} per Mtok`)
  }
  const ctx = formatOpenRouterHintContext(model.contextLength)
  if (ctx) parts.push(ctx)
  return parts.join(' · ')
}

// Static list for Anthropic: their /v1/models endpoint requires x-api-key +
// anthropic-version headers, so the generic OpenAI-compat fetch returns 401.
// Prices in USD per million tokens (input / output), per
// https://platform.claude.com/docs/en/about-claude/pricing
const ANTHROPIC_MODEL_SPECS: Array<{
  id: string
  name: string
  input: number
  output: number
}> = [
  { id: 'claude-opus-4-7',   name: 'Claude Opus 4.7',   input: 5,    output: 25   },
  { id: 'claude-opus-4-6',   name: 'Claude Opus 4.6',   input: 5,    output: 25   },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', input: 3,    output: 15   },
  { id: 'claude-haiku-4-5',  name: 'Claude Haiku 4.5',  input: 1,    output: 5    },
  { id: 'claude-opus-4-5',   name: 'Claude Opus 4.5',   input: 5,    output: 25   },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', input: 3,    output: 15   },
  { id: 'claude-haiku-3-5',  name: 'Claude Haiku 3.5',  input: 0.8,  output: 4    },
  { id: 'claude-opus-3',     name: 'Claude Opus 3',     input: 15,   output: 75   },
  { id: 'claude-sonnet-3-7', name: 'Claude Sonnet 3.7', input: 3,    output: 15   },
  { id: 'claude-haiku-3',    name: 'Claude Haiku 3',    input: 0.25, output: 1.25 },
]

const ANTHROPIC_CONTEXT_TOKENS = 200_000

const ANTHROPIC_MODELS: WizardModel[] = ANTHROPIC_MODEL_SPECS.map(spec => {
  const pricing: FavoriteModelPricing = {
    promptPricePerMToken: spec.input,
    completionPricePerMToken: spec.output,
    contextLength: ANTHROPIC_CONTEXT_TOKENS,
  }
  return {
    id: spec.id,
    name: spec.name,
    hint: buildOpenRouterHint(pricing),
    pricing,
  }
})

// Prices in USD per million tokens (input / output) for popular OpenAI models.
// Source: https://openai.com/api/pricing/
// Patterns are checked in order — put more specific (mini/nano) matches first.
const OPENAI_MODEL_PRICING: Array<{
  match: RegExp
  input: number
  output: number
  contextLength: number
}> = [
  // GPT-5 family
  { match: /^gpt-5-nano/,         input: 0.05, output: 0.4,  contextLength: 400_000 },
  { match: /^gpt-5-mini/,         input: 0.25, output: 2,    contextLength: 400_000 },
  { match: /^gpt-5-codex/,        input: 1.25, output: 10,   contextLength: 400_000 },
  { match: /^gpt-5/,              input: 1.25, output: 10,   contextLength: 400_000 },
  // GPT-4.1 family
  { match: /^gpt-4\.1-nano/,      input: 0.1,  output: 0.4,  contextLength: 1_000_000 },
  { match: /^gpt-4\.1-mini/,      input: 0.4,  output: 1.6,  contextLength: 1_000_000 },
  { match: /^gpt-4\.1/,           input: 2,    output: 8,    contextLength: 1_000_000 },
  // GPT-4o family
  { match: /^gpt-4o-mini/,        input: 0.15, output: 0.6,  contextLength: 128_000 },
  { match: /^chatgpt-4o-latest/,  input: 5,    output: 15,   contextLength: 128_000 },
  { match: /^gpt-4o-audio/,       input: 2.5,  output: 10,   contextLength: 128_000 },
  { match: /^gpt-4o/,             input: 2.5,  output: 10,   contextLength: 128_000 },
  // o-series reasoning models
  { match: /^o4-mini/,             input: 1.1,  output: 4.4,  contextLength: 200_000 },
  { match: /^o3-pro/,              input: 20,   output: 80,   contextLength: 200_000 },
  { match: /^o3-mini/,             input: 1.1,  output: 4.4,  contextLength: 200_000 },
  { match: /^o3/,                  input: 2,    output: 8,    contextLength: 200_000 },
  { match: /^o1-pro/,              input: 150,  output: 600,  contextLength: 200_000 },
  { match: /^o1-mini/,             input: 1.1,  output: 4.4,  contextLength: 128_000 },
  { match: /^o1-preview/,          input: 15,   output: 60,   contextLength: 128_000 },
  { match: /^o1/,                  input: 15,   output: 60,   contextLength: 200_000 },
  // GPT-4 / 3.5 legacy
  { match: /^gpt-4-turbo/,         input: 10,   output: 30,   contextLength: 128_000 },
  { match: /^gpt-4-32k/,           input: 60,   output: 120,  contextLength: 32_000 },
  { match: /^gpt-4/,               input: 30,   output: 60,   contextLength: 8_000 },
  { match: /^gpt-3\.5-turbo/,      input: 0.5,  output: 1.5,  contextLength: 16_000 },
]

function lookupOpenAIPricing(id: string): FavoriteModelPricing | undefined {
  for (const entry of OPENAI_MODEL_PRICING) {
    if (entry.match.test(id)) {
      return {
        promptPricePerMToken: entry.input,
        completionPricePerMToken: entry.output,
        contextLength: entry.contextLength,
      }
    }
  }
  return undefined
}

function decorateOpenAIModels(models: WizardModel[]): WizardModel[] {
  return models.map(m => {
    if (m.pricing || m.hint) return m
    const pricing = lookupOpenAIPricing(m.id)
    if (!pricing) return m
    return { ...m, pricing, hint: buildOpenRouterHint(pricing) }
  })
}

// Simple model fetch for a given OpenAI-compatible endpoint
async function fetchModelsFromOpenaiCompat(
  baseUrl: string,
  apiKey: string,
): Promise<WizardModel[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const response = await fetch(url, {
    headers: {
      Authorization: 'Bearer ' + (apiKey || 'placeholder'),
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) return []
  const data = (await response.json()) as { data?: Array<{ id: string }> }
  if (!data?.data) return []
  return data.data.map(m => ({ id: m.id, name: m.id }))
}

const ADD_PRESETS: ProviderPreset[] = [
  'anthropic',
  'openrouter',
  'openai',
  'ollama',
  'gemini',
  'mistral',
  'deepseek',
  'groq',
  'nvidia-nim',
  'minimax',
  'together',
  'moonshotai',
  'lmstudio',
  'custom',
]

// ---------------------------------------------------------------------------
// Presentation-only sub-screens (no useInput)
// ---------------------------------------------------------------------------

function FavoritesList({
  favorites,
  cursor,
}: {
  favorites: (FavoriteModelEntry | { _addNew: true } | { _deleteMenu: true })[]
  cursor: number
}) {
  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="claude">
          Оберіть модель
        </Text>
      </Box>
      {favorites.length === 0 ? (
        <Text dimColor>
          Ще немає обраних моделей. Додайте першу модель нижче.
        </Text>
      ) : null}
      {favorites.map((entry, i) => {
        const active = i === cursor
        if ('_addNew' in entry) {
          return (
            <Box key="+add" flexDirection="column">
              <Box>
                <Text color={active ? 'claude' : undefined} bold={active}>
                  {active ? '▶ ' : '  '}+ Додати модель
                </Text>
              </Box>
              {active && <Text dimColor>Налаштувати нового провайдера та модель</Text>}
            </Box>
          )
        }
        if ('_deleteMenu' in entry) {
          return (
            <Box key="-del" flexDirection="column">
              <Box>
                <Text color={active ? 'claude' : undefined} bold={active}>
                  {active ? '▶ ' : '  '}− Видалити модель
                </Text>
              </Box>
              {active && <Text dimColor>Прибрати модель зі списку обраних</Text>}
            </Box>
          )
        }
        const displayName = getModelDisplayName(entry)
        const pricingLine = entry.pricing ? buildOpenRouterHint(entry.pricing) : ''
        return (
          <Box key={entry.id} flexDirection="column">
            <Box>
              <Text color={active ? 'claude' : undefined} bold={active}>
                {active ? '▶ ' : '  '}
                {displayName}
              </Text>
            </Box>
            {active && (
              <Text dimColor>
                {'  '}
                {entry.providerName} · {entry.model}
              </Text>
            )}
            {active && pricingLine ? (
              <Text dimColor>
                {'  '}
                {pricingLine}
              </Text>
            ) : null}
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Text dimColor>↑↓ навігація · Enter вибрати · Esc відміна</Text>
      </Box>
    </Box>
  )
}

function DeleteModelChoice({
  favorites,
  cursor,
}: {
  favorites: FavoriteModelEntry[]
  cursor: number
}) {
  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="claude">
          Яку модель видалити?
        </Text>
      </Box>
      {favorites.map((entry, i) => {
        const active = i === cursor
        const displayName = getModelDisplayName(entry)
        const pricingLine = entry.pricing ? buildOpenRouterHint(entry.pricing) : ''
        return (
          <Box key={entry.id} flexDirection="column">
            <Box>
              <Text color={active ? 'claude' : undefined} bold={active}>
                {active ? '▶ ' : '  '}
                {displayName}
              </Text>
            </Box>
            {active && (
              <Text dimColor>
                {'  '}
                {entry.providerName} · {entry.model}
              </Text>
            )}
            {active && pricingLine ? (
              <Text dimColor>
                {'  '}
                {pricingLine}
              </Text>
            ) : null}
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Text dimColor>↑↓ навігація · Enter видалити · Esc назад</Text>
      </Box>
    </Box>
  )
}

function ProviderChoice({
  cursor,
}: {
  cursor: number
}) {
  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="claude">
          Оберіть провайдера
        </Text>
      </Box>
      {ADD_PRESETS.map((preset, i) => {
        const active = i === cursor
        const d = getProviderPresetDefaults(preset)
        return (
          <Box key={preset} flexDirection="column">
            <Box>
              <Text color={active ? 'claude' : undefined} bold={active}>
                {active ? '▶ ' : '  '}
                {d.name}
              </Text>
            </Box>
            {active && (
              <Text dimColor>
                {'  '}
                {d.requiresApiKey ? 'потрібен ключ' : 'ключ не потрібен'}
                {' · '}
                {d.baseUrl}
              </Text>
            )}
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Text dimColor>↑↓ навігація · Enter вибрати · Esc назад</Text>
      </Box>
    </Box>
  )
}

function KeyChoice({
  providerName,
  cursor,
}: {
  providerName: string
  cursor: number
}) {
  const providerKey = getProviderApiKey(providerName)
  const options = providerKey ? [providerKey] : []

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="claude">
          API ключ{' '}
        </Text>
        <Text dimColor>· {providerName}</Text>
      </Box>
      {options.map((key, i) => {
        const active = i === cursor
        const masked = key.apiKey ? '\u2022'.repeat(Math.min(key.apiKey.length, 20)) : '\u2022\u2022\u2022\u2022\u2022\u2022'
        return (
          <Box key={key.id} flexDirection="column">
            <Box>
              <Text color={active ? 'claude' : undefined} bold={active}>
                {active ? '▶ ' : '  '}
                {key.label ?? key.id}: {masked}
              </Text>
            </Box>
            {active && <Text dimColor>Використати збережений ключ</Text>}
          </Box>
        )
      })}
      <Box flexDirection="column">
        <Box>
          <Text
            color={cursor === options.length ? 'claude' : undefined}
            bold={cursor === options.length}
          >
            {cursor === options.length ? '▶ ' : '  '}
            Ввести новий ключ
          </Text>
        </Box>
        {cursor === options.length && <Text dimColor>Ввести новий API ключ</Text>}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ навігація · Enter вибрати · Esc назад</Text>
      </Box>
    </Box>
  )
}

function KeyInput({ apiKey }: { apiKey: string }) {
  const masked = '\u2022'.repeat(Math.min(apiKey.length, 32))
  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text>
          Введіть ключ{' '}
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>Ключ: </Text>
        {apiKey.length === 0 ? (
          <Text dimColor>sk-...\u258C</Text>
        ) : (
          <Text>
            {masked}
            {'\u258C'}
          </Text>
        )}
      </Box>
      <Box>
        <Text dimColor>Enter = OK · Esc назад</Text>
      </Box>
    </Box>
  )
}

function ModelChoice({
  models,
  visibleModels,
  cursor,
  searchQuery,
  customModel,
  isCustom,
  scrollOffset,
}: {
  models: WizardModel[]
  visibleModels: WizardModel[]
  cursor: number
  searchQuery: string
  customModel: string
  isCustom: boolean
  scrollOffset: number
}) {
  const customIndex = visibleModels.length
  const totalItems = customIndex + 1
  const windowSize = Math.min(MODEL_LIST_VISIBLE_COUNT, Math.max(1, totalItems - scrollOffset))
  const windowEnd = scrollOffset + windowSize
  const hasAbove = scrollOffset > 0
  const hasBelow = windowEnd < totalItems

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="claude">
          Оберіть модель
        </Text>
      </Box>
      {searchQuery.length > 0 && !isCustom && (
        <Box marginBottom={1}>
          <Text color="subtle">
            Пошук: {'"' + searchQuery + '"'} ({visibleModels.length}/{models.length})
          </Text>
        </Box>
      )}
      {models.length === 0 ? (
        <Text dimColor>Не вдалося отримати список моделей.</Text>
      ) : null}
      {visibleModels.length === 0 && searchQuery.length > 0 && !isCustom ? (
        <Text color="attention">Немає моделей за запитом "{searchQuery}"</Text>
      ) : null}
      {hasAbove ? (
        <Box>
          <Text dimColor>  ↑ ще {scrollOffset}</Text>
        </Box>
      ) : null}
      {Array.from({ length: windowSize }, (_, offset) => {
        const i = scrollOffset + offset
        const active = i === cursor
        if (i === customIndex) {
          return (
            <Box key="__custom">
              <Text color={active ? 'claude' : undefined} bold={active}>
                {active ? '▶ ' : '  '}
                Ввести назву моделі вручну
              </Text>
            </Box>
          )
        }
        const m = visibleModels[i]
        if (!m) return null
        let label = m.name || m.id
        if (searchQuery && !isCustom) {
          const q = searchQuery.toLowerCase()
          const idx = label.toLowerCase().indexOf(q)
          if (idx >= 0) {
            label = (
              label.slice(0, idx) +
              label.slice(idx, idx + searchQuery.length) +
              label.slice(idx + searchQuery.length)
            )
          }
        }
        return (
          <Box key={m.id}>
            <Text color={active ? 'claude' : undefined} bold={active}>
              {active ? '▶ ' : '  '}
              {label}
            </Text>
            {m.hint ? <Text dimColor>{' · ' + m.hint}</Text> : null}
          </Box>
        )
      })}
      {hasBelow ? (
        <Box>
          <Text dimColor>  ↓ ще {totalItems - windowEnd}</Text>
        </Box>
      ) : null}
      {isCustom && (
        <Box marginTop={1}>
          <Text dimColor>Модель: </Text>
          <Text>
            {customModel}
            {'\u258C'}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ навігація · {searchQuery && !isCustom ? 'букви=пошук · Esc=очистити · ' : 'букви=пошук · '}Enter вибрати · Esc назад
        </Text>
      </Box>
    </Box>
  )
}

function LoadingScreen({ message }: { message: string }) {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="claude">
        {message}
      </Text>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Top-level component — single useInput
// ---------------------------------------------------------------------------

export function StartupFavoritesPicker({ onSelect, onCancel }: Props) {
  const [screen, setScreen] = useState<Screen>('favorites')
  const [favorites, setFavorites] = useState<FavoriteModelEntry[]>([])
  const [cursor, setCursor] = useState(0)
  const [selectedPreset, setSelectedPreset] = useState<ProviderPreset | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [models, setModels] = useState<WizardModel[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [modelScrollOffset, setModelScrollOffset] = useState(0)

  // Filtered models based on search
  const visibleModels = searchQuery
    ? models.filter(m => {
        const q = searchQuery.toLowerCase()
        const name = (m.name || m.id).toLowerCase()
        return name.includes(q)
      })
    : models

  // Keep the scroll window pinned to the cursor so long lists can be navigated
  // past the initial render budget. Reset whenever the filtered list shrinks
  // past the current offset (e.g. narrowing the search).
  useEffect(() => {
    if (screen !== 'add-model-select') return
    setModelScrollOffset(prev => {
      if (cursor < prev) return cursor
      if (cursor >= prev + MODEL_LIST_VISIBLE_COUNT) {
        return cursor - MODEL_LIST_VISIBLE_COUNT + 1
      }
      const totalItems = visibleModels.length + 1
      const maxOffset = Math.max(0, totalItems - MODEL_LIST_VISIBLE_COUNT)
      if (prev > maxOffset) return maxOffset
      return prev
    })
  }, [cursor, screen, visibleModels.length])

  // Reset to top whenever the search narrows/changes.
  useEffect(() => {
    setModelScrollOffset(0)
  }, [searchQuery, screen])

  // Initialize favorites
  useEffect(() => {
    let favs = getFavoriteModels()
    if (favs.length === 0) {
      autoPopulateFavoritesFromHistory()
      favs = getFavoriteModels()
    }
    setFavorites(favs)
    const config = getGlobalConfig()
    if (config.selectedFavoriteModelId) {
      const idx = favs.findIndex(f => f.id === config.selectedFavoriteModelId)
      if (idx >= 0) setCursor(idx)
    }
  }, [])

  // ------------------------------------------------------------------
  // Single useInput — dispatches based on current screen
  // ------------------------------------------------------------------
  useInput((input, key) => {
    // --- Favorites list ---
    if (screen === 'favorites') {
      if (key.escape || (key.ctrl && input === 'c')) {
        onCancel()
        return
      }
      const showDelete = favorites.length > 0
      const trailingCount = 1 + (showDelete ? 1 : 0)
      const totalItems = favorites.length + trailingCount
      if (key.upArrow) {
        setCursor(prev => (prev - 1 + totalItems) % totalItems)
        return
      }
      if (key.downArrow) {
        setCursor(prev => (prev + 1 + totalItems) % totalItems)
        return
      }
      if (key.return) {
        if (cursor === favorites.length) {
          // + Додати модель
          setScreen('add-provider')
          setCursor(0)
          return
        }
        if (showDelete && cursor === favorites.length + 1) {
          // − Видалити модель
          setScreen('delete-select')
          setCursor(0)
          return
        }
        const fav = favorites[cursor]
        if (!fav) return
        setSelectedModelId(fav.id)
        saveGlobalConfig(current => ({
          ...current,
          favoriteModels: (current.favoriteModels ?? []).map(f =>
            f.id === fav.id ? { ...f, lastUsedAt: Date.now() } : f,
          ),
        }))
        onSelect({
          providerName: fav.providerName,
          model: fav.model,
          baseUrl: fav.baseUrl,
          favoriteId: fav.id,
        })
      }
    }

    // --- Delete model selection ---
    else if (screen === 'delete-select') {
      if (key.escape) {
        setScreen('favorites')
        setCursor(0)
        return
      }
      if (favorites.length === 0) return
      if (key.upArrow) {
        setCursor(prev => (prev - 1 + favorites.length) % favorites.length)
        return
      }
      if (key.downArrow) {
        setCursor(prev => (prev + 1 + favorites.length) % favorites.length)
        return
      }
      if (key.return) {
        const target = favorites[cursor]
        if (!target) return
        removeFavoriteModel(target.id)
        const remaining = getFavoriteModels()
        setFavorites(remaining)
        if (remaining.length === 0) {
          setScreen('favorites')
          setCursor(0)
        } else {
          setScreen('favorites')
          setCursor(Math.min(cursor, remaining.length - 1))
        }
      }
    }

    // --- Provider selection ---
    else if (screen === 'add-provider') {
      if (key.escape) {
        setScreen('favorites')
        setCursor(favorites.length)
        return
      }
      if (key.upArrow) {
        setCursor(prev => {
          const t = ADD_PRESETS.length
          return (prev - 1 + t) % t
        })
        return
      }
      if (key.downArrow) {
        setCursor(prev => {
          const t = ADD_PRESETS.length
          return (prev + 1 + t) % t
        })
        return
      }
      if (key.return) {
        const preset = ADD_PRESETS[cursor]
        if (!preset) return
        setSelectedPreset(preset)
        setCursor(0)
        const d = getProviderPresetDefaults(preset)
        if (d.requiresApiKey) {
          setScreen('add-key')
        } else {
          void loadModels(preset, '')
        }
      }
    }

    // --- Key choice ---
    else if (screen === 'add-key') {
      if (key.escape) {
        setScreen('add-provider')
        setCursor(0)
        return
      }
      if (key.upArrow || key.downArrow) {
        const providerKey = selectedPreset ? getProviderApiKey(selectedPreset) : null
        const hasExisting = providerKey ? 1 : 0
        const total = hasExisting + 1
        setCursor(prev => {
          const delta = key.upArrow ? -1 : 1
          return (prev + delta + total) % total
        })
        return
      }
      if (key.return) {
        if (!selectedPreset) return
        const providerKey = getProviderApiKey(selectedPreset)
        const options = providerKey ? [providerKey] : []
        if (cursor === options.length) {
          // Enter new key
          if (selectedPreset === 'ollama' || selectedPreset === 'lmstudio') {
            void loadModels(selectedPreset, '')
          } else {
            setCursor(0)
            setScreen('add-new-key-input')
          }
        } else {
          const k = options[cursor]
          if (k) {
            setSelectedKey(k.apiKey)
            void loadModels(selectedPreset, k.apiKey)
          }
        }
      }
    }

    // --- Key text input ---
    else if (screen === 'add-new-key-input') {
      if (key.escape) {
        setScreen('add-key')
        setCursor(0)
        return
      }
      if (key.return) {
        if (selectedKey?.trim() && selectedPreset) {
          void loadModels(selectedPreset, selectedKey)
        }
        return
      }
      if (key.backspace || key.delete) {
        setSelectedKey(prev => (prev ?? '').slice(0, -1))
        return
      }
      if (input && !key.ctrl && !key.meta) {
        setSelectedKey(prev => (prev ?? '') + input)
      }
    }

    // --- Model selection ---
    else if (screen === 'add-model-select') {
      if (isCustom) {
        if (key.escape) {
          setIsCustom(false)
          return
        }
        if (key.return) {
          if (customModel.trim()) {
            void onModelChosen({ id: customModel.trim(), name: customModel.trim() })
          }
          return
        }
        if (key.backspace || key.delete) {
          setCustomModel(prev => prev.slice(0, -1))
          return
        }
        if (input && !key.ctrl && !key.meta) {
          setCustomModel(prev => prev + input)
        }
        return
      }

      if (key.escape) {
        if (searchQuery.length > 0) {
          setSearchQuery('')
          setCursor(0)
          return
        }
        setScreen('add-provider')
        if (selectedPreset) setCursor(ADD_PRESETS.indexOf(selectedPreset))
        return
      }
      if (key.backspace || key.delete) {
        setSearchQuery(prev => prev.slice(0, -1))
        setCursor(0)
        return
      }
      // Typing letters acts as a live search
      if (input && !key.ctrl && !key.meta && input.length === 1) {
        setSearchQuery(prev => prev + input.toLowerCase())
        setCursor(0)
        return
      }
      if (key.upArrow) {
        setCursor(prev => {
          const t = visibleModels.length + 1
          return (prev - 1 + t) % t
        })
        return
      }
      if (key.downArrow) {
        setCursor(prev => {
          const t = visibleModels.length + 1
          return (prev + 1 + t) % t
        })
        return
      }
      if (key.return) {
        const total = visibleModels.length + 1
        if (cursor === total - 1) {
          setIsCustom(true)
        } else {
          // Index against visibleModels, not models — cursor navigates the
          // filtered view, and using the raw list here selected a completely
          // different entry whenever the user typed to search.
          const m = visibleModels[cursor]
          if (m) void onModelChosen(m)
        }
      }
    }
  })

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  async function loadModels(preset: ProviderPreset, apiKey: string) {
    setScreen('add-loading')
    setSearchQuery('')
    try {
      if (preset === 'anthropic') {
        setModels(ANTHROPIC_MODELS)
      } else if (preset === 'openrouter') {
        // OpenRouter's /models endpoint is public and returns prompt/completion
        // pricing alongside each id — surface that in the picker.
        const catalog = await listOpenRouterModels(apiKey)
        setModels(
          catalog.map(m => ({
            id: m.id,
            name: m.name || m.id,
            hint: buildOpenRouterHint(m),
            pricing: {
              promptPricePerMToken: m.promptPricePerMToken,
              completionPricePerMToken: m.completionPricePerMToken,
              contextLength: m.contextLength,
            },
          })),
        )
      } else {
        const d = getProviderPresetDefaults(preset)
        const result = await fetchModelsFromOpenaiCompat(d.baseUrl, apiKey || 'placeholder')
        setModels(preset === 'openai' ? decorateOpenAIModels(result) : result)
      }
      setScreen('add-model-select')
      setCursor(0)
      setIsCustom(false)
      setCustomModel('')
    } catch {
      setModels([])
      setScreen('add-model-select')
      setCursor(0)
      setIsCustom(false)
      setCustomModel('')
    }
  }

  async function onModelChosen(model: WizardModel) {
    if (!selectedPreset) return
    const d = getProviderPresetDefaults(selectedPreset)
    const keyToSave = selectedKey || ''

    if (keyToSave && d.requiresApiKey) {
      saveProviderApiKey(selectedPreset, keyToSave, d.name)
    }

    const favorite = addFavoriteModel({
      providerName: selectedPreset,
      model: model.id,
      baseUrl: d.baseUrl,
      apiKeyId: keyToSave ? selectedPreset : undefined,
      displayName: model.name || model.id,
      pricing: model.pricing,
    })

    onSelect({
      providerName: favorite.providerName,
      model: favorite.model,
      baseUrl: favorite.baseUrl,
      favoriteId: favorite.id,
    })
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  switch (screen) {
    case 'favorites': {
      const tail: Array<{ _addNew: true } | { _deleteMenu: true }> = [
        { _addNew: true as const },
      ]
      if (favorites.length > 0) tail.push({ _deleteMenu: true as const })
      return <FavoritesList favorites={[...favorites, ...tail]} cursor={cursor} />
    }

    case 'add-provider':
      return <ProviderChoice cursor={cursor} />

    case 'add-key':
      return selectedPreset ? <KeyChoice providerName={selectedPreset} cursor={cursor} /> : null

    case 'add-new-key-input':
      return <KeyInput apiKey={selectedKey ?? ''} />

    case 'add-model-select':
      return (
        <ModelChoice
          models={models}
          visibleModels={visibleModels}
          cursor={cursor}
          searchQuery={searchQuery}
          customModel={customModel}
          isCustom={isCustom}
          scrollOffset={modelScrollOffset}
        />
      )

    case 'add-loading':
      return <LoadingScreen message="Завантаження моделей..." />

    case 'delete-select':
      return <DeleteModelChoice favorites={favorites} cursor={cursor} />

    default:
      return null
  }
}
