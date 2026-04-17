import { c as _c } from "react-compiler-runtime";
import figures from 'figures';
import { Box, Text } from '../ink.js';
import type { ContextSuggestion } from '../utils/contextSuggestions.js';
import { formatTokens } from '../utils/format.js';
import { StatusIcon } from './design-system/StatusIcon.js';
type Props = {
  suggestions: ContextSuggestion[];
};
export function ContextSuggestions(t0: Props) {
  const $ = _c(5);
  const {
    suggestions
  } = t0;
  if (suggestions.length === 0) {
    return null;
  }
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Text bold={true}>Пропозиції</Text>;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== suggestions) {
    t2 = suggestions.map(_temp);
    $[1] = suggestions;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== t2) {
    t3 = <Box flexDirection="column" marginTop={1}>{t1}{t2}</Box>;
    $[3] = t2;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  return t3;
}
function _temp(suggestion: ContextSuggestion, i: number) {
  return <Box key={i} flexDirection="column" marginTop={i === 0 ? 0 : 1}><Box><StatusIcon status={suggestion.severity} withSpace={true} /><Text bold={true}>{suggestion.title}</Text>{suggestion.savingsTokens ? <Text dimColor={true}>{" "}{figures.arrowRight} економія ~{formatTokens(suggestion.savingsTokens)}</Text> : null}</Box><Box marginLeft={2}><Text dimColor={true}>{suggestion.detail}</Text></Box></Box>;
}
