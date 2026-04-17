import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { GITHUB_ACTION_SETUP_DOCS_URL } from '../../constants/github-app.js';
import { Box, Text } from '../../ink.js';
interface ErrorStepProps {
  error: string | undefined;
  errorReason?: string;
  errorInstructions?: string[];
}
export function ErrorStep(t0) {
  const $ = _c(15);
  const {
    error,
    errorReason,
    errorInstructions
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Box flexDirection="column" marginBottom={1}><Text bold={true}>Встановлення GitHub застосунку</Text></Box>;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== error) {
    t2 = <Text color="error">Помилка: {error}</Text>;
    $[1] = error;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== errorReason) {
    t3 = errorReason && <Box marginTop={1}><Text dimColor={true}>Причина: {errorReason}</Text></Box>;
    $[3] = errorReason;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== errorInstructions) {
    t4 = errorInstructions && errorInstructions.length > 0 && <Box flexDirection="column" marginTop={1}><Text dimColor={true}>Як виправити:</Text>{errorInstructions.map(_temp)}</Box>;
    $[5] = errorInstructions;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Box marginTop={1}><Text dimColor={true}>Інструкції для ручного налаштування:{" "}<Text color="claude">{GITHUB_ACTION_SETUP_DOCS_URL}</Text></Text></Box>;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  let t6;
  if ($[8] !== t2 || $[9] !== t3 || $[10] !== t4) {
    t6 = <Box flexDirection="column" borderStyle="round" paddingX={1}>{t1}{t2}{t3}{t4}{t5}</Box>;
    $[8] = t2;
    $[9] = t3;
    $[10] = t4;
    $[11] = t6;
  } else {
    t6 = $[11];
  }
  let t7;
  if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Box marginLeft={3}><Text dimColor={true}>Натисніть будь-яку клавішу для виходу</Text></Box>;
    $[12] = t7;
  } else {
    t7 = $[12];
  }
  let t8;
  if ($[13] !== t6) {
    t8 = <>{t6}{t7}</>;
    $[13] = t6;
    $[14] = t8;
  } else {
    t8 = $[14];
  }
  return t8;
}
function _temp(instruction, index) {
  return <Box key={index} marginLeft={2}><Text dimColor={true}>• </Text><Text>{instruction}</Text></Box>;
}
