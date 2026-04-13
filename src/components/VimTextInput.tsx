import { c as _c } from "react-compiler-runtime";
import chalk from 'chalk';
import React from 'react';
import { useClipboardImageHint } from '../hooks/useClipboardImageHint.js';
import { useVimInput } from '../hooks/useVimInput.js';
import { Box, color, useTerminalFocus, useTheme } from '../ink.js';
import type { VimTextInputProps } from '../types/textInputTypes.js';
import type { TextHighlight } from '../utils/textHighlighting.js';
import { BaseTextInput } from './BaseTextInput.js';
export type Props = VimTextInputProps & {
  highlights?: TextHighlight[];
};
export default function VimTextInput(props) {
  const $ = _c(38);
  const [theme] = useTheme();
  const isTerminalFocused = useTerminalFocus();
  useClipboardImageHint(isTerminalFocused, !!props.onImagePaste);
  const t0 = props.value;
  const t1 = props.onChange;
  const t2 = props.onSubmit;
  const t3 = props.onExit;
  const t4 = props.onExitMessage;
  const t5 = props.onHistoryReset;
  const t6 = props.onHistoryUp;
  const t7 = props.onHistoryDown;
  const t8 = props.onClearInput;
  const t9 = props.focus;
  const t10 = props.mask;
  const t11 = props.multiline;
  const t12 = props.showCursor ? " " : "";
  const t13 = props.highlightPastedText;
  const t14 = isTerminalFocused ? chalk.inverse : _temp;
  let t15;
  if ($[0] !== theme) {
    t15 = color("text", theme);
    $[0] = theme;
    $[1] = t15;
  } else {
    t15 = $[1];
  }
  let t16;
  if ($[2] !== props.columns || $[3] !== props.cursorOffset || $[4] !== props.disableCursorMovementForUpDownKeys || $[5] !== props.disableEscapeDoublePress || $[6] !== props.focus || $[7] !== props.highlightPastedText || $[8] !== props.inputFilter || $[9] !== props.mask || $[10] !== props.maxVisibleLines || $[11] !== props.multiline || $[12] !== props.onChange || $[13] !== props.onChangeCursorOffset || $[14] !== props.onClearInput || $[15] !== props.onExit || $[16] !== props.onExitMessage || $[17] !== props.onHistoryDown || $[18] !== props.onHistoryReset || $[19] !== props.onHistoryUp || $[20] !== props.onImagePaste || $[21] !== props.onModeChange || $[22] !== props.onSubmit || $[23] !== props.onUndo || $[24] !== props.value || $[25] !== t12 || $[26] !== t14 || $[27] !== t15) {
    t16 = {
      value: t0,
      onChange: t1,
      onSubmit: t2,
      onExit: t3,
      onExitMessage: t4,
      onHistoryReset: t5,
      onHistoryUp: t6,
      onHistoryDown: t7,
      onClearInput: t8,
      focus: t9,
      mask: t10,
      multiline: t11,
      cursorChar: t12,
      highlightPastedText: t13,
      invert: t14,
      themeText: t15,
      columns: props.columns,
      maxVisibleLines: props.maxVisibleLines,
      onImagePaste: props.onImagePaste,
      disableCursorMovementForUpDownKeys: props.disableCursorMovementForUpDownKeys,
      disableEscapeDoublePress: props.disableEscapeDoublePress,
      externalOffset: props.cursorOffset,
      onOffsetChange: props.onChangeCursorOffset,
      inputFilter: props.inputFilter,
      onModeChange: props.onModeChange,
      onUndo: props.onUndo
    };
    $[2] = props.columns;
    $[3] = props.cursorOffset;
    $[4] = props.disableCursorMovementForUpDownKeys;
    $[5] = props.disableEscapeDoublePress;
    $[6] = props.focus;
    $[7] = props.highlightPastedText;
    $[8] = props.inputFilter;
    $[9] = props.mask;
    $[10] = props.maxVisibleLines;
    $[11] = props.multiline;
    $[12] = props.onChange;
    $[13] = props.onChangeCursorOffset;
    $[14] = props.onClearInput;
    $[15] = props.onExit;
    $[16] = props.onExitMessage;
    $[17] = props.onHistoryDown;
    $[18] = props.onHistoryReset;
    $[19] = props.onHistoryUp;
    $[20] = props.onImagePaste;
    $[21] = props.onModeChange;
    $[22] = props.onSubmit;
    $[23] = props.onUndo;
    $[24] = props.value;
    $[25] = t12;
    $[26] = t14;
    $[27] = t15;
    $[28] = t16;
  } else {
    t16 = $[28];
  }
  const vimInputState = useVimInput(t16);
  const {
    mode,
    setMode
  } = vimInputState;
  let t17;
  let t18;
  if ($[29] !== mode || $[30] !== props.initialMode || $[31] !== setMode) {
    t17 = () => {
      if (props.initialMode && props.initialMode !== mode) {
        setMode(props.initialMode);
      }
    };
    t18 = [props.initialMode, mode, setMode];
    $[29] = mode;
    $[30] = props.initialMode;
    $[31] = setMode;
    $[32] = t17;
    $[33] = t18;
  } else {
    t17 = $[32];
    t18 = $[33];
  }
  React.useEffect(t17, t18);
  let t19;
  if ($[34] !== isTerminalFocused || $[35] !== props || $[36] !== vimInputState) {
    t19 = <Box flexDirection="column"><BaseTextInput inputState={vimInputState} terminalFocus={isTerminalFocused} highlights={props.highlights} {...props} /></Box>;
    $[34] = isTerminalFocused;
    $[35] = props;
    $[36] = vimInputState;
    $[37] = t19;
  } else {
    t19 = $[37];
  }
  return t19;
}
function _temp(text) {
  return text;
}
