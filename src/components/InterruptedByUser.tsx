import { c as _c } from "react-compiler-runtime";
import { Text } from '../ink.js';
export function InterruptedByUser() {
  const $ = _c(1);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = <><Text dimColor={true}>Interrupted </Text>{false ? <Text dimColor={true}>· [ANT-ONLY] /issue to report a model issue</Text> : <Text dimColor={true}>· What should Claude do instead?</Text>}</>;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  return t0;
}
