import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { DIAMOND_FILLED, DIAMOND_OPEN } from '../../constants/figures.js';
import { NO_CONTENT_MESSAGE } from '../../constants/messages.js';
import { Box, Text } from '../../ink.js';
import { extractTag } from '../../utils/messages.js';
import { Markdown } from '../Markdown.js';
import FullWidthRow from '../design-system/FullWidthRow.js';
import { MessageResponse } from '../MessageResponse.js';
type Props = {
  content: string;
};
export function UserLocalCommandOutputMessage(t0) {
  const $ = _c(4);
  const {
    content
  } = t0;
  let lines;
  let t1;
  if ($[0] !== content) {
    t1 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const stdout = extractTag(content, "local-command-stdout");
      const stderr = extractTag(content, "local-command-stderr");
      if (!stdout && !stderr) {
        let t2;
        if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
          t2 = <MessageResponse><Text dimColor={true}>{NO_CONTENT_MESSAGE}</Text></MessageResponse>;
          $[3] = t2;
        } else {
          t2 = $[3];
        }
        t1 = t2;
        break bb0;
      }
      lines = [];
      if (stdout?.trim()) {
        lines.push(<IndentedContent key="stdout">{stdout.trim()}</IndentedContent>);
      }
      if (stderr?.trim()) {
        lines.push(<IndentedContent key="stderr">{stderr.trim()}</IndentedContent>);
      }
    }
    $[0] = content;
    $[1] = lines;
    $[2] = t1;
  } else {
    lines = $[1];
    t1 = $[2];
  }
  if (t1 !== Symbol.for("react.early_return_sentinel")) {
    return t1;
  }
  return lines;
}
function IndentedContent(t0) {
  const $ = _c(5);
  const {
    children
  } = t0;
  if (children.startsWith(`${DIAMOND_OPEN} `) || children.startsWith(`${DIAMOND_FILLED} `)) {
    let t1;
    if ($[0] !== children) {
      t1 = <CloudLaunchContent>{children}</CloudLaunchContent>;
      $[0] = children;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    return t1;
  }
  let t1;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Text dimColor={true}>{"  \u2514  "}</Text>;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  let t2;
  if ($[3] !== children) {
    t2 = <FullWidthRow>{t1}<Box flexDirection="column" flexGrow={1}><Markdown>{children}</Markdown></Box></FullWidthRow>;
    $[3] = children;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  return t2;
}
function CloudLaunchContent(t0) {
  const $ = _c(19);
  const {
    children
  } = t0;
  const diamond = children[0];
  let label;
  let rest;
  let t1;
  if ($[0] !== children) {
    const nl = children.indexOf("\n");
    const header = nl === -1 ? children.slice(2) : children.slice(2, nl);
    rest = nl === -1 ? "" : children.slice(nl + 1).trim();
    const sep = header.indexOf(" \xB7 ");
    label = sep === -1 ? header : header.slice(0, sep);
    t1 = sep === -1 ? "" : header.slice(sep);
    $[0] = children;
    $[1] = label;
    $[2] = rest;
    $[3] = t1;
  } else {
    label = $[1];
    rest = $[2];
    t1 = $[3];
  }
  const suffix = t1;
  let t2;
  if ($[4] !== diamond) {
    t2 = <Text color="background">{diamond} </Text>;
    $[4] = diamond;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  let t3;
  if ($[6] !== label) {
    t3 = <Text bold={true}>{label}</Text>;
    $[6] = label;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  let t4;
  if ($[8] !== suffix) {
    t4 = suffix && <Text dimColor={true}>{suffix}</Text>;
    $[8] = suffix;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  let t5;
  if ($[10] !== t2 || $[11] !== t3 || $[12] !== t4) {
    t5 = <Text>{t2}{t3}{t4}</Text>;
    $[10] = t2;
    $[11] = t3;
    $[12] = t4;
    $[13] = t5;
  } else {
    t5 = $[13];
  }
  let t6;
  if ($[14] !== rest) {
    t6 = rest && <FullWidthRow><Text dimColor={true}>{"  \u2514  "}</Text><Text dimColor={true}>{rest}</Text></FullWidthRow>;
    $[14] = rest;
    $[15] = t6;
  } else {
    t6 = $[15];
  }
  let t7;
  if ($[16] !== t5 || $[17] !== t6) {
    t7 = <Box flexDirection="column">{t5}{t6}</Box>;
    $[16] = t5;
    $[17] = t6;
    $[18] = t7;
  } else {
    t7 = $[18];
  }
  return t7;
}
