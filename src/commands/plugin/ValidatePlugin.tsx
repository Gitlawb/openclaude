import { c as _c } from "react-compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { useEffect } from 'react';
import { Box, Text } from '../../ink.js';
import { errorMessage } from '../../utils/errors.js';
import { logError } from '../../utils/log.js';
import { validateManifest } from '../../utils/plugins/validatePlugin.js';
import { plural } from '../../utils/stringUtils.js';
type Props = {
  onComplete: (result?: string) => void;
  path?: string;
};
export function ValidatePlugin(t0) {
  const $ = _c(5);
  const {
    onComplete,
    path
  } = t0;
  let t1;
  let t2;
  if ($[0] !== onComplete || $[1] !== path) {
    t1 = () => {
      const runValidation = async function runValidation() {
        if (!path) {
          onComplete("Використання: /plugin validate <шлях>\n\nПеревіряє маніфест плагіна або marketplace (файл або директорію).\n\nПриклади:\n  /plugin validate .nnc-plugin/plugin.json\n  /plugin validate /path/to/plugin-directory\n  /plugin validate .\n\nЯкщо вказано директорію, автоматично перевіряється .nnc-plugin/marketplace.json\nабо .nnc-plugin/plugin.json (перевага marketplace, якщо існують обидва).\n\nАбо з командного рядка:\n  nnc plugin validate <шлях>");
          return;
        }
        ;
        try {
          const result = await validateManifest(path);
          let output = "";
          output = output + `Перевірка ${result.fileType} маніфесту: ${result.filePath}\n\n`;
          output;
          if (result.errors.length > 0) {
            output = output + `${figures.cross} Знайдено помилок: ${result.errors.length}:\n\n`;
            output;
            result.errors.forEach(error_0 => {
              output = output + `  ${figures.pointer} ${error_0.path}: ${error_0.message}\n`;
              output;
            });
            output = output + "\n";
            output;
          }
          if (result.warnings.length > 0) {
            output = output + `${figures.warning} Знайдено попереджень: ${result.warnings.length}:\n\n`;
            output;
            result.warnings.forEach(warning => {
              output = output + `  ${figures.pointer} ${warning.path}: ${warning.message}\n`;
              output;
            });
            output = output + "\n";
            output;
          }
          if (result.success) {
            if (result.warnings.length > 0) {
              output = output + `${figures.tick} Перевірку пройдено з попередженнями\n`;
              output;
            } else {
              output = output + `${figures.tick} Перевірку пройдено\n`;
              output;
            }
            process.exitCode = 0;
          } else {
            output = output + `${figures.cross} Перевірку не пройдено\n`;
            output;
            process.exitCode = 1;
          }
          onComplete(output);
        } catch (t3) {
          const error = t3;
          process.exitCode = 2;
          logError(error);
          onComplete(`${figures.cross} Неочікувана помилка під час перевірки: ${errorMessage(error)}`);
        }
      };
      runValidation();
    };
    t2 = [onComplete, path];
    $[0] = onComplete;
    $[1] = path;
    $[2] = t1;
    $[3] = t2;
  } else {
    t1 = $[2];
    t2 = $[3];
  }
  useEffect(t1, t2);
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Box flexDirection="column"><Text>Виконується перевірка...</Text></Box>;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  return t3;
}
