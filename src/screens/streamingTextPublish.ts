// Pure streaming-text publish decision, factored out of REPL's onStreamingText
// so the hot-path behavior can be unit-tested without rendering the REPL:
// deltas always accumulate (so the Esc handler can recover partial output even
// when the live preview is off), but a React state publish — which commits a
// synchronous LegacyRoot render — only happens when the newline-truncated
// visible preview actually changes.

// The streaming preview hides the in-progress trailing line (everything after
// the last newline), so it only changes when a newline is appended.
export function visibleStreamingPreview(text: string | null): string | null {
  return text ? text.substring(0, text.lastIndexOf('\n') + 1) || null : null
}

export type StreamingTextDecision = {
  // Full accumulated text. Always written to streamingTextRef, even when the
  // preview is disabled, so the Esc handler can append partial assistant output.
  nextText: string | null
  // Whether to publish nextText to React state (drives a render).
  publish: boolean
  // New last-published visible preview; only advances when publish is true.
  nextVisible: string | null
}

// Decide the effect of one streaming-text delta. `apply` is the incoming
// updater (current -> next); `lastVisible` is the previously published preview.
export function decideStreamingTextUpdate(
  currentText: string | null,
  apply: (current: string | null) => string | null,
  showPreview: boolean,
  lastVisible: string | null,
): StreamingTextDecision {
  const nextText = apply(currentText)
  if (!showPreview) {
    // Accumulate into the ref but never render while the preview is hidden.
    return { nextText, publish: false, nextVisible: lastVisible }
  }
  const nextVisible = visibleStreamingPreview(nextText)
  if (nextVisible !== lastVisible) {
    // Publish only when the visible preview changes. A clear (nextText === null)
    // always wins this check because the live preview was non-null, keeping the
    // streaming -> final swap atomic with the onMessage setMessages.
    return { nextText, publish: true, nextVisible }
  }
  return { nextText, publish: false, nextVisible: lastVisible }
}
