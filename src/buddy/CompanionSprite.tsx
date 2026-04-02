import { feature } from 'bun:bundle'
import figures from 'figures'
import React, { useEffect, useRef, useState } from 'react'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { stringWidth } from '../ink/stringWidth.js'
import { Box, Text } from '../ink.js'
import { useAppState, useSetAppState } from '../state/AppState.js'
import type { AppState } from '../state/AppStateStore.js'
import { getGlobalConfig } from '../utils/config.js'
import { isFullscreenActive } from '../utils/fullscreen.js'
import type { Theme } from '../utils/theme.js'
import { getCompanion } from './companion.js'
import { renderFace, renderSprite, spriteFrameCount } from './sprites.js'
import { RARITY_COLORS } from './types.js'

const TICK_MS = 500
const BUBBLE_SHOW = 20 // ticks → ~10s at 500ms
const FADE_WINDOW = 6 // last ~3s the bubble dims so you know it's about to go
const PET_BURST_MS = 2500 // how long hearts float after /buddy pet

// Idle sequence: mostly rest (frame 0), occasional fidget (frames 1-2), rare blink.
// Sequence indices map to sprite frames; -1 means "blink on frame 0".
const IDLE_SEQUENCE = [0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 2, 0, 0, 0]

// Hearts float up-and-out over 5 ticks (~2.5s). Prepended above the sprite.
const H = figures.heart
const PET_HEARTS = [
  `   ${H}    ${H}   `,
  `  ${H}  ${H}   ${H}  `,
  ` ${H}   ${H}  ${H}   `,
  `${H}  ${H}      ${H} `,
  '·    ·   ·  ',
]

function wrap(text: string, width: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (cur.length + w.length + 1 > width && cur) {
      lines.push(cur)
      cur = w
    } else {
      cur = cur ? `${cur} ${w}` : w
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function SpeechBubble({
  text,
  color,
  fading,
  tail,
}: {
  text: string
  color: keyof Theme
  fading: boolean
  tail: 'down' | 'right'
}): React.ReactNode {
  const lines = wrap(text, 30)
  const borderColor = fading ? 'inactive' : color
  const bubble = (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      width={34}
    >
      {lines.map((l, i) => (
        <Text
          key={i}
          italic
          dimColor={!fading}
          color={fading ? 'inactive' : undefined}
        >
          {l}
        </Text>
      ))}
    </Box>
  )
  if (tail === 'right') {
    return (
      <Box flexDirection="row" alignItems="center">
        {bubble}
        <Text color={borderColor}>─</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" alignItems="flex-end" marginRight={1}>
      {bubble}
      <Box flexDirection="column" alignItems="flex-end" paddingRight={6}>
        <Text color={borderColor}>╲ </Text>
        <Text color={borderColor}>╲</Text>
      </Box>
    </Box>
  )
}

export const MIN_COLS_FOR_FULL_SPRITE = 100
const SPRITE_BODY_WIDTH = 12
const NAME_ROW_PAD = 2 // focused state wraps name in spaces: ` name `
const SPRITE_PADDING_X = 2
const BUBBLE_WIDTH = 36 // SpeechBubble box (34) + tail column
const NARROW_QUIP_CAP = 24

function spriteColWidth(nameWidth: number): number {
  return Math.max(SPRITE_BODY_WIDTH, nameWidth + NAME_ROW_PAD)
}

// Width the sprite area consumes. PromptInput subtracts this so text wraps
// correctly. In fullscreen the bubble floats over scrollback (no extra
// width); in non-fullscreen it sits inline and needs BUBBLE_WIDTH more.
// Narrow terminals: 0 — REPL.tsx stacks the one-liner on its own row
// (above input in fullscreen, below in scrollback), so no reservation.
export function companionReservedColumns(
  terminalColumns: number,
  speaking: boolean,
): number {
  if (!feature('BUDDY')) return 0
  const companion = getCompanion()
  if (!companion || getGlobalConfig().companionMuted) return 0
  if (terminalColumns < MIN_COLS_FOR_FULL_SPRITE) return 0
  const nameWidth = stringWidth(companion.name)
  const bubble = speaking && !isFullscreenActive() ? BUBBLE_WIDTH : 0
  return spriteColWidth(nameWidth) + SPRITE_PADDING_X + bubble
}

export function CompanionSprite(): React.ReactNode {
  const reaction = useAppState(s => s.companionReaction)
  const petAt = useAppState(s => s.companionPetAt)
  const focused = useAppState(s => s.footerSelection === 'companion')
  const setAppState = useSetAppState()
  const { columns } = useTerminalSize()
  const [tick, setTick] = useState(0)
  const lastSpokeTick = useRef(0)
  const [{ petStartTick, forPetAt }, setPetStart] = useState({
    petStartTick: 0,
    forPetAt: petAt,
  })
  if (petAt !== forPetAt) {
    setPetStart({ petStartTick: tick, forPetAt: petAt })
  }

  useEffect(() => {
    const timer = setInterval(
      setT => setT((t: number) => t + 1),
      TICK_MS,
      setTick,
    )
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!reaction) return
    lastSpokeTick.current = tick
    const timer = setTimeout(
      setA =>
        setA((prev: AppState) =>
          prev.companionReaction === undefined
            ? prev
            : { ...prev, companionReaction: undefined },
        ),
      BUBBLE_SHOW * TICK_MS,
      setAppState,
    )
    return () => clearTimeout(timer)
  }, [reaction, setAppState])

  if (!feature('BUDDY')) return null
  const companion = getCompanion()
  if (!companion || getGlobalConfig().companionMuted) return null

  const color = RARITY_COLORS[companion.rarity]
  const colWidth = spriteColWidth(stringWidth(companion.name))

  const bubbleAge = reaction ? tick - lastSpokeTick.current : 0
  const fading =
    reaction !== undefined && bubbleAge >= BUBBLE_SHOW - FADE_WINDOW

  const petAge = petAt ? tick - petStartTick : Infinity
  const petting = petAge * TICK_MS < PET_BURST_MS

  if (columns < MIN_COLS_FOR_FULL_SPRITE) {
    const quip =
      reaction && reaction.length > NARROW_QUIP_CAP
        ? reaction.slice(0, NARROW_QUIP_CAP - 1) + '…'
        : reaction
    const label = quip
      ? `"${quip}"`
      : focused
        ? ` ${companion.name} `
        : companion.name
    return (
      <Box paddingX={1} alignSelf="flex-end">
        <Text>
          {petting && <Text color="autoAccept">{figures.heart} </Text>}
          <Text bold color={color}>
            {renderFace(companion)}
          </Text>{' '}
          <Text
            italic
            dimColor={!focused && !reaction}
            bold={focused}
            inverse={focused && !reaction}
            color={
              reaction
                ? fading
                  ? 'inactive'
                  : color
                : focused
                  ? color
                  : undefined
            }
          >
            {label}
          </Text>
        </Text>
      </Box>
    )
  }
  const frameCount = spriteFrameCount(companion.species)
  const heartFrame = petting ? PET_HEARTS[petAge % PET_HEARTS.length] : null

  let spriteFrame: number
  let blink = false
  if (reaction || petting) {
    spriteFrame = tick % frameCount
  } else {
    const step = IDLE_SEQUENCE[tick % IDLE_SEQUENCE.length]!
    if (step === -1) {
      spriteFrame = 0
      blink = true
    } else {
      spriteFrame = step % frameCount
    }
  }

  const body = renderSprite(companion, spriteFrame).map(line =>
    blink ? line.replaceAll(companion.eye, '-') : line,
  )
  const sprite = heartFrame ? [heartFrame, ...body] : body

  const spriteColumn = (
    <Box
      flexDirection="column"
      flexShrink={0}
      alignItems="center"
      width={colWidth}
    >
      {sprite.map((line, i) => (
        <Text key={i} color={i === 0 && heartFrame ? 'autoAccept' : color}>
          {line}
        </Text>
      ))}
      <Text
        italic
        bold={focused}
        dimColor={!focused}
        color={focused ? color : undefined}
        inverse={focused}
      >
        {focused ? ` ${companion.name} ` : companion.name}
      </Text>
    </Box>
  )

  if (!reaction) {
    return <Box paddingX={1}>{spriteColumn}</Box>
  }

  if (isFullscreenActive()) {
    return <Box paddingX={1}>{spriteColumn}</Box>
  }
  return (
    <Box flexDirection="row" alignItems="flex-end" paddingX={1} flexShrink={0}>
      <SpeechBubble
        text={reaction}
        color={color}
        fading={fading}
        tail="right"
      />
      {spriteColumn}
    </Box>
  )
}

export function CompanionFloatingBubble(): React.ReactNode {
  const reaction = useAppState(s => s.companionReaction)
  const [{ tick, forReaction }, setTick] = useState({
    tick: 0,
    forReaction: reaction,
  })

  if (reaction !== forReaction) {
    setTick({ tick: 0, forReaction: reaction })
  }

  useEffect(() => {
    if (!reaction) return
    const timer = setInterval(
      set => set(s => ({ ...s, tick: s.tick + 1 })),
      TICK_MS,
      setTick,
    )
    return () => clearInterval(timer)
  }, [reaction])

  if (!feature('BUDDY') || !reaction) return null
  const companion = getCompanion()
  if (!companion || getGlobalConfig().companionMuted) return null

  return (
    <SpeechBubble
      text={reaction}
      color={RARITY_COLORS[companion.rarity]}
      fading={tick >= BUBBLE_SHOW - FADE_WINDOW}
      tail="down"
    />
  )
}
