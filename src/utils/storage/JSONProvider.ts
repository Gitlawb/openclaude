import { readFileSync, mkdirSync, existsSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import type { KnowledgeGraph } from '../knowledgeGraph.js'
import { writeFileSyncAndFlush_DEPRECATED } from '../file.js'

/**
 * JSON Storage Provider for Knowledge Graph.
 * Serves as the durable Audit Log and Source of Truth.
 */
export class JSONProvider {
  private path: string

  constructor(projectDir: string) {
    this.path = join(projectDir, 'knowledge_graph.json')
  }

  public loadGraph(): KnowledgeGraph | null {
    if (!existsSync(this.path)) return null

    try {
      const data = JSON.parse(readFileSync(this.path, 'utf-8'))
      // Robust migration for fields
      if (!data.summaries) data.summaries = []
      if (!data.rules) data.rules = []
      return data
    } catch (e) {
      console.error(`Failed to load project graph from JSON:`, e)
      return null
    }
  }

  public saveGraph(graph: KnowledgeGraph): void {
    try {
      const dir = dirname(this.path)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      
      // Use established project utility for atomic writes with flushing
      writeFileSyncAndFlush_DEPRECATED(this.path, JSON.stringify(graph, null, 2), { encoding: 'utf-8' })
    } catch (e) {
      console.error(`Failed to save project graph to JSON:`, e)
    }
  }

  public delete(): void {
    if (existsSync(this.path)) {
      try {
        rmSync(this.path, { force: true })
      } catch {}
    }
  }
}
