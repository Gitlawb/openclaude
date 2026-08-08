// Shared FNV-1a hash + deterministic pick for buddy flavor content (names,
// canned reactions). companion.ts keeps its OWN hash with a Bun fast path —
// its output seeds the persisted companion roll and must never change; these
// helpers only seed ephemeral or hatch-time flavor picks.

export function fnvHash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function pickDeterministic<T>(items: readonly T[], seed: string): T {
  return items[fnvHash(seed) % items.length]!
}
