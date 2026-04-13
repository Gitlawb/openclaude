import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { Box, Text } from '../../ink.js';
import { useDebouncedDigitInput } from './useDebouncedDigitInput.js';
import type { FeedbackSurveyResponse } from './utils.js';
type Props = {
  onSelect: (option: FeedbackSurveyResponse) => void;
  inputValue: string;
  setInputValue: (value: string) => void;
  message?: string;
};
const RESPONSE_INPUTS = ['0', '1', '2', '3'] as const;
type ResponseInput = (typeof RESPONSE_INPUTS)[number];
const inputToResponse: Record<ResponseInput, FeedbackSurveyResponse> = {
  '0': 'dismissed',
  '1': 'bad',
  '2': 'fine',
  '3': 'good'
} as const;
export const isValidResponseInput = (input: string): input is ResponseInput => (RESPONSE_INPUTS as readonly string[]).includes(input);
const DEFAULT_MESSAGE = 'How is Claude doing this session? (optional)';
export function FeedbackSurveyView(t0) {
  const $ = _c(15);
  const {
    onSelect,
    inputValue,
    setInputValue,
    message: t1
  } = t0;
  const message = t1 === undefined ? DEFAULT_MESSAGE : t1;
  let t2;
  if ($[0] !== onSelect) {
    t2 = digit => onSelect(inputToResponse[digit]);
    $[0] = onSelect;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  let t3;
  if ($[2] !== inputValue || $[3] !== setInputValue || $[4] !== t2) {
    t3 = {
      inputValue,
      setInputValue,
      isValidDigit: isValidResponseInput,
      onDigit: t2
    };
    $[2] = inputValue;
    $[3] = setInputValue;
    $[4] = t2;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  useDebouncedDigitInput(t3);
  let t4;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Text color="ansi:cyan">● </Text>;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] !== message) {
    t5 = <Box>{t4}<Text bold={true}>{message}</Text></Box>;
    $[7] = message;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  let t6;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Box width={10}><Text><Text color="ansi:cyan">1</Text>: Bad</Text></Box>;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  let t7;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Box width={10}><Text><Text color="ansi:cyan">2</Text>: Fine</Text></Box>;
    $[10] = t7;
  } else {
    t7 = $[10];
  }
  let t8;
  if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Box width={10}><Text><Text color="ansi:cyan">3</Text>: Good</Text></Box>;
    $[11] = t8;
  } else {
    t8 = $[11];
  }
  let t9;
  if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = <Box marginLeft={2}>{t6}{t7}{t8}<Box><Text><Text color="ansi:cyan">0</Text>: Dismiss</Text></Box></Box>;
    $[12] = t9;
  } else {
    t9 = $[12];
  }
  let t10;
  if ($[13] !== t5) {
    t10 = <Box flexDirection="column" marginTop={1}>{t5}{t9}</Box>;
    $[13] = t5;
    $[14] = t10;
  } else {
    t10 = $[14];
  }
  return t10;
}
