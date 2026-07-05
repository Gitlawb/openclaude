/**
 * Migrate users who had "sonnet[1m]" saved to the explicit "sonnet-4-5-20250929[1m]".
 *
 * No-op for non-first-party providers (the only migration target is
 * Anthropic first-party users, who are not the current provider).
 */
export function migrateSonnet1mToSonnet45(): void {
  // No-op: only applicable to first-party Anthropic users
}
