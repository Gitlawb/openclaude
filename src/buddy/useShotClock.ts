import { useState } from 'react'
import { useAnimationFrame } from '../ink.js'

// Spinner convention — see SpinnerAnimationRow's 50ms clock.
export const ACTION_BURST_INTERVAL_MS = 50

type ShotState = {
  forShotAt: number | undefined // shot token this state belongs to
  armTime: number // clock time at the render where the shot was observed
  anchor: number | null // clock time of animation start; null while arming
  done: boolean
}

/**
 * Drives a one-shot burst animation off the shared animation clock.
 * Returns elapsed ms since the shot started (0 while arming), or null when
 * idle/finished/disabled. Subscribes to the clock at 50ms only while a shot
 * is live — zero clock load otherwise.
 *
 * Arming subtlety: at the render where a new shot token is observed, `time`
 * from any other (slower) clock subscription can be one idle interval stale;
 * anchoring on it would swallow the draw phase. So the observing render only
 * arms (records armTime), and the anchor is set on the first FRESH tick
 * (time !== armTime). The sync-during-render setState mirrors the sprite's
 * existing pet-heart anchor pattern.
 */
/**
 * IMPORTANT: callers must pass `shotAt` UNCONDITIONALLY (not gated on their
 * own eligibility) and use `enabled` to suppress playback. The hook consumes
 * every token it sees — including on mount and while disabled — so a stale
 * token can never replay after a remount (prompt hidden by a tool, resize
 * across the narrow boundary) or an eligibility flip (unmute, reduced-motion
 * off, resize wider). Gating the token at the call site would hide it from
 * the disabled-consume path and resurrect exactly those replays.
 */
export function useShotClock(
  shotAt: number | undefined,
  enabled: boolean,
  totalMs: number,
): number | null {
  const [s, set] = useState<ShotState>(() => ({
    // Consume the mount-time token: whatever shot happened before this
    // component existed is history, not something to replay.
    forShotAt: shotAt,
    armTime: 0,
    anchor: null,
    done: true,
  }))
  const playable = enabled && totalMs > 0 && shotAt !== undefined
  const live = playable && (shotAt !== s.forShotAt || !s.done)
  const [, time] = useAnimationFrame(live ? ACTION_BURST_INTERVAL_MS : null)

  if (shotAt !== s.forShotAt) {
    if (playable) {
      // New shot token while eligible — arm.
      set({ forShotAt: shotAt, armTime: time, anchor: null, done: false })
    } else {
      // New token while ineligible — consume silently so it can't arm later.
      set({ forShotAt: shotAt, armTime: 0, anchor: null, done: true })
    }
  } else if (!playable && !s.done) {
    // Playback became ineligible mid-flight (mute, reduced-motion, resize
    // narrow) — consume the in-flight shot so re-enabling doesn't resume it.
    set({ ...s, anchor: null, done: true })
  } else if (live && s.anchor === null && time !== s.armTime) {
    // First fresh tick — anchor the animation start.
    set({ ...s, anchor: time })
  } else if (live && s.anchor !== null && time - s.anchor >= totalMs) {
    // Finished — unsubscribe on the next render.
    set({ ...s, done: true })
  }

  if (!live) return null
  if (s.anchor === null || shotAt !== s.forShotAt) return 0 // arming
  return Math.max(0, Math.min(totalMs, time - s.anchor))
}
