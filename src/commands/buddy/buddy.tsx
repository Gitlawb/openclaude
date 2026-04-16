import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { companionUserId, getCompanion, rollWithSeed } from '../../buddy/companion.js'
import type { StoredCompanion } from '../../buddy/types.js'
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js'

const NAMES = [
  'Хрумчик',
  'Пухнастик',
  'Буркотун',
  'Шкряботун',
  'Мурмуряка',
  'Пельменчик',
  'Вареничок',
  'Галушка',
  'Борщик',
  'Пампушка',
  'Пузанчик',
  'Товстунець',
  'Сопелько',
  'Хитрунчик',
  'Пищалик',
  'Ричалик',
  'Гризень',
  'Кусака',
  'Бурмило',
  'Дракоша',
  'Чмурик',
  'Шмигалик',
  'Буцик',
  'Шкеребертик',
  'Булочка',
  'Цокотун',
  'Сирник',
  'Зозулик',
  'Бабайчик',
  'Смалько',
] as const

const PERSONALITIES = [
  'Curious and quietly encouraging',
  'A patient little watcher with strong debugging instincts',
  'Playful, observant, and suspicious of flaky tests',
  'Calm under pressure and fond of clean diffs',
  'A tiny terminal gremlin who likes successful builds',
] as const

const PET_REACTIONS = [
  'мружиться від погладжування',
  'задоволено підстрибує',
  'щасливо пирхає',
  'сяє від радості',
  'радісно виляє хвостом',
] as const

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function pickDeterministic<T>(items: readonly T[], seed: string): T {
  return items[hashString(seed) % items.length]!
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function createStoredCompanion(): StoredCompanion {
  const userId = companionUserId()
  const { bones } = rollWithSeed(`${userId}:buddy`)
  const name = pickDeterministic(NAMES, `${userId}:name`)
  const personality = pickDeterministic(PERSONALITIES, `${userId}:personality`)

  return {
    name,
    personality: `${personality}.`,
    hatchedAt: Date.now(),
  }
}

function setCompanionReaction(
  context: LocalJSXCommandContext,
  reaction: string | undefined,
  pet = false,
): void {
  context.setAppState(prev => ({
    ...prev,
    companionReaction: reaction,
    companionPetAt: pet ? Date.now() : prev.companionPetAt,
  }))
}

function showHelp(onDone: LocalJSXCommandOnDone): void {
  onDone(
    'Usage: /buddy [status|show|hide|mute|unmute]\n\nRun /buddy with no args to hatch your companion the first time, then pet it on later runs. Companion is hidden by default — use /buddy show to reveal, /buddy hide to tuck away.',
    { display: 'system' },
  )
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
): Promise<null> {
  const arg = args?.trim().toLowerCase() ?? ''

  if (COMMON_HELP_ARGS.includes(arg) || arg === '') {
    const existing = getCompanion()
    if (arg !== '' || existing) {
      if (arg !== '') {
        showHelp(onDone)
        return null
      }
    }
  }

  if (COMMON_HELP_ARGS.includes(arg)) {
    showHelp(onDone)
    return null
  }

  if (COMMON_INFO_ARGS.includes(arg) || arg === 'status') {
    const companion = getCompanion()
    if (!companion) {
      onDone('No buddy hatched yet. Run /buddy to hatch one.', {
        display: 'system',
      })
      return null
    }
    const cfg = getGlobalConfig()
    const visibility = cfg.companionHidden === false ? 'visible' : 'hidden'
    const muted = cfg.companionMuted ? ' (muted)' : ''
    onDone(
      `${companion.name} is your ${titleCase(companion.rarity)} ${companion.species}. ${companion.personality} [${visibility}${muted}]`,
      { display: 'system' },
    )
    return null
  }

  if (arg === 'mute' || arg === 'unmute') {
    const muted = arg === 'mute'
    saveGlobalConfig(current => ({
      ...current,
      companionMuted: muted,
    }))
    if (muted) {
      setCompanionReaction(context, undefined)
    }
    onDone(`Buddy ${muted ? 'muted' : 'unmuted'}.`, { display: 'system' })
    return null
  }

  if (arg === 'show' || arg === 'hide' || arg === 'toggle') {
    const current = getGlobalConfig().companionHidden !== false
    const hidden = arg === 'toggle' ? !current : arg === 'hide'
    saveGlobalConfig(prev => ({
      ...prev,
      companionHidden: hidden,
    }))
    if (hidden) {
      setCompanionReaction(context, undefined)
    }
    onDone(`Buddy ${hidden ? 'hidden' : 'visible'}.`, { display: 'system' })
    return null
  }

  if (arg !== '') {
    showHelp(onDone)
    return null
  }

  let companion = getCompanion()
  if (!companion) {
    const stored = createStoredCompanion()
    saveGlobalConfig(current => ({
      ...current,
      companion: stored,
      companionMuted: false,
    }))
    companion = {
      ...rollWithSeed(`${companionUserId()}:buddy`).bones,
      ...stored,
    }
    setCompanionReaction(
      context,
      `${companion.name} the ${companion.species} has hatched.`,
      true,
    )
    const hiddenHint = getGlobalConfig().companionHidden === false
      ? ''
      : ' Buddy stays hidden by default — run /buddy show to reveal them.'
    onDone(
      `${companion.name} the ${companion.species} is now your buddy. Run /buddy again to pet them.${hiddenHint}`,
      { display: 'system' },
    )
    return null
  }

  const reaction = `${companion.name} ${pickDeterministic(
    PET_REACTIONS,
    `${Date.now()}:${companion.name}`,
  )}`
  setCompanionReaction(context, reaction, true)
  onDone(undefined, { display: 'skip' })
  return null
}
