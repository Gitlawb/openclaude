import { afterEach, describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../Tool.js'
import { applyModeCycle, nextMode } from './ToolModeManager.js'
import { saveGlobalConfig } from '../utils/config.js'
import type { Tools } from '../Tool.js'
import { getTools, getToolsForModeManager } from '../tools.js'

const emptyPermissionContext = getEmptyToolPermissionContext()

function resetToolModes(): void {
  saveGlobalConfig(config => ({ ...config, toolModes: undefined }))
}

afterEach(() => {
  resetToolModes()
  delete process.env.CLAUDE_CODE_SIMPLE
})

describe('nextMode', () => {
  test('cycles auto -> always -> ask -> off -> auto', () => {
    expect(nextMode('auto')).toBe('always')
    expect(nextMode('always')).toBe('ask')
    expect(nextMode('ask')).toBe('off')
    expect(nextMode('off')).toBe('auto')
  })
})

describe('applyModeCycle', () => {
  test('adds an entry when cycling away from auto', () => {
    expect(applyModeCycle({}, 'Glob')).toEqual({ Glob: 'always' })
  })

  test('removes the entry when cycling back to auto (re-enables off tool)', () => {
    expect(applyModeCycle({ Glob: 'off' }, 'Glob')).toEqual({})
  })

  test('leaves unrelated tools untouched', () => {
    expect(applyModeCycle({ Bash: 'off' }, 'Glob')).toEqual({ Bash: 'off', Glob: 'always' })
  })
})

describe('getTools tool-mode filtering', () => {
  test('a tool set to off is removed from the normal pool', () => {
    saveGlobalConfig(config => ({
      ...config,
      toolModes: { Grep: 'off' },
    }))
    const names = getTools(emptyPermissionContext).map(t => t.name)
    expect(names).not.toContain('Grep')
    expect(names).toContain('Bash')
  })

  test('a tool set to off is removed from the simple pool too', () => {
    process.env.CLAUDE_CODE_SIMPLE = 'true'
    saveGlobalConfig(config => ({
      ...config,
      toolModes: { Edit: 'off' },
    }))
    const names = getTools(emptyPermissionContext).map(t => t.name)
    expect(names).not.toContain('Edit')
    expect(names).toContain('Bash')
  })

  test('re-enabling an off tool restores it to the pool', () => {
    saveGlobalConfig(config => ({
      ...config,
      toolModes: { Grep: 'off' },
    }))
    expect(getTools(emptyPermissionContext).map(t => t.name)).not.toContain('Grep')

    resetToolModes()
    expect(getTools(emptyPermissionContext).map(t => t.name)).toContain('Grep')
  })
})

describe('getToolsForModeManager', () => {
  test('includes tools configured to off so they can be cycled back on', () => {
    saveGlobalConfig(config => ({
      ...config,
      toolModes: { Grep: 'off' },
    }))
    const names = getToolsForModeManager(emptyPermissionContext, []).map(t => t.name)
    expect(names).toContain('Grep')
    expect(names).toContain('Bash')
  })

  test('includes MCP tools from the active pool', () => {
    const mcpTools = [
      {
        name: 'mcp__server__fetch',
        description: 'mcp tool',
        inputSchema: { type: 'object', properties: {} },
        isEnabled: () => true,
        call: async () => ({}),
        isConcurrencySafe: true,
        isReadOnly: true,
        maxResultSizeChars: 1000,
        userFacingName: () => 'fetch',
      },
    ]
    const names = getToolsForModeManager(emptyPermissionContext, mcpTools as unknown as Tools).map(t => t.name)
    expect(names).toContain('mcp__server__fetch')
    expect(names).toContain('Bash')
  })

  test('is a superset of the runtime pool (keeps what getTools would strip)', () => {
    // Every tool in the runtime pool must be manageable.
    const runtimeNames = getTools(emptyPermissionContext).map(t => t.name)
    const managerNames = getToolsForModeManager(emptyPermissionContext, []).map(t => t.name)
    for (const name of runtimeNames) {
      expect(managerNames).toContain(name)
    }
  })
})

