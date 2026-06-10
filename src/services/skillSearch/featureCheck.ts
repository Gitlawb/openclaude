// Stub — skillSearch not included in source snapshot (feature-gated).
// All call sites are behind feature('EXPERIMENTAL_SKILL_SEARCH').

/** Runtime gate for experimental skill search. Always false here. */
export function isSkillSearchEnabled(): boolean {
  return false
}
