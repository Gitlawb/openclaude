import { describe, expect, test } from 'bun:test'
import { resolveAgentProvider } from './agentRouting.js'
import type { SettingsJson } from '../../utils/settings/types.js'

const baseSettings = {
  agentModels: {
    'deepseek-chat': { base_url: 'https://api.deepseek.com/v1', api_key: 'sk-ds' },
    'gpt-4o': { base_url: 'https://api.openai.com/v1', api_key: 'sk-oai' },
  },
  agentRouting: {
    Explore: 'deepseek-chat',
    'general-purpose': 'gpt-4o',
    'frontend-dev': 'deepseek-chat',
    default: 'gpt-4o',
  },
} as unknown as SettingsJson

describe('resolveAgentProvider', () => {
  // ── Priority chain ──────────────────────────────────────────

  test('name takes priority over subagentType', () => {
    const result = resolveAgentProvider('frontend-dev', 'Explore', baseSettings)
    expect(result).toEqual({
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'sk-ds',
    })
  })

  test('subagentType used when name has no match', () => {
    const result = resolveAgentProvider('unknown-name', 'Explore', baseSettings)
    expect(result).toEqual({
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'sk-ds',
    })
  })

  test('falls back to "default" when neither name nor subagentType match', () => {
    const result = resolveAgentProvider('nobody', 'unknown-type', baseSettings)
    expect(result).toEqual({
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-oai',
    })
  })

  test('returns null when no routing match and no default', () => {
    const settings = {
      agentModels: baseSettings.agentModels,
      agentRouting: { Explore: 'deepseek-chat' },
    } as unknown as SettingsJson
    const result = resolveAgentProvider('nobody', 'unknown-type', settings)
    expect(result).toBeNull()
  })

  test('returns null when name and subagentType are both undefined', () => {
    const settings = {
      agentModels: baseSettings.agentModels,
      agentRouting: { Explore: 'deepseek-chat' },
    } as unknown as SettingsJson
    const result = resolveAgentProvider(undefined, undefined, settings)
    expect(result).toBeNull()
  })

  // ── normalize() matching ────────────────────────────────────

  test('matching is case-insensitive', () => {
    const result = resolveAgentProvider(undefined, 'explore', baseSettings)
    expect(result?.model).toBe('deepseek-chat')
  })

  test('matching is case-insensitive (UPPER)', () => {
    const result = resolveAgentProvider(undefined, 'EXPLORE', baseSettings)
    expect(result?.model).toBe('deepseek-chat')
  })

  test('hyphen and underscore are equivalent', () => {
    const result = resolveAgentProvider(undefined, 'general_purpose', baseSettings)
    expect(result?.model).toBe('gpt-4o')
  })

  test('underscore in config matches hyphen in input', () => {
    const settings = {
      agentModels: baseSettings.agentModels,
      agentRouting: { general_purpose: 'deepseek-chat' },
    } as unknown as SettingsJson
    const result = resolveAgentProvider(undefined, 'general-purpose', settings)
    expect(result?.model).toBe('deepseek-chat')
  })

  // ── Edge cases ──────────────────────────────────────────────

  test('returns null when settings is null', () => {
    expect(resolveAgentProvider('Explore', 'Explore', null)).toBeNull()
  })

  test('returns null when agentRouting is missing', () => {
    const settings = { agentModels: baseSettings.agentModels } as unknown as SettingsJson
    expect(resolveAgentProvider(undefined, 'Explore', settings)).toBeNull()
  })

  test('returns null when agentModels is missing', () => {
    const settings = { agentRouting: baseSettings.agentRouting } as unknown as SettingsJson
    expect(resolveAgentProvider(undefined, 'Explore', settings)).toBeNull()
  })

  test('returns null when routing references non-existent model', () => {
    const settings = {
      agentModels: {},
      agentRouting: { Explore: 'non-existent-model' },
    } as unknown as SettingsJson
    expect(resolveAgentProvider(undefined, 'Explore', settings)).toBeNull()
  })

  test('subagentType only (no name)', () => {
    const result = resolveAgentProvider(undefined, 'Explore', baseSettings)
    expect(result?.model).toBe('deepseek-chat')
  })

  test('name only (no subagentType)', () => {
    const result = resolveAgentProvider('frontend-dev', undefined, baseSettings)
    expect(result?.model).toBe('deepseek-chat')
  })
})
