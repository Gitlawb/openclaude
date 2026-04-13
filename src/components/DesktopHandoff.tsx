import { c as _c } from "react-compiler-runtime";
import React, { useEffect, useState } from 'react';
import type { CommandResultDisplay } from '../commands.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw input for "any key" dismiss and y/n prompt
import { Box, Text, useInput } from '../ink.js';
import { openBrowser } from '../utils/browser.js';
import { getDesktopInstallStatus, openCurrentSessionInDesktop } from '../utils/desktopDeepLink.js';
import { errorMessage } from '../utils/errors.js';
import { gracefulShutdown } from '../utils/gracefulShutdown.js';
import { flushSessionStorage } from '../utils/sessionStorage.js';
import { LoadingState } from './design-system/LoadingState.js';
const DESKTOP_DOCS_URL = 'https://clau.de/desktop';
export function getDownloadUrl(): string {
  switch (process.platform) {
    case 'win32':
      return 'https://claude.ai/api/desktop/win32/x64/exe/latest/redirect';
    default:
      return 'https://claude.ai/api/desktop/darwin/universal/dmg/latest/redirect';
  }
}
type DesktopHandoffState = 'checking' | 'prompt-download' | 'flushing' | 'opening' | 'success' | 'error';
type Props = {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
export function DesktopHandoff(t0) {
  const $ = _c(20);
  const {
    onDone
  } = t0;
  const [state, setState] = useState("checking");
  const [error, setError] = useState(null);
  const [downloadMessage, setDownloadMessage] = useState("");
  let t1;
  if ($[0] !== error || $[1] !== onDone || $[2] !== state) {
    t1 = input => {
      if (state === "error") {
        onDone(error ?? "Unknown error", {
          display: "system"
        });
        return;
      }
      if (state === "prompt-download") {
        if (input === "y" || input === "Y") {
          openBrowser(getDownloadUrl()).catch(_temp);
          onDone(`Starting download. Re-run /desktop once you\u2019ve installed the app.\nLearn more at ${DESKTOP_DOCS_URL}`, {
            display: "system"
          });
        } else {
          if (input === "n" || input === "N") {
            onDone(`The desktop app is required for /desktop. Learn more at ${DESKTOP_DOCS_URL}`, {
              display: "system"
            });
          }
        }
      }
    };
    $[0] = error;
    $[1] = onDone;
    $[2] = state;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  useInput(t1);
  let t2;
  let t3;
  if ($[4] !== onDone) {
    t2 = () => {
      const performHandoff = async function performHandoff() {
        setState("checking");
        const installStatus = await getDesktopInstallStatus();
        if (installStatus.status === "not-installed") {
          setDownloadMessage("Claude Desktop is not installed.");
          setState("prompt-download");
          return;
        }
        if (installStatus.status === "version-too-old") {
          setDownloadMessage(`Claude Desktop needs to be updated (found v${installStatus.version}, need v1.1.2396+).`);
          setState("prompt-download");
          return;
        }
        setState("flushing");
        await flushSessionStorage();
        setState("opening");
        const result = await openCurrentSessionInDesktop();
        if (!result.success) {
          setError(result.error ?? "Failed to open Claude Desktop");
          setState("error");
          return;
        }
        setState("success");
        setTimeout(_temp2, 500, onDone);
      };
      performHandoff().catch(err => {
        setError(errorMessage(err));
        setState("error");
      });
    };
    t3 = [onDone];
    $[4] = onDone;
    $[5] = t2;
    $[6] = t3;
  } else {
    t2 = $[5];
    t3 = $[6];
  }
  useEffect(t2, t3);
  if (state === "error") {
    let t4;
    if ($[7] !== error) {
      t4 = <Text color="error">Error: {error}</Text>;
      $[7] = error;
      $[8] = t4;
    } else {
      t4 = $[8];
    }
    let t5;
    if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
      t5 = <Text dimColor={true}>Press any key to continue…</Text>;
      $[9] = t5;
    } else {
      t5 = $[9];
    }
    let t6;
    if ($[10] !== t4) {
      t6 = <Box flexDirection="column" paddingX={2}>{t4}{t5}</Box>;
      $[10] = t4;
      $[11] = t6;
    } else {
      t6 = $[11];
    }
    return t6;
  }
  if (state === "prompt-download") {
    let t4;
    if ($[12] !== downloadMessage) {
      t4 = <Text>{downloadMessage}</Text>;
      $[12] = downloadMessage;
      $[13] = t4;
    } else {
      t4 = $[13];
    }
    let t5;
    if ($[14] === Symbol.for("react.memo_cache_sentinel")) {
      t5 = <Text>Download now? (y/n)</Text>;
      $[14] = t5;
    } else {
      t5 = $[14];
    }
    let t6;
    if ($[15] !== t4) {
      t6 = <Box flexDirection="column" paddingX={2}>{t4}{t5}</Box>;
      $[15] = t4;
      $[16] = t6;
    } else {
      t6 = $[16];
    }
    return t6;
  }
  let t4;
  if ($[17] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = {
      checking: "Checking for Claude Desktop\u2026",
      flushing: "Saving session\u2026",
      opening: "Opening Claude Desktop\u2026",
      success: "Opening in Claude Desktop\u2026"
    };
    $[17] = t4;
  } else {
    t4 = $[17];
  }
  const messages = t4;
  const t5 = messages[state];
  let t6;
  if ($[18] !== t5) {
    t6 = <LoadingState message={t5} />;
    $[18] = t5;
    $[19] = t6;
  } else {
    t6 = $[19];
  }
  return t6;
}
async function _temp2(onDone_0) {
  onDone_0("Session transferred to Claude Desktop", {
    display: "system"
  });
  await gracefulShutdown(0, "other");
}
function _temp() {}
