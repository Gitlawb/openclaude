import { c as _c } from "react-compiler-runtime";
import { useEffect, useRef } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import { getModelDeprecationWarning } from 'src/utils/model/deprecation.js';
import { getIsRemoteMode } from '../../bootstrap/state.js';
export function useDeprecationWarningNotification(model) {
  const $ = _c(4);
  const {
    addNotification
  } = useNotifications();
  const lastWarningRef = useRef(null);
  let t0;
  let t1;
  if ($[0] !== addNotification || $[1] !== model) {
    t0 = () => {
      if (getIsRemoteMode()) {
        return;
      }
      const deprecationWarning = getModelDeprecationWarning(model);
      if (deprecationWarning && deprecationWarning !== lastWarningRef.current) {
        // @ts-expect-error type mismatch
        lastWarningRef.current = deprecationWarning;
        addNotification({
          key: "model-deprecation-warning",
          text: deprecationWarning,
          color: "warning",
          priority: "high"
        });
      }
      if (!deprecationWarning) {
        lastWarningRef.current = null;
      }
    };
    t1 = [model, addNotification];
    $[0] = addNotification;
    $[1] = model;
    $[2] = t0;
    $[3] = t1;
  } else {
    t0 = $[2];
    t1 = $[3];
  }
  useEffect(t0, t1);
}
