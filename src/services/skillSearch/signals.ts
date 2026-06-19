// Stub — skillSearch not included in source snapshot (feature-gated).
// Only the DiscoverySignal type is consumed (in the skill_discovery
// attachment); it is erased at compile time.

/**
 * What triggered a skill-discovery pass. Open string union — known members
 * are listed for readability, but the field is telemetry-only.
 */
export type DiscoverySignal =
  | 'user_input'
  | 'assistant_turn'
  | 'write_pivot'
  | 'subagent_spawn'
  | (string & {})
