import { randomUUID } from 'crypto'
import { confirm, input, select } from '@inquirer/prompts'
import { stdout } from 'process'
import { getLastCacheSafeParams } from '../utils/forkedAgent.js'
import { runSideQuestion } from '../utils/sideQuestion.js'
import {
  isValidSprite,
  isValidStats,
  type CustomPet,
  type CustomPetStats,
} from './customPetTypes.js'

const STAT_NAMES = [
  'DEBUGGING',
  'PATIENCE',
  'CHAOS',
  'WISDOM',
  'SNARK',
] as const

type StatName = (typeof STAT_NAMES)[number]

type SpriteFlowResult =
  | { action: 'accept'; sprite: string }
  | { action: 'redo-stats' }

type GeneratedSpriteResult = SpriteFlowResult | { action: 'switch-manual' }

type PromptOption<T> = {
  label: string
  value: T
}

const RARITY_OPTIONS: PromptOption<
  'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
>[] = [
  { label: 'Common', value: 'common' },
  { label: 'Uncommon', value: 'uncommon' },
  { label: 'Rare', value: 'rare' },
  { label: 'Epic', value: 'epic' },
  { label: 'Legendary', value: 'legendary' },
]

const SPRITE_LINE_COUNT = 5
const SPRITE_LINE_WIDTH = 12
const MAX_PERSONALITY_LENGTH = 500
const MAX_NAME_LENGTH = 30
const MAX_SPECIES_LENGTH = 30
const MIN_CUSTOM_REPLIES = 2
const MAX_CUSTOM_REPLIES = 3

async function promptText(
  message: string,
  validate: (value: string) => string | null,
  options?: { trim?: boolean },
): Promise<string> {
  const shouldTrim = options?.trim ?? true

  const value = await input({
    message,
    validate: raw => {
      const nextValue = shouldTrim ? raw.trim() : raw
      const error = validate(nextValue)
      return error ?? true
    },
  })

  return shouldTrim ? value.trim() : value
}

async function promptNumber(
  message: string,
  options: {
    min: number
    max: number
    allowZero?: boolean
  },
): Promise<number> {
  const value = await input({
    message,
    validate: raw => {
      const parsed = Number(raw.trim())
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        return 'Enter a whole number.'
      }
      if (parsed < options.min || parsed > options.max) {
        return `Enter a value between ${options.min} and ${options.max}.`
      }
      if (!options.allowZero && parsed === 0) {
        return 'Value must be greater than 0.'
      }
      return true
    },
  })

  return Number(value.trim())
}

async function promptSelect<T>(
  message: string,
  options: PromptOption<T>[],
): Promise<T> {
  return select({
    message,
    choices: options.map(option => ({
      name: option.label,
      value: option.value,
    })),
  })
}

async function promptConfirm(
  message: string,
  defaultValue = true,
): Promise<boolean> {
  return confirm({ message, default: defaultValue })
}

function countSentences(text: string): number {
  const normalized = text.trim()
  if (!normalized) return 0

  const parts = normalized
    .split(/[.!?]+/)
    .map(part => part.trim())
    .filter(Boolean)

  return parts.length === 0 ? 1 : parts.length
}

function describeSpriteGrid(): void {
  stdout.write(
    `\nSprite grid is ${SPRITE_LINE_WIDTH}x${SPRITE_LINE_COUNT}. Example ruler: 123456789012\n`,
  )
}

function showSpritePreview(sprite: string): void {
  stdout.write('\nSprite preview:\n')
  stdout.write(`${sprite}\n`)
}

function parseTraits(input: string): string[] {
  return input
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
}

function isValidPersonality(text: string): string | null {
  if (!text.trim()) return 'Personality is required.'
  if (text.length > MAX_PERSONALITY_LENGTH) {
    return `Personality must be ${MAX_PERSONALITY_LENGTH} characters or less.`
  }

  const sentenceCount = countSentences(text)
  if (sentenceCount < 1 || sentenceCount > 3) {
    return 'Personality must be 1-3 sentences.'
  }

  return null
}

async function collectStats(): Promise<CustomPetStats> {
  stdout.write('\nAllocate 100 points across the five stats.\n')
  const stats = {} as CustomPetStats
  let remaining = 100

  for (let i = 0; i < STAT_NAMES.length; i += 1) {
    const stat = STAT_NAMES[i]
    const isLast = i === STAT_NAMES.length - 1
    const maxValue = isLast ? remaining : remaining
    const message = isLast
      ? `${stat} (must use remaining ${remaining})`
      : `${stat} (0-${remaining} remaining)`

    const value = await promptNumber(message, {
      min: 0,
      max: maxValue,
      allowZero: true,
    })

    if (isLast && value !== remaining) {
      stdout.write(`Value must equal remaining points (${remaining}).\n`)
      i -= 1
      continue
    }

    stats[stat] = value
    remaining -= value
  }

  if (!isValidStats(stats)) {
    throw new Error('Stats validation failed. Please retry.')
  }

  return stats
}

async function collectManualSprite(): Promise<string> {
  describeSpriteGrid()
  const lines: string[] = []

  for (let i = 0; i < SPRITE_LINE_COUNT; i += 1) {
    const line = await promptText(
      `Line ${i + 1}/${SPRITE_LINE_COUNT} (exactly ${SPRITE_LINE_WIDTH} chars)`,
      value =>
        value.length === SPRITE_LINE_WIDTH
          ? null
          : `Line must be exactly ${SPRITE_LINE_WIDTH} characters.`,
      { trim: false },
    )
    lines.push(line)
  }

  const sprite = lines.join('\n')

  if (!isValidSprite(sprite)) {
    stdout.write('Sprite is not a valid 12x5 grid.\n')
    return collectManualSprite()
  }

  return sprite
}

function extractSpriteFromResponse(response: string): string | null {
  const lines = response.split(/\r?\n/)

  for (let start = 0; start <= lines.length - SPRITE_LINE_COUNT; start += 1) {
    const slice = lines.slice(start, start + SPRITE_LINE_COUNT)
    if (slice.every(line => line.length === SPRITE_LINE_WIDTH)) {
      const sprite = slice.join('\n')
      return isValidSprite(sprite) ? sprite : null
    }
  }

  return null
}

async function generateSpriteFromDescription(
  description: string,
): Promise<string | null> {
  const cacheSafeParams = getLastCacheSafeParams()
  if (!cacheSafeParams) {
    stdout.write(
      'Claude generation is unavailable in this context. Try manual sprite entry.\n',
    )
    return null
  }

  const prompt = `Create a 12x5 ASCII sprite based on this description.\n\nDescription: ${description}\n\nRules:\n- Output exactly 5 lines\n- Each line must be exactly 12 characters\n- Use ASCII characters only (no emojis or special symbols)\n- Do not include code fences or extra text\n`

  const result = await runSideQuestion({
    question: prompt,
    cacheSafeParams,
  })

  if (!result.response) return null

  return extractSpriteFromResponse(result.response)
}

async function collectGeneratedSprite(): Promise<GeneratedSpriteResult> {
  let description = await promptText(
    'Describe your pet for ASCII generation',
    value => (value.trim() ? null : 'Description is required.'),
  )

  for (;;) {
    const sprite = await generateSpriteFromDescription(description)

    if (!sprite) {
      const fallback = await promptSelect(
        'Generation failed. What next?',
        [
          { label: 'Try a new description', value: 'retry' },
          { label: 'Switch to manual sprite entry', value: 'manual' },
          { label: 'Redo stat allocation', value: 'redo-stats' },
        ],
      )

      if (fallback === 'retry') {
        description = await promptText(
          'Describe your pet for ASCII generation',
          value => (value.trim() ? null : 'Description is required.'),
        )
        continue
      }

      if (fallback === 'manual') {
        return { action: 'switch-manual' }
      }

      return { action: 'redo-stats' }
    }

    showSpritePreview(sprite)

    const nextAction = await promptSelect('Use this sprite?', [
      { label: 'Yes, keep it', value: 'accept' },
      { label: 'Regenerate with same description', value: 'regenerate' },
      { label: 'Change description', value: 'change' },
      { label: 'Switch to manual sprite entry', value: 'manual' },
      { label: 'Redo stat allocation', value: 'redo-stats' },
    ])

    if (nextAction === 'accept') return { action: 'accept', sprite }
    if (nextAction === 'regenerate') continue
    if (nextAction === 'change') {
      description = await promptText(
        'Describe your pet for ASCII generation',
        value => (value.trim() ? null : 'Description is required.'),
      )
      continue
    }
    if (nextAction === 'manual') {
      return { action: 'switch-manual' }
    }

    return { action: 'redo-stats' }
  }
}

async function collectManualSpriteFlow(): Promise<SpriteFlowResult> {
  for (;;) {
    const sprite = await collectManualSprite()
    showSpritePreview(sprite)

    const confirmSprite = await promptSelect('Use this sprite?', [
      { label: 'Yes, keep it', value: 'accept' },
      { label: 'Re-enter sprite', value: 'retry' },
      { label: 'Switch to Claude generation', value: 'generate' },
      { label: 'Redo stat allocation', value: 'redo-stats' },
    ])

    if (confirmSprite === 'accept') {
      return { action: 'accept', sprite }
    }

    if (confirmSprite === 'redo-stats') {
      return { action: 'redo-stats' }
    }

    if (confirmSprite === 'generate') {
      const generated = await collectGeneratedSprite()
      if (generated.action === 'switch-manual') {
        continue
      }
      if (generated.action === 'redo-stats') {
        return { action: 'redo-stats' }
      }
      return generated
    }
  }
}

async function collectSprite(): Promise<SpriteFlowResult> {
  for (;;) {
    const method = await promptSelect('Choose sprite creation method', [
      {
        label: 'Draw ASCII sprite manually (12x5 grid editor)',
        value: 'manual',
      },
      {
        label: 'Let Claude generate ASCII art from description',
        value: 'generate',
      },
      {
        label: 'Redo stat allocation',
        value: 'redo-stats',
      },
    ])

    if (method === 'redo-stats') {
      return { action: 'redo-stats' }
    }

    if (method === 'manual') {
      return collectManualSpriteFlow()
    }

    const generated = await collectGeneratedSprite()
    if (generated.action === 'switch-manual') {
      return collectManualSpriteFlow()
    }
    return generated
  }
}

async function collectTraits(): Promise<string[]> {
  const traitsInput = await promptText(
    'List 1-5 visual traits (comma-separated)',
    value => {
      const traits = parseTraits(value)
      if (traits.length === 0) return 'At least one trait is required.'
      if (traits.length > 5) return 'Limit traits to five or fewer.'
      return null
    },
  )

  return parseTraits(traitsInput)
}

async function collectCustomReplies(): Promise<
  Array<{ trigger: string; response: string }>
> {
  const replies: Array<{ trigger: string; response: string }> = []

  while (replies.length < MIN_CUSTOM_REPLIES) {
    const index = replies.length + 1
    stdout.write(`\nCustom reply ${index} of ${MIN_CUSTOM_REPLIES}:\n`)
    const trigger = await promptText(
      'Trigger text',
      value => (value.trim() ? null : 'Trigger is required.'),
    )
    const response = await promptText(
      'Response text',
      value => (value.trim() ? null : 'Response is required.'),
    )

    replies.push({ trigger, response })
  }

  if (replies.length < MAX_CUSTOM_REPLIES) {
    const addMore = await promptConfirm('Add a third custom reply?', false)
    if (addMore) {
      const trigger = await promptText(
        'Trigger text',
        value => (value.trim() ? null : 'Trigger is required.'),
      )
      const response = await promptText(
        'Response text',
        value => (value.trim() ? null : 'Response is required.'),
      )
      replies.push({ trigger, response })
    }
  }

  return replies
}

export async function runPetCreationWizard(): Promise<CustomPet> {
  const name = await promptText('Pet name (1-30 chars)', value => {
    const trimmed = value.trim()
    if (!trimmed) return 'Name is required.'
    if (trimmed.length > MAX_NAME_LENGTH) {
      return `Name must be ${MAX_NAME_LENGTH} characters or less.`
    }
    return null
  })

  const species = await promptText('Species/type (1-30 chars)', value => {
    const trimmed = value.trim()
    if (!trimmed) return 'Species is required.'
    if (trimmed.length > MAX_SPECIES_LENGTH) {
      return `Species must be ${MAX_SPECIES_LENGTH} characters or less.`
    }
    return null
  })

  const personality = await promptText(
    'Personality (1-3 sentences)',
    isValidPersonality,
  )

  const rarity = await promptSelect('Select rarity', RARITY_OPTIONS)

  let stats = await collectStats()
  let spriteResult = await collectSprite()

  while (spriteResult.action === 'redo-stats') {
    stats = await collectStats()
    spriteResult = await collectSprite()
  }

  if (spriteResult.action !== 'accept') {
    throw new Error('Sprite creation did not complete.')
  }

  const traits = await collectTraits()
  const customReplies = await collectCustomReplies()

  return {
    id: randomUUID(),
    name: name.trim(),
    species: species.trim(),
    personality: personality.trim(),
    bones: {
      sprite: spriteResult.sprite,
      stats,
      rarity,
      traits,
    },
    soul: {
      customReplies,
      createdAt: Date.now(),
    },
  }
}
