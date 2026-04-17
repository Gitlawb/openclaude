import { c as _c } from "react-compiler-runtime";
import React, { type ReactNode } from 'react';
import { Box } from '../../../../ink.js';
import type { SettingSource } from '../../../../utils/settings/constants.js';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Select } from '../../../CustomSelect/select.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import type { AgentWizardData } from '../types.js';
export function LocationStep() {
  const $ = _c(11);
  const {
    goNext,
    updateWizardData,
    cancel
  } = useWizard();
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = {
      label: "Project (.nnc/agents/)",
      value: "projectSettings" as SettingSource
    };
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  let t1;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [t0, {
      label: "Personal (~/.nnc/agents/)",
      value: "userSettings" as SettingSource
    }];
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const locationOptions = t1;
  let t2;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Byline><KeyboardShortcutHint shortcut={"\u2191\u2193"} action="navigate" /><KeyboardShortcutHint shortcut="Enter" action="select" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" /></Byline>;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== goNext || $[4] !== updateWizardData) {
    t3 = value => {
      updateWizardData({
        location: value as SettingSource
      });
      goNext();
    };
    $[3] = goNext;
    $[4] = updateWizardData;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] !== cancel) {
    t4 = () => cancel();
    $[6] = cancel;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] !== t3 || $[9] !== t4) {
    t5 = <WizardDialogLayout subtitle="Choose location" footerText={t2}><Box><Select key="location-select" options={locationOptions} onChange={t3} onCancel={t4} /></Box></WizardDialogLayout>;
    $[8] = t3;
    $[9] = t4;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  return t5;
}
