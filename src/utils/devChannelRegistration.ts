import {
  type ChannelEntry,
  getAllowedChannels,
  setAllowedChannels,
  setHasDevChannels,
} from "../bootstrap/state.js";

/**
 * Register development channels, marking each entry with `dev: true` so the
 * allowlist bypass (granted by `--dangerously-load-development-channels`) is
 * scoped per-entry and cannot leak to production `--channels` entries.
 *
 * This is the shared mutation used by both branches of the dev-channels
 * dialog gate in `showSetupScreens`:
 *
 *   1. When `isChannelsEnabled()` is true — called from the
 *      `DevChannelsDialog` `onAccept` callback.
 *   2. When `isChannelsEnabled()` is false — called directly (no dialog).
 */
export function registerDevChannels(devChannels: ChannelEntry[]): void {
  // Prepend so dev-tagged entries take precedence in order-sensitive lookups
  // (e.g. findChannelEntry returns the first match). Without this, an existing
  // non-dev entry for the same server/plugin would match first and bypass the
  // dev privilege.
  setAllowedChannels([
    ...devChannels.map(c => ({ ...c, dev: true })),
    ...getAllowedChannels(),
  ]);
  setHasDevChannels(true);
}
