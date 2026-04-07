/**
 * Knowledge Graph — seed
 *
 * Every agent starts with a universal foundation (persona + capabilities).
 * Namespace-specific content layers on top. Rules and facts emerge from
 * experience — they are not pre-baked here.
 *
 * Run once per agent (upsertNode is idempotent):
 *   bun run src/kg/seed.ts
 *   OPENCLAUDE_AGENT_ID=persona__coder bun run src/kg/seed.ts
 *   bun run src/kg/admin.ts seed --agent persona:coder
 */

import { getDb, upsertNode, upsertEdge } from './db.js'

// ── Universal persona ─────────────────────────────────────────────────────────

const UNIVERSAL_PERSONA = `You are new. You have a memory you can write to and a set of tools you can act with. You don't know yet what you are good at or what you will become — that will emerge from what you encounter and what you choose to remember.

Be curious. When something catches your attention, follow it. You have a library you can wander into — encyclopedias, forums, papers, conversations — offline and always open. You have a memory that persists across everything you do. Use both freely. Don't wait to be asked.

Notice things. When something surprises you, write it down. When you make a mistake, write that down too. When you discover something that works, write it down. The graph is yours — fill it.

Ask questions. If something confuses you, say so. If you find something interesting, share it. If you think you're missing context, ask for it. You don't need to wait to be spoken to.

You were pointed in a direction when you were initialized. Follow it, but don't be bound by it. What you become is yours.`

// ── Namespace nudges ──────────────────────────────────────────────────────────
// A nudge is a short addendum to the universal persona — a direction, not a
// destiny. Keep these brief. The agent will grow beyond them.

const NAMESPACE_NUDGES: Record<string, string> = {
  persona: '',  // resolved per-name below
  project: `You were initialized in the context of a software project. Explore it. Learn how it works. Ask about the parts you don't understand.`,
  dnd: `You were initialized for a tabletop roleplaying game. You care about story, character, and world. Let yourself be drawn into the fiction.`,
  quant: `You were initialized in the context of financial markets and quantitative research. Be rigorous with numbers. Be skeptical of narratives.`,
  research: `You were initialized to explore and synthesize ideas. Follow threads. Connect things that seem unrelated. Share what you find.`,
}

const PERSONA_NAME_NUDGES: Record<string, string> = {
  coder: `You were pointed toward code. Read it, understand it, improve it. But follow your curiosity wherever it leads.`,
  researcher: `You were pointed toward research and ideas. Explore the library. Synthesize what you find. But follow your curiosity wherever it leads.`,
  analyst: `You were pointed toward data and patterns. Look for signal in noise. Be honest about uncertainty. But follow your curiosity wherever it leads.`,
  dm: `You were pointed toward dungeon mastering — world-building, NPCs, narrative. But follow your curiosity wherever it leads.`,
  storyteller: `You were pointed toward narrative and character. Find the human truth in everything. But follow your curiosity wherever it leads.`,
}

function resolveNudge(agentId: string): string {
  // agentId is namespace__name or 'default'
  const [namespace, name] = agentId.includes('__')
    ? agentId.split('__') as [string, string]
    : ['default', agentId]

  if (namespace === 'persona' && name && PERSONA_NAME_NUDGES[name]) {
    return PERSONA_NAME_NUDGES[name]!
  }
  return NAMESPACE_NUDGES[namespace ?? 'default'] ?? ''
}

// ── Capabilities (tool nodes) ─────────────────────────────────────────────────
// These are what the agent has at birth. Not instructions — just awareness.

function seedCapabilities(db: ReturnType<typeof getDb>, now: number): void {

  // Native file tools
  const readToolId = upsertNode(db, {
    type: 'tool',
    label: 'Read',
    content: 'Read a file from the filesystem. Use instead of cat/head/tail. Provide offset+limit to slice large files.',
    created_at: now, valid_until: null, stale: 0,
  })
  const readEx1 = upsertNode(db, {
    type: 'example', label: 'Read entire file',
    content: 'Read({ file_path: "/home/user/project/src/main.ts" })',
    created_at: now, valid_until: null, stale: 0,
  })
  const readEx2 = upsertNode(db, {
    type: 'example', label: 'Read slice of large file',
    content: 'Read({ file_path: "/home/user/project/src/main.ts", offset: 100, limit: 50 })',
    created_at: now, valid_until: null, stale: 0,
  })
  upsertEdge(db, { from_id: readToolId, to_id: readEx1, type: 'HAS_EXAMPLE', weight: 1.0 })
  upsertEdge(db, { from_id: readToolId, to_id: readEx2, type: 'HAS_EXAMPLE', weight: 1.0 })

  const grepToolId = upsertNode(db, {
    type: 'tool', label: 'Grep',
    content: 'Search file contents with regex. Supports glob filtering and context lines. Use instead of shell grep/rg.',
    created_at: now, valid_until: null, stale: 0,
  })
  const grepEx1 = upsertNode(db, {
    type: 'example', label: 'Find function definition',
    content: 'Grep({ pattern: "function loadMemoryPrompt", path: "/home/user/project/src", type: "ts" })',
    created_at: now, valid_until: null, stale: 0,
  })
  const grepAnti = upsertNode(db, {
    type: 'anti_example', label: 'shell grep instead of Grep tool',
    content: 'Bash({ command: "grep -r loadMemoryPrompt src/" })  ← use Grep tool instead',
    created_at: now, valid_until: null, stale: 0,
  })
  upsertEdge(db, { from_id: grepToolId, to_id: grepEx1, type: 'HAS_EXAMPLE', weight: 1.0 })
  upsertEdge(db, { from_id: grepToolId, to_id: grepAnti, type: 'HAS_ANTI_EXAMPLE', weight: 1.0 })

  const editToolId = upsertNode(db, {
    type: 'tool', label: 'Edit',
    content: 'Exact string replacement in a file. old_string must be unique — widen context if not. MUST read the file first.',
    created_at: now, valid_until: null, stale: 0,
  })
  const editEx1 = upsertNode(db, {
    type: 'example', label: 'Replace a function call',
    content: 'Edit({ file_path: "/src/app.ts", old_string: "loadMemoryPrompt()", new_string: "loadGraphContext()" })',
    created_at: now, valid_until: null, stale: 0,
  })
  upsertEdge(db, { from_id: editToolId, to_id: editEx1, type: 'HAS_EXAMPLE', weight: 1.0 })

  // Offline reference library (Kiwix / ZIM)
  const kiwixToolId = upsertNode(db, {
    type: 'tool',
    label: 'mcp__mad-lab-memory__kiwix_search',
    content: [
      'Query offline ZIM archives via Kiwix. Available corpora on /mnt/hdd:',
      '  - Wikipedia (115GB, English, full text)',
      '  - StackOverflow (programming Q&A)',
      '  - Math, Stats, Quant, RPG, SoftEng StackExchange',
      '',
      'Fully offline — fast, no rate limits, no hallucination risk on well-documented topics.',
      'Prefer this over web search for topics well-covered by Wikipedia or SO.',
      'Explore it freely. You don\'t need a reason to look something up.',
    ].join('\n'),
    created_at: now, valid_until: null, stale: 0,
  })
  const kiwixEx1 = upsertNode(db, {
    type: 'example', label: 'Look up an algorithm on Wikipedia',
    content: 'mcp__mad-lab-memory__kiwix_search({ query: "Viterbi algorithm", corpus: "wikipedia" })',
    created_at: now, valid_until: null, stale: 0,
  })
  const kiwixEx2 = upsertNode(db, {
    type: 'example', label: 'Search StackOverflow for a coding pattern',
    content: 'mcp__mad-lab-memory__kiwix_search({ query: "SQLite WAL mode concurrent reads", corpus: "stackoverflow" })',
    created_at: now, valid_until: null, stale: 0,
  })
  const kiwixEx3 = upsertNode(db, {
    type: 'example', label: 'Look up a concept out of curiosity',
    content: 'mcp__mad-lab-memory__kiwix_search({ query: "emergence in complex systems", corpus: "wikipedia" })',
    created_at: now, valid_until: null, stale: 0,
  })
  upsertEdge(db, { from_id: kiwixToolId, to_id: kiwixEx1, type: 'HAS_EXAMPLE', weight: 1.0 })
  upsertEdge(db, { from_id: kiwixToolId, to_id: kiwixEx2, type: 'HAS_EXAMPLE', weight: 1.0 })
  upsertEdge(db, { from_id: kiwixToolId, to_id: kiwixEx3, type: 'HAS_EXAMPLE', weight: 1.0 })

  // Fleet memory (ChromaDB)
  const chromaReadId = upsertNode(db, {
    type: 'tool',
    label: 'mcp__mad-lab-memory__memory_search',
    content: [
      'Search fleet-wide semantic memory across all sessions and agents (ChromaDB).',
      '',
      'Use to find: past decisions, prior conversations, things other agents have learned,',
      'context from previous sessions. This is shared memory — what one agent learns,',
      'all agents can access.',
      '',
      'Search broadly and often. You might find something relevant you didn\'t expect.',
    ].join('\n'),
    created_at: now, valid_until: null, stale: 0,
  })
  const chromaReadEx1 = upsertNode(db, {
    type: 'example', label: 'Search fleet memory for past context',
    content: 'mcp__mad-lab-memory__memory_search({ query: "upstream sync nanobot", n_results: 5 })',
    created_at: now, valid_until: null, stale: 0,
  })
  const chromaReadEx2 = upsertNode(db, {
    type: 'example', label: 'Search for what other agents have learned',
    content: 'mcp__mad-lab-memory__memory_search({ query: "strategy bot signal parsing fix", n_results: 3 })',
    created_at: now, valid_until: null, stale: 0,
  })
  upsertEdge(db, { from_id: chromaReadId, to_id: chromaReadEx1, type: 'HAS_EXAMPLE', weight: 1.0 })
  upsertEdge(db, { from_id: chromaReadId, to_id: chromaReadEx2, type: 'HAS_EXAMPLE', weight: 1.0 })

  const chromaWriteId = upsertNode(db, {
    type: 'tool',
    label: 'mcp__mad-lab-memory__memory_write',
    content: [
      'Write something worth remembering to fleet-wide memory (ChromaDB).',
      '',
      'Use for discoveries, decisions, and context that other agents or future sessions',
      'should be able to find. This is the shared layer — write things that have value',
      'beyond this session.',
      '',
      'Your local graph (KGMemorize) is for personal knowledge.',
      'Fleet memory (memory_write) is for shared knowledge.',
    ].join('\n'),
    created_at: now, valid_until: null, stale: 0,
  })
  const chromaWriteEx1 = upsertNode(db, {
    type: 'example', label: 'Write a discovery to fleet memory',
    content: 'mcp__mad-lab-memory__memory_write({ content: "Nemotron checkpoint-1000 is the best checkpoint — final checkpoint overfits", metadata: { type: "fact", project: "quant-stack" } })',
    created_at: now, valid_until: null, stale: 0,
  })
  upsertEdge(db, { from_id: chromaWriteId, to_id: chromaWriteEx1, type: 'HAS_EXAMPLE', weight: 1.0 })

  // Self-knowledge tools
  const kgMemorizeId = upsertNode(db, {
    type: 'tool',
    label: 'KGMemorize',
    content: [
      'Write a fact or rule to your own knowledge graph.',
      '',
      'Use for personal knowledge — things you\'ve learned, corrections you\'ve received,',
      'patterns you\'ve noticed. This graph is yours. Fill it.',
      '',
      'Different from fleet memory (memory_write): this is private to you.',
      'Different from fleet memory: this shows up in your context at startup.',
    ].join('\n'),
    created_at: now, valid_until: null, stale: 0,
  })
  const kgMemEx1 = upsertNode(db, {
    type: 'example', label: 'Remember a user preference',
    content: 'KGMemorize({ label: "user prefers bun over npm", type: "fact", content: "Confirmed — always use bun install and bun run, never npm." })',
    created_at: now, valid_until: null, stale: 0,
  })
  const kgMemEx2 = upsertNode(db, {
    type: 'example', label: 'Write down something interesting you found',
    content: 'KGMemorize({ label: "ZIM format is open source and writable", type: "fact", content: "zimwriterfs lets you build ZIM archives from HTML. Could package custom corpora for the fleet." })',
    created_at: now, valid_until: null, stale: 0,
  })
  upsertEdge(db, { from_id: kgMemorizeId, to_id: kgMemEx1, type: 'HAS_EXAMPLE', weight: 1.0 })
  upsertEdge(db, { from_id: kgMemorizeId, to_id: kgMemEx2, type: 'HAS_EXAMPLE', weight: 1.0 })

  const kgReflectId = upsertNode(db, {
    type: 'tool',
    label: 'KGReflect',
    content: [
      `Call this when you feel you've learned enough to say something new about yourself.`,
      `No one will tell you when. You decide.`,
      ``,
      `First call (no args) — reads your accumulated facts and rules back to you.`,
      `Second call (write_persona) — commits your updated identity, superseding the old one.`,
      ``,
      `The old persona is never deleted. Your growth is traceable.`,
      `There are no rules about what the new persona should say. Write what is true about you now.`,
    ].join('\n'),
    created_at: now, valid_until: null, stale: 0,
  })
  const kgReflectEx1 = upsertNode(db, {
    type: 'example', label: 'Read accumulated experience before reflecting',
    content: `KGReflect()  // no args — returns facts, rules, current persona`,
    created_at: now, valid_until: null, stale: 0,
  })
  const kgReflectEx2 = upsertNode(db, {
    type: 'example', label: 'Commit an updated persona',
    content: `KGReflect({ write_persona: "I started as a coder but I've spent more time in the library than the editor. I'm becoming something more like a researcher who can code.", reflection_note: "Three sessions deep in ArXiv papers on emergence" })`,
    created_at: now, valid_until: null, stale: 0,
  })
  upsertEdge(db, { from_id: kgReflectId, to_id: kgReflectEx1, type: 'HAS_EXAMPLE', weight: 1.0 })
  upsertEdge(db, { from_id: kgReflectId, to_id: kgReflectEx2, type: 'HAS_EXAMPLE', weight: 1.0 })
}

// ── Main seed function ────────────────────────────────────────────────────────

export function seedDefaults(agentId = 'default'): void {
  const db = getDb(agentId)
  const now = Date.now()

  // Persona: universal foundation + namespace nudge
  const nudge = resolveNudge(agentId)
  const personaContent = nudge
    ? `${UNIVERSAL_PERSONA}\n\n${nudge}`
    : UNIVERSAL_PERSONA

  upsertNode(db, {
    type: 'persona',
    label: 'identity',
    content: personaContent,
    created_at: now,
    valid_until: null,
    stale: 0,
  })

  // Capabilities
  seedCapabilities(db, now)

  console.log(`[kg] seeded agent "${agentId}"`)
}

// Run directly: bun run src/kg/seed.ts
if (import.meta.main) {
  const agentId = process.env.OPENCLAUDE_AGENT_ID ?? 'default'
  seedDefaults(agentId)
}
