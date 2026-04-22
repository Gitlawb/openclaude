// @ts-nocheck
/**
 * Checkpoint Manager — gemini-cli style session save/restore
 * Save session state (messages, tools, context) to disk for recovery.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'

export interface Checkpoint {
  id: string
  name: string
  timestamp: number
  messages: unknown[]
  context: Record<string, unknown>
  metadata: {
    messageCount: number
    totalTokens: number
    provider: string
    model: string
    tags: string[]
  }
}

export interface CheckpointManagerConfig {
  checkpointDir?: string
  maxCheckpoints?: number
  autoSave?: boolean
  autoSaveInterval?: number
}

const DEFAULT_CONFIG = {
  checkpointDir: resolve(process.env.HOME ?? '~', '.config/openclaude/checkpoints'),
  maxCheckpoints: 50,
  autoSave: true,
  autoSaveInterval: 60000, // 1 minute
}

export class CheckpointManager {
  private config: Required<CheckpointManagerConfig>
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: Partial<CheckpointManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<CheckpointManagerConfig>
    mkdirSync(this.config.checkpointDir, { recursive: true })
  }

  /** Save a checkpoint */
  save(name: string, messages: unknown[], context: Record<string, unknown> = {}, metadata: Checkpoint['metadata']): string {
    const id = `ckpt_${Date.now()}`
    const checkpoint: Checkpoint = {
      id,
      name,
      timestamp: Date.now(),
      messages,
      context,
      metadata,
    }
    const file = this.checkpointFile(id)
    writeFileSync(file, JSON.stringify(checkpoint, null, 2), 'utf8')
    this.pruneOld()
    return id
  }

  /** Load a checkpoint */
  load(id: string): Checkpoint | null {
    const file = this.checkpointFile(id)
    if (!existsSync(file)) return null
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Checkpoint
    } catch {
      return null
    }
  }

  /** List all checkpoints */
  list(): Checkpoint[] {
    const dir = this.config.checkpointDir
    if (!existsSync(dir)) return []
    const files = (() => { try { return require('fs').readdirSync(dir).filter(f => f.endsWith('.json')) } catch { return [] } })()
    const checkpoints: Checkpoint[] = []
    for (const file of files) {
      try {
        const ckpt = JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as Checkpoint
        checkpoints.push(ckpt)
      } catch { /* skip invalid */ }
    }
    return checkpoints.sort((a, b) => b.timestamp - a.timestamp)
  }

  /** Delete a checkpoint */
  delete(id: string): boolean {
    const file = this.checkpointFile(id)
    if (!existsSync(file)) return false
    try {
      require('fs').unlinkSync(file)
      return true
    } catch {
      return false
    }
  }

  /** Start auto-save timer */
  startAutoSave(getState: () => { messages: unknown[]; context: Record<string, unknown>; metadata: Checkpoint['metadata'] }, name?: string) {
    if (this.autoSaveTimer) clearInterval(this.autoSaveTimer)
    this.autoSaveTimer = setInterval(() => {
      const state = getState()
      this.save(name ?? 'autosave', state.messages, state.context, state.metadata)
    }, this.config.autoSaveInterval)
  }

  /** Stop auto-save */
  stopAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer)
      this.autoSaveTimer = null
    }
  }

  private checkpointFile(id: string): string {
    return resolve(this.config.checkpointDir, `${id}.json`)
  }

  private pruneOld() {
    const all = this.list()
    if (all.length > this.config.maxCheckpoints) {
      for (const ckpt of all.slice(this.config.maxCheckpoints)) {
        this.delete(ckpt.id)
      }
    }
  }
}

export const createCheckpointManager = (config?: Partial<CheckpointManagerConfig>) => new CheckpointManager(config)
