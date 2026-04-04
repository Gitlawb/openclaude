import { c as _c } from "react-compiler-runtime";
/**
 * Portal for content that floats above the prompt so it escapes
 * FullscreenLayout's bottom-slot `overflowY:hidden` clip.
 *
 * The clip is load-bearing (CC-668: tall pastes squash the ScrollBox
 * without it), but floating overlays use `position:absolute
 * bottom="100%"` to float above the prompt — and Ink's clip stack
 * intersects ALL descendants, so they were clipped to ~1 row.
 *
 * Two channels:
 * - `useSetPromptOverlay` — slash-command suggestion data (structured,
 *   written by PromptInputFooter)
 * - `useSetPromptOverlayDialog` — arbitrary dialog node (e.g.
 *   AutoModeOptInDialog, written by PromptInput)
 *
 * FullscreenLayout reads both and renders them outside the clipped slot.
 *
 * Split into data/setter context pairs so writers never re-render on
 * their own writes — the setter contexts are stable.
 */
import React, { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import type { SuggestionItem } from '../components/PromptInput/PromptInputFooterSuggestions.js';
export type PromptOverlayData = {
  suggestions: SuggestionItem[];
  selectedSuggestion: number;
  maxColumnWidth?: number;
};
type Setter<T> = (d: T | null) => void;
const DataContext = createContext<PromptOverlayData | null>(null);
const SetContext = createContext<Setter<PromptOverlayData> | null>(null);
const DialogContext = createContext<ReactNode>(null);
const SetDialogContext = createContext<Setter<ReactNode> | null>(null);
export function PromptOverlayProvider(t0) {
  const $ = _c(6);
  const {
    children
  } = t0;
  const [data, setData] = useState(null);
  const [dialog, setDialog] = useState(null);
  let t1;
  if ($[0] !== children || $[1] !== dialog) {
    t1 = <DialogContext.Provider value={dialog}>{children}</DialogContext.Provider>;
    $[0] = children;
    $[1] = dialog;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  let t2;
  if ($[3] !== data || $[4] !== t1) {
    t2 = <SetContext.Provider value={setData}><SetDialogContext.Provider value={setDialog}><DataContext.Provider value={data}>{t1}</DataContext.Provider></SetDialogContext.Provider></SetContext.Provider>;
    $[3] = data;
    $[4] = t1;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  return t2;
}
export function usePromptOverlay() {
  return useContext(DataContext);
}
export function usePromptOverlayDialog() {
  return useContext(DialogContext);
}

/**
 * Register suggestion data for the floating overlay. Clears on unmount.
 * No-op outside the provider (non-fullscreen renders inline instead).
 */
export function useSetPromptOverlay(data) {
  const $ = _c(8);
  const set = useContext(SetContext);
  let t0;
  let t1;
  let t2;
  let t3;
  if ($[0] !== data || $[1] !== set) {
    t0 = () => {
      if (!set) {
        return;
      }
      set(data);
    };
    t1 = [set, data];
    $[0] = data;
    $[1] = set;
    $[2] = t0;
    $[3] = t1;
  } else {
    t0 = $[2];
    t1 = $[3];
  }
  if ($[4] !== set) {
    t2 = () => {
      if (!set) {
        return;
      }
      return () => set(null);
    };
    t3 = [set];
    $[4] = set;
    $[5] = t2;
    $[6] = t3;
  } else {
    t2 = $[5];
    t3 = $[6];
  }
  useEffect(t0, t1);
  useEffect(t2, t3);
}

/**
 * Register a dialog node to float above the prompt. Clears on unmount.
 * No-op outside the provider (non-fullscreen renders inline instead).
 */
export function useSetPromptOverlayDialog(node) {
  const $ = _c(8);
  const set = useContext(SetDialogContext);
  let t0;
  let t1;
  let t2;
  let t3;
  if ($[0] !== node || $[1] !== set) {
    t0 = () => {
      if (!set) {
        return;
      }
      set(node);
    };
    t1 = [set, node];
    $[0] = node;
    $[1] = set;
    $[2] = t0;
    $[3] = t1;
  } else {
    t0 = $[2];
    t1 = $[3];
  }
  if ($[4] !== set) {
    t2 = () => {
      if (!set) {
        return;
      }
      return () => set(null);
    };
    t3 = [set];
    $[4] = set;
    $[5] = t2;
    $[6] = t3;
  } else {
    t2 = $[5];
    t3 = $[6];
  }
  useEffect(t0, t1);
  useEffect(t2, t3);
}
