import { c as _c } from "react-compiler-runtime";
import figures from 'figures';
import React from 'react';
import { Box, Text } from '../../../ink.js';
import type { Question } from '../../../tools/AskUserQuestionTool/AskUserQuestionTool.js';
import type { PermissionDecision } from '../../../utils/permissions/PermissionResult.js';
import { Select } from '../../CustomSelect/index.js';
import { Divider } from '../../design-system/Divider.js';
import { PermissionRequestTitle } from '../PermissionRequestTitle.js';
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js';
import { QuestionNavigationBar } from './QuestionNavigationBar.js';
type Props = {
  questions: Question[];
  currentQuestionIndex: number;
  answers: Record<string, string>;
  allQuestionsAnswered: boolean;
  permissionResult: PermissionDecision;
  minContentHeight?: number;
  onFinalResponse: (value: 'submit' | 'cancel') => void;
};
export function SubmitQuestionsView(t0) {
  const $ = _c(27);
  const {
    questions,
    currentQuestionIndex,
    answers,
    allQuestionsAnswered,
    permissionResult,
    minContentHeight,
    onFinalResponse
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Divider color="inactive" />;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== answers || $[2] !== currentQuestionIndex || $[3] !== questions) {
    t2 = <QuestionNavigationBar questions={questions} currentQuestionIndex={currentQuestionIndex} answers={answers} />;
    $[1] = answers;
    $[2] = currentQuestionIndex;
    $[3] = questions;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <PermissionRequestTitle title="Review your answers" color="text" />;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] !== allQuestionsAnswered) {
    t4 = !allQuestionsAnswered && <Box marginBottom={1}><Text color="warning">{figures.warning} You have not answered all questions</Text></Box>;
    $[6] = allQuestionsAnswered;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] !== answers || $[9] !== questions) {
    t5 = Object.keys(answers).length > 0 && <Box flexDirection="column" marginBottom={1}>{questions.filter(q => q?.question && answers[q.question]).map(q_0 => {
        const answer = answers[q_0?.question];
        return <Box key={q_0?.question || "answer"} flexDirection="column" marginLeft={1}><Text>{figures.bullet} {q_0?.question || "Question"}</Text><Box marginLeft={2}><Text color="success">{figures.arrowRight} {answer}</Text></Box></Box>;
      })}</Box>;
    $[8] = answers;
    $[9] = questions;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  let t6;
  if ($[11] !== permissionResult) {
    t6 = <PermissionRuleExplanation permissionResult={permissionResult} toolType="tool" />;
    $[11] = permissionResult;
    $[12] = t6;
  } else {
    t6 = $[12];
  }
  let t7;
  if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Text color="inactive">Ready to submit your answers?</Text>;
    $[13] = t7;
  } else {
    t7 = $[13];
  }
  let t8;
  if ($[14] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = {
      type: "text" as const,
      label: "Submit answers",
      value: "submit"
    };
    $[14] = t8;
  } else {
    t8 = $[14];
  }
  let t9;
  if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = [t8, {
      type: "text" as const,
      label: "Cancel",
      value: "cancel"
    }];
    $[15] = t9;
  } else {
    t9 = $[15];
  }
  let t10;
  if ($[16] !== onFinalResponse) {
    t10 = <Box marginTop={1}><Select options={t9} onChange={value => onFinalResponse(value as 'submit' | 'cancel')} onCancel={() => onFinalResponse("cancel")} /></Box>;
    $[16] = onFinalResponse;
    $[17] = t10;
  } else {
    t10 = $[17];
  }
  let t11;
  if ($[18] !== minContentHeight || $[19] !== t10 || $[20] !== t4 || $[21] !== t5 || $[22] !== t6) {
    t11 = <Box flexDirection="column" marginTop={1} minHeight={minContentHeight}>{t4}{t5}{t6}{t7}{t10}</Box>;
    $[18] = minContentHeight;
    $[19] = t10;
    $[20] = t4;
    $[21] = t5;
    $[22] = t6;
    $[23] = t11;
  } else {
    t11 = $[23];
  }
  let t12;
  if ($[24] !== t11 || $[25] !== t2) {
    t12 = <Box flexDirection="column" marginTop={1}>{t1}<Box flexDirection="column" borderTop={true} borderColor="inactive" paddingTop={0}>{t2}{t3}{t11}</Box></Box>;
    $[24] = t11;
    $[25] = t2;
    $[26] = t12;
  } else {
    t12 = $[26];
  }
  return t12;
}
