import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { TaskEntry, Tier } from './types.js'

let _idCounter = 0

export class TaskPersistence {
  private filePath: string
  private tasks: TaskEntry[] = []

  constructor(projectDir: string) {
    const dir = join(projectDir, '.openclaude')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, 'tasks.json')
    this.tasks = this.load()
  }

  addTask(subject: string, blockedBy: string[] = []): TaskEntry {
    const task: TaskEntry = {
      id: `t${Date.now()}_${++_idCounter}`,
      subject,
      status: 'pending',
      createdSession: new Date().toISOString(),
      completedSession: null,
      tokensUsed: 0,
      cost: 0,
      tier: null,
      blockedBy,
    }
    this.tasks.push(task)
    this.save()
    return task
  }

  updateTask(id: string, updates: Partial<Pick<TaskEntry, 'status' | 'tokensUsed' | 'cost' | 'tier' | 'completedSession'>>): TaskEntry | null {
    const task = this.tasks.find(t => t.id === id)
    if (!task) return null
    Object.assign(task, updates)
    if (updates.status === 'completed' && !task.completedSession) {
      task.completedSession = new Date().toISOString()
    }
    this.save()
    return task
  }

  completeTask(id: string, tokensUsed: number = 0, cost: number = 0, tier: Tier | null = null): TaskEntry | null {
    return this.updateTask(id, { status: 'completed', tokensUsed, cost, tier, completedSession: new Date().toISOString() })
  }

  getTask(id: string): TaskEntry | undefined {
    return this.tasks.find(t => t.id === id)
  }

  getPendingTasks(): TaskEntry[] {
    return this.tasks.filter(t => t.status === 'pending' || t.status === 'in_progress')
  }

  getCompletedTasks(): TaskEntry[] {
    return this.tasks.filter(t => t.status === 'completed')
  }

  getAllTasks(): TaskEntry[] {
    return [...this.tasks]
  }

  archiveCompleted(): number {
    const before = this.tasks.length
    this.tasks = this.tasks.filter(t => t.status !== 'completed')
    this.save()
    return before - this.tasks.length
  }

  getTotalCost(): number {
    return this.tasks.reduce((sum, t) => sum + t.cost, 0)
  }

  getTotalTokens(): number {
    return this.tasks.reduce((sum, t) => sum + t.tokensUsed, 0)
  }

  toSummary(): string {
    const pending = this.getPendingTasks()
    const completed = this.getCompletedTasks()
    const lines = [`Tasks: ${completed.length} done, ${pending.length} remaining`]
    if (pending.length > 0) {
      lines.push('Pending:')
      for (const t of pending) lines.push(`  - [${t.status}] ${t.subject}`)
    }
    return lines.join('\n')
  }

  private load(): TaskEntry[] {
    if (!existsSync(this.filePath)) return []
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf-8'))
      return data.tasks ?? []
    } catch { return [] }
  }

  private save(): void {
    try {
      const tmp = this.filePath + '.tmp'
      writeFileSync(tmp, JSON.stringify({ tasks: this.tasks }, null, 2))
      renameSync(tmp, this.filePath)
    } catch {}
  }
}
