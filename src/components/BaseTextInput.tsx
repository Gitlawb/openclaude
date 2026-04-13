import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { renderPlaceholder } from '../hooks/renderPlaceholder.js';
import { usePasteHandler } from '../hooks/usePasteHandler.js';
import { useDeclaredCursor } from '../ink/hooks/use-declared-cursor.js';
import { Ansi, Box, Text, useInput } from '../ink.js';
import type { BaseInputState, BaseTextInputProps } from '../types/textInputTypes.js';
import type { TextHighlight } from '../utils/textHighlighting.js';
import { HighlightedInput } from './PromptInput/ShimmeredInput.js';
type BaseTextInputComponentProps = BaseTextInputProps & {
  inputState: BaseInputState;
  children?: React.ReactNode;
  terminalFocus: boolean;
  highlights?: TextHighlight[];
  invert?: (text: string) => string;
  hidePlaceholderText?: boolean;
};

/**
 * A base component for text inputs that handles rendering and basic input
 */
export function BaseTextInput(t0) {
  const $ = _c(14);
  const {
    inputState,
    children,
    terminalFocus,
    invert,
    hidePlaceholderText,
    ...props
  } = t0;
  const {
    onInput,
    value,
    renderedValue,
    cursorLine,
    cursorColumn,
    offset,
  } = inputState;
  const t1 = Boolean(props.focus && props.showCursor && terminalFocus);
  let t2;
  if ($[0] !== cursorColumn || $[1] !== cursorLine || $[2] !== t1) {
    t2 = {
      line: cursorLine,
      column: cursorColumn,
      active: t1
    };
    $[0] = cursorColumn;
    $[1] = cursorLine;
    $[2] = t1;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const cursorRef = useDeclaredCursor(t2);
  const {
    wrappedOnInput,
    isPasting: t3
  } = usePasteHandler({
    onPaste: props.onPaste,
    onInput: (input, key) => {
      if (isPasting && key.return) {
        return;
      }
      onInput(input, key);
    },
    onImagePaste: props.onImagePaste
  });
  const isPasting = t3;
  const {
    onIsPastingChange
  } = props;
  React.useEffect(() => {
    if (onIsPastingChange) {
      onIsPastingChange(isPasting);
    }
  }, [isPasting, onIsPastingChange]);
  const {
    showPlaceholder,
    renderedPlaceholder
  } = renderPlaceholder({
    placeholder: props.placeholder,
    value,
    showCursor: props.showCursor,
    focus: props.focus,
    terminalFocus,
    invert,
    hidePlaceholderText
  });
  useInput(wrappedOnInput, {
    isActive: props.focus
  });
  const commandWithoutArgs = value && value.trim().indexOf(" ") === -1 || value && value.endsWith(" ");
  const showArgumentHint = Boolean(props.argumentHint && value && commandWithoutArgs && value.startsWith("/"));
  const cursorFiltered = props.showCursor && props.highlights ? props.highlights.filter(h => h.dimColor || offset < h.start || offset >= h.end) : props.highlights;
  const {
    viewportCharOffset,
    viewportCharEnd
  } = inputState;
  const filteredHighlights = cursorFiltered && viewportCharOffset > 0 ? cursorFiltered.filter(h_0 => h_0.end > viewportCharOffset && h_0.start < viewportCharEnd).map(h_1 => ({
    ...h_1,
    start: Math.max(0, h_1.start - viewportCharOffset),
    end: h_1.end - viewportCharOffset
  })) : cursorFiltered;
  const hasHighlights = filteredHighlights && filteredHighlights.length > 0;
  if (hasHighlights) {
    return <Box ref={cursorRef}><HighlightedInput text={renderedValue} highlights={filteredHighlights} />{showArgumentHint && <Text dimColor={true}>{value.endsWith(" ") ? "" : " "}{props.argumentHint}</Text>}{children}</Box>;
  }
  const T0 = Box;
  const T1 = Text;
  const t4 = "truncate-end";
  const t5 = showPlaceholder && props.placeholderElement ? props.placeholderElement : showPlaceholder && renderedPlaceholder ? <Ansi>{renderedPlaceholder}</Ansi> : <Ansi>{renderedValue}</Ansi>;
  const t6 = showArgumentHint && <Text dimColor={true}>{value.endsWith(" ") ? "" : " "}{props.argumentHint}</Text>;
  let t7;
  if ($[4] !== T1 || $[5] !== children || $[6] !== props || $[7] !== t5 || $[8] !== t6) {
    t7 = <T1 wrap={t4} dimColor={props.dimColor}>{t5}{t6}{children}</T1>;
    $[4] = T1;
    $[5] = children;
    $[6] = props;
    $[7] = t5;
    $[8] = t6;
    $[9] = t7;
  } else {
    t7 = $[9];
  }
  let t8;
  if ($[10] !== T0 || $[11] !== cursorRef || $[12] !== t7) {
    t8 = <T0 ref={cursorRef}>{t7}</T0>;
    $[10] = T0;
    $[11] = cursorRef;
    $[12] = t7;
    $[13] = t8;
  } else {
    t8 = $[13];
  }
  return t8;
}
