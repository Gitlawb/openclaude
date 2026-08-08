import { TerminalEvent } from './terminal-event.js'

/**
 * Paste event carrying text inserted via bracketed paste.
 *
 * Dispatched to the focused element and bubbles, matching the
 * onPaste/onPasteCapture handler props in event-handlers.ts.
 */
export class PasteEvent extends TerminalEvent {
  /** The pasted text, with bracketed-paste delimiters already stripped. */
  readonly text: string

  constructor(text: string) {
    super('paste', { bubbles: true, cancelable: true })
    this.text = text
  }
}
