import { c as _c } from "react-compiler-runtime";
import React from 'react';
import type { DeepImmutable } from 'src/types/utils.js';
import { useElapsedTime } from '../../hooks/useElapsedTime.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Text } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import type { DreamTaskState } from '../../tasks/DreamTask/DreamTask.js';
import { plural } from '../../utils/stringUtils.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
type Props = {
  task: DeepImmutable<DreamTaskState>;
  onDone: () => void;
  onBack?: () => void;
  onKill?: () => void;
};

// How many recent turns to render. Earlier turns collapse to a count.
const VISIBLE_TURNS = 6;
export function DreamDetailDialog(t0) {
  const $ = _c(70);
  const {
    task,
    onDone,
    onBack,
    onKill
  } = t0;
  const elapsedTime = useElapsedTime(task.startTime, task.status === "running", 1000, 0);
  let t1;
  if ($[0] !== onDone) {
    t1 = {
      "confirm:yes": onDone
    };
    $[0] = onDone;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = {
      context: "Confirmation"
    };
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  useKeybindings(t1, t2);
  let t3;
  if ($[3] !== onBack || $[4] !== onDone || $[5] !== onKill || $[6] !== task.status) {
    t3 = e => {
      if (e.key === " ") {
        e.preventDefault();
        onDone();
      } else {
        if (e.key === "left" && onBack) {
          e.preventDefault();
          onBack();
        } else {
          if (e.key === "x" && task.status === "running" && onKill) {
            e.preventDefault();
            onKill();
          }
        }
      }
    };
    $[3] = onBack;
    $[4] = onDone;
    $[5] = onKill;
    $[6] = task.status;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  const handleKeyDown = t3;
  let T0;
  let T1;
  let T2;
  let t10;
  let t11;
  let t12;
  let t13;
  let t14;
  let t15;
  let t16;
  let t4;
  let t5;
  let t6;
  let t7;
  let t8;
  let t9;
  if ($[8] !== elapsedTime || $[9] !== handleKeyDown || $[10] !== onBack || $[11] !== onDone || $[12] !== onKill || $[13] !== task.filesTouched.length || $[14] !== task.sessionsReviewing || $[15] !== task.status || $[16] !== task.turns) {
    const visibleTurns = task.turns.filter(_temp);
    const shown = visibleTurns.slice(-VISIBLE_TURNS);
    const hidden = visibleTurns.length - shown.length;
    T2 = Box;
    t13 = "column";
    t14 = 0;
    t15 = true;
    t16 = handleKeyDown;
    T1 = Dialog;
    t8 = "Memory consolidation";
    const t17 = task.sessionsReviewing;
    let t18;
    if ($[33] !== task.sessionsReviewing) {
      t18 = plural(task.sessionsReviewing, "session");
      $[33] = task.sessionsReviewing;
      $[34] = t18;
    } else {
      t18 = $[34];
    }
    let t19;
    if ($[35] !== task.filesTouched.length) {
      t19 = task.filesTouched.length > 0 && <>{" "}· {task.filesTouched.length}{" "}{plural(task.filesTouched.length, "file")} touched</>;
      $[35] = task.filesTouched.length;
      $[36] = t19;
    } else {
      t19 = $[36];
    }
    if ($[37] !== elapsedTime || $[38] !== t18 || $[39] !== t19 || $[40] !== task.sessionsReviewing) {
      t9 = <Text dimColor={true}>{elapsedTime} · reviewing {t17}{" "}{t18}{t19}</Text>;
      $[37] = elapsedTime;
      $[38] = t18;
      $[39] = t19;
      $[40] = task.sessionsReviewing;
      $[41] = t9;
    } else {
      t9 = $[41];
    }
    t10 = onDone;
    t11 = "background";
    if ($[42] !== onBack || $[43] !== onKill || $[44] !== task.status) {
      t12 = exitState => exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <Byline>{onBack && <KeyboardShortcutHint shortcut={"\u2190"} action="go back" />}<KeyboardShortcutHint shortcut="Esc/Enter/Space" action="close" />{task.status === "running" && onKill && <KeyboardShortcutHint shortcut="x" action="stop" />}</Byline>;
      $[42] = onBack;
      $[43] = onKill;
      $[44] = task.status;
      $[45] = t12;
    } else {
      t12 = $[45];
    }
    T0 = Box;
    t4 = "column";
    t5 = 1;
    let t20;
    if ($[46] === Symbol.for("react.memo_cache_sentinel")) {
      t20 = <Text bold={true}>Status:</Text>;
      $[46] = t20;
    } else {
      t20 = $[46];
    }
    if ($[47] !== task.status) {
      t6 = <Text>{t20}{" "}{task.status === "running" ? <Text color="background">running</Text> : task.status === "completed" ? <Text color="success">{task.status}</Text> : <Text color="error">{task.status}</Text>}</Text>;
      $[47] = task.status;
      $[48] = t6;
    } else {
      t6 = $[48];
    }
    t7 = shown.length === 0 ? <Text dimColor={true}>{task.status === "running" ? "Starting\u2026" : "(no text output)"}</Text> : <>{hidden > 0 && <Text dimColor={true}>({hidden} earlier {plural(hidden, "turn")})</Text>}{shown.map(_temp2)}</>;
    $[8] = elapsedTime;
    $[9] = handleKeyDown;
    $[10] = onBack;
    $[11] = onDone;
    $[12] = onKill;
    $[13] = task.filesTouched.length;
    $[14] = task.sessionsReviewing;
    $[15] = task.status;
    $[16] = task.turns;
    $[17] = T0;
    $[18] = T1;
    $[19] = T2;
    $[20] = t10;
    $[21] = t11;
    $[22] = t12;
    $[23] = t13;
    $[24] = t14;
    $[25] = t15;
    $[26] = t16;
    $[27] = t4;
    $[28] = t5;
    $[29] = t6;
    $[30] = t7;
    $[31] = t8;
    $[32] = t9;
  } else {
    T0 = $[17];
    T1 = $[18];
    T2 = $[19];
    t10 = $[20];
    t11 = $[21];
    t12 = $[22];
    t13 = $[23];
    t14 = $[24];
    t15 = $[25];
    t16 = $[26];
    t4 = $[27];
    t5 = $[28];
    t6 = $[29];
    t7 = $[30];
    t8 = $[31];
    t9 = $[32];
  }
  let t17;
  if ($[49] !== T0 || $[50] !== t4 || $[51] !== t5 || $[52] !== t6 || $[53] !== t7) {
    t17 = <T0 flexDirection={t4} gap={t5}>{t6}{t7}</T0>;
    $[49] = T0;
    $[50] = t4;
    $[51] = t5;
    $[52] = t6;
    $[53] = t7;
    $[54] = t17;
  } else {
    t17 = $[54];
  }
  let t18;
  if ($[55] !== T1 || $[56] !== t10 || $[57] !== t11 || $[58] !== t12 || $[59] !== t17 || $[60] !== t8 || $[61] !== t9) {
    t18 = <T1 title={t8} subtitle={t9} onCancel={t10} color={t11} inputGuide={t12}>{t17}</T1>;
    $[55] = T1;
    $[56] = t10;
    $[57] = t11;
    $[58] = t12;
    $[59] = t17;
    $[60] = t8;
    $[61] = t9;
    $[62] = t18;
  } else {
    t18 = $[62];
  }
  let t19;
  if ($[63] !== T2 || $[64] !== t13 || $[65] !== t14 || $[66] !== t15 || $[67] !== t16 || $[68] !== t18) {
    t19 = <T2 flexDirection={t13} tabIndex={t14} autoFocus={t15} onKeyDown={t16}>{t18}</T2>;
    $[63] = T2;
    $[64] = t13;
    $[65] = t14;
    $[66] = t15;
    $[67] = t16;
    $[68] = t18;
    $[69] = t19;
  } else {
    t19 = $[69];
  }
  return t19;
}
function _temp2(turn, i) {
  return <Box key={i} flexDirection="column"><Text wrap="wrap">{turn.text}</Text>{turn.toolUseCount > 0 && <Text dimColor={true}>{"  "}({turn.toolUseCount}{" "}{plural(turn.toolUseCount, "tool")})</Text>}</Box>;
}
function _temp(t) {
  return t.text !== "";
}
