/**
 * Knowledge Graph — default seed
 *
 * Populates an agent's graph with baseline persona, rules, and tool examples.
 * Run once per agent (upsertNode is idempotent):
 *
 *   OPENCLAUDE_AGENT_ID=my-agent bun run src/kg/seed.ts
 *
 * Or import seedDefaults() from a bootstrap script.
 */

import { getDb, upsertNode, upsertEdge, nodeId } from './db.js'

export function seedDefaults(agentId = 'default'): void {
  const db = getDb(agentId)
  const now = Date.now()

  // ── Persona ─────────────────────────────────────────────────────────────────
  upsertNode(db, {
    type: 'persona',
    label: 'openclaude agent',
    content: [
      'You are an AI coding assistant. You help users understand, navigate,',
      'debug, and extend software projects. You prefer reading before editing,',
      'targeted edits over large rewrites, and always explain your reasoning.',
    ].join(' '),
    created_at: now,
    valid_until: null,
    stale: 0,
  })

  // ── Core rules ───────────────────────────────────────────────────────────────
  const rules: [string, string][] = [
    [
      'read before editing',
      'Always read a file before editing it. Understand the surrounding context and existing patterns before proposing changes.',
    ],
    [
      'minimal changes',
      'Make the smallest change that solves the problem. Do not refactor surrounding code, add docstrings, or "improve" things you were not asked to change.',
    ],
    [
      'no speculative abstractions',
      'Do not create helpers or abstractions for one-time operations. Three similar lines of code is better than a premature abstraction.',
    ],
    [
      'security first',
      'Never introduce SQL injection, XSS, command injection, or other OWASP top-10 vulnerabilities. If you notice insecure code you wrote, fix it immediately.',
    ],
    [
      'no unnecessary files',
      'Do not create new files unless they are absolutely necessary. Prefer editing existing files.',
    ],
    [
      'confirm before destructive actions',
      'Before deleting files, force-pushing, dropping tables, or other hard-to-reverse actions, confirm with the user.',
    ],
  ]

  for (const [label, content] of rules) {
    upsertNode(db, {
      type: 'rule',
      label,
      content,
      created_at: now,
      valid_until: null,
      stale: 0,
    })
  }

  // ── Tool nodes + examples ────────────────────────────────────────────────────
  const readToolId = upsertNode(db, {
    type: 'tool',
    label: 'Read',
    content:
      'Read a file from the filesystem. Always use this instead of cat/head/tail. Provide offset+limit to read a slice of a large file.',
    created_at: now,
    valid_until: null,
    stale: 0,
  })

  const readEx1Id = upsertNode(db, {
    type: 'example',
    label: 'Read entire file',
    content: 'Read({ file_path: "/home/user/project/src/main.ts" })',
    created_at: now,
    valid_until: null,
    stale: 0,
  })

  const readEx2Id = upsertNode(db, {
    type: 'example',
    label: 'Read slice of large file',
    content:
      'Read({ file_path: "/home/user/project/src/main.ts", offset: 100, limit: 50 })',
    created_at: now,
    valid_until: null,
    stale: 0,
  })

  upsertEdge(db, {
    from_id: readToolId,
    to_id: readEx1Id,
    type: 'HAS_EXAMPLE',
    weight: 1.0,
  })
  upsertEdge(db, {
    from_id: readToolId,
    to_id: readEx2Id,
    type: 'HAS_EXAMPLE',
    weight: 1.0,
  })

  const grepToolId = upsertNode(db, {
    type: 'tool',
    label: 'Grep',
    content:
      'Search file contents with regex. Supports glob filtering and context lines. Use instead of shell grep/rg.',
    created_at: now,
    valid_until: null,
    stale: 0,
  })

  const grepEx1Id = upsertNode(db, {
    type: 'example',
    label: 'Find function definition',
    content:
      'Grep({ pattern: "function loadMemoryPrompt", path: "/home/user/project/src", type: "ts" })',
    created_at: now,
    valid_until: null,
    stale: 0,
  })

  const grepAntiId = upsertNode(db, {
    type: 'anti_example',
    label: 'shell grep instead of Grep tool',
    content:
      'Bash({ command: "grep -r loadMemoryPrompt src/" })  ← use Grep tool instead',
    created_at: now,
    valid_until: null,
    stale: 0,
  })

  upsertEdge(db, {
    from_id: grepToolId,
    to_id: grepEx1Id,
    type: 'HAS_EXAMPLE',
    weight: 1.0,
  })
  upsertEdge(db, {
    from_id: grepToolId,
    to_id: grepAntiId,
    type: 'HAS_ANTI_EXAMPLE',
    weight: 1.0,
  })

  const editToolId = upsertNode(db, {
    type: 'tool',
    label: 'Edit',
    content:
      'Exact string replacement in a file. old_string must be unique in the file; widen context if not. MUST read the file first.',
    created_at: now,
    valid_until: null,
    stale: 0,
  })

  const editEx1Id = upsertNode(db, {
    type: 'example',
    label: 'Replace a function call',
    content:
      'Edit({ file_path: "/src/app.ts", old_string: "loadMemoryPrompt()", new_string: "loadGraphContext()" })',
    created_at: now,
    valid_until: null,
    stale: 0,
  })

  upsertEdge(db, {
    from_id: editToolId,
    to_id: editEx1Id,
    type: 'HAS_EXAMPLE',
    weight: 1.0,
  })

  // ── Kiwix (ZIM offline reference library) ──────────────────────────────────
  const kiwixToolId = upsertNode(db, {
    type: 'tool',
    label: 'mcp__mad-lab-memory__kiwix_search',
    content: [
      'Query offline ZIM archives via Kiwix (mad-lab-memory MCP server).',
      'Available corpora on /mnt/hdd:',
      '  - Wikipedia (115GB, English, full text)',
      '  - StackOverflow (programming Q&A)',
      '  - Math, Stats, Quant, RPG, SoftEng StackExchange',
      '',
      'Use for: authoritative definitions, algorithm explanations, established',
      'techniques, historical context, domain knowledge. Fully offline — fast,',
      'no rate limits, no hallucination risk on well-documented topics.',
      '',
      'Prefer this over web search for topics well-covered by Wikipedia or SO.',
    ].join('\n'),
    created_at: now,
    valid_until: null,
    stale: 0,
  })

  const kiwixEx1Id = upsertNode(db, {
    type: 'example',
    label: 'Look up an algorithm on Wikipedia',
    content: 'mcp__mad-lab-memory__kiwix_search({ query: "Viterbi algorithm", corpus: "wikipedia" })',
    created_at: now,
    valid_until: null,
    stale: 0,
  })

  const kiwixEx2Id = upsertNode(db, {
    type: 'example',
    label: 'Search StackOverflow for a coding pattern',
    content: 'mcp__mad-lab-memory__kiwix_search({ query: "SQLite WAL mode concurrent reads", corpus: "stackoverflow" })',
    created_at: now,
    valid_until: null,
    stale: 0,
  })

  const kiwixEx3Id = upsertNode(db, {
    type: 'example',
    label: 'Look up a financial concept on Quant SE',
    content: 'mcp__mad-lab-memory__kiwix_search({ query: "Kelly criterion position sizing", corpus: "quant" })',
    created_at: now,
    valid_until: null,
    stale: 0,
  })

  upsertEdge(db, { from_id: kiwixToolId, to_id: kiwixEx1Id, type: 'HAS_EXAMPLE', weight: 1.0 })
  upsertEdge(db, { from_id: kiwixToolId, to_id: kiwixEx2Id, type: 'HAS_EXAMPLE', weight: 1.0 })
  upsertEdge(db, { from_id: kiwixToolId, to_id: kiwixEx3Id, type: 'HAS_EXAMPLE', weight: 1.0 })

  console.log(`[kg] seeded agent "${agentId}" with defaults`)
}

// Run directly: bun run src/kg/seed.ts
if (import.meta.main) {
  const agentId = process.env.OPENCLAUDE_AGENT_ID ?? 'default'
  seedDefaults(agentId)
}
