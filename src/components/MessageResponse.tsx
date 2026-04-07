import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { useContext } from 'react';
import { Box, NoSelect, Text } from '../ink.js';
import { Ratchet } from './design-system/Ratchet.js';
type Props = {
  children: React.ReactNode;
  height?: number;
};
export function MessageResponse(t0) {
  const $ = _c(8);
  const {
    children,
    height
  } = t0;
  const isMessageResponse = useContext(MessageResponseContext);
  if (isMessageResponse) {
    return children;
  }
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <NoSelect fromLeftEdge={true} flexShrink={0}><Text dimColor={true}>{"  "}⎿  </Text></NoSelect>;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== children) {
    t2 = <Box flexShrink={1} flexGrow={1}>{children}</Box>;
    $[1] = children;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== height || $[4] !== t2) {
    t3 = <MessageResponseProvider><Box flexDirection="row" height={height} overflowY="hidden">{t1}{t2}</Box></MessageResponseProvider>;
    $[3] = height;
    $[4] = t2;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  const content = t3;
  if (height !== undefined) {
    return content;
  }
  let t4;
  if ($[6] !== content) {
    t4 = <Ratchet lock="offscreen">{content}</Ratchet>;
    $[6] = content;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  return t4;
}

// This is a context that is used to determine if the message response
// is rendered as a descendant of another MessageResponse. We use it
// to avoid rendering nested ⎿ characters.
const MessageResponseContext = React.createContext(false);
function MessageResponseProvider(t0) {
  const $ = _c(2);
  const {
    children
  } = t0;
  let t1;
  if ($[0] !== children) {
    t1 = <MessageResponseContext.Provider value={true}>{children}</MessageResponseContext.Provider>;
    $[0] = children;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  return t1;
}
