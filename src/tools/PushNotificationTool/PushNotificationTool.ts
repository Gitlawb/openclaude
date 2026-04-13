/**
 * PushNotificationTool — send system notifications to the user.
 *
 * In the Anthropic internal build, this sends mobile push notifications.
 * In the open build, this triggers OS-native notifications:
 * - macOS: osascript (AppleScript)
 * - Linux: notify-send
 *
 * Useful in assistant/daemon mode to alert the user when a long-running
 * task completes or when input is needed.
 */

import React from 'react'
import { z } from 'zod/v4'
import { execFile } from 'child_process'
import { getKairosActive } from '../../bootstrap/state.js'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    title: z.string().describe('Notification title (short, attention-grabbing)'),
    body: z.string().describe('Notification body text'),
  }),
)

type Input = z.infer<ReturnType<typeof inputSchema>>

function sendNotification(title: string, body: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      execFile('osascript', [
        '-e',
        `display notification "${body.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`,
      ], (err) => resolve(!err))
    } else if (process.platform === 'linux') {
      execFile('notify-send', [title, body], (err) => resolve(!err))
    } else {
      // Windows or unsupported — silently succeed
      resolve(true)
    }
  })
}

export const PushNotificationTool = buildTool({
  name: 'PushNotification',
  maxResultSizeChars: 500,

  async description() {
    return 'Send a system notification to the user'
  },

  userFacingName() {
    return 'PushNotification'
  },

  get inputSchema() {
    return inputSchema()
  },

  isEnabled() {
    return getKairosActive()
  },

  isConcurrencySafe() {
    return true
  },

  isReadOnly() {
    return true
  },

  toAutoClassifierInput(input: Input) {
    return `notify: ${input.title}`
  },

  async prompt() {
    return `Send a system notification to the user's desktop. Use this to alert the user when:
- A long-running task completes while they may be away
- You need their input and they haven't responded
- Something important happened that requires attention

Keep titles short (under 50 chars) and body text concise.`
  },

  async checkPermissions(input: Input) {
    return { behavior: 'allow' as const, updatedInput: input }
  },

  async call(input: Input) {
    const { title, body } = input
    const sent = await sendNotification(title, body)
    return {
      data: { title, body, delivered: sent },
    }
  },

  getActivityDescription(input: Partial<Input> | undefined) {
    return input?.title ? `Notifying: ${input.title}` : 'Sending notification'
  },

  renderToolUseMessage(input: Partial<Input>) {
    return React.createElement('div', null, `Notify: ${input.title ?? ''}`)
  },

  renderToolResultMessage(content: { title: string; body: string; delivered: boolean }) {
    return React.createElement(
      'div',
      null,
      content.delivered ? `Notification sent: ${content.title}` : 'Notification failed',
    )
  },
})
