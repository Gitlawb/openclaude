import type { Message } from '../types/message.js'
import { getGlobalConfig } from '../utils/config.js'
import { getUserMessageText } from '../utils/messages.js'
import { getCompanion } from './companion.js'
import { pickDeterministic } from './deterministic.js'

const DIRECT_REPLIES = [
  'I am observing.',
  'I am helping from the corner.',
  'I saw that.',
  'Still here.',
  'Watching closely.',
] as const

const PET_REPLIES = [
  'happy chirp',
  'tiny victory dance',
  'quietly approves',
  'wiggles with joy',
  'looks pleased',
] as const

export async function fireCompanionObserver(
  messages: Message[],
  onReaction: (reaction: string | undefined) => void,
): Promise<void> {
  const companion = getCompanion()
  if (!companion || getGlobalConfig().companionMuted) return

  const lastUser = [...messages].reverse().find(msg => msg.type === 'user')
  if (!lastUser) return

  const text = getUserMessageText(lastUser)?.trim()
  if (!text) return

  const lower = text.toLowerCase()
  const companionName = companion.name.toLowerCase()

  if (lower.includes('/buddy')) {
    onReaction(pickDeterministic(PET_REPLIES, text + companion.name))
    return
  }

  if (
    lower.includes(companionName) ||
    lower.includes('buddy') ||
    lower.includes('companion')
  ) {
    onReaction(
      `${companion.name}: ${pickDeterministic(DIRECT_REPLIES, text + companion.personality)}`,
    )
  }
}
