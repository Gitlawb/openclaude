import { feature } from 'bun:bundle';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNotifications } from '../context/notifications.js';
import { useIsModalOverlayActive } from '../context/overlayContext.js';
import { useGetVoiceState, useSetVoiceState, useVoiceState } from '../context/voice.js';
import { KeyboardEvent } from '../ink/events/keyboard-event.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- backward-compat bridge until REPL wires handleKeyDown to <Box onKeyDown>
import { useInput } from '../ink.js';
import { useOptionalKeybindingContext } from '../keybindings/KeybindingContext.js';
import { keystrokesEqual } from '../keybindings/resolver.js';
import type { ParsedKeystroke } from '../keybindings/types.js';
import { normalizeFullWidthSpace } from '../utils/stringUtils.js';
import { useVoiceEnabled } from './useVoiceEnabled.js';

// Dead code elimination: conditional import for voice input hook.
/* eslint-disable @typescript-eslint/no-require-imports */
// Capture the module namespace, not the function: spyOn() mutates the module
// object, so `voiceNs.useVoice(...)` resolves to the spy even if this module
// was loaded before the spy was installed (test ordering independence).
const voiceNs: {
  useVoice: typeof import('./useVoice.js').useVoice;
} = feature('VOICE_MODE') ? require('./useVoice.js') : {
  useVoice: ({
    enabled: _e
  }: {
    onTranscript: (t: string) => void;
    enabled: boolean;
  }) => ({
    state: 'idle' as const,
    handleKeyEvent: (_fallbackMs?: number) => {}
  })
};
/* eslint-enable @typescript-eslint/no-require-imports */

// Maximum gap (ms) between key presses to count as held (auto-repeat).
// Terminal auto-repeat fires every 30-80ms; 120ms covers jitter while
// excluding normal typing speed (100-300ms between keystrokes).
const RAPID_KEY_GAP_MS = 120;

// Fallback (ms) for modifier-combo first-press activation. Must match
// FIRST_PRESS_FALLBACK_MS in useVoice.ts. Covers the max OS initial
// key-repeat delay (~2s on macOS with slider at "Long") so holding a
// modifier combo doesn't fragment into two sessions when the first
// auto-repeat arrives after the default 600ms REPEAT_FALLBACK_MS.
const MODIFIER_FIRST_PRESS_FALLBACK_MS = 2000;

// Number of rapid consecutive key events required to activate voice.
// Only applies to bare-char bindings (space, v, etc.) where a single press
// could be normal typing. Modifier combos activate on the first press.
const HOLD_THRESHOLD = 5;

// Number of rapid key events to start showing warmup feedback.
const WARMUP_THRESHOLD = 2;

// Match a KeyboardEvent against a ParsedKeystroke. Replaces the legacy
// matchesKeystroke(input, Key, ...) path which assumed useInput's raw
// `input` arg — KeyboardEvent.key holds normalized names (e.g. 'space',
// 'f9') that getKeyName() didn't handle, so modifier combos and f-keys
// silently failed to match after the onKeyDown migration (#23524).
function matchesKeyboardEvent(e: KeyboardEvent, target: ParsedKeystroke): boolean {
  // KeyboardEvent stores key names; ParsedKeystroke stores ' ' for space
  // and 'enter' for return (see parser.ts case 'space'/'return').
  const key = e.key === 'space' ? ' ' : e.key === 'return' ? 'enter' : e.key.toLowerCase();
  if (key !== target.key) return false;
  if (e.ctrl !== target.ctrl) return false;
  if (e.shift !== target.shift) return false;
  // KeyboardEvent.meta folds alt|option (terminal limitation — esc-prefix);
  // ParsedKeystroke has both alt and meta as aliases for the same thing.
  if (e.meta !== (target.alt || target.meta)) return false;
  if (e.superKey !== target.super) return false;
  return true;
}

// Hardcoded default for when there's no KeybindingProvider at all (e.g.
// headless/test contexts). NOT used when the provider exists and the
// lookup returns null — that means the user null-unbound or reassigned
// space, and falling back to space would pick a dead or conflicting key.
const DEFAULT_VOICE_KEYSTROKE: ParsedKeystroke = {
  key: ' ',
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  super: false
};
type InsertTextHandle = {
  insert: (text: string) => void;
  setInputWithCursor: (value: string, cursor: number) => void;
  cursorOffset: number;
};
type UseVoiceIntegrationArgs = {
  setInputValueRaw: React.Dispatch<React.SetStateAction<string>>;
  inputValueRef: React.RefObject<string>;
  insertTextRef: React.RefObject<InsertTextHandle | null>;
};
type InterimRange = {
  start: number;
  end: number;
};
type StripOpts = {
  // Which char to strip (the configured hold key). Defaults to space.
  char?: string;
  // Capture the voice prefix/suffix anchor at the stripped position.
  anchor?: boolean;
  // Minimum trailing count to leave behind — prevents stripping the
  // intentional warmup chars when defensively cleaning up leaks.
  floor?: number;
};
type UseVoiceIntegrationResult = {
  // Returns the number of trailing chars remaining after stripping.
  stripTrailing: (maxStrip: number, opts?: StripOpts) => number;
  // Undo the gap space and reset anchor refs after a failed voice activation.
  resetAnchor: () => void;
  handleKeyEvent: (fallbackMs?: number) => void;
  interimRange: InterimRange | null;
};
export function useVoiceIntegration({
  setInputValueRaw,
  inputValueRef,
  insertTextRef
}: UseVoiceIntegrationArgs): UseVoiceIntegrationResult {
  const {
    addNotification
  } = useNotifications();

  // Tracks the input content before/after the cursor when voice starts,
  // so interim transcripts can be inserted at the cursor position without
  // clobbering surrounding user text.
  const voicePrefixRef = useRef<string | null>(null);
  const voiceSuffixRef = useRef<string>('');
  // Tracks the last input value this hook wrote (via anchor, interim effect,
  // or handleVoiceTranscript). If inputValueRef.current diverges, the user
  // submitted or edited — both write paths bail to avoid clobbering. This is
  // the only guard that correctly handles empty-prefix-empty-suffix: a
  // startsWith('')/endsWith('') check vacuously passes, and a length check
  // can't distinguish a cleared input from a never-set one.
  const lastSetInputRef = useRef<string | null>(null);

  // Strip trailing hold-key chars (and optionally capture the voice
  // anchor). Called during warmup (to clean up chars that leaked past
  // stopImmediatePropagation — listener order is not guaranteed) and
  // on activation (with anchor=true to capture the prefix/suffix around
  // the cursor for interim transcript placement). The caller passes the
  // exact count it expects to strip so pre-existing chars at the
  // boundary are preserved (e.g. the "v" in "hav" when hold-key is "v").
  // The floor option sets a minimum trailing count to leave behind
  // (during warmup this is the count we intentionally let through, so
  // defensive cleanup only removes leaks). Returns the number of
  // trailing chars remaining after stripping. When nothing changes, no
  // state update is performed.
  const stripTrailing = useCallback((maxStrip: number, {
    char = ' ',
    anchor = false,
    floor = 0
  }: StripOpts = {}) => {
    const prev = inputValueRef.current;
    const offset = insertTextRef.current?.cursorOffset ?? prev.length;
    const beforeCursor = prev.slice(0, offset);
    const afterCursor = prev.slice(offset);
    // When the hold key is space, also count full-width spaces (U+3000)
    // that a CJK IME may have inserted for the same physical key.
    // U+3000 is BMP single-code-unit so indices align with beforeCursor.
    const scan = char === ' ' ? normalizeFullWidthSpace(beforeCursor) : beforeCursor;
    let trailing = 0;
    while (trailing < scan.length && scan[scan.length - 1 - trailing] === char) {
      trailing++;
    }
    const stripCount = Math.max(0, Math.min(trailing - floor, maxStrip));
    const remaining = trailing - stripCount;
    const stripped = beforeCursor.slice(0, beforeCursor.length - stripCount);
    // When anchoring with a non-space suffix, insert a gap space so the
    // waveform cursor sits on the gap instead of covering the first
    // suffix letter. The interim transcript effect maintains this same
    // structure (prefix + leading + interim + trailing + suffix), so
    // the gap is seamless once transcript text arrives.
    // Always overwrite on anchor — if a prior activation failed to start
    // voice (voiceState stayed 'idle'), the cleanup effect didn't fire and
    // the old anchor is stale. anchor=true is only passed on the single
    // activation call, never during recording, so overwrite is safe.
    let gap = '';
    if (anchor) {
      voicePrefixRef.current = stripped;
      voiceSuffixRef.current = afterCursor;
      if (afterCursor.length > 0 && !/^\s/.test(afterCursor)) {
        gap = ' ';
      }
    }
    const newValue = stripped + gap + afterCursor;
    if (anchor) lastSetInputRef.current = newValue;
    if (newValue === prev && stripCount === 0) return remaining;
    if (insertTextRef.current) {
      insertTextRef.current.setInputWithCursor(newValue, stripped.length);
    } else {
      setInputValueRaw(newValue);
    }
    return remaining;
  }, [setInputValueRaw, inputValueRef, insertTextRef]);

  // Undo the gap space inserted by stripTrailing(..., {anchor:true}) and
  // reset the voice prefix/suffix refs. Called when voice activation fails
  // (voiceState stays 'idle' after voiceHandleKeyEvent), so the cleanup
  // effect (voiceState useEffect below) — which only fires on voiceState transitions — can't
  // reach the stale anchor. Without this, the gap space and stale refs
  // persist in the input.
  const resetAnchor = useCallback(() => {
    const prefix = voicePrefixRef.current;
    if (prefix === null) return;
    const suffix = voiceSuffixRef.current;
    voicePrefixRef.current = null;
    voiceSuffixRef.current = '';
    const restored = prefix + suffix;
    if (insertTextRef.current) {
      insertTextRef.current.setInputWithCursor(restored, prefix.length);
    } else {
      setInputValueRaw(restored);
    }
  }, [setInputValueRaw, insertTextRef]);

  // Voice state selectors. useVoiceEnabled = user intent (settings) +
  // auth + GB kill-switch, with the auth half memoized on authVersion so
  // render loops never hit a cold keychain spawn.
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  const voiceEnabled = feature('VOICE_MODE') ? useVoiceEnabled() : false;
  const voiceState = feature('VOICE_MODE') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useVoiceState(s => s.voiceState) : 'idle' as const;
  const voiceInterimTranscript = feature('VOICE_MODE') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useVoiceState(s_0 => s_0.voiceInterimTranscript) : '';

  // Set the voice anchor for focus mode (where recording starts via terminal
  // focus, not key hold). Key-hold sets the anchor in stripTrailing.
  useEffect(() => {
    if (!feature('VOICE_MODE')) return;
    if (voiceState === 'recording' && voicePrefixRef.current === null) {
      const input = inputValueRef.current;
      const offset_0 = insertTextRef.current?.cursorOffset ?? input.length;
      voicePrefixRef.current = input.slice(0, offset_0);
      voiceSuffixRef.current = input.slice(offset_0);
      lastSetInputRef.current = input;
    }
    if (voiceState === 'idle') {
      voicePrefixRef.current = null;
      voiceSuffixRef.current = '';
      lastSetInputRef.current = null;
    }
  }, [voiceState, inputValueRef, insertTextRef]);

  // Live-update the prompt input with the interim transcript as voice
  // transcribes speech. The prefix (user-typed text before the cursor) is
  // preserved and the transcript is inserted between prefix and suffix.
  useEffect(() => {
    if (!feature('VOICE_MODE')) return;
    if (voicePrefixRef.current === null) return;
    const prefix_0 = voicePrefixRef.current;
    const suffix_0 = voiceSuffixRef.current;
    // Submit race: if the input isn't what this hook last set it to, the
    // user submitted (clearing it) or edited it. voicePrefixRef is only
    // cleared on voiceState→idle, so it's still set during the 'processing'
    // window between CloseStream and WS close — this catches refined
    // TranscriptText arriving then and re-filling a cleared input.
    if (inputValueRef.current !== lastSetInputRef.current) return;
    const needsSpace = prefix_0.length > 0 && !/\s$/.test(prefix_0) && voiceInterimTranscript.length > 0;
    // Don't gate on voiceInterimTranscript.length -- when interim clears to ''
    // after handleVoiceTranscript sets the final text, the trailing space
    // between prefix and suffix must still be preserved.
    const needsTrailingSpace = suffix_0.length > 0 && !/^\s/.test(suffix_0);
    const leadingSpace = needsSpace ? ' ' : '';
    const trailingSpace = needsTrailingSpace ? ' ' : '';
    const newValue_0 = prefix_0 + leadingSpace + voiceInterimTranscript + trailingSpace + suffix_0;
    // Position cursor after the transcribed text (before suffix)
    const cursorPos = prefix_0.length + leadingSpace.length + voiceInterimTranscript.length;
    if (insertTextRef.current) {
      insertTextRef.current.setInputWithCursor(newValue_0, cursorPos);
    } else {
      setInputValueRaw(newValue_0);
    }
    lastSetInputRef.current = newValue_0;
  }, [voiceInterimTranscript, setInputValueRaw, inputValueRef, insertTextRef]);
  const handleVoiceTranscript = useCallback((text: string) => {
    if (!feature('VOICE_MODE')) return;
    const prefix_1 = voicePrefixRef.current;
    // No voice anchor — voice was reset (or never started). Nothing to do.
    if (prefix_1 === null) return;
    const suffix_1 = voiceSuffixRef.current;
    // Submit race: finishRecording() → user presses Enter (input cleared)
    // → WebSocket close → this callback fires with stale prefix/suffix.
    // If the input isn't what this hook last set (via the interim effect
    // or anchor), the user submitted or edited — don't re-fill. Comparing
    // against `text.length` would false-positive when the final is longer
    // than the interim (ASR routinely adds punctuation/corrections).
    if (inputValueRef.current !== lastSetInputRef.current) return;
    const needsSpace_0 = prefix_1.length > 0 && !/\s$/.test(prefix_1) && text.length > 0;
    const needsTrailingSpace_0 = suffix_1.length > 0 && !/^\s/.test(suffix_1) && text.length > 0;
    const leadingSpace_0 = needsSpace_0 ? ' ' : '';
    const trailingSpace_0 = needsTrailingSpace_0 ? ' ' : '';
    const newInput = prefix_1 + leadingSpace_0 + text + trailingSpace_0 + suffix_1;
    // Position cursor after the transcribed text (before suffix)
    const cursorPos_0 = prefix_1.length + leadingSpace_0.length + text.length;
    if (insertTextRef.current) {
      insertTextRef.current.setInputWithCursor(newInput, cursorPos_0);
    } else {
      setInputValueRaw(newInput);
    }
    lastSetInputRef.current = newInput;
    // Update the prefix to include this chunk so focus mode can continue
    // appending subsequent transcripts after it.
    voicePrefixRef.current = prefix_1 + leadingSpace_0 + text;
  }, [setInputValueRaw, inputValueRef, insertTextRef]);
  const voice = voiceNs.useVoice({
    onTranscript: handleVoiceTranscript,
    onError: (message: string) => {
      addNotification({
        key: 'voice-error',
        text: message,
        color: 'error',
        priority: 'immediate',
        timeoutMs: 10_000
      });
    },
    enabled: voiceEnabled,
    focusMode: false
  });

  // Compute the character range of interim (not-yet-finalized) transcript
  // text in the input value, so the UI can dim it.
  const interimRange = useMemo((): InterimRange | null => {
    if (!feature('VOICE_MODE')) return null;
    if (voicePrefixRef.current === null) return null;
    if (voiceInterimTranscript.length === 0) return null;
    const prefix_2 = voicePrefixRef.current;
    const needsSpace_1 = prefix_2.length > 0 && !/\s$/.test(prefix_2) && voiceInterimTranscript.length > 0;
    const start = prefix_2.length + (needsSpace_1 ? 1 : 0);
    const end = start + voiceInterimTranscript.length;
    return {
      start,
      end
    };
  }, [voiceInterimTranscript]);
  return {
    stripTrailing,
    resetAnchor,
    handleKeyEvent: voice.handleKeyEvent,
    interimRange
  };
}

/**
 * Component that handles hold-to-talk voice activation.
 *
 * The activation key is configurable via keybindings (voice:pushToTalk,
 * default: space). Hold detection depends on OS auto-repeat delivering a
 * stream of events at 30-80ms intervals. Two binding types work:
 *
 * **Modifier + letter (meta+k, ctrl+x, alt+v):** Cleanest. Activates on
 * the first press — a modifier combo is unambiguous intent (can't be
 * typed accidentally), so no hold threshold applies. The letter part
 * auto-repeats while held, feeding release detection in useVoice.ts.
 * No flow-through, no stripping.
 *
 * **Bare chars (space, v, x):** Require HOLD_THRESHOLD rapid presses to
 * activate (a single space could be normal typing). The first
 * WARMUP_THRESHOLD presses flow into the input so a single press types
 * normally. Past that, rapid presses are swallowed; on activation the
 * flow-through chars are stripped. Binding "v" doesn't make "v"
 * untypable — normal typing (>120ms between keystrokes) flows through;
 * only rapid auto-repeat from a held key triggers activation.
 *
 * Known broken: modifier+space (NUL → parsed as ctrl+backtick), chords
 * (discrete sequences, no hold). Validation warns on these.
 */
export function useVoiceKeybindingHandler({
  voiceHandleKeyEvent,
  stripTrailing,
  resetAnchor,
  isActive
}: {
  voiceHandleKeyEvent: (fallbackMs?: number) => void;
  stripTrailing: (maxStrip: number, opts?: StripOpts) => number;
  resetAnchor: () => void;
  isActive: boolean;
}): {
  handleKeyDown: (e: KeyboardEvent) => void;
} {
  const getVoiceState = useGetVoiceState();
  const setVoiceState = useSetVoiceState();
  const keybindingContext = useOptionalKeybindingContext();
  const isModalOverlayActive = useIsModalOverlayActive();
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  const voiceEnabled = feature('VOICE_MODE') ? useVoiceEnabled() : false;
  const voiceState = feature('VOICE_MODE') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useVoiceState(s => s.voiceState) : 'idle';

  // Find the configured key for voice:pushToTalk from keybinding context.
  // Forward iteration with last-wins (matching the resolver): if a later
  // Chat binding overrides the same chord with null or a different
  // action, the voice binding is discarded and null is returned — the
  // user explicitly disabled hold-to-talk via binding override, so
  // don't second-guess them with a fallback. The DEFAULT is only used
  // when there's no provider at all. Context filter is required — space
  // is also bound in Settings/Confirmation/Plugin (select:accept etc.);
  // without the filter those would null out the default.
  const voiceKeystroke = useMemo((): ParsedKeystroke | null => {
    if (!keybindingContext) return DEFAULT_VOICE_KEYSTROKE;
    let result: ParsedKeystroke | null = null;
    for (const binding of keybindingContext.bindings) {
      if (binding.context !== 'Chat') continue;
      if (binding.chord.length !== 1) continue;
      const ks = binding.chord[0];
      if (!ks) continue;
      if (binding.action === 'voice:pushToTalk') {
        result = ks;
      } else if (result !== null && keystrokesEqual(ks, result)) {
        // A later binding overrides this chord (null unbind or reassignment)
        result = null;
      }
    }
    return result;
  }, [keybindingContext]);

  // If the binding is a bare (unmodified) single printable char, terminal
  // auto-repeat may batch N keystrokes into one input event (e.g. "vvv"),
  // and the char flows into the text input — we need flow-through + strip.
  // Modifier combos (meta+k, ctrl+x) also auto-repeat (the letter part
  // repeats) but don't insert text, so they're swallowed from the first
  // press with no stripping needed. matchesKeyboardEvent handles those.
  const bareChar = voiceKeystroke !== null && voiceKeystroke.key.length === 1 && !voiceKeystroke.ctrl && !voiceKeystroke.alt && !voiceKeystroke.shift && !voiceKeystroke.meta && !voiceKeystroke.super ? voiceKeystroke.key : null;
  const rapidCountRef = useRef(0);
  // How many rapid chars we intentionally let through to the text
  // input (the first WARMUP_THRESHOLD). The activation strip removes
  // up to this many + the activation event's potential leak. For the
  // default (space) this is precise — pre-existing trailing spaces are
  // rare. For letter bindings (validation warns) this may over-strip
  // one pre-existing char if the input already ended in the bound
  // letter (e.g. "hav" + hold "v" → "ha"). We don't track that
  // boundary — it's best-effort and the warning says so.
  const charsInInputRef = useRef(0);
  // Trailing-char count remaining after the activation strip — these
  // belong to the user's anchored prefix and must be preserved during
  // recording's defensive leak cleanup.
  const recordingFloorRef = useRef(0);
  // True when the current recording was started by key-hold (not focus).
  // Used to avoid swallowing keypresses during focus-mode recording.
  const isHoldActiveRef = useRef(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset hold state as soon as we leave 'recording'. The physical hold
  // ends when key-repeat stops (state → 'processing'); keeping the ref
  // set through 'processing' swallows new space presses the user types
  // while the transcript finalizes.
  useEffect(() => {
    if (voiceState !== 'recording') {
      isHoldActiveRef.current = false;
      rapidCountRef.current = 0;
      charsInInputRef.current = 0;
      recordingFloorRef.current = 0;
      setVoiceState(prev => {
        if (!prev.voiceWarmingUp) return prev;
        return {
          ...prev,
          voiceWarmingUp: false
        };
      });
    }
  }, [voiceState, setVoiceState]);
  const handleKeyDown = (e: KeyboardEvent): void => {
    if (!voiceEnabled) return;

    // PromptInput is not a valid transcript target — let the hold key
    // flow through instead of swallowing it into stale refs (#33556).
    // Two distinct unmount/unfocus paths (both needed):
    //   - !isActive: local-jsx command hid PromptInput (shouldHidePromptInput)
    //     without registering an overlay — e.g. /install-github-app,
    //     /plugin. Mirrors CommandKeybindingHandlers' isActive gate.
    //   - isModalOverlayActive: overlay (permission dialog, Select with
    //     onCancel) has focus; PromptInput is mounted but focus=false.
    if (!isActive || isModalOverlayActive) return;

    // null means the user overrode the default (null-unbind/reassign) —
    // hold-to-talk is disabled via binding. To toggle the feature
    // itself, use /voice.
    if (voiceKeystroke === null) return;

    // Match the configured key. Bare chars match by content (handles
    // batched auto-repeat like "vvv") with a modifier reject so e.g.
    // ctrl+v doesn't trip a "v" binding. Modifier combos go through
    // matchesKeyboardEvent (one event per repeat, no batching).
    let repeatCount: number;
    if (bareChar !== null) {
      if (e.ctrl || e.meta || e.shift) return;
      // When bound to space, also accept U+3000 (full-width space) —
      // CJK IMEs emit it for the same physical key.
      const normalized = bareChar === ' ' ? normalizeFullWidthSpace(e.key) : e.key;
      // Fast-path: normal typing (any char that isn't the bound one)
      // bails here without allocating. The repeat() check only matters
      // for batched auto-repeat (input.length > 1) which is rare.
      if (normalized[0] !== bareChar) return;
      if (normalized.length > 1 && normalized !== bareChar.repeat(normalized.length)) return;
      repeatCount = normalized.length;
    } else {
      if (!matchesKeyboardEvent(e, voiceKeystroke)) return;
      repeatCount = 1;
    }

    // Guard: only swallow keypresses when recording was triggered by
    // key-hold. Focus-mode recording also sets voiceState to 'recording',
    // but keypresses should flow through normally (voiceHandleKeyEvent
    // returns early for focus-triggered sessions). We also check voiceState
    // from the store so that if voiceHandleKeyEvent() fails to transition
    // state (module not loaded, stream unavailable) we don't permanently
    // swallow keypresses.
    const currentVoiceState = getVoiceState().voiceState;
    if (isHoldActiveRef.current && currentVoiceState !== 'idle') {
      // Already recording — swallow continued keypresses and forward
      // to voice for release detection. For bare chars, defensively
      // strip in case the text input handler fired before this one
      // (listener order is not guaranteed). Modifier combos don't
      // insert text, so nothing to strip.
      e.stopImmediatePropagation();
      if (bareChar !== null) {
        stripTrailing(repeatCount, {
          char: bareChar,
          floor: recordingFloorRef.current
        });
      }
      voiceHandleKeyEvent();
      return;
    }

    // Non-hold recording (focus-mode) or processing is active.
    // Modifier combos must not re-activate: stripTrailing(0,{anchor:true})
    // would overwrite voicePrefixRef with interim text and duplicate the
    // transcript on the next interim update. Pre-#22144, a single tap
    // hit the warmup else-branch (swallow only). Bare chars flow through
    // unconditionally — user may be typing during focus-recording.
    if (currentVoiceState !== 'idle') {
      if (bareChar === null) e.stopImmediatePropagation();
      return;
    }
    const countBefore = rapidCountRef.current;
    rapidCountRef.current += repeatCount;

    // ── Activation ────────────────────────────────────────────
    // Handled first so the warmup branch below does NOT also run
    // on this event — two strip calls in the same tick would both
    // read the stale inputValueRef and the second would under-strip.
    // Modifier combos activate on the first press — they can't be
    // typed accidentally, so the hold threshold (which exists to
    // distinguish typing a space from holding space) doesn't apply.
    if (bareChar === null || rapidCountRef.current >= HOLD_THRESHOLD) {
      e.stopImmediatePropagation();
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      rapidCountRef.current = 0;
      isHoldActiveRef.current = true;
      setVoiceState(prev_0 => {
        if (!prev_0.voiceWarmingUp) return prev_0;
        return {
          ...prev_0,
          voiceWarmingUp: false
        };
      });
      if (bareChar !== null) {
        // Strip the intentional warmup chars plus this event's leak
        // (if text input fired first). Cap covers both; min(trailing)
        // handles the no-leak case. Anchor the voice prefix here.
        // The return value (remaining) becomes the floor for
        // recording-time leak cleanup.
        recordingFloorRef.current = stripTrailing(charsInInputRef.current + repeatCount, {
          char: bareChar,
          anchor: true
        });
        charsInInputRef.current = 0;
        voiceHandleKeyEvent();
      } else {
        // Modifier combo: nothing inserted, nothing to strip. Just
        // anchor the voice prefix at the current cursor position.
        // Longer fallback: this call is at t=0 (before auto-repeat),
        // so the gap to the next keypress is the OS initial repeat
        // *delay* (up to ~2s), not the repeat *rate* (~30-80ms).
        stripTrailing(0, {
          anchor: true
        });
        voiceHandleKeyEvent(MODIFIER_FIRST_PRESS_FALLBACK_MS);
      }
      // If voice failed to transition (module not loaded, stream
      // unavailable, stale enabled), clear the ref so a later
      // focus-mode recording doesn't inherit stale hold state
      // and swallow keypresses. Store is synchronous — the check is
      // immediate. The anchor set by stripTrailing above will
      // be overwritten on retry (anchor always overwrites now).
      if (getVoiceState().voiceState === 'idle') {
        isHoldActiveRef.current = false;
        resetAnchor();
      }
      return;
    }

    // ── Warmup (bare-char only; modifier combos activated above) ──
    // First WARMUP_THRESHOLD chars flow to the text input so normal
    // typing has zero latency (a single press types normally).
    // Subsequent rapid chars are swallowed so the input stays aligned
    // with the warmup UI. Strip defensively (listener order is not
    // guaranteed — text input may have already added the char). The
    // floor preserves the intentional warmup chars; the strip is a
    // no-op when nothing leaked. Check countBefore so the event that
    // crosses the threshold still flows through (terminal batching).
    if (countBefore >= WARMUP_THRESHOLD) {
      e.stopImmediatePropagation();
      stripTrailing(repeatCount, {
        char: bareChar,
        floor: charsInInputRef.current
      });
    } else {
      charsInInputRef.current += repeatCount;
    }

    // Show warmup feedback once we detect a hold pattern
    if (rapidCountRef.current >= WARMUP_THRESHOLD) {
      setVoiceState(prev_1 => {
        if (prev_1.voiceWarmingUp) return prev_1;
        return {
          ...prev_1,
          voiceWarmingUp: true
        };
      });
    }
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout((resetTimerRef_0, rapidCountRef_0, charsInInputRef_0, setVoiceState_0) => {
      resetTimerRef_0.current = null;
      rapidCountRef_0.current = 0;
      charsInInputRef_0.current = 0;
      setVoiceState_0(prev_2 => {
        if (!prev_2.voiceWarmingUp) return prev_2;
        return {
          ...prev_2,
          voiceWarmingUp: false
        };
      });
    }, RAPID_KEY_GAP_MS, resetTimerRef, rapidCountRef, charsInInputRef, setVoiceState);
  };

  // Backward-compat bridge: REPL.tsx doesn't yet wire handleKeyDown to
  // <Box onKeyDown>. Subscribe via useInput and adapt InputEvent →
  // KeyboardEvent until the consumer is migrated (separate PR).
  // TODO(onKeyDown-migration): remove once REPL passes handleKeyDown.
  useInput((_input, _key, event) => {
    const kbEvent = new KeyboardEvent(event.keypress);
    handleKeyDown(kbEvent);
    // handleKeyDown stopped the adapter event, not the InputEvent the
    // emitter actually checks — forward it so the text input's useInput
    // listener is skipped and held spaces don't leak into the prompt.
    if (kbEvent.didStopImmediatePropagation()) {
      event.stopImmediatePropagation();
    }
  }, {
    isActive
  });
  return {
    handleKeyDown
  };
}

// TODO(onKeyDown-migration): temporary shim so existing JSX callers
// (<VoiceKeybindingHandler .../>) keep compiling. Remove once REPL.tsx
// wires handleKeyDown directly.
export function VoiceKeybindingHandler(props) {
  useVoiceKeybindingHandler(props);
  return null;
}
