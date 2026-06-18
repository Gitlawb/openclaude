import type { Message } from '../../types/message.js'
import { localCommandOutputToSDKAssistantMessage } from '../../utils/messages/mappers.js'
import { isGoalStatusSystemMessage } from './status.js'

export function toSDKGoalStatusMessage(message: Message) {
  if (!isGoalStatusSystemMessage(message)) return null
  return localCommandOutputToSDKAssistantMessage(message.content, message.uuid)
}
