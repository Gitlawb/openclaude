/**
 * Conversation Arc Memory - Production Grade
 *
 * Remembers conversation goals and key decisions.
 * High-level abstraction of conversation progress.
 */

import type { Message } from '../types/message.js'
import {
  addGlobalEntity,
  addGlobalRelation,
  addGlobalSummary,
  addGlobalRule,
  getGlobalGraph,
  getGlobalGraphSummary,
  getOrchestratedMemory,
  extractKeywords
} from './knowledgeGraph.js'

// ... (Goal, Decision, Milestone interfaces)

export async function finalizeArcTurn(): Promise<void> {
  const arc = getArc()
  if (!arc) return

  const completedGoals = arc.goals.filter(g => g.status === 'completed')
  const graph = getGlobalGraph()
  // Heuristic to detect new facts: entities added after arc start
  const newFacts = Object.values(graph.entities).filter(e =>
    e.id.includes(String(arc.id.split('_')[1])) ||
    graph.lastUpdateTime > arc.startTime
  )

  if (completedGoals.length === 0 && arc.decisions.length === 0 && newFacts.length === 0) return

  // Generate a concise summary of what was learned/done
  let summaryContent = `In session ${arc.id}: `
  if (completedGoals.length > 0) {
    summaryContent += `Completed goals: ${completedGoals.map(g => g.description).join(', ')}. `
  }
  if (arc.decisions.length > 0) {
    summaryContent += `Made decisions: ${arc.decisions.map(d => d.description).join(', ')}. `
  }
  if (newFacts.length > 0) {
    const uniqueFactNames = Array.from(new Set(newFacts.map(f => f.name)))
    summaryContent += `Learned about: ${uniqueFactNames.join(', ')}. `
  }

  const keywords = extractKeywords(summaryContent)
  if (keywords.length > 0) {
    await addGlobalSummary(summaryContent, keywords)
  }
}

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

let conversationArc: ConversationArc | null = null

export function initializeArc(): ConversationArc {
  conversationArc = {
    id: `arc_${Date.now()}`,
    goals: [],
    decisions: [],
    milestones: [],
    currentPhase: 'init',
    startTime: Date.now(),
    lastUpdateTime: Date.now(),
  }
  return conversationArc
}

export function getArc(): ConversationArc | null {
  if (!conversationArc) {
    initializeArc()
    // Trigger global graph load
    getGlobalGraph()
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
      .join('\\n')
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
  const arc = getArc()
  if (!arc) return

  const promises: Promise<any>[] = []

  // 1. Detect Environment Variables (KEY=VALUE)
  const envMatches = content.matchAll(/(?:export\s+)?([A-Z_]{3,})=([^\s\n"']+)/g)
  for (const match of envMatches) {
    promises.push(addGlobalEntity('environment_variable', match[1], { value: match[2] }))
  }

  // 2. Detect Absolute Paths
  const pathMatches = content.matchAll(/(\/(?:[\w.-]+\/)+[\w.-]+)/g)
  for (const match of pathMatches) {
    const path = match[1]
    if (path.length > 8 && !path.includes('node_modules') && !path.includes('://')) {
      promises.push(addGlobalEntity('path', path, { type: 'absolute' }))
    }
  }

  // 3. Detect Versions
  const versionMatches = content.matchAll(/(?:v|version\s+)(\d+\.\d+(?:\.\d+)?)/gi)
  for (const match of versionMatches) {
    promises.push(addGlobalEntity('version', match[0].toLowerCase(), { semver: match[1] }))
  }

  // 4. Detect Hostnames/URLs
  const urlMatches = content.matchAll(/(https?:\/\/[^\s\n"']+)/g)
  for (const match of urlMatches) {
    try {
      const url = new URL(match[1])
      if (url.hostname.includes('.')) {
        promises.push(addGlobalEntity('endpoint', url.hostname, { url: url.toString() }))
      }
    } catch {
      /* ignore */
    }
  }

  // 5. Detect IPv4
  const ipMatches = content.matchAll(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g)
  for (const match of ipMatches) {
    const ip = match[1]
    const context = content.toLowerCase()
    const tags: Record<string, string> = { type: 'ipv4' }

    // Contextual tagging: if 'database' or 'prod' is nearby, tag the IP
    if (context.includes('database') || context.includes('db')) tags.role = 'database'
    if (context.includes('prod')) tags.env = 'production'
    if (context.includes('worker')) tags.role = 'worker'

    promises.push(addGlobalEntity('server_ip', ip, tags))
  }

  // 6. DYNAMIC CONCEPT DISCOVERY (Improved for Doctoral precision)

  // A. Detect symbols in backticks (High confidence symbols)
  const backtickMatches = content.matchAll(/`([^`]+)`/g)
  for (const match of backtickMatches) {
    const symbol = match[1]
    if (symbol.length > 2 && symbol.length < 60) {
      promises.push(addGlobalEntity('concept', symbol, { source: 'backticks' }))
    }
  }

  // B. Detect Technical Concepts (Hyphenated-Terms, PascalCase, camelCase)
  // Now also capturing lowercase hyphenated terms (worker-node-49)
  const technicalMatches = content.matchAll(
    /\b([a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)+|[A-Z][a-z]+[A-Z][\w]*|[a-z]+[A-Z][\w]*)\b/g,
  )
  for (const match of technicalMatches) {
    const word = match[1]
    if (!['The', 'This', 'That', 'With', 'From', 'Here', 'There'].includes(word)) {
      promises.push(addGlobalEntity('concept', word, { source: 'auto_discovery' }))
    }
  }

  // C. Specific pattern for availability/percentages
  const metricMatches = content.matchAll(/(\d+(?:\.\d+)?%)/g)
  for (const match of metricMatches) {
    promises.push(addGlobalEntity('metric', match[1], { type: 'availability' }))
  }

  // D. Project Rule Detection (Passive Learning)
  const rulePatterns = [
    /\b(?:always|must|should)\s+(?:use|implement|follow)\b\s+([^.!?]+)/gi,
    /\b(?:never|cannot|should\s+not)\b\s+([^.!?]+)/gi,
    /\b(?:prefer)\b\s+([^.!?]+)/gi,
  ]
  for (const pattern of rulePatterns) {
    const ruleMatches = content.matchAll(pattern)
    for (const match of ruleMatches) {
      promises.push(addGlobalRule(match[0].trim()))
    }
  }

  // E. Direct Tech detection for UI/State
  if (content.toLowerCase().includes('redux'))
    promises.push(addGlobalEntity('technology', 'Redux', { category: 'state_management' }))
  if (content.toLowerCase().includes('react'))
    promises.push(addGlobalEntity('technology', 'React', { category: 'frontend' }))

  // F. Project File Signatures
  if (content.match(/\b([\w.-]+\.(?:xml|json|yaml|yml|gradle|toml|bazel))\b/i)) {
    const fileMatches = content.matchAll(/\b([\w.-]+\.(?:xml|json|yaml|yml|gradle|toml|bazel))\b/gi)
    for (const match of fileMatches) {
      promises.push(addGlobalEntity('project_file', match[1].toLowerCase(), { category: 'configuration' }))
    }
  }

  await Promise.all(promises)
}

export async function updateArcPhase(messages: Message[]): Promise<void> {
  const arc = getArc()
  if (!arc) return

  for (const msg of messages.slice(-5).reverse()) {
    const content = extractTextFromContent(msg.message?.content)
    if (!content) continue

    // Phase detection
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

    // Passive fact extraction (Automatic Learning)
    await extractFactsAutomatically(content)
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

  return milestone
}

export async function getArcSummary(query?: string): Promise<string> {
  const arc = getArc()
  if (!arc) return 'No conversation arc'

  const activeGoals = arc.goals.filter(g => g.status === 'active' || g.status === 'pending')
  const completedGoals = arc.goals.filter(g => g.status === 'completed')

  let summary = `Phase: ${arc.currentPhase}\\n`
  summary += `Goals: ${completedGoals.length}/${arc.goals.length} completed\\n`

  if (activeGoals.length > 0) {
    summary += `Active: ${activeGoals[0].description.slice(0, 50)}...\\n`
  }

  // 1. Primary: Targeted RAG Search (High volume context)
  summary += await getOrchestratedMemory(query || '')

  // 2. Secondary: Global Snapshot (Full Graph for small/medium projects)
  const graph = getGlobalGraph()
  const entities = Object.values(graph.entities)
  if (entities.length < 100) {
    summary += '\\n--- Full Project Knowledge Graph ---\\n'
    for (const e of entities) {
      summary += `- [${e.type}] ${e.name}: ${Object.entries(e.attributes)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}\\n`
    }
    if (graph.rules.length > 0) {
      summary += '\\nActive Project Rules:\\n'
      graph.rules.forEach(r => (summary += `- ${r}\\n`))
    }
  }

  return summary
}

export function resetArc(): void {
  conversationArc = null
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

// Re-export Knowledge Graph management through the Arc for convenience
export const addEntity = addGlobalEntity
export const addRelation = addGlobalRelation
export const getGraphSummary = getGlobalGraphSummary
