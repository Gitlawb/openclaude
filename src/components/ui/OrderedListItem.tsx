import { c as _c } from "react-compiler-runtime";
import React, { createContext, type ReactNode, useContext } from 'react';
import { Box, Text } from '../../ink.js';
export const OrderedListItemContext = createContext({
  marker: ''
});
type OrderedListItemProps = {
  children: ReactNode;
};
export function OrderedListItem(t0) {
  const $ = _c(7);
  const {
    children
  } = t0;
  const {
    marker
  } = useContext(OrderedListItemContext);
  let t1;
  if ($[0] !== marker) {
    t1 = <Text dimColor={true}>{marker}</Text>;
    $[0] = marker;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] !== children) {
    t2 = <Box flexDirection="column">{children}</Box>;
    $[2] = children;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] !== t1 || $[5] !== t2) {
    t3 = <Box gap={1}>{t1}{t2}</Box>;
    $[4] = t1;
    $[5] = t2;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  return t3;
}
