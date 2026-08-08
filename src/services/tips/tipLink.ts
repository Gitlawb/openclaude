import chalk from 'chalk'
import { supportsHyperlinks } from '../../ink/supports-hyperlinks.js'

// OSC 8 hyperlink escape. Empty params (;;) is the exact prefix ansi-tokenize
// recognizes (see ink/render-node-to-output.ts), so Ink preserves it through
// the spinner's <Text> and the terminal renders it clickable.
const OSC = ']'
const BEL = ''

export type SponsorLink = {
  /** Sponsor name to show in the badge — a clickable hyperlink when supported. */
  display: string
  /**
   * Trailing text appended after the tip body. Empty when the name is already
   * a working hyperlink; otherwise the dimmed raw URL so the destination is
   * still reachable on terminals without OSC 8 support.
   */
  trailing: string
}

/**
 * Render a sponsor/advertiser name as a clickable link to its click URL (an ad
 * tracker like trygravity, or the sponsor's site). The long URL becomes the
 * hidden link target so the status line stays clean while clicks still hit the
 * tracker that records them — attribution and payout are unchanged.
 *
 * Degrades gracefully:
 *   - no url           → plain name, nothing trailing
 *   - OSC 8 supported  → "Name ↗" hyperlinked to url, nothing trailing
 *   - no OSC 8 support → plain name + the dimmed raw url at the end of the line
 *                        (current behavior — never lose the click target)
 */
// Advertiser name + URL come from the ad partner — untrusted. Both are written
// to the terminal (the name inside an OSC 8 hyperlink), so strip C0/C1 control
// chars (incl. ESC/BEL) to prevent escape-sequence injection, and only honor
// http(s) URLs so a crafted javascript:/file: target can't be made clickable.
// CONTROL_CHARS_RE: built via RegExp() so the regex SOURCE carries no literal
// control bytes (the ESC/BEL above in OSC/BEL are intentional terminal-sequence
// constants, not part of this matcher). Covers C0 (00–1F), DEL (7F), C1 (80–9F).
const CONTROL_CHARS_RE = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g')

function stripControls(value: string): string {
  return value.replace(CONTROL_CHARS_RE, '')
}

function safeHttpUrl(url: string | undefined): string | null {
  const cleaned = stripControls(url ?? '').trim()
  if (!cleaned) return null
  try {
    const parsed = new URL(cleaned)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

export function renderSponsorLink(
  name: string,
  url: string | undefined,
  // Injectable so both branches are deterministically testable; defaults to the
  // real terminal probe in production.
  hyperlinks: boolean = supportsHyperlinks(),
): SponsorLink {
  const safeName = stripControls(name)
  const link = safeHttpUrl(url)
  if (!link) return { display: safeName, trailing: '' }
  if (hyperlinks) {
    return { display: `${OSC}8;;${link}${BEL}${safeName} ↗${OSC}8;;${BEL}`, trailing: '' }
  }
  return { display: safeName, trailing: ` ${chalk.dim(link)}` }
}
