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
  const { changes: edges } = db.query(`DELETE FROM edges`).run()
  const { changes: nodes } = db.query(`DELETE FROM nodes`).run()
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

// Resolve agent ID: --agent flag, or namespace:name shorthand, or env var, or default
// e.g. `admin.ts list --agent persona:coder`  →  persona__coder
function resolveAgentIdFromArgs(args: string[]): string {
  const raw = opt(args, 'agent') ?? process.env.OPENCLAUDE_AGENT_ID ?? 'default'
  // Accept namespace:name shorthand (same format as the CLI positional arg)
  return raw.replace(/^([\w-]+):([\w-]+)$/, '$1__$2')
}

const agentId = resolveAgentIdFromArgs(rest)

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
  list   [--agent <ns:name>] [--type <nodeType>] [--stale]
  show   <id>               [--agent <ns:name>]
  forget <id>               [--agent <ns:name>]
  wipe                      [--agent <ns:name>]
  render                    [--agent <ns:name>] [--manifest]
  seed                      [--agent <ns:name>]

  --agent accepts namespace:name (e.g. persona:coder, project:openclaude)
  or a raw agent ID (e.g. default).`)
    process.exit(command ? 1 : 0)
}
