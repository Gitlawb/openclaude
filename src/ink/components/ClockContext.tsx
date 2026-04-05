import { c as _c } from "react-compiler-runtime";
import React, { createContext, useEffect, useState } from 'react';
import { FRAME_INTERVAL_MS } from '../constants.js';
import { useTerminalFocus } from '../hooks/use-terminal-focus.js';
export type Clock = {
  subscribe: (onChange: () => void, keepAlive: boolean) => () => void;
  now: () => number;
  setTickInterval: (ms: number) => void;
};
export function createClock(tickIntervalMs: number): Clock {
  const subscribers = new Map<() => void, boolean>();
  let interval: ReturnType<typeof setInterval> | null = null;
  let currentTickIntervalMs = tickIntervalMs;
  let startTime = 0;
  // Snapshot of the current tick's time, ensuring all subscribers in the same
  // tick see the same value (keeps animations synchronized)
  let tickTime = 0;
  function tick(): void {
    tickTime = Date.now() - startTime;
    for (const onChange of subscribers.keys()) {
      onChange();
    }
  }
  function updateInterval(): void {
    const anyKeepAlive = [...subscribers.values()].some(Boolean);
    if (anyKeepAlive) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (startTime === 0) {
        startTime = Date.now();
      }
      interval = setInterval(tick, currentTickIntervalMs);
    } else if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }
  return {
    subscribe(onChange, keepAlive) {
      subscribers.set(onChange, keepAlive);
      updateInterval();
      return () => {
        subscribers.delete(onChange);
        updateInterval();
      };
    },
    now() {
      if (startTime === 0) {
        startTime = Date.now();
      }
      // When the clock interval is running, return the synchronized tickTime
      // so all subscribers in the same tick see the same value.
      // When paused (no keepAlive subscribers), return real-time to avoid
      // returning a stale tickTime from the last tick before the pause.
      if (interval && tickTime) {
        return tickTime;
      }
      return Date.now() - startTime;
    },
    setTickInterval(ms) {
      if (ms === currentTickIntervalMs) return;
      currentTickIntervalMs = ms;
      updateInterval();
    }
  };
}
export const ClockContext = createContext<Clock | null>(null);
const BLURRED_TICK_INTERVAL_MS = FRAME_INTERVAL_MS * 2;

// Own component so App.tsx doesn't re-render when the clock is created.
// The clock value is stable (created once via useState), so the provider
// never causes consumer re-renders on its own.
export function ClockProvider(t0) {
  const $ = _c(7);
  const {
    children
  } = t0;
  const [clock] = useState(_temp);
  const focused = useTerminalFocus();
  let t1;
  let t2;
  if ($[0] !== clock || $[1] !== focused) {
    t1 = () => {
      clock.setTickInterval(focused ? FRAME_INTERVAL_MS : BLURRED_TICK_INTERVAL_MS);
    };
    t2 = [clock, focused];
    $[0] = clock;
    $[1] = focused;
    $[2] = t1;
    $[3] = t2;
  } else {
    t1 = $[2];
    t2 = $[3];
  }
  useEffect(t1, t2);
  let t3;
  if ($[4] !== children || $[5] !== clock) {
    t3 = <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
    $[4] = children;
    $[5] = clock;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  return t3;
}
function _temp() {
  return createClock(FRAME_INTERVAL_MS);
}
