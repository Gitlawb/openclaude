export type GoalStatus = 'active' | 'paused' | 'achieved' | 'cleared'

export type GoalDecision = 'complete' | 'incomplete' | 'malformed' | 'error'

export type GoalState = {
  id: string
  condition: string
  status: GoalStatus
  createdAt: string
  updatedAt: string
  startedAt: string
  turnCount: number
  maxTurns: number
  lastEvaluatedMessageUuid?: string
  lastDecision?: GoalDecision
  lastReason?: string
  lastNextInstruction?: string
  evaluatorFailures: number
  achievedAt?: string
  clearedAt?: string
  pausedAt?: string
  resumedAt?: string
}

export type GoalEvaluatorDecision = {
  complete: boolean
  confidence: number
  decision: GoalDecision
  reason: string
  nextInstruction: string | null
  raw?: string
}
