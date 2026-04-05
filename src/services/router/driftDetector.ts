import type { TaskPersistence } from './taskPersistence.js'

export interface DriftResult {
  drifted: boolean
  activeTask: string | null
  currentFiles: string[]
  reason: string | null
}

export class DriftDetector {
  private taskPersistence: TaskPersistence | null = null
  private recentFiles: string[] = []
  private maxRecentFiles: number = 20

  setTaskPersistence(tp: TaskPersistence): void { this.taskPersistence = tp }

  recordFileAccess(filePath: string): void {
    this.recentFiles = this.recentFiles.filter(f => f !== filePath)
    this.recentFiles.push(filePath)
    if (this.recentFiles.length > this.maxRecentFiles) {
      this.recentFiles.shift()
    }
  }

  getRecentFiles(): string[] { return [...this.recentFiles] }

  checkDrift(): DriftResult {
    if (!this.taskPersistence) {
      return { drifted: false, activeTask: null, currentFiles: this.recentFiles, reason: null }
    }

    const pending = this.taskPersistence.getPendingTasks()
    if (pending.length === 0) {
      return { drifted: false, activeTask: null, currentFiles: this.recentFiles, reason: null }
    }

    const inProgress = pending.find(t => t.status === 'in_progress')
    const activeTask = inProgress?.subject ?? pending[0]?.subject ?? null

    if (this.recentFiles.length < 3) {
      return { drifted: false, activeTask, currentFiles: this.recentFiles, reason: null }
    }

    const taskKeywords = this.extractKeywords(activeTask ?? '')
    const allTaskKeywords = new Set<string>()
    for (const t of pending) {
      for (const kw of this.extractKeywords(t.subject)) allTaskKeywords.add(kw)
    }

    const recentFileKeywords = new Set<string>()
    for (const f of this.recentFiles.slice(-5)) {
      for (const kw of this.extractPathKeywords(f)) recentFileKeywords.add(kw)
    }

    let overlap = 0
    for (const kw of recentFileKeywords) {
      if (allTaskKeywords.has(kw)) overlap++
    }

    if (recentFileKeywords.size > 0 && overlap === 0 && this.recentFiles.length >= 5) {
      return {
        drifted: true,
        activeTask,
        currentFiles: this.recentFiles.slice(-5),
        reason: `Recent files (${[...recentFileKeywords].join(', ')}) don't relate to any pending task (${[...allTaskKeywords].slice(0, 5).join(', ')})`,
      }
    }

    return { drifted: false, activeTask, currentFiles: this.recentFiles, reason: null }
  }

  reset(): void { this.recentFiles = [] }

  private extractKeywords(text: string): string[] {
    return text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
  }

  private extractPathKeywords(filePath: string): string[] {
    const parts = filePath.split('/').filter(Boolean)
    const filename = parts[parts.length - 1] ?? ''
    const nameWithoutExt = filename.replace(/\.[^.]+$/, '')
    return [
      ...parts.filter(p => p.length > 2 && !['src', 'lib', 'dist', 'node_modules', 'test', 'tests', '__tests__'].includes(p)),
      ...nameWithoutExt.replace(/([A-Z])/g, ' $1').toLowerCase().split(/[\s_-]+/).filter(w => w.length > 2),
    ]
  }
}
