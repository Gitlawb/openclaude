import { expect, test } from 'bun:test'
import { classifyTask } from './classifier.js'

test('classifies exploration prompts as T0', () => {
  const result = classifyTask('Search for all files that import auth.ts')
  expect(result.finalTier).toBe('T0')
})

test('classifies code generation as T1', () => {
  const result = classifyTask('Create a new React component for user profile')
  expect(result.finalTier).toBe('T1')
})

test('classifies debugging as T2', () => {
  const result = classifyTask('Debug this error: TypeError Cannot read property id')
  expect(result.finalTier).toBe('T2')
})

test('classifies code review as T3', () => {
  const result = classifyTask('Review the code changes in this PR')
  expect(result.finalTier).toBe('T3')
})

test('classifies architecture prompts as T4', () => {
  const result = classifyTask('Design the database schema for the new feature')
  expect(result.finalTier).toBe('T4')
})

test('escalates sensitive keywords over task type', () => {
  const result = classifyTask('Generate code to store the API key securely')
  expect(result.finalTier).toBe('T3')
  expect(result.escalations).toContain('sensitive_data')
})

test('escalates for large context', () => {
  const result = classifyTask('Refactor this function', { contextTokens: 150000 })
  expect(result.finalTier).toBe('T3')
  expect(result.escalations).toContain('context_size_exceeds_128K')
})

test('Explore subagent type maps to T0', () => {
  const result = classifyTask('Find all TypeScript files', { subagentType: 'Explore' })
  expect(result.initialTier).toBe('T0')
})

test('detects doc need for framework mentions', () => {
  const result = classifyTask('Add a Fastify route for user registration')
  expect(result.docNeeded).toBe(true)
})

test('no doc need for generic prompts', () => {
  const result = classifyTask('Add a function that sums two numbers')
  expect(result.docNeeded).toBe(false)
})

test('defaults to T1 for unrecognized prompts', () => {
  const result = classifyTask('Do the thing with the stuff')
  expect(result.finalTier).toBe('T1')
})
