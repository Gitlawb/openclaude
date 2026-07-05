/**
 * Migrate first-party users off explicit Opus 4.0/4.1 model strings.
 *
 * No-op for non-first-party providers (the only migration target is
 * Anthropic first-party users, who are not the current provider).
 */
export function migrateLegacyOpusToCurrent(): void {
  // No-op: only applicable to first-party Anthropic users
}
