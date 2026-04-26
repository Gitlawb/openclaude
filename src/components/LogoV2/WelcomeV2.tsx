import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { Box, Text, useTheme } from 'src/ink.js';
import { env } from '../../utils/env.js';
const WELCOME_V2_WIDTH = 58;
export function WelcomeV2() {
  const $ = _c(35);
  const [theme] = useTheme();
  if (env.terminal === "Apple_Terminal") {
    let t0;
    if ($[0] !== theme) {
      t0 = <AppleTerminalWelcomeV2 theme={theme} welcomeMessage="Welcome to OpenClaude" />;
      $[0] = theme;
      $[1] = t0;
    } else {
      t0 = $[1];
    }
    return t0;
  }
  if (["light", "light-daltonized", "light-ansi"].includes(theme)) {
    let t0;
    let t1;
    let t2;
    let t3;
    let t4;
    let t5;
    let t6;
    let t7;
    let t8;
    if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
      t0 = <Text><Text color="claude">{"Welcome to OpenClaude"} </Text><Text dimColor={true}>v{MACRO.DISPLAY_VERSION ?? MACRO.VERSION} </Text></Text>;
      t1 = <Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}</Text>;
      t2 = <Text>{"                                                          "}</Text>;
      t3 = <Text>{"                                                          "}</Text>;
      t4 = <Text>{"                                                          "}</Text>;
      t5 = <Text>{"            \u2591\u2591\u2591\u2591\u2591\u2591                                        "}</Text>;
      t6 = <Text>{"    \u2591\u2591\u2591   \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591                                      "}</Text>;
      t7 = <Text>{"   \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591                                    "}</Text>;
      t8 = <Text>{"                                                          "}</Text>;
      $[2] = t0;
      $[3] = t1;
      $[4] = t2;
      $[5] = t3;
      $[6] = t4;
      $[7] = t5;
      $[8] = t6;
      $[9] = t7;
      $[10] = t8;
    } else {
      t0 = $[2];
      t1 = $[3];
      t2 = $[4];
      t3 = $[5];
      t4 = $[6];
      t5 = $[7];
      t6 = $[8];
      t7 = $[9];
      t8 = $[10];
    }
    let t9;
    if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
      t9 = <Text><Text dimColor={true}>{"                           \u2591\u2591\u2591\u2591"}</Text><Text>{"                     \u2588\u2588    "}</Text></Text>;
      $[11] = t9;
    } else {
      t9 = $[11];
    }
    let t10;
    let t11;
    if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
      t10 = <Text><Text dimColor={true}>{"                         \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591"}</Text><Text>{"               \u2588\u2588\u2592\u2592\u2588\u2588  "}</Text></Text>;
      t11 = <Text>{"                                            \u2592\u2592      \u2588\u2588   \u2592"}</Text>;
      $[12] = t10;
      $[13] = t11;
    } else {
      t10 = $[12];
      t11 = $[13];
    }
    let t12;
    if ($[14] === Symbol.for("react.memo_cache_sentinel")) {
      t12 = <Text>{"      "}<Text color="clawd_body"> █████████ </Text>{"                         \u2592\u2592\u2591\u2591\u2592\u2592      \u2592 \u2592\u2592"}</Text>;
      $[14] = t12;
    } else {
      t12 = $[14];
    }
    let t13;
    if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
      t13 = <Text>{"      "}<Text color="clawd_body" backgroundColor="clawd_background">██▄█████▄██</Text>{"                           \u2592\u2592         \u2592\u2592 "}</Text>;
      $[15] = t13;
    } else {
      t13 = $[15];
    }
    let t14;
    if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
      t14 = <Text>{"      "}<Text color="clawd_body"> █████████ </Text>{"                          \u2591          \u2592   "}</Text>;
      $[16] = t14;
    } else {
      t14 = $[16];
    }
    let t15;
    if ($[17] === Symbol.for("react.memo_cache_sentinel")) {
      t15 = <Box width={WELCOME_V2_WIDTH}><Text>{t0}{t1}{t2}{t3}{t4}{t5}{t6}{t7}{t8}{t9}{t10}{t11}{t12}{t13}{t14}<Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}<Text color="clawd_body">{"\u2588 \u2588   \u2588 \u2588"}</Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2591\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2592\u2026\u2026\u2026\u2026"}</Text></Text></Box>;
      $[17] = t15;
    } else {
      t15 = $[17];
    }
    return t15;
  }
  let t0;
  let t1;
  let t2;
  let t3;
  let t4;
  let t5;
  let t6;
  if ($[18] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = <Text><Text color="claude">{"Welcome to OpenClaude"} </Text><Text dimColor={true}>v{MACRO.DISPLAY_VERSION ?? MACRO.VERSION} </Text></Text>;
    t1 = <Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}</Text>;
    t2 = <Text>{"                                                          "}</Text>;
    t3 = <Text>{"     *                                       \u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2591     "}</Text>;
    t4 = <Text>{"                                 *         \u2588\u2588\u2588\u2593\u2591     \u2591\u2591   "}</Text>;
    t5 = <Text>{"            \u2591\u2591\u2591\u2591\u2591\u2591                        \u2588\u2588\u2588\u2593\u2591           "}</Text>;
    t6 = <Text>{"    \u2591\u2591\u2591   \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591                      \u2588\u2588\u2588\u2593\u2591           "}</Text>;
    $[18] = t0;
    $[19] = t1;
    $[20] = t2;
    $[21] = t3;
    $[22] = t4;
    $[23] = t5;
    $[24] = t6;
  } else {
    t0 = $[18];
    t1 = $[19];
    t2 = $[20];
    t3 = $[21];
    t4 = $[22];
    t5 = $[23];
    t6 = $[24];
  }
  let t10;
  let t11;
  let t7;
  let t8;
  let t9;
  if ($[25] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Text><Text>{"   \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591    "}</Text><Text bold={true}>*</Text><Text>{"                \u2588\u2588\u2593\u2591\u2591      \u2593   "}</Text></Text>;
    t8 = <Text>{"                                             \u2591\u2593\u2593\u2588\u2588\u2588\u2593\u2593\u2591    "}</Text>;
    t9 = <Text dimColor={true}>{" *                                 \u2591\u2591\u2591\u2591                   "}</Text>;
    t10 = <Text dimColor={true}>{"                                 \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591                 "}</Text>;
    t11 = <Text dimColor={true}>{"                               \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591           "}</Text>;
    $[25] = t10;
    $[26] = t11;
    $[27] = t7;
    $[28] = t8;
    $[29] = t9;
  } else {
    t10 = $[25];
    t11 = $[26];
    t7 = $[27];
    t8 = $[28];
    t9 = $[29];
  }
  let t12;
  if ($[30] === Symbol.for("react.memo_cache_sentinel")) {
    t12 = <Text color="clawd_body"> █████████ </Text>;
    $[30] = t12;
  } else {
    t12 = $[30];
  }
  let t13;
  if ($[31] === Symbol.for("react.memo_cache_sentinel")) {
    t13 = <Text>{"      "}{t12}{"                                       "}<Text dimColor={true}>*</Text><Text> </Text></Text>;
    $[31] = t13;
  } else {
    t13 = $[31];
  }
  let t14;
  if ($[32] === Symbol.for("react.memo_cache_sentinel")) {
    t14 = <Text>{"      "}<Text color="clawd_body">██▄█████▄██</Text><Text>{"                        "}</Text><Text bold={true}>*</Text><Text>{"                "}</Text></Text>;
    $[32] = t14;
  } else {
    t14 = $[32];
  }
  let t15;
  if ($[33] === Symbol.for("react.memo_cache_sentinel")) {
    t15 = <Text>{"      "}<Text color="clawd_body"> █████████ </Text>{"     *                                   "}</Text>;
    $[33] = t15;
  } else {
    t15 = $[33];
  }
  let t16;
  if ($[34] === Symbol.for("react.memo_cache_sentinel")) {
    t16 = <Box width={WELCOME_V2_WIDTH}><Text>{t0}{t1}{t2}{t3}{t4}{t5}{t6}{t7}{t8}{t9}{t10}{t11}{t13}{t14}{t15}<Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}<Text color="clawd_body">{"\u2588 \u2588   \u2588 \u2588"}</Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}</Text></Text></Box>;
    $[34] = t16;
  } else {
    t16 = $[34];
  }
  return t16;
}
type AppleTerminalWelcomeV2Props = {
  theme: string;
  welcomeMessage: string;
};
function AppleTerminalWelcomeV2(t0) {
  const $ = _c(44);
  const {
    theme,
    welcomeMessage
  } = t0;
  const isLightTheme = ["light", "light-daltonized", "light-ansi"].includes(theme);
  if (isLightTheme) {
    let t1;
    if ($[0] !== welcomeMessage) {
      t1 = <Text color="claude">{welcomeMessage} </Text>;
      $[0] = welcomeMessage;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    let t2;
    if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
      t2 = <Text dimColor={true}>v{MACRO.DISPLAY_VERSION ?? MACRO.VERSION} </Text>;
      $[2] = t2;
    } else {
      t2 = $[2];
    }
    let t3;
    if ($[3] !== t1) {
      t3 = <Text>{t1}{t2}</Text>;
      $[3] = t1;
      $[4] = t3;
    } else {
      t3 = $[4];
    }
    let t10;
    let t11;
    let t4;
    let t5;
    let t6;
    let t7;
    let t8;
    let t9;
    if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = <Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}</Text>;
      t5 = <Text>{"                                                          "}</Text>;
      t6 = <Text>{"                                                          "}</Text>;
      t7 = <Text>{"                                                          "}</Text>;
      t8 = <Text>{"            \u2591\u2591\u2591\u2591\u2591\u2591                                        "}</Text>;
      t9 = <Text>{"    \u2591\u2591\u2591   \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591                                      "}</Text>;
      t10 = <Text>{"   \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591                                    "}</Text>;
      t11 = <Text>{"                                                          "}</Text>;
      $[5] = t10;
      $[6] = t11;
      $[7] = t4;
      $[8] = t5;
      $[9] = t6;
      $[10] = t7;
      $[11] = t8;
      $[12] = t9;
    } else {
      t10 = $[5];
      t11 = $[6];
      t4 = $[7];
      t5 = $[8];
      t6 = $[9];
      t7 = $[10];
      t8 = $[11];
      t9 = $[12];
    }
    let t12;
    if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
      t12 = <Text><Text dimColor={true}>{"                           \u2591\u2591\u2591\u2591"}</Text><Text>{"                     \u2588\u2588    "}</Text></Text>;
      $[13] = t12;
    } else {
      t12 = $[13];
    }
    let t13;
    let t14;
    let t15;
    if ($[14] === Symbol.for("react.memo_cache_sentinel")) {
      t13 = <Text><Text dimColor={true}>{"                         \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591"}</Text><Text>{"               \u2588\u2588\u2592\u2592\u2588\u2588  "}</Text></Text>;
      t14 = <Text>{"                                            \u2592\u2592      \u2588\u2588   \u2592"}</Text>;
      t15 = <Text>{"                                          \u2592\u2592\u2591\u2591\u2592\u2592      \u2592 \u2592\u2592"}</Text>;
      $[14] = t13;
      $[15] = t14;
      $[16] = t15;
    } else {
      t13 = $[14];
      t14 = $[15];
      t15 = $[16];
    }
    let t16;
    if ($[17] === Symbol.for("react.memo_cache_sentinel")) {
      t16 = <Text>{"      "}<Text color="clawd_body">▗</Text><Text color="clawd_background" backgroundColor="clawd_body">{" "}▗{"     "}▖{" "}</Text><Text color="clawd_body">▖</Text>{"                           \u2592\u2592         \u2592\u2592 "}</Text>;
      $[17] = t16;
    } else {
      t16 = $[17];
    }
    let t17;
    if ($[18] === Symbol.for("react.memo_cache_sentinel")) {
      t17 = <Text>{"       "}<Text backgroundColor="clawd_body">{" ".repeat(9)}</Text>{"                           \u2591          \u2592   "}</Text>;
      $[18] = t17;
    } else {
      t17 = $[18];
    }
    let t18;
    if ($[19] === Symbol.for("react.memo_cache_sentinel")) {
      t18 = <Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}<Text backgroundColor="clawd_body"> </Text><Text> </Text><Text backgroundColor="clawd_body"> </Text><Text>{"   "}</Text><Text backgroundColor="clawd_body"> </Text><Text> </Text><Text backgroundColor="clawd_body"> </Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2591\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2592\u2026\u2026\u2026\u2026"}</Text>;
      $[19] = t18;
    } else {
      t18 = $[19];
    }
    let t19;
    if ($[20] !== t3) {
      t19 = <Box width={WELCOME_V2_WIDTH}><Text>{t3}{t4}{t5}{t6}{t7}{t8}{t9}{t10}{t11}{t12}{t13}{t14}{t15}{t16}{t17}{t18}</Text></Box>;
      $[20] = t3;
      $[21] = t19;
    } else {
      t19 = $[21];
    }
    return t19;
  }
  let t1;
  if ($[22] !== welcomeMessage) {
    t1 = <Text color="claude">{welcomeMessage} </Text>;
    $[22] = welcomeMessage;
    $[23] = t1;
  } else {
    t1 = $[23];
  }
  let t2;
  if ($[24] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Text dimColor={true}>v{MACRO.DISPLAY_VERSION ?? MACRO.VERSION} </Text>;
    $[24] = t2;
  } else {
    t2 = $[24];
  }
  let t3;
  if ($[25] !== t1) {
    t3 = <Text>{t1}{t2}</Text>;
    $[25] = t1;
    $[26] = t3;
  } else {
    t3 = $[26];
  }
  let t4;
  let t5;
  let t6;
  let t7;
  let t8;
  let t9;
  if ($[27] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}</Text>;
    t5 = <Text>{"                                                          "}</Text>;
    t6 = <Text>{"     *                                       \u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2591     "}</Text>;
    t7 = <Text>{"                                 *         \u2588\u2588\u2588\u2593\u2591     \u2591\u2591   "}</Text>;
    t8 = <Text>{"            \u2591\u2591\u2591\u2591\u2591\u2591                        \u2588\u2588\u2588\u2593\u2591           "}</Text>;
    t9 = <Text>{"    \u2591\u2591\u2591   \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591                      \u2588\u2588\u2588\u2593\u2591           "}</Text>;
    $[27] = t4;
    $[28] = t5;
    $[29] = t6;
    $[30] = t7;
    $[31] = t8;
    $[32] = t9;
  } else {
    t4 = $[27];
    t5 = $[28];
    t6 = $[29];
    t7 = $[30];
    t8 = $[31];
    t9 = $[32];
  }
  let t10;
  let t11;
  let t12;
  let t13;
  let t14;
  if ($[33] === Symbol.for("react.memo_cache_sentinel")) {
    t10 = <Text><Text>{"   \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591    "}</Text><Text bold={true}>*</Text><Text>{"                \u2588\u2588\u2593\u2591\u2591      \u2593   "}</Text></Text>;
    t11 = <Text>{"                                             \u2591\u2593\u2593\u2588\u2588\u2588\u2593\u2593\u2591    "}</Text>;
    t12 = <Text dimColor={true}>{" *                                 \u2591\u2591\u2591\u2591                   "}</Text>;
    t13 = <Text dimColor={true}>{"                                 \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591                 "}</Text>;
    t14 = <Text dimColor={true}>{"                               \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591           "}</Text>;
    $[33] = t10;
    $[34] = t11;
    $[35] = t12;
    $[36] = t13;
    $[37] = t14;
  } else {
    t10 = $[33];
    t11 = $[34];
    t12 = $[35];
    t13 = $[36];
    t14 = $[37];
  }
  let t15;
  if ($[38] === Symbol.for("react.memo_cache_sentinel")) {
    t15 = <Text>{"                                                      "}<Text dimColor={true}>*</Text><Text> </Text></Text>;
    $[38] = t15;
  } else {
    t15 = $[38];
  }
  let t16;
  if ($[39] === Symbol.for("react.memo_cache_sentinel")) {
    t16 = <Text>{"        "}<Text color="clawd_body">▗</Text><Text color="clawd_background" backgroundColor="clawd_body">{" "}▗{"     "}▖{" "}</Text><Text color="clawd_body">▖</Text><Text>{"                       "}</Text><Text bold={true}>*</Text><Text>{"                "}</Text></Text>;
    $[39] = t16;
  } else {
    t16 = $[39];
  }
  let t17;
  if ($[40] === Symbol.for("react.memo_cache_sentinel")) {
    t17 = <Text>{"        "}<Text backgroundColor="clawd_body">{" ".repeat(9)}</Text>{"      *                                   "}</Text>;
    $[40] = t17;
  } else {
    t17 = $[40];
  }
  let t18;
  if ($[41] === Symbol.for("react.memo_cache_sentinel")) {
    t18 = <Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}<Text backgroundColor="clawd_body"> </Text><Text> </Text><Text backgroundColor="clawd_body"> </Text><Text>{"   "}</Text><Text backgroundColor="clawd_body"> </Text><Text> </Text><Text backgroundColor="clawd_body"> </Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}</Text>;
    $[41] = t18;
  } else {
    t18 = $[41];
  }
  let t19;
  if ($[42] !== t3) {
    t19 = <Box width={WELCOME_V2_WIDTH}><Text>{t3}{t4}{t5}{t6}{t7}{t8}{t9}{t10}{t11}{t12}{t13}{t14}{t15}{t16}{t17}{t18}</Text></Box>;
    $[42] = t3;
    $[43] = t19;
  } else {
    t19 = $[43];
  }
  return t19;
}
