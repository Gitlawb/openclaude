/**
 * Knowledge Graph — admin CLI
 *
 * Usage:
 *   bun run src/kg/admin.ts list [--agent <id>] [--type <nodeType>] [--stale]
 *   bun run src/kg/admin.ts show <id> [--agent <id>]
 *   bun run src/kg/admin.ts forget <id> [--agent <id>]
 *   bun run src/kg/admin.ts wipe [--agent <id>]
 *   bun run src/kg/admin.ts render [--agent <id>] [--manifest]
 *   bun run src/kg/admin.ts seed [--agent <id>]
 */

import { getDb, getNodesByType, pruneExpired, type NodeType } from './db.js'
import { renderFullContext, renderManifest, recallNode } from './traversal.js'
import { seedDefaults } from './seed.js'

// ── CLI arg helpers ───────────────────────────────────────────────────────────

function flag(args: string[], name: string): boolean {
  return args.includes(`--${name}`)
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i !== -1 ? args[i + 1] : undefined
}

// ── Commands ──────────────────────────────────────────────────────────────────

function cmdList(agentId: string, args: string[]): void {
  const db = getDb(agentId)
  pruneExpired(db)

  const typeFilter = opt(args, 'type') as NodeType | undefined
  const includeStale = flag(args, 'stale')

  const types: NodeType[] = typeFilter
    ? [typeFilter]
    : ['persona', 'rule', 'fact', 'tool', 'example', 'anti_example']

  let total = 0
  for (const t of types) {
    const nodes = getNodesByType(db, t, includeStale)
    if (nodes.length === 0) continue
    console.log(`\n[${t}]`)
    for (const n of nodes) {
      const staleTag = n.stale ? ' ⚠stale' : ''
      const expiryTag = n.valid_until
        ? ` (expires ${new Date(n.valid_until).toISOString().slice(0, 10)})`
        : ''
      console.log(`  [m:${n.id}] ${n.label}${staleTag}${expiryTag}`)
    }
    total += nodes.length
  }
  console.log(`\n${total} node(s) — agent: ${agentId}`)
}

function cmdShow(agentId: string, id: string): void {
  const db = getDb(agentId)
  const result = recallNode(db, id)
  console.log(result)
}

function cmdForget(agentId: string, id: string): void {
  const db = getDb(agentId)
  const result = db
    .query(`UPDATE nodes SET stale = 1 WHERE id LIKE $pattern`)
    .run({ $pattern: `${id}%` })
  if (result.changes === 0) {
    console.error(`No node found matching id prefix "${id}"`)
    process.exit(1)
  }
  console.log(`Marked ${result.changes} node(s) stale.`)
}

function cmdWipe(agentId: string): void {
  const db = getDb(agentId)
  const { changes: nodes } = db.query(`DELETE FROM nodes`).run()
  const { changes: edges } = db.query(`DELETE FROM edges`).run()
  console.log(`Wiped ${nodes} nodes and ${edges} edges from agent "${agentId}".`)
}

function cmdRender(agentId: string, manifest: boolean): void {
  const db = getDb(agentId)
  pruneExpired(db)
  console.log(manifest ? renderManifest(db) : renderFullContext(db))
}

function cmdSeed(agentId: string): void {
  seedDefaults(agentId)
}

// ── Main ──────────────────────────────────────────────────────────────────────

const [, , command, ...rest] = process.argv
const agentId = opt(rest, 'agent') ?? process.env.OPENCLAUDE_AGENT_ID ?? 'default'

switch (command) {
  case 'list':
    cmdList(agentId, rest)
    break

  case 'show': {
    const id = rest.find(a => !a.startsWith('--'))
    if (!id) { console.error('Usage: admin.ts show <id>'); process.exit(1) }
    cmdShow(agentId, id)
    break
  }

  case 'forget': {
    const id = rest.find(a => !a.startsWith('--'))
    if (!id) { console.error('Usage: admin.ts forget <id>'); process.exit(1) }
    cmdForget(agentId, id)
    break
  }

  case 'wipe':
    cmdWipe(agentId)
    break

  case 'render':
    cmdRender(agentId, flag(rest, 'manifest'))
    break

  case 'seed':
    cmdSeed(agentId)
    break

  default:
    console.log(`Usage:
  list   [--agent <id>] [--type <nodeType>] [--stale]
  show   <id>          [--agent <id>]
  forget <id>          [--agent <id>]
  wipe                 [--agent <id>]
  render               [--agent <id>] [--manifest]
  seed                 [--agent <id>]`)
    process.exit(command ? 1 : 0)
}
