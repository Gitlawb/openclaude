import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { useEffect, useState } from 'react';
import { Box, Text } from '../../ink.js';
import { getDynamicConfig_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { logEvent } from '../../services/analytics/index.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { Select } from '../CustomSelect/select.js';
import { DesktopHandoff } from '../DesktopHandoff.js';
import { PermissionDialog } from '../permissions/PermissionDialog.js';
type DesktopUpsellConfig = {
  enable_shortcut_tip: boolean;
  enable_startup_dialog: boolean;
};
const DESKTOP_UPSELL_DEFAULT: DesktopUpsellConfig = {
  enable_shortcut_tip: false,
  enable_startup_dialog: false
};
export function getDesktopUpsellConfig(): DesktopUpsellConfig {
  return getDynamicConfig_CACHED_MAY_BE_STALE('tengu_desktop_upsell', DESKTOP_UPSELL_DEFAULT);
}
function isSupportedPlatform(): boolean {
  return process.platform === 'darwin' || process.platform === 'win32' && process.arch === 'x64';
}
export function shouldShowDesktopUpsellStartup(): boolean {
  if (!isSupportedPlatform()) return false;
  if (!getDesktopUpsellConfig().enable_startup_dialog) return false;
  const config = getGlobalConfig();
  if (config.desktopUpsellDismissed) return false;
  if ((config.desktopUpsellSeenCount ?? 0) >= 3) return false;
  return true;
}
type DesktopUpsellSelection = 'try' | 'not-now' | 'never';
type Props = {
  onDone: () => void;
};
export function DesktopUpsellStartup(t0) {
  const $ = _c(14);
  const {
    onDone
  } = t0;
  const [showHandoff, setShowHandoff] = useState(false);
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [];
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  useEffect(_temp, t1);
  if (showHandoff) {
    let t2;
    if ($[1] !== onDone) {
      t2 = <DesktopHandoff onDone={() => onDone()} />;
      $[1] = onDone;
      $[2] = t2;
    } else {
      t2 = $[2];
    }
    return t2;
  }
  let t2;
  if ($[3] !== onDone) {
    t2 = function handleSelect(value) {
      switch (value) {
        case "try":
          {
            setShowHandoff(true);
            return;
          }
        case "never":
          {
            saveGlobalConfig(_temp2);
            onDone();
            return;
          }
        case "not-now":
          {
            onDone();
            return;
          }
      }
    };
    $[3] = onDone;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const handleSelect = t2;
  let t3;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = {
      label: "Open in Claude desktop app",
      value: "try" as const
    };
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = {
      label: "Not now",
      value: "not-now" as const
    };
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = [t3, t4, {
      label: "Don't ask again",
      value: "never" as const
    }];
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  const options = t5;
  let t6;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Box marginBottom={1}><Text>Use OpenClaude in the Claude desktop app for visual diffs, live app preview, parallel sessions, and more.</Text></Box>;
    $[8] = t6;
  } else {
    t6 = $[8];
  }
  let t7;
  if ($[9] !== handleSelect) {
    t7 = () => handleSelect("not-now");
    $[9] = handleSelect;
    $[10] = t7;
  } else {
    t7 = $[10];
  }
  let t8;
  if ($[11] !== handleSelect || $[12] !== t7) {
    t8 = <PermissionDialog title="Try the Claude desktop app"><Box flexDirection="column" paddingX={2} paddingY={1}>{t6}<Select options={options} onChange={handleSelect} onCancel={t7} /></Box></PermissionDialog>;
    $[11] = handleSelect;
    $[12] = t7;
    $[13] = t8;
  } else {
    t8 = $[13];
  }
  return t8;
}
function _temp2(prev_0) {
  if (prev_0.desktopUpsellDismissed) {
    return prev_0;
  }
  return {
    ...prev_0,
    desktopUpsellDismissed: true
  };
}
function _temp() {
  const newCount = (getGlobalConfig().desktopUpsellSeenCount ?? 0) + 1;
  saveGlobalConfig(prev => {
    if ((prev.desktopUpsellSeenCount ?? 0) >= newCount) {
      return prev;
    }
    return {
      ...prev,
      desktopUpsellSeenCount: newCount
    };
  });
  logEvent("tengu_desktop_upsell_shown", {
    seen_count: newCount
  });
}
