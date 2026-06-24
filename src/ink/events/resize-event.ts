import { TerminalEvent } from './terminal-event.js'

/**
 * Resize event fired when an element's layout size changes
 * (e.g. after a terminal resize or reflow).
 *
 * Non-bubbling — fires only on the observed element, matching the
 * bubble-only onResize handler prop in event-handlers.ts.
 */
export class ResizeEvent extends TerminalEvent {
  /** New width in terminal columns. */
  readonly width: number
  /** New height in terminal rows. */
  readonly height: number

  constructor(width: number, height: number) {
    super('resize', { bubbles: false, cancelable: false })
    this.width = width
    this.height = height
  }
}
