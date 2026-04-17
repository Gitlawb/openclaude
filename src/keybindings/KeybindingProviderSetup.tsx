import { c as _c } from "react-compiler-runtime";
/**
 * Setup utilities for integrating KeybindingProvider into the app.
 *
 * This file provides the bindings and a composed provider that can be
 * added to the app's component tree. It loads both default bindings and
 * user-defined bindings from ~/.nnc/keybindings.json, with hot-reload
 * support when the file changes.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNotifications } from '../context/notifications.js';
import type { InputEvent } from '../ink/events/input-event.js';
// ChordInterceptor intentionally uses useInput to intercept all keystrokes before
// other handlers process them - this is required for chord sequence support
// eslint-disable-next-line custom-rules/prefer-use-keybindings
import { type Key, useInput } from '../ink.js';
import { count } from '../utils/array.js';
import { logForDebugging } from '../utils/debug.js';
import { plural } from '../utils/stringUtils.js';
import { KeybindingProvider } from './KeybindingContext.js';
import { initializeKeybindingWatcher, type KeybindingsLoadResult, loadKeybindingsSyncWithWarnings, subscribeToKeybindingChanges } from './loadUserBindings.js';
import { resolveKeyWithChordState } from './resolver.js';
import type { KeybindingContextName, ParsedBinding, ParsedKeystroke } from './types.js';
import type { KeybindingWarning } from './validate.js';

/**
 * Timeout for chord sequences in milliseconds.
 * If the user doesn't complete the chord within this time, it's cancelled.
 */
const CHORD_TIMEOUT_MS = 1000;
type Props = {
  children: React.ReactNode;
};

/**
 * Keybinding provider with default + user bindings and hot-reload support.
 *
 * Usage: Wrap your app with this provider to enable keybinding support.
 *
 * ```tsx
 * <AppStateProvider>
 *   <KeybindingSetup>
 *     <REPL ... />
 *   </KeybindingSetup>
 * </AppStateProvider>
 * ```
 *
 * Features:
 * - Loads default bindings from code
 * - Merges with user bindings from ~/.nnc/keybindings.json
 * - Watches for file changes and reloads automatically (hot-reload)
 * - User bindings override defaults (later entries win)
 * - Chord support with automatic timeout
 */
/**
 * Display keybinding warnings to the user via notifications.
 * Shows a brief message pointing to /doctor for details.
 */
function useKeybindingWarnings(warnings, isReload) {
  const $ = _c(9);
  const {
    addNotification,
    removeNotification
  } = useNotifications();
  let t0;
  if ($[0] !== addNotification || $[1] !== removeNotification || $[2] !== warnings) {
    t0 = () => {
      if (warnings.length === 0) {
        removeNotification("keybinding-config-warning");
        return;
      }
      const errorCount = count(warnings, _temp);
      const warnCount = count(warnings, _temp2);
      let message;
      if (errorCount > 0 && warnCount > 0) {
        message = `Found ${errorCount} keybinding ${plural(errorCount, "error")} and ${warnCount} ${plural(warnCount, "warning")}`;
      } else {
        if (errorCount > 0) {
          message = `Found ${errorCount} keybinding ${plural(errorCount, "error")}`;
        } else {
          message = `Found ${warnCount} keybinding ${plural(warnCount, "warning")}`;
        }
      }
      message = message + " \xB7 /doctor for details";
      addNotification({
        key: "keybinding-config-warning",
        text: message,
        color: errorCount > 0 ? "error" : "warning",
        priority: errorCount > 0 ? "immediate" : "high",
        timeoutMs: 60000
      });
    };
    $[0] = addNotification;
    $[1] = removeNotification;
    $[2] = warnings;
    $[3] = t0;
  } else {
    t0 = $[3];
  }
  let t1;
  if ($[4] !== addNotification || $[5] !== isReload || $[6] !== removeNotification || $[7] !== warnings) {
    t1 = [warnings, isReload, addNotification, removeNotification];
    $[4] = addNotification;
    $[5] = isReload;
    $[6] = removeNotification;
    $[7] = warnings;
    $[8] = t1;
  } else {
    t1 = $[8];
  }
  useEffect(t0, t1);
}
function _temp2(w_0) {
  return w_0.severity === "warning";
}
function _temp(w) {
  return w.severity === "error";
}
export function KeybindingSetup({
  children
}: Props): React.ReactNode {
  // Load bindings synchronously for initial render
  const [{
    bindings,
    warnings
  }, setLoadResult] = useState<KeybindingsLoadResult>(() => {
    const result = loadKeybindingsSyncWithWarnings();
    logForDebugging(`[keybindings] KeybindingSetup initialized with ${result.bindings.length} bindings, ${result.warnings.length} warnings`);
    return result;
  });

  // Track if this is a reload (not initial load)
  const [isReload, setIsReload] = useState(false);

  // Display warnings via notifications
  useKeybindingWarnings(warnings, isReload);

  // Chord state management - use ref for immediate access, state for re-renders
  // The ref is used by resolve() to get the current value without waiting for re-render
  // The state is used to trigger re-renders when needed (e.g., for UI updates)
  const pendingChordRef = useRef<ParsedKeystroke[] | null>(null);
  const [pendingChord, setPendingChordState] = useState<ParsedKeystroke[] | null>(null);
  const chordTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Handler registry for action callbacks (used by ChordInterceptor to invoke handlers)
  const handlerRegistryRef = useRef(new Map<string, Set<{
    action: string;
    context: KeybindingContextName;
    handler: () => void;
  }>>());

  // Active context tracking for keybinding priority resolution
  // Using a ref instead of state for synchronous updates - input handlers need
  // to see the current value immediately, not after a React render cycle.
  const activeContextsRef = useRef<Set<KeybindingContextName>>(new Set());
  const registerActiveContext = useCallback((context: KeybindingContextName) => {
    activeContextsRef.current.add(context);
  }, []);
  const unregisterActiveContext = useCallback((context_0: KeybindingContextName) => {
    activeContextsRef.current.delete(context_0);
  }, []);

  // Clear chord timeout when component unmounts or chord changes
  const clearChordTimeout = useCallback(() => {
    if (chordTimeoutRef.current) {
      clearTimeout(chordTimeoutRef.current);
      chordTimeoutRef.current = null;
    }
  }, []);

  // Wrapper for setPendingChord that manages timeout and syncs ref+state
  const setPendingChord = useCallback((pending: ParsedKeystroke[] | null) => {
    clearChordTimeout();
    if (pending !== null) {
      // Set timeout to cancel chord if not completed
      chordTimeoutRef.current = setTimeout((pendingChordRef_0, setPendingChordState_0) => {
        logForDebugging('[keybindings] Chord timeout - cancelling');
        pendingChordRef_0.current = null;
        setPendingChordState_0(null);
      }, CHORD_TIMEOUT_MS, pendingChordRef, setPendingChordState);
    }

    // Update ref immediately for synchronous access in resolve()
    pendingChordRef.current = pending;
    // Update state to trigger re-renders for UI updates
    setPendingChordState(pending);
  }, [clearChordTimeout]);
  useEffect(() => {
    // Initialize file watcher (idempotent - only runs once)
    void initializeKeybindingWatcher();

    // Subscribe to changes
    const unsubscribe = subscribeToKeybindingChanges(result_0 => {
      // Any callback invocation is a reload since initial load happens
      // synchronously in useState, not via this subscription
      setIsReload(true);
      setLoadResult(result_0);
      logForDebugging(`[keybindings] Reloaded: ${result_0.bindings.length} bindings, ${result_0.warnings.length} warnings`);
    });
    return () => {
      unsubscribe();
      clearChordTimeout();
    };
  }, [clearChordTimeout]);
  return <KeybindingProvider bindings={bindings} pendingChordRef={pendingChordRef} pendingChord={pendingChord} setPendingChord={setPendingChord} activeContexts={activeContextsRef.current} registerActiveContext={registerActiveContext} unregisterActiveContext={unregisterActiveContext} handlerRegistryRef={handlerRegistryRef}>
      <ChordInterceptor bindings={bindings} pendingChordRef={pendingChordRef} setPendingChord={setPendingChord} activeContexts={activeContextsRef.current} handlerRegistryRef={handlerRegistryRef} />
      {children}
    </KeybindingProvider>;
}

/**
 * Global chord interceptor that registers useInput FIRST (before children).
 *
 * This component intercepts keystrokes that are part of chord sequences and
 * stops propagation before other handlers (like PromptInput) can see them.
 *
 * Without this, the second key of a chord (e.g., 'r' in "ctrl+c r") would be
 * captured by PromptInput and added to the input field before the keybinding
 * system could recognize it as completing a chord.
 */
type HandlerRegistration = {
  action: string;
  context: KeybindingContextName;
  handler: () => void;
};
function ChordInterceptor(t0) {
  const $ = _c(6);
  const {
    bindings,
    pendingChordRef,
    setPendingChord,
    activeContexts,
    handlerRegistryRef
  } = t0;
  let t1;
  if ($[0] !== activeContexts || $[1] !== bindings || $[2] !== handlerRegistryRef || $[3] !== pendingChordRef || $[4] !== setPendingChord) {
    t1 = (input, key, event) => {
      if ((key.wheelUp || key.wheelDown) && pendingChordRef.current === null) {
        return;
      }
      const registry = handlerRegistryRef.current;
      const handlerContexts = new Set();
      if (registry) {
        for (const handlers of registry.values()) {
          for (const registration of handlers) {
            handlerContexts.add(registration.context);
          }
        }
      }
      const contexts = [...handlerContexts, ...activeContexts, "Global"];
      const wasInChord = pendingChordRef.current !== null;
      const result = resolveKeyWithChordState(input, key, contexts, bindings, pendingChordRef.current);
      bb23: switch (result.type) {
        case "chord_started":
          {
            setPendingChord(result.pending);
            event.stopImmediatePropagation();
            break bb23;
          }
        case "match":
          {
            setPendingChord(null);
            if (wasInChord) {
              const contextsSet = new Set(contexts);
              if (registry) {
                const handlers_0 = registry.get(result.action);
                if (handlers_0 && handlers_0.size > 0) {
                  for (const registration_0 of handlers_0) {
                    if (contextsSet.has(registration_0.context)) {
                      registration_0.handler();
                      event.stopImmediatePropagation();
                      break;
                    }
                  }
                }
              }
            }
            break bb23;
          }
        case "chord_cancelled":
          {
            setPendingChord(null);
            event.stopImmediatePropagation();
            break bb23;
          }
        case "unbound":
          {
            setPendingChord(null);
            event.stopImmediatePropagation();
            break bb23;
          }
        case "none":
      }
    };
    $[0] = activeContexts;
    $[1] = bindings;
    $[2] = handlerRegistryRef;
    $[3] = pendingChordRef;
    $[4] = setPendingChord;
    $[5] = t1;
  } else {
    t1 = $[5];
  }
  const handleInput = t1;
  useInput(handleInput);
  return null;
}
