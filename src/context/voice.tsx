import { c as _c } from "react-compiler-runtime";
import React, { createContext, useContext, useState, useSyncExternalStore } from 'react';
import { createStore, type Store } from '../state/store.js';
export type VoiceState = {
  voiceState: 'idle' | 'recording' | 'processing';
  voiceError: string | null;
  voiceInterimTranscript: string;
  voiceAudioLevels: number[];
  voiceWarmingUp: boolean;
};
const DEFAULT_STATE: VoiceState = {
  voiceState: 'idle',
  voiceError: null,
  voiceInterimTranscript: '',
  voiceAudioLevels: [],
  voiceWarmingUp: false
};
type VoiceStore = Store<VoiceState>;
const VoiceContext = createContext<VoiceStore | null>(null);
type Props = {
  children: React.ReactNode;
};
export function VoiceProvider(t0) {
  const $ = _c(3);
  const {
    children
  } = t0;
  const [store] = useState(_temp);
  let t1;
  if ($[0] !== children || $[1] !== store) {
    t1 = <VoiceContext.Provider value={store}>{children}</VoiceContext.Provider>;
    $[0] = children;
    $[1] = store;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  return t1;
}
function _temp() {
  return createStore(DEFAULT_STATE);
}
function useVoiceStore() {
  const store = useContext(VoiceContext);
  if (!store) {
    throw new Error("useVoiceState must be used within a VoiceProvider");
  }
  return store;
}

/**
 * Subscribe to a slice of voice state. Only re-renders when the selected
 * value changes (compared via Object.is).
 */
export function useVoiceState(selector) {
  const $ = _c(3);
  const store = useVoiceStore();
  let t0;
  if ($[0] !== selector || $[1] !== store) {
    t0 = () => selector(store.getState());
    $[0] = selector;
    $[1] = store;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  const get = t0;
  return useSyncExternalStore(store.subscribe, get, get);
}

/**
 * Get the voice state setter. Stable reference — never causes re-renders.
 * store.setState is synchronous: callers can read getVoiceState() immediately
 * after to observe the new value (VoiceKeybindingHandler relies on this).
 */
export function useSetVoiceState() {
  return useVoiceStore().setState;
}

/**
 * Get a synchronous reader for fresh state inside callbacks. Unlike
 * useVoiceState (which subscribes), this doesn't cause re-renders — use
 * inside event handlers that need to read state set earlier in the same tick.
 */
export function useGetVoiceState() {
  return useVoiceStore().getState;
}
