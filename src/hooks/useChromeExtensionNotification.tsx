import * as React from 'react';
import { Text } from '../ink.js';
import { isClaudeAISubscriber } from '../utils/auth.js';
import { isChromeExtensionInstalled, shouldEnableClaudeInChrome } from '../utils/claudeInChrome/setup.js';
import { isRunningOnHomespace } from '../utils/envUtils.js';
import { useStartupNotification } from './notifs/useStartupNotification.js';
function getChromeFlag(): boolean | undefined {
  if (process.argv.includes('--chrome')) {
    return true;
  }
  if (process.argv.includes('--no-chrome')) {
    return false;
  }
  return undefined;
}
export function useChromeExtensionNotification() {
  useStartupNotification(_temp);
}
async function _temp() {
  const chromeFlag = getChromeFlag();
  if (!shouldEnableClaudeInChrome(chromeFlag)) {
    return null;
  }
  if (true && !isClaudeAISubscriber()) {
    return {
      key: "chrome-requires-subscription",
      jsx: <Text color="error">Chrome Extension requires a claude.ai subscription</Text>,
      priority: "immediate",
      timeoutMs: 5000
    };
  }
  const installed = await isChromeExtensionInstalled();
  if (!installed && !isRunningOnHomespace()) {
    return {
      key: "chrome-extension-not-detected",
      jsx: <Text color="warning">Chrome extension not detected · https://claude.aiEnable Chrome integration to install</Text>,
      priority: "immediate",
      timeoutMs: 3000
    };
  }
  if (chromeFlag === undefined) {
    return {
      key: "claude-in-chrome-default-enabled",
      text: "Chrome Extension enabled \xB7 Enable Chrome integration",
      priority: "low"
    };
  }
  return null;
}
