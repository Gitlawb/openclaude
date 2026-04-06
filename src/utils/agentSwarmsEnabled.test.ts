import { afterEach, describe, expect, test } from 'bun:test'

const originalArgv = process.argv.slice()
const originalEnv = {
  USER_TYPE: process.env.USER_TYPE,
  CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS,
}

function resetEnv() {
  // Use delete when the original value was undefined — assigning undefined
  // coerces to the string "undefined" in process.env, which leaks into later tests.
  if (originalEnv.USER_TYPE === undefined) {
    delete process.env.USER_TYPE
  } else {
    process.env.USER_TYPE = originalEnv.USER_TYPE
  }
  if (originalEnv.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === undefined) {
    delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
  } else {
    process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS =
      originalEnv.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
  }
  // Restore argv without the --agent-teams flag
  process.argv.splice(0, process.argv.length, ...originalArgv)
}

afterEach(resetEnv)

describe('isAgentSwarmsOptedIn', () => {
  async function importFresh() {
    return import(`./agentSwarmsEnabled.js?t=${Date.now()}-${Math.random()}`) as Promise<
      typeof import('./agentSwarmsEnabled.js')
    >
  }

  test('returns true for ant builds regardless of env var', async () => {
    delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
    process.env.USER_TYPE = 'ant'
    const { isAgentSwarmsOptedIn } = await importFresh()
    expect(isAgentSwarmsOptedIn()).toBe(true)
  })

  test('returns true when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS is truthy', async () => {
    delete process.env.USER_TYPE
    process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'
    const { isAgentSwarmsOptedIn } = await importFresh()
    expect(isAgentSwarmsOptedIn()).toBe(true)
  })

  test('returns false when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS is "0"', async () => {
    delete process.env.USER_TYPE
    process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '0'
    const { isAgentSwarmsOptedIn } = await importFresh()
    expect(isAgentSwarmsOptedIn()).toBe(false)
  })

  test('returns false when no env var and no --agent-teams flag', async () => {
    delete process.env.USER_TYPE
    delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
    // Ensure --agent-teams is not in argv
    process.argv = process.argv.filter(a => a !== '--agent-teams')
    const { isAgentSwarmsOptedIn } = await importFresh()
    expect(isAgentSwarmsOptedIn()).toBe(false)
  })

  test('returns true when --agent-teams flag is in argv', async () => {
    delete process.env.USER_TYPE
    delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
    process.argv = [...process.argv.filter(a => a !== '--agent-teams'), '--agent-teams']
    const { isAgentSwarmsOptedIn } = await importFresh()
    expect(isAgentSwarmsOptedIn()).toBe(true)
  })
})
