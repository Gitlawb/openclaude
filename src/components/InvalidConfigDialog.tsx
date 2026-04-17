import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { Box, render, Text } from '../ink.js';
import { KeybindingSetup } from '../keybindings/KeybindingProviderSetup.js';
import { AppStateProvider } from '../state/AppState.js';
import type { ConfigParseError } from '../utils/errors.js';
import { getBaseRenderOptions } from '../utils/renderOptions.js';
import { jsonStringify, writeFileSync_DEPRECATED } from '../utils/slowOperations.js';
import type { ThemeName } from '../utils/theme.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
interface InvalidConfigHandlerProps {
  error: ConfigParseError;
}
interface InvalidConfigDialogProps {
  filePath: string;
  errorDescription: string;
  onExit: () => void;
  onReset: () => void;
}

/**
 * Dialog shown when the Neural Network config file contains invalid JSON
 */
function InvalidConfigDialog(t0) {
  const $ = _c(19);
  const {
    filePath,
    errorDescription,
    onExit,
    onReset
  } = t0;
  let t1;
  if ($[0] !== onExit || $[1] !== onReset) {
    t1 = value => {
      if (value === "exit") {
        onExit();
      } else {
        onReset();
      }
    };
    $[0] = onExit;
    $[1] = onReset;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const handleSelect = t1;
  let t2;
  if ($[3] !== filePath) {
    t2 = <Text>Файл конфігурації <Text bold={true}>{filePath}</Text> містить невалідний JSON.</Text>;
    $[3] = filePath;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[5] !== errorDescription) {
    t3 = <Text>{errorDescription}</Text>;
    $[5] = errorDescription;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  let t4;
  if ($[7] !== t2 || $[8] !== t3) {
    t4 = <Box flexDirection="column" gap={1}>{t2}{t3}</Box>;
    $[7] = t2;
    $[8] = t3;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  let t5;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Text bold={true}>Оберіть варіант:</Text>;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  let t6;
  if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = [{
      label: "Вийти та виправити вручну",
      value: "exit"
    }, {
      label: "Скинути до типової конфігурації",
      value: "reset"
    }];
    $[11] = t6;
  } else {
    t6 = $[11];
  }
  let t7;
  if ($[12] !== handleSelect || $[13] !== onExit) {
    t7 = <Box flexDirection="column">{t5}<Select options={t6} onChange={handleSelect} onCancel={onExit} /></Box>;
    $[12] = handleSelect;
    $[13] = onExit;
    $[14] = t7;
  } else {
    t7 = $[14];
  }
  let t8;
  if ($[15] !== onExit || $[16] !== t4 || $[17] !== t7) {
    t8 = <Dialog title="Помилка конфігурації" color="error" onCancel={onExit}>{t4}{t7}</Dialog>;
    $[15] = onExit;
    $[16] = t4;
    $[17] = t7;
    $[18] = t8;
  } else {
    t8 = $[18];
  }
  return t8;
}

/**
 * Safe fallback theme name for error dialogs to avoid circular dependency.
 * Uses a hardcoded dark theme that doesn't require reading from config.
 */
const SAFE_ERROR_THEME_NAME: ThemeName = 'dark';
export async function showInvalidConfigDialog({
  error
}: InvalidConfigHandlerProps): Promise<void> {
  // Extend RenderOptions with theme property for this specific usage
  type SafeRenderOptions = Parameters<typeof render>[1] & {
    theme?: ThemeName;
  };
  const renderOptions: SafeRenderOptions = {
    ...getBaseRenderOptions(false),
    // IMPORTANT: Use hardcoded theme name to avoid circular dependency with getGlobalConfig()
    // This allows the error dialog to show even when config file has JSON syntax errors
    theme: SAFE_ERROR_THEME_NAME
  };
  await new Promise<void>(async resolve => {
    const {
      unmount
    } = await render(<AppStateProvider>
        <KeybindingSetup>
          <InvalidConfigDialog filePath={error.filePath} errorDescription={error.message} onExit={() => {
          unmount();
          void resolve();
          process.exit(1);
        }} onReset={() => {
          writeFileSync_DEPRECATED(error.filePath, jsonStringify(error.defaultConfig, null, 2), {
            flush: false,
            encoding: 'utf8'
          });
          unmount();
          void resolve();
          process.exit(0);
        }} />
        </KeybindingSetup>
      </AppStateProvider>, renderOptions);
  });
}
