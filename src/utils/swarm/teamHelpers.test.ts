import { describe, expect, test } from 'bun:test'
import { buildTeamContextBlock } from './teamHelpers.js'
import type { TeamFile } from './teamHelpers.js'

const baseTeamFile: TeamFile = {
  name: 'my-team',
  description: 'Build a full-stack app',
  createdAt: Date.now(),
  leadAgentId: 'team-lead@my-team',
  members: [
    {
      agentId: 'team-lead@my-team',
      name: 'team-lead',
      agentType: 'Leader',
      joinedAt: Date.now(),
      tmuxPaneId: 'pane-0',
      cwd: '/tmp',
      subscriptions: [],
    },
    {
      agentId: 'researcher@my-team',
      name: 'researcher',
      agentType: 'Explore',
      joinedAt: Date.now(),
      tmuxPaneId: 'pane-1',
      cwd: '/tmp',
      subscriptions: [],
    },
    {
      agentId: 'coder@my-team',
      name: 'coder',
      agentType: 'SubAgent',
      joinedAt: Date.now(),
      tmuxPaneId: 'pane-2',
      cwd: '/tmp',
      subscriptions: [],
    },
  ],
}

describe('buildTeamContextBlock', () => {
  test('includes team name, role, lead, teammates, and shared goal', () => {
    const block = buildTeamContextBlock('researcher', 'Explore', baseTeamFile)

    expect(block).toContain('[TEAM CONTEXT]')
    expect(block).toContain('[/TEAM CONTEXT]')
    expect(block).toContain('Team: my-team')
    expect(block).toContain('Your role: researcher (Explore)')
    expect(block).toContain('Team lead: team-lead')
    expect(block).toContain('Teammates: coder (SubAgent)')
    expect(block).toContain('Shared goal: Build a full-stack app')
  })

  test('excludes the receiving agent from the teammates list', () => {
    const block = buildTeamContextBlock('researcher', 'Explore', baseTeamFile)
    // researcher should not appear in the Teammates line
    const lines = block.split('\n')
    const teammatesLine = lines.find(l => l.startsWith('Teammates:'))
    expect(teammatesLine).toBeDefined()
    expect(teammatesLine).not.toContain('researcher')
    expect(teammatesLine).toContain('coder')
  })

  test('excludes the lead from the teammates list', () => {
    const block = buildTeamContextBlock('coder', 'SubAgent', baseTeamFile)
    const lines = block.split('\n')
    const teammatesLine = lines.find(l => l.startsWith('Teammates:'))
    expect(teammatesLine).toBeDefined()
    expect(teammatesLine).not.toContain('team-lead')
  })

  test('omits agentType from role line when not provided', () => {
    const block = buildTeamContextBlock('coder', undefined, baseTeamFile)
    expect(block).toContain('Your role: coder\n')
    expect(block).not.toContain('Your role: coder (')
  })

  test('omits Shared goal line when description is absent', () => {
    const teamFileNoDesc: TeamFile = { ...baseTeamFile, description: undefined }
    const block = buildTeamContextBlock('researcher', 'Explore', teamFileNoDesc)
    expect(block).not.toContain('Shared goal')
  })

  test('omits Teammates line when agent is the only non-lead member', () => {
    const soloTeamFile: TeamFile = {
      ...baseTeamFile,
      members: baseTeamFile.members.filter(
        m => m.name === 'team-lead' || m.name === 'researcher',
      ),
    }
    const block = buildTeamContextBlock('researcher', 'Explore', soloTeamFile)
    expect(block).not.toContain('Teammates:')
  })

  test('includes teammates without agentType as plain names', () => {
    const teamFileNoType: TeamFile = {
      ...baseTeamFile,
      members: baseTeamFile.members.map(m =>
        m.name === 'coder' ? { ...m, agentType: undefined } : m,
      ),
    }
    const block = buildTeamContextBlock('researcher', 'Explore', teamFileNoType)
    const lines = block.split('\n')
    const teammatesLine = lines.find(l => l.startsWith('Teammates:'))
    expect(teammatesLine).toContain('coder')
    expect(teammatesLine).not.toContain('coder (')
  })

  test('includes team config path', () => {
    const block = buildTeamContextBlock('researcher', 'Explore', baseTeamFile)
    expect(block).toContain('Team config:')
    expect(block).toContain('my-team')
    expect(block).toContain('config.json')
  })
})
