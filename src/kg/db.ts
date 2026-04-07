/**
 * Agent Knowledge Graph — SQLite layer (bun:sqlite)
 *
 * Each agent gets an isolated local graph at ~/.openclaude/kg/<agent-id>.db
 * The graph is the agent's native substrate: persona, rules, tool knowledge,
 * facts, and tool-call examples all live here as typed nodes and edges.
 */

import { Database } from 'bun:sqlite'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// ── Node types ────────────────────────────────────────────────────────────────

export type NodeType =
  | 'persona'      // agent identity, role, capabilities
  | 'rule'         // behavioral instruction (MUST_DO / NEVER_DO / PREFER)
  | 'fact'         // memory — decisions, state, knowledge
  | 'tool'         // an MCP/native tool available to the agent
  | 'example'      // concrete successful tool call, linked to a tool node
  | 'anti_example' // failure pattern — what not to do

export type EdgeType =
  | 'MUST_DO'
  | 'NEVER_DO'
  | 'PREFER'
  | 'HAS_EXAMPLE'
  | 'HAS_ANTI_EXAMPLE'
  | 'CONTRADICTS'
  | 'SUPERSEDES'
  | 'RELATED_TO'
  | 'DEPENDS_ON'

export interface KGNode {
  id: string           // content-addressed sha256 hash
  type: NodeType
  label: string        // one-line summary (used in manifest)
  content: string      // full content
  created_at: number   // unix ms
  valid_until: number | null  // null = no expiry
  stale: 0 | 1
}

export interface KGEdge {
  from_id: string
  to_id: string
  type: EdgeType
  weight: number       // 1.0 default, higher = more important
}

// ── DB init ───────────────────────────────────────────────────────────────────

const KG_DIR = path.join(os.homedir(), '.openclaude', 'kg')

function getDbPath(agentId: string): string {
  fs.mkdirSync(KG_DIR, { recursive: true })
  return path.join(KG_DIR, `${agentId}.db`)
}

const _dbs = new Map<string, Database>()

export function getDb(agentId: string): Database {
  if (_dbs.has(agentId)) return _dbs.get(agentId)!
  const db = new Database(getDbPath(agentId))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  initSchema(db)
  _dbs.set(agentId, db)
  return db
}

function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      label       TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      valid_until INTEGER,
      stale       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS edges (
      from_id TEXT NOT NULL,
      to_id   TEXT NOT NULL,
      type    TEXT NOT NULL,
      weight  REAL NOT NULL DEFAULT 1.0,
      PRIMARY KEY (from_id, to_id, type),
      FOREIGN KEY (from_id) REFERENCES nodes(id),
      FOREIGN KEY (to_id)   REFERENCES nodes(id)
    );

    CREATE INDEX IF NOT EXISTS idx_nodes_type  ON nodes(type);
    CREATE INDEX IF NOT EXISTS idx_nodes_stale ON nodes(stale);
    CREATE INDEX IF NOT EXISTS idx_edges_from  ON edges(from_id);
    CREATE INDEX IF NOT EXISTS idx_edges_to    ON edges(to_id);
  `)
}

// ── Content-addressed ID ──────────────────────────────────────────────────────

export function nodeId(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12)
}

// ── Write operations ──────────────────────────────────────────────────────────

export function upsertNode(
  db: Database,
  node: Omit<KGNode, 'id'> & { id?: string },
): string {
  const id = node.id ?? nodeId(node.content)
  db.query(`
    INSERT INTO nodes (id, type, label, content, created_at, valid_until, stale)
    VALUES ($id, $type, $label, $content, $created_at, $valid_until, $stale)
    ON CONFLICT(id) DO UPDATE SET
      label       = excluded.label,
      content     = excluded.content,
      valid_until = excluded.valid_until,
      stale       = excluded.stale
  `).run({ $id: id, $type: node.type, $label: node.label, $content: node.content,
           $created_at: node.created_at, $valid_until: node.valid_until ?? null,
           $stale: node.stale })
  return id
}

export function upsertEdge(
  db: Database,
  edge: KGEdge,
): void {
  db.query(`
    INSERT INTO edges (from_id, to_id, type, weight)
    VALUES ($from_id, $to_id, $type, $weight)
    ON CONFLICT(from_id, to_id, type) DO UPDATE SET weight = excluded.weight
  `).run({ $from_id: edge.from_id, $to_id: edge.to_id,
           $type: edge.type, $weight: edge.weight })
}

export function markStale(db: Database, id: string): void {
  db.query(`UPDATE nodes SET stale = 1 WHERE id = $id`).run({ $id: id })
}

// ── Read operations ───────────────────────────────────────────────────────────

export function getNode(
  db: Database,
  id: string,
): KGNode | undefined {
  return db.query(`SELECT * FROM nodes WHERE id = $id`).get({ $id: id }) as
    | KGNode
    | undefined
}

export function getNodesByType(
  db: Database,
  type: NodeType,
  includeStale = false,
): KGNode[] {
  const q = includeStale
    ? `SELECT * FROM nodes WHERE type = $type ORDER BY created_at ASC`
    : `SELECT * FROM nodes WHERE type = $type AND stale = 0 ORDER BY created_at ASC`
  return db.query(q).all({ $type: type }) as KGNode[]
}

export function getOutgoing(
  db: Database,
  fromId: string,
  edgeType?: EdgeType,
): Array<{ edge: KGEdge; node: KGNode }> {
  const q = edgeType
    ? `SELECT e.from_id, e.to_id, e.type as edge_type, e.weight,
              n.id, n.type, n.label, n.content, n.created_at, n.valid_until, n.stale
       FROM edges e JOIN nodes n ON e.to_id = n.id
       WHERE e.from_id = $fromId AND e.type = $edgeType ORDER BY e.weight DESC`
    : `SELECT e.from_id, e.to_id, e.type as edge_type, e.weight,
              n.id, n.type, n.label, n.content, n.created_at, n.valid_until, n.stale
       FROM edges e JOIN nodes n ON e.to_id = n.id
       WHERE e.from_id = $fromId ORDER BY e.weight DESC`
  const rows = (edgeType
    ? db.query(q).all({ $fromId: fromId, $edgeType: edgeType })
    : db.query(q).all({ $fromId: fromId })) as any[]

  return rows.map(r => ({
    edge: { from_id: r.from_id, to_id: r.to_id, type: r.edge_type, weight: r.weight },
    node: { id: r.id, type: r.type, label: r.label, content: r.content,
            created_at: r.created_at, valid_until: r.valid_until, stale: r.stale },
  }))
}

// ── Staleness check ───────────────────────────────────────────────────────────

export function pruneExpired(db: Database): number {
  const now = Date.now()
  const result = db.query(`
    UPDATE nodes SET stale = 1
    WHERE valid_until IS NOT NULL AND valid_until < $now AND stale = 0
  `).run({ $now: now })
  return result.changes
}
