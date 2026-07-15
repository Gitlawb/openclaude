import { describe, expect, test } from 'bun:test'
import {
  _allPixelFramesForTesting,
  _paletteCharsForTesting,
  hasPixelSprite,
  PIXEL_WIDTH,
  pixelIdleFrameCount,
  pixelShootFrameCount,
  renderPixelSprite,
} from './pixelSprites.js'
import { SPECIES, robinhood, type Species } from './types.js'

const PIXEL_HEIGHT = 16

// Every hero form ships pixel art; robinhood has 3 idle frames, the rest 2.
const EXPECTED_FRAME_COUNTS: Record<string, number> = Object.fromEntries(
  SPECIES.map(s => [s, s === robinhood ? 6 : 5]),
)

describe('pixel sprite frames', () => {
  test('every hero frame is a full 22x16 grid of palette chars', () => {
    const palette = _paletteCharsForTesting()
    for (const species of SPECIES) {
      expect(hasPixelSprite(species)).toBe(true)
      // Idle and shoot counts asserted separately — the animation consumes
      // each set independently and clamps silently, so a combined total
      // would permit an invalid split.
      expect(pixelIdleFrameCount(species)).toBe(species === robinhood ? 3 : 2)
      expect(pixelShootFrameCount(species)).toBe(3)
      const frames = _allPixelFramesForTesting(species)
      expect(frames).toBeDefined()
      expect(frames!.length).toBe(EXPECTED_FRAME_COUNTS[species]!)
      for (const [fi, frame] of frames!.entries()) {
        expect(frame.length).toBe(PIXEL_HEIGHT)
        for (const [ri, row] of frame.entries()) {
          if (row.length !== PIXEL_WIDTH) {
            throw new Error(
              `${species} frame ${fi} row ${ri} is ${row.length} wide: "${row}"`,
            )
          }
          for (const ch of row) {
            if (!palette.has(ch)) {
              throw new Error(
                `${species} frame ${fi} row ${ri} has non-palette char "${ch}"`,
              )
            }
          }
        }
      }
    }
  })

})

describe('renderPixelSprite', () => {
  test('produces 8 rows whose runs sum to exactly 22 columns for every hero', () => {
    for (const species of SPECIES) {
      for (const mode of ['idle', 'shoot'] as const) {
        for (const frame of [0, 1, 2]) {
          const rows = renderPixelSprite(species as Species, frame, mode)
          expect(rows).not.toBeNull()
          expect(rows!.length).toBe(PIXEL_HEIGHT / 2)
          for (const runs of rows!) {
            const width = runs.reduce((n, r) => n + r.text.length, 0)
            expect(width).toBe(PIXEL_WIDTH)
          }
        }
      }
    }
  })

  test('clamps out-of-range frames instead of crashing', () => {
    expect(renderPixelSprite(robinhood, 99, 'idle')).toEqual(
      renderPixelSprite(robinhood, 2, 'idle'),
    )
    expect(renderPixelSprite(robinhood, -1, 'shoot')).toEqual(
      renderPixelSprite(robinhood, 0, 'shoot'),
    )
  })

  test('runs carry rgb() colors only, never raw palette letters', () => {
    const rows = renderPixelSprite(robinhood, 0, 'idle')!
    let colored = 0
    for (const runs of rows) {
      for (const run of runs) {
        if (run.color !== undefined) {
          colored++
          expect(run.color!.startsWith('rgb(')).toBe(true)
        }
        if (run.backgroundColor !== undefined) {
          expect(run.backgroundColor!.startsWith('rgb(')).toBe(true)
        }
        expect(/^[▀▄ ]+$/.test(run.text)).toBe(true)
      }
    }
    expect(colored).toBeGreaterThan(0)
  })
})
