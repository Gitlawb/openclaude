import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import { Box, Link, Text } from '../ink.js';
import type { ExternalClaudeMdInclude } from '../utils/claudemd.js';
import { saveCurrentProjectConfig } from '../utils/config.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
type Props = {
  onDone(): void;
  isStandaloneDialog?: boolean;
  externalIncludes?: ExternalClaudeMdInclude[];
};
export function ClaudeMdExternalIncludesDialog(t0: Props) {
  const $ = _c(18);
  const {
    onDone,
    isStandaloneDialog,
    externalIncludes
  } = t0;
  let t1: [];
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [];
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  React.useEffect(_temp, t1);
  let t2;
  if ($[1] !== onDone) {
    t2 = (value: 'yes' | 'no') => {
      if (value === "no") {
        logEvent("tengu_claude_md_external_includes_dialog_declined", {});
        saveCurrentProjectConfig(_temp2);
      } else {
        logEvent("tengu_claude_md_external_includes_dialog_accepted", {});
        saveCurrentProjectConfig(_temp3);
      }
      onDone();
    };
    $[1] = onDone;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const handleSelection = t2;
  let t3;
  if ($[3] !== handleSelection) {
    t3 = () => {
      handleSelection("no");
    };
    $[3] = handleSelection;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  const handleEscape = t3;
  const t4 = !isStandaloneDialog;
  const t5 = !isStandaloneDialog;
  let t6;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Text>NNC.md цього проєкту імпортує файли поза поточною робочою директорією. Ніколи не дозволяйте це для стороннього репозиторію.</Text>;
    $[5] = t6;
  } else {
    t6 = $[5];
  }
  let t7;
  if ($[6] !== externalIncludes) {
    t7 = externalIncludes && externalIncludes.length > 0 && <Box flexDirection="column"><Text dimColor={true}>Зовнішні імпорти:</Text>{externalIncludes.map(_temp4)}</Box>;
    $[6] = externalIncludes;
    $[7] = t7;
  } else {
    t7 = $[7];
  }
  let t8;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Text dimColor={true}>Важливо: Використовуйте Нейромережу лише з файлами, яким ви довіряєте. Доступ до неперевірених файлів може створити ризики безпеки{" "}<Link url="https://code.claude.com/docs/en/security" />{" "}</Text>;
    $[8] = t8;
  } else {
    t8 = $[8];
  }
  let t9;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = [{
      label: "Так, дозволити зовнішні імпорти",
      value: "yes"
    }, {
      label: "Ні, вимкнути зовнішні імпорти",
      value: "no"
    }];
    $[9] = t9;
  } else {
    t9 = $[9];
  }
  let t10;
  if ($[10] !== handleSelection) {
    t10 = <Select options={t9} onChange={(value_0: string) => handleSelection(value_0 as 'yes' | 'no')} />;
    $[10] = handleSelection;
    $[11] = t10;
  } else {
    t10 = $[11];
  }
  let t11;
  if ($[12] !== handleEscape || $[13] !== t10 || $[14] !== t4 || $[15] !== t5 || $[16] !== t7) {
    t11 = <Dialog title="Дозволити зовнішні імпорти NNC.md?" color="warning" onCancel={handleEscape} hideBorder={t4} hideInputGuide={t5}>{t6}{t7}{t8}{t10}</Dialog>;
    $[12] = handleEscape;
    $[13] = t10;
    $[14] = t4;
    $[15] = t5;
    $[16] = t7;
    $[17] = t11;
  } else {
    t11 = $[17];
  }
  return t11;
}
function _temp4(include: ExternalClaudeMdInclude, i: number) {
  return <Text key={i} dimColor={true}>{"  "}{include.path}</Text>;
}
function _temp3(current_0: any) {
  return {
    ...current_0,
    hasClaudeMdExternalIncludesApproved: true,
    hasClaudeMdExternalIncludesWarningShown: true
  };
}
function _temp2(current: any) {
  return {
    ...current,
    hasClaudeMdExternalIncludesApproved: false,
    hasClaudeMdExternalIncludesWarningShown: true
  };
}
function _temp() {
  logEvent("tengu_claude_md_includes_dialog_shown", {});
}
