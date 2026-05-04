import { c as _c } from "react-compiler-runtime";
import React, { useEffect } from 'react';
import { useNotifications } from '../context/notifications.js';
import { Text } from '../ink.js';
import { getGlobalConfig } from '../utils/config.js';
import { getRainbowColor } from '../utils/thinking.js';
import { isBuddyEnabled } from './feature.js';

// Local date, not UTC — 24h rolling wave across timezones. Sustained Twitter
// buzz instead of a single UTC-midnight spike, gentler on soul-gen load.
// Teaser window: April 1-7, 2026 only. Command stays live forever after.
export function isBuddyTeaserWindow(): boolean {
  if (("external" as string) === 'ant') return true;
  const d = new Date();
  return d.getFullYear() === 2026 && d.getMonth() === 3 && d.getDate() <= 7;
}
export function isBuddyLive(): boolean {
  if (("external" as string) === 'ant') return true;
  const d = new Date();
  return d.getFullYear() > 2026 || d.getFullYear() === 2026 && d.getMonth() >= 3;
}
function RainbowText(t0) {
  const $ = _c(2);
  const {
    text
  } = t0;
  let t1;
  if ($[0] !== text) {
    t1 = <>{[...text].map(_temp)}</>;
    $[0] = text;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  return t1;
}

// Rainbow /buddy teaser shown on startup when no companion hatched yet.
// Idle presence and reactions are handled by CompanionSprite directly.
function _temp(ch, i) {
  return <Text key={i} color={getRainbowColor(i)}>{ch}</Text>;
}
export function useBuddyNotification() {
  const $ = _c(4);
  const {
    addNotification,
    removeNotification
  } = useNotifications();
  let t0;
  let t1;
  if ($[0] !== addNotification || $[1] !== removeNotification) {
    t0 = () => {
      if (!isBuddyEnabled()) {
        return;
      }
      const config = getGlobalConfig();
      if (config.companion || !isBuddyTeaserWindow()) {
        return;
      }
      addNotification({
        key: "buddy-teaser",
        jsx: <RainbowText text="/buddy" />,
        priority: "immediate",
        timeoutMs: 15000
      });
      return () => removeNotification("buddy-teaser");
    };
    t1 = [addNotification, removeNotification];
    $[0] = addNotification;
    $[1] = removeNotification;
    $[2] = t0;
    $[3] = t1;
  } else {
    t0 = $[2];
    t1 = $[3];
  }
  useEffect(t0, t1);
}
export function findBuddyTriggerPositions(text: string): Array<{
  start: number;
  end: number;
}> {
  if (!isBuddyEnabled()) return [];
  const triggers: Array<{
    start: number;
    end: number;
  }> = [];
  const re = /\/buddy\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    triggers.push({
      start: m.index,
      end: m.index + m[0].length
    });
  }
  return triggers;
}
