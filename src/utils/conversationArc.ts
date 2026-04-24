/**
 * Conversation Arc Memory - Production Grade
 * 
 * Remembers conversation goals and key decisions.
 * High-level abstraction of conversation progress.
 */

import type { Message } from '../types/message.js'

export interface Entity {
  id: string
  type: string // e.g., 'system', 'preference', 'credential'
  name: string // e.g., 'RHEL9', 'Jira URL'
  attributes: Record<string, string>
}

export interface Relation {
  sourceId: string
  targetId: string
  type: string // e.g., 'runs_on', 'configured_as'
}

export interface KnowledgeGraph {
  entities: Record<string, Entity>
  relations: Relation[]
}

export interface ConversationArc {
  id: string
  goals: Goal[]
  decisions: Decision[]
  milestones: Milestone[]
  knowledgeGraph: KnowledgeGraph
  currentPhase: 'init' | 'exploring' | 'implementing' | 'reviewing' | 'completed'
  startTime: number
  lastUpdateTime: number
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
    knowledgeGraph: {
      entities: {},
      relations: [],
    },
    currentPhase: 'init',
    startTime: Date.now(),
    lastUpdateTime: Date.now(),
  }
  return conversationArc
}

export function getArc(): ConversationArc | null {
  if (!conversationArc) {
    return initializeArc()
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

function extractFactsAutomatically(content: string): void {
  const arc = getArc()
  if (!arc) return

  // 1. Detect Environment Variables (KEY=VALUE)
  const envMatches = content.matchAll(/(?:export\s+)?([A-Z_]+)=([^\s\n"']+)/g)
  for (const match of envMatches) {
    addEntity('environment_variable', match[1], { value: match[2] })
  }

  // 2. Detect Absolute Paths
  const pathMatches = content.matchAll(/(\/(?:[\w.-]+\/)+[\w.-]+)/g)
  for (const match of pathMatches) {
    const path = match[1]
    if (path.length > 5 && !path.includes('node_modules')) {
      addEntity('path', path, { type: 'absolute' })
    }
  }

  // 3. Detect Versions (v1.2.3 or version 1.2.3)
  const versionMatches = content.matchAll(/(?:v|version\s+)(\d+\.\d+(?:\.\d+)?)/gi)
  for (const match of versionMatches) {
    addEntity('version', match[0], { semver: match[1] })
  }

  // 4. Detect Hostnames/URLs
  const urlMatches = content.matchAll(/(https?:\/\/[^\s\n"']+)/g)
  for (const match of urlMatches) {
    try {
      const url = new URL(match[1])
      addEntity('endpoint', url.hostname, { url: url.toString() })
    } catch {
      // Ignore invalid URLs
    }
  }
}

export function updateArcPhase(messages: Message[]): void {
  const arc = getArc()
  if (!arc) return

  for (const msg of messages.slice(-5).reverse()) {
    const content = extractTextFromContent(msg.message?.content)
    if (!content) continue

    // Phase detection
    const detected = detectPhase(content)
    if (detected && detected !== arc.currentPhase) {
      const phaseOrder = [
        'init',
        'exploring',
        'implementing',
        'reviewing',
        'completed',
      ]
      const oldIdx = phaseOrder.indexOf(arc.currentPhase)
      const newIdx = phaseOrder.indexOf(detected)

      if (newIdx > oldIdx) {
        arc.currentPhase = detected
        arc.lastUpdateTime = Date.now()
      }
    }

    // NEW: Passive fact extraction (Automatic Learning)
    extractFactsAutomatically(content)
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

export function addEntity(
  type: string,
  name: string,
  attributes: Record<string, string> = {},
): Entity {
  const arc = getArc()
  if (!arc) throw new Error('Arc not initialized')

  const id = `entity_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const entity: Entity = { id, type, name, attributes }

  arc.knowledgeGraph.entities[id] = entity
  arc.lastUpdateTime = Date.now()
  return entity
}

export function addRelation(
  sourceId: string,
  targetId: string,
  type: string,
): void {
  const arc = getArc()
  if (!arc) throw new Error('Arc not initialized')

  if (!arc.knowledgeGraph.entities[sourceId] || !arc.knowledgeGraph.entities[targetId]) {
    throw new Error('Source or target entity not found in graph')
  }

  arc.knowledgeGraph.relations.push({ sourceId, targetId, type })
  arc.lastUpdateTime = Date.now()
}

export function getGraphSummary(): string {
  const arc = getArc()
  if (!arc || Object.keys(arc.knowledgeGraph.entities).length === 0) {
    return ''
  }

  let summary = '\\nKnowledge Graph:\\n'
  for (const entity of Object.values(arc.knowledgeGraph.entities)) {
    summary += `- [${entity.type}] ${entity.name}`
    const attrs = Object.entries(entity.attributes)
    if (attrs.length > 0) {
      summary += ` (${attrs.map(([k, v]) => `${k}: ${v}`).join(', ')})`
    }
    summary += '\\n'
  }

  for (const rel of arc.knowledgeGraph.relations) {
    const src = arc.knowledgeGraph.entities[rel.sourceId]?.name
    const tgt = arc.knowledgeGraph.entities[rel.targetId]?.name
    if (src && tgt) {
      summary += `- ${src} --(${rel.type})--> ${tgt}\\n`
    }
  }

  return summary
}

export function getArcSummary(): string {
  const arc = getArc()
  if (!arc) return 'No conversation arc'

  const activeGoals = arc.goals.filter(
    g => g.status === 'active' || g.status === 'pending',
  )
  const completedGoals = arc.goals.filter(g => g.status === 'completed')

  let summary = `Phase: ${arc.currentPhase}\\n`
  summary += `Goals: ${completedGoals.length}/${arc.goals.length} completed\\n`

  if (activeGoals.length > 0) {
    summary += `Active: ${activeGoals[0].description.slice(0, 50)}...\\n`
  }

  if (arc.decisions.length > 0) {
    summary += `Decisions: ${arc.decisions.length}\\n`
  }

  if (arc.milestones.length > 0) {
    summary += `Latest milestone: ${arc.milestones[
      arc.milestones.length - 1
    ].description.slice(0, 40)}`
  }

  summary += getGraphSummary()

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