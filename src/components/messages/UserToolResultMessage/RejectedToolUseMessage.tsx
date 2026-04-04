import { c as _c } from "react-compiler-runtime";
import { Text } from '../../../ink.js';
import { MessageResponse } from '../../MessageResponse.js';
export function RejectedToolUseMessage() {
  const $ = _c(1);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = <MessageResponse height={1}><Text dimColor={true}>Tool use rejected</Text></MessageResponse>;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  return t0;
}
