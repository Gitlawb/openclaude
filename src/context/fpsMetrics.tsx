import { c as _c } from "react-compiler-runtime";
import React, { createContext, useContext } from 'react';
import type { FpsMetrics } from '../utils/fpsTracker.js';
type FpsMetricsGetter = () => FpsMetrics | undefined;
const FpsMetricsContext = createContext<FpsMetricsGetter | undefined>(undefined);
type Props = {
  getFpsMetrics: FpsMetricsGetter;
  children: React.ReactNode;
};
export function FpsMetricsProvider(t0) {
  const $ = _c(3);
  const {
    getFpsMetrics,
    children
  } = t0;
  let t1;
  if ($[0] !== children || $[1] !== getFpsMetrics) {
    t1 = <FpsMetricsContext.Provider value={getFpsMetrics}>{children}</FpsMetricsContext.Provider>;
    $[0] = children;
    $[1] = getFpsMetrics;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  return t1;
}
export function useFpsMetrics() {
  return useContext(FpsMetricsContext);
}
