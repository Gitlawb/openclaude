import { c as _c } from "react-compiler-runtime";
import React, { createContext, isValidElement, type ReactNode, useContext } from 'react';
import { Box } from '../../ink.js';
import { OrderedListItem, OrderedListItemContext } from './OrderedListItem.js';
const OrderedListContext = createContext({
  marker: ''
});
type OrderedListProps = {
  children: ReactNode;
};
function OrderedListComponent(t0) {
  const $ = _c(9);
  const {
    children
  } = t0;
  const {
    marker: parentMarker
  } = useContext(OrderedListContext);
  let numberOfItems = 0;
  for (const child of React.Children.toArray(children)) {
    if (!isValidElement(child) || child.type !== OrderedListItem) {
      continue;
    }
    numberOfItems++;
  }
  const maxMarkerWidth = String(numberOfItems).length;
  let t1;
  if ($[0] !== children || $[1] !== maxMarkerWidth || $[2] !== parentMarker) {
    let t2;
    if ($[4] !== maxMarkerWidth || $[5] !== parentMarker) {
      t2 = (child_0, index) => {
        if (!isValidElement(child_0) || child_0.type !== OrderedListItem) {
          return child_0;
        }
        const paddedMarker = `${String(index + 1).padStart(maxMarkerWidth)}.`;
        const marker = `${parentMarker}${paddedMarker}`;
        return <OrderedListContext.Provider value={{
          marker
        }}><OrderedListItemContext.Provider value={{
            marker
          }}>{child_0}</OrderedListItemContext.Provider></OrderedListContext.Provider>;
      };
      $[4] = maxMarkerWidth;
      $[5] = parentMarker;
      $[6] = t2;
    } else {
      t2 = $[6];
    }
    t1 = React.Children.map(children, t2);
    $[0] = children;
    $[1] = maxMarkerWidth;
    $[2] = parentMarker;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  let t2;
  if ($[7] !== t1) {
    t2 = <Box flexDirection="column">{t1}</Box>;
    $[7] = t1;
    $[8] = t2;
  } else {
    t2 = $[8];
  }
  return t2;
}

// eslint-disable-next-line custom-rules/no-top-level-side-effects
OrderedListComponent.Item = OrderedListItem;
export const OrderedList = OrderedListComponent;
