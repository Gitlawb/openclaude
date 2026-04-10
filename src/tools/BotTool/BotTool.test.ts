/**
 * Tests for BotTool — tool metadata, rendering, schema validation
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BOT_TOOL_NAME, DESCRIPTION } from './prompt.js'
import {
  renderToolUseMessage,
  getToolUseSummary,
  renderToolResultMessage,
} from './UI.js'

describe('BotTool', () => {
  describe('metadata', () => {
    it('should export correct tool name', () => {
      assert.equal(BOT_TOOL_NAME, 'BotManager')
    })

    it('should have a non-empty description', () => {
      assert.ok(DESCRIPTION.length > 0)
      assert.ok(DESCRIPTION.toLowerCase().includes('bot'))
    })
  })

  describe('rendering', () => {
    it('should render status action', () => {
      const msg = renderToolUseMessage({ action: 'status' })
      assert.ok(msg)
    })

    it('should render channels list action', () => {
      const msg = renderToolUseMessage({ action: 'channels list' })
      assert.ok(msg)
    })

    it('should render send action with details', () => {
      const msg = renderToolUseMessage({ action: 'send', platform: 'telegram', userId: 'u1', message: 'hi' })
      assert.ok(msg)
      assert.ok(msg.includes('telegram'))
    })

    it('should render channels add action', () => {
      const msg = renderToolUseMessage({ action: 'channels add', platform: 'discord', channelId: 'ch1' })
      assert.ok(msg)
    })

    it('should return correct summaries for each action', () => {
      assert.ok(getToolUseSummary({ action: 'status' }).length > 0)
      assert.ok(getToolUseSummary({ action: 'channels list' }).length > 0)
      assert.ok(getToolUseSummary({ action: 'send', platform: 'tg' }).length > 0)
    })

    it('should render success result', () => {
      const msg = renderToolResultMessage({ success: true, output: 'OK' })
      assert.ok(msg)
    })

    it('should render error result', () => {
      const msg = renderToolResultMessage({ success: false, output: 'fail' })
      assert.ok(msg)
    })
  })
})
