import { c as _c } from "react-compiler-runtime";
/**
 * Overlay tracking for Escape key coordination.
 *
 * This solves the problem of escape key handling when overlays (like Select with onCancel)
 * are open. The CancelRequestHandler needs to know when an overlay is active so it doesn't
 * cancel requests when the user just wants to dismiss the overlay.
 *
 * Usage:
 * 1. Call useRegisterOverlay() in any overlay component to automatically register it
 * 2. Call useIsOverlayActive() to check if any overlay is currently active
 *
 * The hook automatically registers on mount and unregisters on unmount,
 * so no manual cleanup or state management is needed.
 */
import { useContext, useEffect, useLayoutEffect } from 'react';
import instances from '../ink/instances.js';
import { AppStoreContext, useAppState } from '../state/AppState.js';

// Non-modal overlays that shouldn't disable TextInput focus
const NON_MODAL_OVERLAYS = new Set(['autocomplete']);

/**
 * Hook to register a component as an active overlay.
 * Automatically registers on mount and unregisters on unmount.
 *
 * @param id - Unique identifier for this overlay (e.g., 'select', 'multi-select')
 * @param enabled - Whether to register (default: true). Use this to conditionally register
 *                  based on component props, e.g., only register when onCancel is provided.
 *
 * @example
 * // Conditional registration based on whether cancel is supported
 * function useSelectInput({ state }) {
 *   useRegisterOverlay('select', !!state.onCancel)
 *   // ...
 * }
 */
export function useRegisterOverlay(id, t0) {
  const $ = _c(8);
  const enabled = t0 === undefined ? true : t0;
  const store = useContext(AppStoreContext);
  const setAppState = store?.setState;
  let t1;
  let t2;
  if ($[0] !== enabled || $[1] !== id || $[2] !== setAppState) {
    t1 = () => {
      if (!enabled || !setAppState) {
        return;
      }
      setAppState(prev => {
        if (prev.activeOverlays.has(id)) {
          return prev;
        }
        const next = new Set(prev.activeOverlays);
        next.add(id);
        return {
          ...prev,
          activeOverlays: next
        };
      });
      return () => {
        setAppState(prev_0 => {
          if (!prev_0.activeOverlays.has(id)) {
            return prev_0;
          }
          const next_0 = new Set(prev_0.activeOverlays);
          next_0.delete(id);
          return {
            ...prev_0,
            activeOverlays: next_0
          };
        });
      };
    };
    t2 = [id, enabled, setAppState];
    $[0] = enabled;
    $[1] = id;
    $[2] = setAppState;
    $[3] = t1;
    $[4] = t2;
  } else {
    t1 = $[3];
    t2 = $[4];
  }
  useEffect(t1, t2);
  let t3;
  let t4;
  if ($[5] !== enabled) {
    t3 = () => {
      if (!enabled) {
        return;
      }
      return _temp;
    };
    t4 = [enabled];
    $[5] = enabled;
    $[6] = t3;
    $[7] = t4;
  } else {
    t3 = $[6];
    t4 = $[7];
  }
  useLayoutEffect(t3, t4);
}

/**
 * Hook to check if any overlay is currently active.
 * This is reactive - the component will re-render when the overlay state changes.
 *
 * @returns true if any overlay is currently active
 *
 * @example
 * function CancelRequestHandler() {
 *   const isOverlayActive = useIsOverlayActive()
 *   const isActive = !isOverlayActive && canCancelRunningTask
 *   useKeybinding('chat:cancel', handleCancel, { isActive })
 * }
 */
function _temp() {
  return instances.get(process.stdout)?.invalidatePrevFrame();
}
export function useIsOverlayActive() {
  return useAppState(_temp2);
}

/**
 * Hook to check if any modal overlay is currently active.
 * Modal overlays are overlays that should capture all input (like Select dialogs).
 * Non-modal overlays (like autocomplete) don't disable TextInput focus.
 *
 * @returns true if any modal overlay is currently active
 *
 * @example
 * // Use for TextInput focus - allows typing during autocomplete
 * focus: !isSearchingHistory && !isModalOverlayActive
 */
function _temp2(s) {
  return s.activeOverlays.size > 0;
}
export function useIsModalOverlayActive() {
  return useAppState(_temp3);
}
function _temp3(s) {
  for (const id of s.activeOverlays) {
    if (!NON_MODAL_OVERLAYS.has(id)) {
      return true;
    }
  }
  return false;
}
