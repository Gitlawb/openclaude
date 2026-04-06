import { c as _c } from "react-compiler-runtime";
import { feature } from 'bun:bundle';
import { useEffect, useState } from 'react';
import { Box, Text } from '../../ink.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { getInitialSettings } from '../../utils/settings/settings.js';
import { isVoiceModeEnabled } from '../../voice/voiceModeEnabled.js';
import { AnimatedAsterisk } from './AnimatedAsterisk.js';
import { shouldShowOpus1mMergeNotice } from './Opus1mMergeNotice.js';
const MAX_SHOW_COUNT = 3;
export function VoiceModeNotice() {
  const $ = _c(1);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = feature("VOICE_MODE") ? <VoiceModeNoticeInner /> : null;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  return t0;
}
function VoiceModeNoticeInner() {
  const $ = _c(4);
  const [show] = useState(_temp);
  let t0;
  let t1;
  if ($[0] !== show) {
    t0 = () => {
      if (!show) {
        return;
      }
      const newCount = (getGlobalConfig().voiceNoticeSeenCount ?? 0) + 1;
      saveGlobalConfig(prev => {
        if ((prev.voiceNoticeSeenCount ?? 0) >= newCount) {
          return prev;
        }
        return {
          ...prev,
          voiceNoticeSeenCount: newCount
        };
      });
    };
    t1 = [show];
    $[0] = show;
    $[1] = t0;
    $[2] = t1;
  } else {
    t0 = $[1];
    t1 = $[2];
  }
  useEffect(t0, t1);
  if (!show) {
    return null;
  }
  let t2;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Box paddingLeft={2}><AnimatedAsterisk /><Text dimColor={true}> Voice mode is now available · /voice to enable</Text></Box>;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  return t2;
}
function _temp() {
  return isVoiceModeEnabled() && getInitialSettings().voiceEnabled !== true && (getGlobalConfig().voiceNoticeSeenCount ?? 0) < MAX_SHOW_COUNT && !shouldShowOpus1mMergeNotice();
}
