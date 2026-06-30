/**
 * Conversation Arc Memory - Production Grade
 *
 * Remembers conversation goals and key decisions.
 * High-level abstraction of conversation progress.
 * Uses memdir sidecar file (.arc.json) instead of knowledge graph storage.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'fs'
import { join } from 'path'
import type { Message } from '../types/message.js'
import { getAutoMemPath } from '../memdir/paths.js'
import { extractFactsIntoMemdir } from '../memdir/autoExtractFacts.js'
import {
  searchMemdirIndex,
  initMemdirIndex,
  rebuildIndex,
  clearIndex,
} from '../memdir/vectorIndex.js'
import { extractKeywords } from './knowledgeGraph.js'

export interface Goal {
  id: string
  description: string
  status: 'pending' | 'active' | 'completed' | 'abandoned'
  createdAt: number
  completedAt?: number
}

export interface Decision {
  id: string
  description: string
  rationale?: string
  timestamp: number
}

export interface Milestone {
  id: string
  description: string
  achievedAt: number
}

export interface ConversationArc {
  id: string
  goals: Goal[]
  decisions: Decision[]
  milestones: Milestone[]
  currentPhase: 'init' | 'exploring' | 'implementing' | 'reviewing' | 'completed'
  startTime: number
  lastUpdateTime: number
}

const ARC_KEYWORDS = {
  init: ['start', 'begin', 'help', 'please'],
  exploring: ['check', 'find', 'look', 'what', 'how', 'where', 'show'],
  implementing: ['write', 'create', 'add', 'fix', 'update', 'modify', 'implement'],
  reviewing: ['test', 'review', 'verify', 'check', 'ensure'],
  completed: ['done', 'complete', 'finished', 'ready', 'good'],
}

const ARC_FILENAME = '.arc.json'

let conversationArc: ConversationArc | null = null
let arcMemoryDir: string | null = null

function getArcPath(memoryDir: string): string {
  return join(memoryDir, ARC_FILENAME)
}

function loadArcFromDisk(memoryDir: string): ConversationArc | null {
  const path = getArcPath(memoryDir)
  if (!existsSync(path)) return null
  try {
    const data = readFileSync(path, 'utf-8')
    return JSON.parse(data) as ConversationArc
  } catch {
    return null
  }
}

function saveArcToDisk(memoryDir: string, arc: ConversationArc): void {
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true })
  }
  arc.lastUpdateTime = Date.now()
  writeFileSync(getArcPath(memoryDir), JSON.stringify(arc, null, 2), 'utf-8')
}

export function initializeArc(memoryDir?: string): ConversationArc {
  const dir = memoryDir || getAutoMemPath()
  if (!dir) {
    conversationArc = {
      id: `arc_${Date.now()}`,
      goals: [],
      decisions: [],
      milestones: [],
      currentPhase: 'init',
      startTime: Date.now(),
      lastUpdateTime: Date.now(),
    }
    arcMemoryDir = null
    return conversationArc
  }

  const existing = loadArcFromDisk(dir)
  if (existing) {
    conversationArc = existing
    arcMemoryDir = dir
    return existing
  }

  conversationArc = {
    id: `arc_${Date.now()}`,
    goals: [],
    decisions: [],
    milestones: [],
    currentPhase: 'init',
    startTime: Date.now(),
    lastUpdateTime: Date.now(),
  }
  arcMemoryDir = dir
  saveArcToDisk(dir, conversationArc)
  return conversationArc
}

export function getArc(): ConversationArc | null {
  if (!conversationArc) {
    const dir = getAutoMemPath()
    if (dir) {
      const existing = loadArcFromDisk(dir)
      if (existing) {
        conversationArc = existing
        arcMemoryDir = dir
        return conversationArc
      }
    }
    initializeArc(dir || undefined)
  }
  return conversationArc
}

function extractTextFromContent(content: unknown): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text)
      .join('\n')
  }
  return ''
}

function detectPhase(content: string): ConversationArc['currentPhase'] | null {
  const lower = content.toLowerCase()

  for (const [phase, keywords] of Object.entries(ARC_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) {
      return phase as ConversationArc['currentPhase']
    }
  }

  return null
}

async function extractFactsAutomatically(content: string): Promise<void> {
  const dir = arcMemoryDir || getAutoMemPath()
  if (!dir) return
  const { isAutoMemoryEnabled } = await import('../memdir/paths.js')
  if (!isAutoMemoryEnabled()) return
  await extractFactsIntoMemdir(content, dir)
}

export async function updateArcPhase(messages: Message[]): Promise<void> {
  const arc = getArc()
  if (!arc) return

  for (const msg of messages.slice(-5).reverse()) {
    const content = extractTextFromContent(msg.message?.content)
    if (!content) continue

    const detected = detectPhase(content)
    if (detected && detected !== arc.currentPhase) {
      const phaseOrder = ['init', 'exploring', 'implementing', 'reviewing', 'completed']
      const oldIdx = phaseOrder.indexOf(arc.currentPhase)
      const newIdx = phaseOrder.indexOf(detected)

      if (newIdx > oldIdx) {
        arc.currentPhase = detected
        arc.lastUpdateTime = Date.now()
      }
    }

    await extractFactsAutomatically(content)
  }

  // Only persist arc state when auto-memory is enabled
  const { isAutoMemoryEnabled } = await import('../memdir/paths.js')
  if (arcMemoryDir && isAutoMemoryEnabled()) {
    saveArcToDisk(arcMemoryDir, arc)
    await rebuildIndex(arcMemoryDir).catch(() => {})
  }
}

function yamlQuote(val: string): string {
  const escaped = val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')
  return `"${escaped}"`
}

export async function finalizeArcTurn(): Promise<void> {
  const arc = getArc()
  if (!arc) return

  const completedGoals = arc.goals.filter(g => g.status === 'completed')
  const dir = arcMemoryDir

  if (completedGoals.length === 0 && arc.decisions.length === 0) return

  let summaryContent = `Session ${arc.id}: `
  if (completedGoals.length > 0) {
    summaryContent += `Completed goals: ${completedGoals.map(g => g.description).join(', ')}. `
  }
  if (arc.decisions.length > 0) {
    summaryContent += `Decisions: ${arc.decisions.map(d => d.description).join(', ')}. `
  }

  // Write summary as a memory file in the memdir
  if (dir) {
    const filename = `session-summary-${arc.id.replace(/[^a-z0-9]/gi, '-')}.md`
    const filePath = join(dir, filename)
    const now = new Date().toISOString()
    const content = `---
type: reference
title: ${yamlQuote(`Session Summary - ${arc.id}`)}
description: ${yamlQuote(summaryContent)}
sessionId: ${arc.id}
detectedAt: ${now}
phase: ${arc.currentPhase}
goalsCompleted: ${completedGoals.length}
decisionsMade: ${arc.decisions.length}
---

**Session Summary**

Phase: ${arc.currentPhase}

**Goals Completed:**
${completedGoals.map(g => `- ${g.description}`).join('\n')}

**Decisions Made:**
${arc.decisions.map(d => `- ${d.description}${d.rationale ? ` — ${d.rationale}` : ''}`).join('\n')}

**Milestones:**
${arc.milestones.map(m => `- ${m.description}`).join('\n')}
`
    try {
      writeFileSync(filePath, content, 'utf-8')
      await rebuildIndex(dir).catch(() => {})
    } catch {
      // non-fatal
    }
  }
}

export function addGoal(description: string): Goal {
  const arc = getArc()
  if (!arc) throw new Error('Arc not initialized')

  const goal: Goal = {
    id: `goal_${Date.now()}`,
    description,
    status: 'pending',
    createdAt: Date.now(),
  }

  arc.goals.push(goal)
  arc.lastUpdateTime = Date.now()

  if (arc.currentPhase === 'init') {
    arc.currentPhase = 'exploring'
  }

  if (arcMemoryDir) {
    saveArcToDisk(arcMemoryDir, arc)
  }

  return goal
}

export function updateGoalStatus(goalId: string, status: Goal['status']): void {
  const arc = getArc()
  if (!arc) return

  const goal = arc.goals.find(g => g.id === goalId)
  if (!goal) return

  goal.status = status
  if (status === 'completed') {
    goal.completedAt = Date.now()
    addMilestone(`Completed: ${goal.description}`)
  }

  arc.lastUpdateTime = Date.now()
  if (arcMemoryDir) {
    saveArcToDisk(arcMemoryDir, arc)
  }
}

export function addDecision(description: string, rationale?: string): Decision {
  const arc = getArc()
  if (!arc) throw new Error('Arc not initialized')

  const decision: Decision = {
    id: `decision_${Date.now()}`,
    description,
    rationale,
    timestamp: Date.now(),
  }

  arc.decisions.push(decision)
  arc.lastUpdateTime = Date.now()

  if (arcMemoryDir) {
    saveArcToDisk(arcMemoryDir, arc)
  }

  return decision
}

export function addMilestone(description: string): Milestone {
  const arc = getArc()
  if (!arc) throw new Error('Arc not initialized')

  const milestone: Milestone = {
    id: `milestone_${Date.now()}`,
    description,
    achievedAt: Date.now(),
  }

  arc.milestones.push(milestone)
  arc.lastUpdateTime = Date.now()

  if (arcMemoryDir) {
    saveArcToDisk(arcMemoryDir, arc)
  }

  return milestone
}

export async function getArcSummary(query?: string): Promise<string> {
  const arc = getArc()
  if (!arc) return 'No conversation arc'

  const activeGoals = arc.goals.filter(g => g.status === 'active' || g.status === 'pending')
  const completedGoals = arc.goals.filter(g => g.status === 'completed')

  let summary = `Phase: ${arc.currentPhase}\n`
  summary += `Goals: ${completedGoals.length}/${arc.goals.length} completed\n`

  if (activeGoals.length > 0) {
    summary += `Active: ${activeGoals[0].description.slice(0, 50)}...\n`
  }

  // Search the memdir vector index
  const dir = arcMemoryDir || getAutoMemPath()
  if (dir && query) {
    try {
      await initMemdirIndex(dir)
      const results = await searchMemdirIndex(query, dir, 8)
      if (results.length > 0) {
        summary += '\nRelevant Knowledge:\n'
        for (const r of results.slice(0, 5)) {
          summary += `- ${r.title}${r.description ? `: ${r.description}` : ''}\n`
        }
      }
    } catch {
      // vector search is optional
    }
  }

  return summary
}

export function resetArc(): void {
  conversationArc = null
  arcMemoryDir = null
}

export function clearArcArtifacts(memoryDir: string): void {
  if (!memoryDir || !existsSync(memoryDir)) return
  // Remove .arc.json
  const arcPath = getArcPath(memoryDir)
  if (existsSync(arcPath)) {
    try { rmSync(arcPath, { force: true }) } catch { /* ignore */ }
  }
  // Remove session-summary-* files
  try {
    for (const entry of readdirSync(memoryDir)) {
      if (entry.startsWith('session-summary-')) {
        rmSync(join(memoryDir, entry), { force: true })
      }
    }
  } catch { /* ignore */ }
  // Remove vector index artifacts and invalidate the in-memory cache
  for (const name of ['.vector-index', '.vector-index-meta.json']) {
    const p = join(memoryDir, name)
    if (existsSync(p)) {
      try { rmSync(p, { force: true }) } catch { /* ignore */ }
    }
  }
  clearIndex()
}

export function getArcStats() {
  const arc = getArc()
  if (!arc) return null

  return {
    phase: arc.currentPhase,
    goalCount: arc.goals.length,
    completedGoals: arc.goals.filter(g => g.status === 'completed').length,
    decisionCount: arc.decisions.length,
    milestoneCount: arc.milestones.length,
    durationMs: arc.lastUpdateTime - arc.startTime,
  }
}
