import React from 'react'
import { useSettings } from '../hooks/useSettings.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
// Raw ink Text: effect runs carry raw rgb() colors, which the themed
// wrapper does not accept.
import RawText from '../ink/components/Text.js'
import { Box } from '../ink.js'
import { useAppState } from '../state/AppState.js'
import { getGlobalConfig } from '../utils/config.js'
import { effectTotalMs, getActionEffect } from './actionEffects.js'
import {
  companionReservedColumns,
  MIN_COLS_FOR_FULL_SPRITE,
} from './CompanionSprite.js'
import { getCompanion } from './companion.js'
import { isBuddyEnabled } from './feature.js'
import { useShotClock } from './useShotClock.js'

// Mirrors PromptInput's textInputColumns gutter so the FX row's travel lane
// matches the prompt text width.
const PROMPT_GUTTER = 3
const MIN_FX_WIDTH = 8

/**
 * Transient height-1 row above the prompt input: blank while the companion
 * plays its draw/cast poses, then the hero's signature effect (arrow, energy
 * wave, stretchy punch, ...) travels right→left toward the prompt. Mounts /
 * unmounts around the action — the same transient-row class as
 * CompletionFlash. Skipped in narrow terminals and under reduced motion.
 */
export const CompanionActionFX = React.memo(
  function CompanionActionFX(): React.ReactNode {
  const shotAt = useAppState(s => s.companionShotAt)
  const speaking = useAppState(s => s.companionReaction !== undefined)
  const settings = useSettings()
  const reducedMotion = settings?.prefersReducedMotion === true
  const { columns } = useTerminalSize()

  // Skip the config/companion lookups entirely until the first shot token
  // exists — this component is mounted whenever the prompt is visible, so
  // idle keystrokes shouldn't pay for lookups that end in `return null`.
  const hasToken = shotAt !== undefined
  const companion = hasToken && isBuddyEnabled() ? getCompanion() : undefined
  const fx = companion ? getActionEffect(companion.species) : undefined
  const eligible =
    fx !== undefined &&
    getGlobalConfig().companionMuted !== true &&
    !reducedMotion &&
    columns >= MIN_COLS_FOR_FULL_SPRITE
  // shotAt passes through UNCONDITIONALLY so the hook can consume tokens
  // stamped while ineligible (see useShotClock docs).
  const elapsed = useShotClock(shotAt, eligible, fx ? effectTotalMs(fx) : 0)

  if (elapsed === null || fx === undefined || companion === undefined) {
    return null
  }
  const width = Math.max(
    MIN_FX_WIDTH,
    columns - PROMPT_GUTTER - companionReservedColumns(columns, speaking),
  )
  const runs = elapsed < fx.drawMs ? [] : fx.render(elapsed - fx.drawMs, width)
  if (runs === null) return null
  return (
    <Box height={1} width="100%" flexShrink={0}>
      <RawText wrap="truncate">
        {runs.length === 0 ? (
          ' '
        ) : (
          runs.map((run, i) => (
            <RawText key={i} color={run.color}>
              {run.text}
            </RawText>
          ))
        )}
      </RawText>
    </Box>
  )
  },
)
