export type DailyActivity = {
  date: string
  messageCount: number
  sessionCount: number
  toolCallCount: number
}

export type DailyModelTokens = {
  date: string
  tokensByModel: { [modelName: string]: number }
}

export type StreakInfo = {
  currentStreak: number
  longestStreak: number
  currentStreakStart: string | null
  longestStreakStart: string | null
  longestStreakEnd: string | null
}

export type SessionStats = {
  sessionId: string
  duration: number
  messageCount: number
  timestamp: string
}

export type ClaudeCodeStats = {
  totalSessions: number
  totalMessages: number
  totalDays: number
  activeDays: number
  streaks: StreakInfo
  dailyActivity: DailyActivity[]
  dailyModelTokens: DailyModelTokens[]
  longestSession: SessionStats | null
  modelUsage: { [modelName: string]: unknown }
}

export type StatsDateRange = '7d' | '30d' | 'all'
