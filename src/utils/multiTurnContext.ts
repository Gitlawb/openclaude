/**
 * Multi-Turn Context Tracking - Production Grade
 * 
 * Tracks context across multiple tool use cycles.
 * Preserves state between tool invocations.
 */

import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import type { Message } from '../types/message.js'

export interface TurnContext {
  turnId: string
  startTime: number
  messages: Message[]
  toolCalls: ToolCallInfo[]
  state: Map<string, unknown>
  tokens: number
}

export interface ToolCallInfo {
  id: string
  name: string
  input: Record<string, unknown>
  result?: string
  timestamp: number
}

export interface MultiTurnOptions {
  maxTurns?: number
  maxTokensPerTurn?: number
  preserveState?: boolean
}

const DEFAULT_OPTIONS: Required<MultiTurnOptions> = {
  maxTurns: 10,
  maxTokensPerTurn: 5000,
  preserveState: true,
}

let turnHistory: TurnContext[] = []
let currentTurn: TurnContext | null = null
let turnCounter = 0
let activeOptions: Required<MultiTurnOptions> = { ...DEFAULT_OPTIONS }

export function startNewTurn(): TurnContext {
  const turn: TurnContext = {
    turnId: `turn_${++turnCounter}_${Date.now()}`,
    startTime: Date.now(),
    messages: [],
    toolCalls: [],
    state: new Map(),
    tokens: 0,
  }

  if (turnHistory.length >= activeOptions.maxTurns) {
    turnHistory = turnHistory.slice(-activeOptions.maxTurns + 1)
  }

  currentTurn = turn
  turnHistory.push(turn)

  return turn
}

export function getCurrentTurn(): TurnContext | null {
  return currentTurn
}

export function addMessageToTurn(message: Message): void {
  if (!currentTurn) {
    currentTurn = startNewTurn()
  }

  const content = typeof message.message?.content === 'string'
    ? message.message.content
    : JSON.stringify(message.message?.content)

  currentTurn.messages.push(message)
  currentTurn.tokens += roughTokenCountEstimation(content)
}

export function addToolCallToTurn(toolCall: ToolCallInfo): void {
  if (!currentTurn) {
    currentTurn = startNewTurn()
  }

  currentTurn.toolCalls.push(toolCall)
}

export function setTurnState(key: string, value: unknown): void {
  if (!currentTurn) return
  currentTurn.state.set(key, value)
}

export function getTurnState<T>(key: string): T | undefined {
  if (!currentTurn) return undefined
  return currentTurn.state.get(key) as T | undefined
}

export function getTurnHistory(): TurnContext[] {
  return turnHistory
}

export function getRecentTurns(count: number): TurnContext[] {
  return turnHistory.slice(-count)
}

export function getTurnById(turnId: string): TurnContext | undefined {
  return turnHistory.find(t => t.turnId === turnId)
}

export function getCrossTurnContext(key: string): unknown[] {
  return turnHistory.map(t => t.state.get(key)).filter(v => v !== undefined)
}

export function getMultiTurnStats() {
  return {
    totalTurns: turnHistory.length,
    currentTurnActive: currentTurn !== null,
    totalTokens: turnHistory.reduce((sum, t) => sum + t.tokens, 0),
    totalToolCalls: turnHistory.reduce((sum, t) => sum + t.toolCalls.length, 0),
  }
}

export function clearTurnHistory(): void {
  turnHistory = []
  currentTurn = null
}

export function resetMultiTurnState(): void {
  clearTurnHistory()
  turnCounter = 0
}

export function createMultiTurnTracker(options: MultiTurnOptions = {}) {
  activeOptions = { ...DEFAULT_OPTIONS, ...options }
  return {
    startTurn: startNewTurn,
    getCurrentTurn,
    addMessage: addMessageToTurn,
    addToolCall: addToolCallToTurn,
    setState: (k: string, v: unknown) => setTurnState(k, v),
    getState: <T>(k: string) => getTurnState<T>(k),
    getHistory: getTurnHistory,
    getRecent: (n: number) => getRecentTurns(n),
    getStats: getMultiTurnStats,
    reset: resetMultiTurnState,
  }
}