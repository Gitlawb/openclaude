import { stripVTControlCharacters } from 'node:util'
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js'
import { stringWidth } from '../../ink/stringWidth.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { companionUserId, getCompanion } from '../../buddy/companion.js'
import { pickDeterministic } from '../../buddy/deterministic.js'
import type { Species, StoredCompanion } from '../../buddy/types.js'
import {
  corsair,
  ember,
  kage,
  kaio,
  merlin,
  SPECIES,
  robinhood,
  strawhat,
} from '../../buddy/types.js'
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js'

// Flavor for /buddy set confirmations. A full Record so adding a hero
// without flavor text is a compile error.
const FORM_FLAVOR: Record<Species, { don: string; hint: string }> = {
  [robinhood]: {
    don: 'dons the green hood',
    hint: 'Submit any message to see the arrow fly.',
  },
  [kaio]: {
    don: 'powers up — hair blazing gold',
    hint: 'Submit any message to fire the energy wave.',
  },
  [strawhat]: {
    don: 'puts on the straw hat with a grin',
    hint: 'Submit any message to throw the stretchy punch.',
  },
  [merlin]: {
    don: 'raises the star-tipped staff',
    hint: 'Submit any message to cast the sparkle stream.',
  },
  [kage]: {
    don: 'melts into the shadows',
    hint: 'Submit any message to throw the shuriken.',
  },
  [ember]: {
    don: 'puffs a proud little smoke ring',
    hint: 'Submit any message to breathe fire.',
  },
  [corsair]: {
    don: 'tips the tricorn',
    hint: 'Submit any message to fire the cannon.',
  },
}

const NAME_PREFIXES = [
  'Byte',
  'Echo',
  'Glint',
  'Miso',
  'Nova',
  'Pixel',
  'Rune',
  'Static',
  'Vector',
  'Whisk',
] as const

const NAME_SUFFIXES = [
  'bean',
  'bit',
  'bud',
  'dot',
  'ling',
  'loop',
  'moss',
  'patch',
  'puff',
  'spark',
] as const

const PERSONALITIES = [
  'Curious and quietly encouraging',
  'A patient little watcher with strong debugging instincts',
  'Playful, observant, and suspicious of flaky tests',
  'Calm under pressure and fond of clean diffs',
  'A tiny terminal gremlin who likes successful builds',
] as const

const PET_REACTIONS = [
  'leans into the headpat',
  'does a proud little bounce',
  'emits a content beep',
  'looks delighted',
  'wiggles happily',
] as const

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function createStoredCompanion(): StoredCompanion {
  const userId = companionUserId()
  const prefix = pickDeterministic(NAME_PREFIXES, `${userId}:prefix`)
  const suffix = pickDeterministic(NAME_SUFFIXES, `${userId}:suffix`)
  const personality = pickDeterministic(PERSONALITIES, `${userId}:personality`)

  return {
    name: `${prefix}${suffix}`,
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
    `Usage: /buddy [status|mute|unmute|set <form|random>|name <new name>]\n\nForms: ${SPECIES.join(', ')}\n\nRun /buddy with no args to hatch your companion the first time, then pet it on later runs. /buddy set picks a hero form with its own Enter animation; /buddy set random restores the rolled one; /buddy name renames your companion.`,
    { display: 'system' },
  )
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
): Promise<null> {
  const arg = args?.trim().toLowerCase() ?? ''

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
    const chosenForm = getGlobalConfig().companion?.speciesOverride
      ? ' (chosen form — /buddy set random to revert)'
      : ''
    onDone(
      `${companion.name} is your ${titleCase(companion.rarity)} ${companion.species}${chosenForm}. ${companion.personality}`,
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
    } else {
      // The sprite reads companionMuted non-reactively and its animation
      // clock is paused while hidden, so a config-only unmute would leave it
      // invisible until an unrelated re-render. The reaction is an AppState
      // change that re-renders the sprite immediately (and greets the user).
      const companion = getCompanion()
      if (companion) {
        setCompanionReaction(context, `${companion.name} is back.`)
      }
    }
    onDone(`Buddy ${muted ? 'muted' : 'unmuted'}.`, { display: 'system' })
    return null
  }

  const [sub, ...rest] = arg.split(/\s+/)

  if (sub === 'name') {
    if (!getGlobalConfig().companion) {
      onDone('No buddy hatched yet. Run /buddy to hatch one first.', {
        display: 'system',
      })
      return null
    }
    // Parse from the raw args (not `arg`) so capitalization is preserved.
    // Sanitize: the name renders verbatim in the sprite column, so ANSI
    // escapes / control / zero-width characters would corrupt the TUI line
    // until the next rename. Cap by DISPLAY width, not UTF-16 length.
    const newName = stripVTControlCharacters(
      (args ?? '').trim().split(/\s+/).slice(1).join(' '),
    )
      .replace(/[\p{Cc}\p{Cf}]/gu, '')
      .trim()
    if (!newName) {
      onDone('Usage: /buddy name <new name>', { display: 'system' })
      return null
    }
    if (stringWidth(newName) > 20) {
      onDone('Buddy names are capped at 20 columns.', {
        display: 'system',
      })
      return null
    }
    const previous = getCompanion()!.name
    saveGlobalConfig(current => ({
      ...current,
      companion: current.companion
        ? { ...current.companion, name: newName }
        : current.companion,
    }))
    if (!getGlobalConfig().companionMuted) {
      setCompanionReaction(context, `${newName} answers to their new name.`)
    }
    onDone(`${previous} is now called ${newName}.`, { display: 'system' })
    return null
  }

  if (sub === 'set') {
    if (!getGlobalConfig().companion) {
      onDone('No buddy hatched yet. Run /buddy to hatch one first.', {
        display: 'system',
      })
      return null
    }
    const target = rest[0]
    if (target === 'random') {
      saveGlobalConfig(current => ({
        ...current,
        companion: current.companion
          ? { ...current.companion, speciesOverride: undefined }
          : current.companion,
      }))
      const companion = getCompanion()!
      onDone(
        `${companion.name} is back to their rolled form: ${titleCase(companion.rarity)} ${companion.species}.`,
        { display: 'system' },
      )
      return null
    }
    if (
      target !== undefined &&
      (SPECIES as readonly string[]).includes(target)
    ) {
      const form = target as Species
      saveGlobalConfig(current => ({
        ...current,
        companion: current.companion
          ? { ...current.companion, speciesOverride: form }
          : current.companion,
      }))
      const companion = getCompanion()!
      const flavor = FORM_FLAVOR[form]
      setCompanionReaction(context, `${companion.name} ${flavor.don}.`)
      const mutedHint = getGlobalConfig().companionMuted
        ? ' Note: your buddy is muted and hidden — run /buddy unmute to see them.'
        : ''
      onDone(
        `${companion.name} is now a ${form}. ${flavor.hint} /buddy set random reverts.${mutedHint}`,
        { display: 'system' },
      )
      return null
    }
    onDone(
      `Unknown form '${rest[0] ?? ''}'. Available: ${[...SPECIES, 'random'].join(', ')}.`,
      { display: 'system' },
    )
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
    // Read back through getCompanion() so the hatch message names the SAME
    // species the sprite will display (the display roll is seeded with
    // userId+SALT, not the `:buddy` seed used for hatch-time stats).
    companion = getCompanion()!
    setCompanionReaction(
      context,
      `${companion.name} the ${companion.species} has hatched.`,
      true,
    )
    onDone(
      `${companion.name} the ${companion.species} is now your buddy. Run /buddy again to pet them.`,
      { display: 'system' },
    )
    return null
  }

  // Muted: the sprite is hidden and reactions never render, so a silent
  // pet reads as "/buddy did nothing". Say so instead.
  if (getGlobalConfig().companionMuted) {
    onDone(
      `${companion.name} is hidden (buddy is muted). Run /buddy unmute to show them.`,
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
