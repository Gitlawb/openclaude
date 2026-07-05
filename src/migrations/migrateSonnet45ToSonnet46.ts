/**
 * Migrate Pro/Max/Team Premium first-party users off explicit Sonnet 4.5
 * model strings to the 'sonnet' alias (which now resolves to Sonnet 4.6).
 *
 * No-op for non-first-party providers (the only migration target is
 * Anthropic first-party users, who are not the current provider).
 */
export function migrateSonnet45ToSonnet46(): void {
  // No-op: only applicable to first-party Anthropic users
}
