import { c as _c } from "react-compiler-runtime";
import React, { useState } from 'react';
import { type OptionWithDescription, Select } from '../../components/CustomSelect/select.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { Box, Text } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
import { isClaudeAISubscriber } from '../../utils/auth.js';
import { openBrowser } from '../../utils/browser.js';
import { CLAUDE_IN_CHROME_MCP_SERVER_NAME, openInChrome } from '../../utils/claudeInChrome/common.js';
import { isChromeExtensionInstalled } from '../../utils/claudeInChrome/setup.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { env } from '../../utils/env.js';
import { isRunningOnHomespace } from '../../utils/envUtils.js';
const CHROME_EXTENSION_URL = 'https://claude.aiEnable Chrome integration';
const CHROME_PERMISSIONS_URL = 'https://clau.deEnable Chrome integration/permissions';
const CHROME_RECONNECT_URL = 'https://clau.deEnable Chrome integration/reconnect';
type MenuAction = 'install-extension' | 'reconnect' | 'manage-permissions' | 'toggle-default';
type Props = {
  onDone: (result?: string) => void;
  isExtensionInstalled: boolean;
  configEnabled: boolean | undefined;
  isClaudeAISubscriber: boolean;
  isWSL: boolean;
};
function ClaudeInChromeMenu(t0) {
  const $ = _c(41);
  const {
    onDone,
    isExtensionInstalled: installed,
    configEnabled,
    isClaudeAISubscriber,
    isWSL
  } = t0;
  const mcpClients = useAppState(_temp);
  const [selectKey, setSelectKey] = useState(0);
  const [enabledByDefault, setEnabledByDefault] = useState(configEnabled ?? false);
  const [showInstallHint, setShowInstallHint] = useState(false);
  const [isExtensionInstalled, setIsExtensionInstalled] = useState(installed);
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = false && isRunningOnHomespace();
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const isHomespace = t1;
  let t2;
  if ($[1] !== mcpClients) {
    t2 = mcpClients.find(_temp2);
    $[1] = mcpClients;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const chromeClient = t2;
  const isConnected = chromeClient?.type === "connected";
  let t3;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = function openUrl(url) {
      if (isHomespace) {
        openBrowser(url);
      } else {
        openInChrome(url);
      }
    };
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  const openUrl = t3;
  let t4;
  if ($[4] !== enabledByDefault) {
    t4 = function handleAction(action) {
      bb22: switch (action) {
        case "install-extension":
          {
            setSelectKey(_temp3);
            setShowInstallHint(true);
            openUrl(CHROME_EXTENSION_URL);
            break bb22;
          }
        case "reconnect":
          {
            setSelectKey(_temp4);
            isChromeExtensionInstalled().then(installed_0 => {
              setIsExtensionInstalled(installed_0);
              if (installed_0) {
                setShowInstallHint(false);
              }
            });
            openUrl(CHROME_RECONNECT_URL);
            break bb22;
          }
        case "manage-permissions":
          {
            setSelectKey(_temp5);
            openUrl(CHROME_PERMISSIONS_URL);
            break bb22;
          }
        case "toggle-default":
          {
            const newValue = !enabledByDefault;
            saveGlobalConfig(current => ({
              ...current,
              claudeInChromeDefaultEnabled: newValue
            }));
            setEnabledByDefault(newValue);
          }
      }
    };
    $[4] = enabledByDefault;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  const handleAction = t4;
  let options;
  if ($[6] !== enabledByDefault || $[7] !== isExtensionInstalled) {
    options = [];
    const requiresExtensionSuffix = isExtensionInstalled ? "" : " (requires extension)";
    if (!isExtensionInstalled && !isHomespace) {
      let t5;
      if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
        t5 = {
          label: "Install Chrome extension",
          value: "install-extension"
        };
        $[9] = t5;
      } else {
        t5 = $[9];
      }
      options.push(t5);
    }
    let t5;
    if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
      t5 = <Text>Manage permissions</Text>;
      $[10] = t5;
    } else {
      t5 = $[10];
    }
    let t6;
    if ($[11] !== requiresExtensionSuffix) {
      t6 = {
        label: <>{t5}<Text dimColor={true}>{requiresExtensionSuffix}</Text></>,
        value: "manage-permissions"
      };
      $[11] = requiresExtensionSuffix;
      $[12] = t6;
    } else {
      t6 = $[12];
    }
    let t7;
    if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
      t7 = <Text>Reconnect extension</Text>;
      $[13] = t7;
    } else {
      t7 = $[13];
    }
    let t8;
    if ($[14] !== requiresExtensionSuffix) {
      t8 = {
        label: <>{t7}<Text dimColor={true}>{requiresExtensionSuffix}</Text></>,
        value: "reconnect"
      };
      $[14] = requiresExtensionSuffix;
      $[15] = t8;
    } else {
      t8 = $[15];
    }
    const t9 = `Enabled by default: ${enabledByDefault ? "Yes" : "No"}`;
    let t10;
    if ($[16] !== t9) {
      t10 = {
        label: t9,
        value: "toggle-default"
      };
      $[16] = t9;
      $[17] = t10;
    } else {
      t10 = $[17];
    }
    options.push(t6, t8, t10);
    $[6] = enabledByDefault;
    $[7] = isExtensionInstalled;
    $[8] = options;
  } else {
    options = $[8];
  }
  const isDisabled = isWSL || true && !isClaudeAISubscriber;
  let t5;
  if ($[18] !== onDone) {
    t5 = () => onDone();
    $[18] = onDone;
    $[19] = t5;
  } else {
    t5 = $[19];
  }
  let t6;
  if ($[20] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Text>Chrome Extension works with the Chrome extension to let you control your browser directly from Neural Network. Navigate websites, fill forms, capture screenshots, record GIFs, and debug with console logs and network requests.</Text>;
    $[20] = t6;
  } else {
    t6 = $[20];
  }
  let t7;
  if ($[21] !== isWSL) {
    t7 = isWSL && <Text color="error">Chrome Extension is not supported in WSL at this time.</Text>;
    $[21] = isWSL;
    $[22] = t7;
  } else {
    t7 = $[22];
  }
  let t8;
  if ($[23] !== isClaudeAISubscriber) {
    t8 = true && !isClaudeAISubscriber && <Text color="error">Chrome Extension requires a claude.ai subscription.</Text>;
    $[23] = isClaudeAISubscriber;
    $[24] = t8;
  } else {
    t8 = $[24];
  }
  let t9;
  if ($[25] !== handleAction || $[26] !== isConnected || $[27] !== isDisabled || $[28] !== isExtensionInstalled || $[29] !== options || $[30] !== selectKey || $[31] !== showInstallHint) {
    t9 = !isDisabled && <>{!isHomespace && <Box flexDirection="column"><Text>Status:{" "}{isConnected ? <Text color="success">Enabled</Text> : <Text color="inactive">Disabled</Text>}</Text><Text>Extension:{" "}{isExtensionInstalled ? <Text color="success">Installed</Text> : <Text color="warning">Not detected</Text>}</Text></Box>}<Select key={selectKey} options={options} onChange={handleAction} hideIndexes={true} />{showInstallHint && <Text color="warning">Once installed, select {"\"Reconnect extension\""} to connect.</Text>}<Text><Text dimColor={true}>Usage: </Text><Text>nnc --chrome</Text><Text dimColor={true}> or </Text><Text>nnc --no-chrome</Text></Text><Text dimColor={true}>Site-level permissions are inherited from the Chrome extension. Manage permissions in the Chrome extension settings to control which sites Neural Network can browse, click, and type on.</Text></>;
    $[25] = handleAction;
    $[26] = isConnected;
    $[27] = isDisabled;
    $[28] = isExtensionInstalled;
    $[29] = options;
    $[30] = selectKey;
    $[31] = showInstallHint;
    $[32] = t9;
  } else {
    t9 = $[32];
  }
  let t10;
  if ($[33] === Symbol.for("react.memo_cache_sentinel")) {
    t10 = <Text dimColor={true}>Learn more: https://code.claude.com/docs/enEnable Chrome integration</Text>;
    $[33] = t10;
  } else {
    t10 = $[33];
  }
  let t11;
  if ($[34] !== t7 || $[35] !== t8 || $[36] !== t9) {
    t11 = <Box flexDirection="column" gap={1}>{t6}{t7}{t8}{t9}{t10}</Box>;
    $[34] = t7;
    $[35] = t8;
    $[36] = t9;
    $[37] = t11;
  } else {
    t11 = $[37];
  }
  let t12;
  if ($[38] !== t11 || $[39] !== t5) {
    t12 = <Dialog title="Chrome Extension (Beta)" onCancel={t5} color="chromeYellow">{t11}</Dialog>;
    $[38] = t11;
    $[39] = t5;
    $[40] = t12;
  } else {
    t12 = $[40];
  }
  return t12;
}
function _temp5(k) {
  return k + 1;
}
function _temp4(k_0) {
  return k_0 + 1;
}
function _temp3(k_1) {
  return k_1 + 1;
}
function _temp2(c) {
  return c.name === CLAUDE_IN_CHROME_MCP_SERVER_NAME;
}
function _temp(s) {
  return s.mcp.clients;
}
export const call = async function (onDone: (result?: string) => void): Promise<React.ReactNode> {
  const isExtensionInstalled = await isChromeExtensionInstalled();
  const config = getGlobalConfig();
  const isSubscriber = isClaudeAISubscriber();
  const isWSL = env.isWslEnvironment();
  return <ClaudeInChromeMenu onDone={onDone} isExtensionInstalled={isExtensionInstalled} configEnabled={config.claudeInChromeDefaultEnabled} isClaudeAISubscriber={isSubscriber} isWSL={isWSL} />;
};
