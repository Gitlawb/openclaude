import { describe, expect, test } from 'bun:test'

import { buildSdkUserAgents } from './agentDefinitions.js'

describe('buildSdkUserAgents', () => {
  test('preserves valid maxSteps, ignores invalid maxSteps, and rejects malformed SDK agents safely', () => {
    const failures: Array<{ name: string; error: string }> = []

    const agents = buildSdkUserAgents(
      {
        valid: {
          description: 'Use for valid SDK agent coverage',
          prompt: 'valid prompt',
          maxTurns: 4,
          maxSteps: 2,
        },
        zero: {
          description: 'Use for invalid SDK agent coverage',
          prompt: 'zero prompt',
          maxSteps: 0,
        },
        malformed: {
          description: 'Use for malformed SDK agent coverage',
          prompt: 'malformed prompt',
          maxSteps: '2' as unknown as number,
        },
        negative: {
          description: 'Use for negative SDK agent coverage',
          prompt: 'negative prompt',
          maxSteps: -1,
        },
        fractional: {
          description: 'Use for fractional SDK agent coverage',
          prompt: 'fractional prompt',
          maxSteps: 1.5,
        },
        invalidTurns: {
          description: 'Use for invalid maxTurns SDK coverage',
          prompt: 'invalid turns prompt',
          maxTurns: 0,
        },
        malformedTurns: {
          description: 'Use for malformed maxTurns SDK coverage',
          prompt: 'malformed turns prompt',
          maxTurns: '2' as unknown as number,
        },
        missingDescription: {
          prompt: 'missing description prompt',
          maxSteps: 3,
        } as unknown as {
          description: string
          prompt: string
          maxSteps: number
        },
        missingPrompt: {
          maxSteps: 3,
        } as unknown as {
          description: string
          prompt: string
          maxSteps: number
        },
        broken: {
          description: 'Use for broken SDK agent coverage',
          prompt: 2 as unknown as string,
        },
        scalar: 'not an object',
        array: [],
        nullish: null,
      },
      (name, error) => failures.push({ name, error }),
    )

    expect(agents.map(agent => agent.agentType)).toEqual([
      'valid',
      'zero',
      'malformed',
      'negative',
      'fractional',
      'invalidTurns',
      'malformedTurns',
      'missingDescription',
    ])
    expect(agents.find(agent => agent.agentType === 'valid')?.maxSteps).toBe(2)
    expect(agents.find(agent => agent.agentType === 'valid')?.maxTurns).toBe(4)
    expect(
      agents.find(agent => agent.agentType === 'zero')?.maxSteps,
    ).toBeUndefined()
    expect(
      agents.find(agent => agent.agentType === 'malformed')?.maxSteps,
    ).toBeUndefined()
    expect(
      agents.find(agent => agent.agentType === 'negative')?.maxSteps,
    ).toBeUndefined()
    expect(
      agents.find(agent => agent.agentType === 'fractional')?.maxSteps,
    ).toBeUndefined()
    expect(
      agents.find(agent => agent.agentType === 'invalidTurns')?.maxTurns,
    ).toBeUndefined()
    expect(
      agents.find(agent => agent.agentType === 'malformedTurns')?.maxTurns,
    ).toBeUndefined()
    expect(
      agents.find(agent => agent.agentType === 'missingDescription'),
    ).toMatchObject({
      whenToUse: 'missingDescription',
      maxSteps: 3,
    })
    expect(
      agents
        .find(agent => agent.agentType === 'missingDescription')
        ?.getSystemPrompt(),
    ).toBe('missing description prompt')
    expect(failures.map(failure => failure.name)).toEqual([
      'missingPrompt',
      'broken',
      'scalar',
      'array',
      'nullish',
    ])
    expect(
      failures.find(failure => failure.name === 'missingPrompt')?.error,
    ).toContain('prompt')
    expect(failures.find(failure => failure.name === 'broken')?.error).toContain(
      'prompt',
    )
    expect(
      failures
        .filter(failure => ['scalar', 'array', 'nullish'].includes(failure.name))
        .map(failure => failure.error),
    ).toEqual([
      'Agent definition must be an object',
      'Agent definition must be an object',
      'Agent definition must be an object',
    ])
  })
})
