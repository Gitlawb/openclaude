import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { Select } from 'src/components/CustomSelect/index.js';
import { Box, Text } from '../../ink.js';
interface ExistingWorkflowStepProps {
  repoName: string;
  onSelectAction: (action: 'update' | 'skip' | 'exit') => void;
}
export function ExistingWorkflowStep(t0) {
  const $ = _c(16);
  const {
    repoName,
    onSelectAction
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [{
      label: "Оновити workflow файл до останньої версії",
      value: "update"
    }, {
      label: "Пропустити оновлення workflow (налаштувати лише secrets)",
      value: "skip"
    }, {
      label: "Вийти без змін",
      value: "exit"
    }];
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const options = t1;
  let t2;
  if ($[1] !== onSelectAction) {
    t2 = value => {
      onSelectAction(value as 'update' | 'skip' | 'exit');
    };
    $[1] = onSelectAction;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const handleSelect = t2;
  let t3;
  if ($[3] !== onSelectAction) {
    t3 = () => {
      onSelectAction("exit");
    };
    $[3] = onSelectAction;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  const handleCancel = t3;
  let t4;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Text bold={true}>Знайдено наявний workflow</Text>;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  let t5;
  if ($[6] !== repoName) {
    t5 = <Box flexDirection="column" marginBottom={1}>{t4}<Text dimColor={true}>Репозиторій: {repoName}</Text></Box>;
    $[6] = repoName;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  let t6;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Box flexDirection="column" marginBottom={1}><Text>Файл workflow уже існує у{" "}<Text color="claude">.github/workflows/claude.yml</Text></Text><Text dimColor={true}>Що бажаєте зробити?</Text></Box>;
    $[8] = t6;
  } else {
    t6 = $[8];
  }
  let t7;
  if ($[9] !== handleCancel || $[10] !== handleSelect) {
    t7 = <Box flexDirection="column"><Select options={options} onChange={handleSelect} onCancel={handleCancel} /></Box>;
    $[9] = handleCancel;
    $[10] = handleSelect;
    $[11] = t7;
  } else {
    t7 = $[11];
  }
  let t8;
  if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Box marginTop={1}><Text dimColor={true}>Перегляньте останній шаблон workflow:{" "}<Text color="claude">https://github.com/anthropics/claude-code-action/blob/main/examples/claude.yml</Text></Text></Box>;
    $[12] = t8;
  } else {
    t8 = $[12];
  }
  let t9;
  if ($[13] !== t5 || $[14] !== t7) {
    t9 = <Box flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1}>{t5}{t6}{t7}{t8}</Box>;
    $[13] = t5;
    $[14] = t7;
    $[15] = t9;
  } else {
    t9 = $[15];
  }
  return t9;
}
