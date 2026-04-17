import { c as _c } from "react-compiler-runtime";
import chalk from 'chalk';
import * as React from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js';
import { useAppState } from '../../state/AppState.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { getDefaultMainLoopModelSetting, renderDefaultModelSetting } from '../../utils/model/model.js';
import { Box, Text } from '../../ink.js';

function _temp7(s) {
  return s.mainLoopModel;
}
function _temp8(s_0) {
  return s_0.mainLoopModelForSession;
}
function _temp9(s_1) {
  return s_1.effortValue;
}

function ShowModelAndClose(t0) {
  const {
    onDone
  } = t0;
  const mainLoopModel = useAppState(_temp7);
  const mainLoopModelForSession = useAppState(_temp8);
  const effortValue = useAppState(_temp9);
  const displayModel = renderModelLabel(mainLoopModel);
  const effortInfo = effortValue !== undefined ? ` (effort: ${effortValue})` : "";
  if (mainLoopModelForSession) {
    onDone(`\u041F\u043E\u0442\u043E\u0447\u043D\u0430 \u043C\u043E\u0434\u0435\u043B\u044C: ${chalk.bold(renderModelLabel(mainLoopModelForSession))} (\u043E\u0432\u0435\u0440\u0440\u0430\u0439\u0434 \u0441\u0435\u0441\u0456\u0457 \u0437 plan mode)\n\u0411\u0430\u0437\u043E\u0432\u0430 \u043C\u043E\u0434\u0435\u043B\u044C: ${displayModel}${effortInfo}`);
  } else {
    onDone(`\u041F\u043E\u0442\u043E\u0447\u043D\u0430 \u043C\u043E\u0434\u0435\u043B\u044C: ${displayModel}${effortInfo}`);
  }
  return null;
}

function renderModelLabel(model: string | null): string {
  const rendered = renderDefaultModelSetting(model ?? getDefaultMainLoopModelSetting());
  return model === null ? `${rendered} (default)` : rendered;
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  args = args?.trim() || '';
  // --info / -h / --help
  if (COMMON_INFO_ARGS.includes(args) || COMMON_HELP_ARGS.includes(args)) {
    return <ShowModelAndClose onDone={onDone} />;
  }

  // Any arg that isn't help -- treat as attempt to switch model
  if (args === '--provider' || args === '-p') {
    onDone('\u041F\u0435\u0440\u0435\u043C\u0438\u043A\u0430\u043D\u043D\u044F \u043F\u0440\u043E\u0432\u0430\u0439\u0434\u0435\u0440\u0430 \u043F\u0456\u0434 \u0447\u0430\u0441 \u0441\u0435\u0441\u0456\u0457 \u0431\u0456\u043B\u044C\u0448\u0435 \u043D\u0435 \u043F\u0456\u0434\u0442\u0440\u0438\u043C\u0443\u0454\u0442\u044C\u0441\u044F. \u041E\u0431\u0435\u0440\u0456\u0442\u044C \u043F\u0440\u043E\u0432\u0430\u0439\u0434\u0435\u0440 \u043F\u0440\u0438 \u0441\u0442\u0430\u0440\u0442\u0456 \u0447\u0435\u0440\u0435\u0437 --modellist.', {
      display: 'system'
    });
    return;
  }

  if (args) {
    onDone(`\u041C\u043E\u0434\u0435\u043B\u044C \u043D\u0435 \u043C\u043E\u0436\u0435 \u0431\u0443\u0442\u0438 \u0437\u043C\u0456\u043D\u0435\u043D\u0430 \u043F\u0456\u0434 \u0447\u0430\u0441 \u0441\u0435\u0441\u0456\u0457. \u041E\u0431\u0435\u0440\u0456\u0442\u044C \u043C\u043E\u0434\u0435\u043B\u044C \u043F\u0440\u0438 \u0441\u0442\u0430\u0440\u0442\u0456.`, {
      display: 'system'
    });
    return;
  }

  // No args -- show current model info (same as --info)
  return <ShowModelAndClose onDone={onDone} />;
};
