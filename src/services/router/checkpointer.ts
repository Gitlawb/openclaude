import { existsSync, writeFileSync, readFileSync, readdirSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import type { EventLog } from './eventLog.js'
import type { DecisionLog } from './decisionLog.js'
import type { TaskPersistence } from './taskPersistence.js'

export interface CheckpointData {
  timestamp: string
  sessionId: string
  decisions: string[]
  completedTasks: string[]
  pendingTasks: string[]
  filesModified: string[]
  totalCost: number
  totalTokens: number
}

export class Checkpointer {
  private sessionsDir: string
  private projectDir: string
  private saveCounter: number = 0

  constructor(projectDir: string) {
    this.projectDir = projectDir
    this.sessionsDir = join(projectDir, '.openclaude', 'sessions')
    if (!existsSync(this.sessionsDir)) mkdirSync(this.sessionsDir, { recursive: true })
  }

  save(
    sessionId: string,
    eventLog: EventLog | null,
    decisionLog: DecisionLog | null,
    taskPersistence: TaskPersistence | null,
  ): string {
    const timestamp = new Date().toISOString()
    const data: CheckpointData = {
      timestamp,
      sessionId,
      decisions: decisionLog?.getDecisions().map(d => `${d.title}: ${d.choice}`) ?? [],
      completedTasks: taskPersistence?.getCompletedTasks().map(t => t.subject) ?? [],
      pendingTasks: taskPersistence?.getPendingTasks().map(t => `[${t.status}] ${t.subject}`) ?? [],
      filesModified: this.getModifiedFiles(),
      totalCost: taskPersistence?.getTotalCost() ?? 0,
      totalTokens: taskPersistence?.getTotalTokens() ?? 0,
    }

    const md = this.toMarkdown(data)
    const seq = String(++this.saveCounter).padStart(4, '0')
    const filename = `checkpoint-${timestamp.slice(0, 10)}-${timestamp.slice(11, 19).replace(/:/g, '')}-${seq}.md`
    const filePath = join(this.sessionsDir, filename)

    const tmp = filePath + '.tmp'
    writeFileSync(tmp, md)
    renameSync(tmp, filePath)

    eventLog?.emit({ event: 'checkpoint', path: filePath, session: sessionId })

    return filePath
  }

  getLatestCheckpoint(): { path: string; content: string } | null {
    if (!existsSync(this.sessionsDir)) return null
    const files = readdirSync(this.sessionsDir)
      .filter(f => f.startsWith('checkpoint-') && f.endsWith('.md'))
      .sort()
      .reverse()
    if (files.length === 0) return null
    const path = join(this.sessionsDir, files[0]!)
    return { path, content: readFileSync(path, 'utf-8') }
  }

  listCheckpoints(): string[] {
    if (!existsSync(this.sessionsDir)) return []
    return readdirSync(this.sessionsDir)
      .filter(f => f.startsWith('checkpoint-') && f.endsWith('.md'))
      .sort()
      .reverse()
  }

  private getModifiedFiles(): string[] {
    try {
      const output = execSync('git diff --name-only HEAD 2>/dev/null || echo ""', {
        cwd: this.projectDir,
        encoding: 'utf-8',
        timeout: 5000,
      })
      return output.trim().split('\n').filter(Boolean)
    } catch { return [] }
  }

  private toMarkdown(data: CheckpointData): string {
    const lines = [
      `# Session Checkpoint`,
      ``,
      `**Time:** ${data.timestamp}`,
      `**Session:** ${data.sessionId}`,
      `**Cost:** $${data.totalCost.toFixed(4)}`,
      `**Tokens:** ${data.totalTokens.toLocaleString()}`,
      ``,
    ]

    if (data.decisions.length > 0) {
      lines.push('## Decisions Made', '')
      for (const d of data.decisions) lines.push(`- ${d}`)
      lines.push('')
    }

    if (data.completedTasks.length > 0) {
      lines.push('## Work Completed', '')
      for (const t of data.completedTasks) lines.push(`- [x] ${t}`)
      lines.push('')
    }

    if (data.pendingTasks.length > 0) {
      lines.push('## Work Remaining', '')
      for (const t of data.pendingTasks) lines.push(`- [ ] ${t}`)
      lines.push('')
    }

    if (data.filesModified.length > 0) {
      lines.push('## Files Modified', '')
      for (const f of data.filesModified) lines.push(`- ${f}`)
      lines.push('')
    }

    lines.push('## Resume', '', 'To continue from this checkpoint, load pending tasks and decisions at session start.', '')

    return lines.join('\n')
  }
}
