const CUSTOM_PET_STAT_NAMES = [
  'DEBUGGING',
  'PATIENCE',
  'CHAOS',
  'WISDOM',
  'SNARK',
] as const

type CustomPetStatName = (typeof CUSTOM_PET_STAT_NAMES)[number]

export type CustomPetStats = Record<CustomPetStatName, number>

export type CustomPetRarity =
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'epic'
  | 'legendary'

export interface CustomPetBones {
  sprite: string
  stats: CustomPetStats
  rarity: CustomPetRarity
  traits: string[]
}

export interface CustomPetSoul {
  customReplies: Array<{ trigger: string; response: string }>
  createdAt: number
}

export interface CustomPet {
  id: string
  name: string
  species: string
  personality: string
  bones: CustomPetBones
  soul: CustomPetSoul
}

export interface StoredCustomPets {
  customPets: CustomPet[]
  equippedPetId?: string
}

const CUSTOM_PET_RARITIES: readonly CustomPetRarity[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
]

const SPRITE_LINE_COUNT = 5
const SPRITE_LINE_WIDTH = 12
const MAX_PERSONALITY_LENGTH = 500

type UnknownRecord = Record<string, unknown>

type CustomPetReply = { trigger: string; response: string }

const isPlainObject = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isValidNumberStat = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100

const isValidRarity = (value: unknown): value is CustomPetRarity =>
  typeof value === 'string' &&
  CUSTOM_PET_RARITIES.includes(value as CustomPetRarity)

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')

const isValidCustomReplies = (value: unknown): value is CustomPetReply[] => {
  if (!Array.isArray(value)) return false

  return value.every(entry => {
    if (!isPlainObject(entry)) return false

    return (
      typeof entry.trigger === 'string' && typeof entry.response === 'string'
    )
  })
}

export function isValidSprite(sprite: string): boolean {
  const lines = sprite.split(/\r?\n/)
  if (lines.length !== SPRITE_LINE_COUNT) return false

  return lines.every(line => line.length === SPRITE_LINE_WIDTH)
}

export function isValidStats(stats: unknown): stats is CustomPetStats {
  if (!isPlainObject(stats)) return false

  return CUSTOM_PET_STAT_NAMES.every(stat => isValidNumberStat(stats[stat]))
}

export function isValidCustomPet(pet: unknown): pet is CustomPet {
  if (!isPlainObject(pet)) return false

  if (typeof pet.id !== 'string') return false
  if (typeof pet.name !== 'string') return false
  if (typeof pet.species !== 'string') return false
  if (typeof pet.personality !== 'string') return false
  if (pet.personality.length > MAX_PERSONALITY_LENGTH) return false

  if (!isPlainObject(pet.bones)) return false
  if (!isPlainObject(pet.soul)) return false

  const bones = pet.bones as UnknownRecord
  const soul = pet.soul as UnknownRecord

  if (typeof bones.sprite !== 'string' || !isValidSprite(bones.sprite)) {
    return false
  }

  if (!isValidStats(bones.stats)) return false
  if (!isValidRarity(bones.rarity)) return false
  if (!isStringArray(bones.traits)) return false

  if (!isValidCustomReplies(soul.customReplies)) return false
  if (typeof soul.createdAt !== 'number' || !Number.isFinite(soul.createdAt)) {
    return false
  }

  return true
}
