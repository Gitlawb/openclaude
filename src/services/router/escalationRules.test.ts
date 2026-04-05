import { expect, test } from 'bun:test'
import { checkEscalation } from './escalationRules.js'

test('detects API key mention and escalates to T3', () => {
  const result = checkEscalation('Store the api_key in environment variables')
  expect(result.escalated).toBe(true)
  expect(result.minTier).toBe('T3')
  expect(result.reasons).toContain('sensitive_data')
})

test('detects password mention', () => {
  const result = checkEscalation('Hash the user password before saving')
  expect(result.escalated).toBe(true)
  expect(result.minTier).toBe('T3')
})

test('detects architecture keyword and escalates to T4', () => {
  const result = checkEscalation('Design the system architecture for the new API')
  expect(result.escalated).toBe(true)
  expect(result.minTier).toBe('T4')
  expect(result.reasons).toContain('architecture')
})

test('detects security keywords and escalates to T4', () => {
  const result = checkEscalation('Check for SQL injection vulnerabilities')
  expect(result.escalated).toBe(true)
  expect(result.minTier).toBe('T4')
  expect(result.reasons).toContain('security')
})

test('picks highest tier when multiple rules match', () => {
  const result = checkEscalation('Review the architecture for credential storage vulnerabilities')
  expect(result.escalated).toBe(true)
  expect(result.minTier).toBe('T4')
  expect(result.reasons.length).toBeGreaterThanOrEqual(2)
})

test('does not escalate normal coding prompts', () => {
  const result = checkEscalation('Add a button component with onClick handler')
  expect(result.escalated).toBe(false)
  expect(result.minTier).toBeNull()
  expect(result.reasons).toEqual([])
})

test('token word triggers sensitive_data', () => {
  const result = checkEscalation('Parse the JSON token from the response')
  expect(result.escalated).toBe(true)
  expect(result.minTier).toBe('T3')
})
