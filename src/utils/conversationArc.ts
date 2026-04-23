/**
 * Conversation Arc Memory - Production Grade
 * 
 * Remembers conversation goals and key decisions.
 * High-level abstraction of conversation progress.
 */

import type { Message } from '../types/message.js'

export interface ConversationArc {
  id: string
  goals: Goal[]
  decisions: Decision[]
  milestones: Milestone[]
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

function detectPhase(content: string): ConversationArc['currentPhase'] | null {
  const lower = content.toLowerCase()

  for (const [phase, keywords] of Object.entries(ARC_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) {
      return phase as ConversationArc['currentPhase']
    }
  }

  return null
}

export function updateArcPhase(messages: Message[]): void {
  const arc = getArc()
  if (!arc) return

  for (const msg of messages.slice(-5).reverse()) {
    const content = typeof msg.message?.content === 'string' ? msg.message.content : ''
    const detected = detectPhase(content)

    if (detected && detected !== arc.currentPhase) {
      const phaseOrder = ['init', 'exploring', 'implementing', 'reviewing', 'completed']
      const oldIdx = phaseOrder.indexOf(arc.currentPhase)
      const newIdx = phaseOrder.indexOf(detected)

      if (newIdx > oldIdx) {
        arc.currentPhase = detected
        arc.lastUpdateTime = Date.now()
        break
      }
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

export function getArcSummary(): string {
  const arc = getArc()
  if (!arc) return 'No conversation arc'

  const activeGoals = arc.goals.filter(g => g.status === 'active' || g.status === 'pending')
  const completedGoals = arc.goals.filter(g => g.status === 'completed')

  let summary = `Phase: ${arc.currentPhase}\n`
  summary += `Goals: ${completedGoals.length}/${arc.goals.length} completed\n`

  if (activeGoals.length > 0) {
    summary += `Active: ${activeGoals[0].description.slice(0, 50)}...\n`
  }

  if (arc.decisions.length > 0) {
    summary += `Decisions: ${arc.decisions.length}\n`
  }

  if (arc.milestones.length > 0) {
    summary += `Latest milestone: ${arc.milestones[arc.milestones.length - 1].description.slice(0, 40)}`
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