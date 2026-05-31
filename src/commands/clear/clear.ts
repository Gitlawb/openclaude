import type { LocalCommandCall } from '../../types/command.js'
import { clearConversation } from './conversation.js'

export const call: LocalCommandCall = async (_, context) => {
  await clearConversation(context)
  // Reset ContentReplacementState so seenIds/replacements accumulated during
  // the cleared session don't persist across the /clear boundary. REPL.tsx
  // resets this for plan-mode exits and idle-return clears; the slash command
  // path goes through this module and previously left the state untouched.
  // context.contentReplacementState is the same object held by
  // contentReplacementStateRef.current in REPL.tsx, so clearing in-place is
  // equivalent to REPL.tsx's createContentReplacementState() replacement.
  if (context.contentReplacementState) {
    context.contentReplacementState.seenIds.clear()
    context.contentReplacementState.replacements.clear()
  }
  return { type: 'text', value: '' }
}
