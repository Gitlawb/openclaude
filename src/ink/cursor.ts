/**
 * Terminal cursor state carried on each rendered Frame (see frame.ts).
 * Coordinates are 0-indexed screen positions.
 */
export type Cursor = {
  readonly x: number
  readonly y: number
  readonly visible: boolean
}
