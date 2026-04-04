import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { Pane } from '../../components/design-system/Pane.js';
import { ThemePicker } from '../../components/ThemePicker.js';
import { useTheme } from '../../ink.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
type Props = {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
function ThemePickerCommand(t0) {
  const $ = _c(8);
  const {
    onDone
  } = t0;
  const [, setTheme] = useTheme();
  let t1;
  if ($[0] !== onDone || $[1] !== setTheme) {
    t1 = setting => {
      setTheme(setting);
      onDone(`Theme set to ${setting}`);
    };
    $[0] = onDone;
    $[1] = setTheme;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  let t2;
  if ($[3] !== onDone) {
    t2 = () => {
      onDone("Theme picker dismissed", {
        display: "system"
      });
    };
    $[3] = onDone;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[5] !== t1 || $[6] !== t2) {
    t3 = <Pane color="permission"><ThemePicker onThemeSelect={t1} onCancel={t2} skipExitHandling={true} /></Pane>;
    $[5] = t1;
    $[6] = t2;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  return t3;
}
export const call: LocalJSXCommandCall = async (onDone, _context) => {
  return <ThemePickerCommand onDone={onDone} />;
};
