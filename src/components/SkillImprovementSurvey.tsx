import { c as _c } from "react-compiler-runtime";
import React, { useEffect, useRef } from 'react';
import { BLACK_CIRCLE, BULLET_OPERATOR } from '../constants/figures.js';
import { Box, Text } from '../ink.js';
import type { SkillUpdate } from '../utils/hooks/skillImprovement.js';
import { normalizeFullWidthDigits } from '../utils/stringUtils.js';
import { isValidResponseInput } from './FeedbackSurvey/FeedbackSurveyView.js';
import type { FeedbackSurveyResponse } from './FeedbackSurvey/utils.js';
type Props = {
  isOpen: boolean;
  skillName: string;
  updates: SkillUpdate[];
  handleSelect: (selected: FeedbackSurveyResponse) => void;
  inputValue: string;
  setInputValue: (value: string) => void;
};
export function SkillImprovementSurvey(t0) {
  const $ = _c(6);
  const {
    isOpen,
    skillName,
    updates,
    handleSelect,
    inputValue,
    setInputValue
  } = t0;
  if (!isOpen) {
    return null;
  }
  if (inputValue && !isValidResponseInput(inputValue)) {
    return null;
  }
  let t1;
  if ($[0] !== handleSelect || $[1] !== inputValue || $[2] !== setInputValue || $[3] !== skillName || $[4] !== updates) {
    t1 = <SkillImprovementSurveyView skillName={skillName} updates={updates} onSelect={handleSelect} inputValue={inputValue} setInputValue={setInputValue} />;
    $[0] = handleSelect;
    $[1] = inputValue;
    $[2] = setInputValue;
    $[3] = skillName;
    $[4] = updates;
    $[5] = t1;
  } else {
    t1 = $[5];
  }
  return t1;
}
type ViewProps = {
  skillName: string;
  updates: SkillUpdate[];
  onSelect: (option: FeedbackSurveyResponse) => void;
  inputValue: string;
  setInputValue: (value: string) => void;
};

// Only 1 (apply) and 0 (dismiss) are valid for this survey
const VALID_INPUTS = ['0', '1'] as const;
function isValidInput(input: string): boolean {
  return (VALID_INPUTS as readonly string[]).includes(input);
}
function SkillImprovementSurveyView(t0) {
  const $ = _c(17);
  const {
    skillName,
    updates,
    onSelect,
    inputValue,
    setInputValue
  } = t0;
  const initialInputValue = useRef(inputValue);
  let t1;
  let t2;
  if ($[0] !== inputValue || $[1] !== onSelect || $[2] !== setInputValue) {
    t1 = () => {
      if (inputValue !== initialInputValue.current) {
        const lastChar = normalizeFullWidthDigits(inputValue.slice(-1));
        if (isValidInput(lastChar)) {
          setInputValue(inputValue.slice(0, -1));
          onSelect(lastChar === "1" ? "good" : "dismissed");
        }
      }
    };
    t2 = [inputValue, onSelect, setInputValue];
    $[0] = inputValue;
    $[1] = onSelect;
    $[2] = setInputValue;
    $[3] = t1;
    $[4] = t2;
  } else {
    t1 = $[3];
    t2 = $[4];
  }
  useEffect(t1, t2);
  let t3;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Text color="ansi:cyan">{BLACK_CIRCLE} </Text>;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] !== skillName) {
    t4 = <Box>{t3}<Text bold={true}>Пропонується покращення навички "{skillName}"</Text></Box>;
    $[6] = skillName;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] !== updates) {
    t5 = updates.map(_temp);
    $[8] = updates;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  let t6;
  if ($[10] !== t5) {
    t6 = <Box flexDirection="column" marginLeft={2}>{t5}</Box>;
    $[10] = t5;
    $[11] = t6;
  } else {
    t6 = $[11];
  }
  let t7;
  if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Box width={12}><Text><Text color="ansi:cyan">1</Text>: Застосувати</Text></Box>;
    $[12] = t7;
  } else {
    t7 = $[12];
  }
  let t8;
  if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Box marginLeft={2} marginTop={1}>{t7}<Box width={14}><Text><Text color="ansi:cyan">0</Text>: Відхилити</Text></Box></Box>;
    $[13] = t8;
  } else {
    t8 = $[13];
  }
  let t9;
  if ($[14] !== t4 || $[15] !== t6) {
    t9 = <Box flexDirection="column" marginTop={1}>{t4}{t6}{t8}</Box>;
    $[14] = t4;
    $[15] = t6;
    $[16] = t9;
  } else {
    t9 = $[16];
  }
  return t9;
}
function _temp(u, i) {
  return <Text key={i} dimColor={true}>{BULLET_OPERATOR} {u.change}</Text>;
}
