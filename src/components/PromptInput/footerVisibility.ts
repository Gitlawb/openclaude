export type TransientFooterMessage = 'exit' | 'paste' | null
export type FooterOverlay = 'suggestions' | 'help' | null

/** Keeps help keybindings from remaining active behind inline history search. */
export function applyHistorySearchActiveState(
  active: boolean,
  setHelpOpen: (open: boolean) => void,
  setIsSearching: (active: boolean) => void,
): void {
  if (active) setHelpOpen(false)
  setIsSearching(active)
}

/** History search owns the footer while active; otherwise suggestions beat help. */
export function resolveFooterOverlay(options: {
  hasInlineSuggestions: boolean
  helpOpen: boolean
  isSearching: boolean
}): FooterOverlay {
  if (options.isSearching) return null
  if (options.hasInlineSuggestions) return 'suggestions'
  if (options.helpOpen) return 'help'
  return null
}

/** Resolves exit/paste precedence shared by footer visibility consumers. */
export function resolveTransientFooterMessage(options: {
  exitMessageShown: boolean
  isPasting: boolean
}): TransientFooterMessage {
  if (options.exitMessageShown) return 'exit'
  if (options.isPasting) return 'paste'
  return null
}

/** Lets history search replace transient feedback in the footer's left side. */
export function resolveVisibleTransientFooterMessage(options: {
  isSearching: boolean
  exitMessageShown: boolean
  isPasting: boolean
}): TransientFooterMessage {
  if (options.isSearching) return null
  return resolveTransientFooterMessage(options)
}

/** Regular footer effects run only while both visibility layers are active. */
export function resolveRegularFooterActive(options: {
  parentActive: boolean
  transientMessage: TransientFooterMessage
}): boolean {
  return options.parentActive && options.transientMessage === null
}
