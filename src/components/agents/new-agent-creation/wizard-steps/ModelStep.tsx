import { c as _c } from "react-compiler-runtime";
import React, { type ReactNode } from 'react';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import { ModelSelector } from '../../ModelSelector.js';
import type { AgentWizardData } from '../types.js';
export function ModelStep() {
  const $ = _c(8);
  const {
    goNext,
    goBack,
    updateWizardData,
    wizardData
  } = useWizard();
  let t0;
  if ($[0] !== goNext || $[1] !== updateWizardData) {
    t0 = model => {
      updateWizardData({
        selectedModel: model
      });
      goNext();
    };
    $[0] = goNext;
    $[1] = updateWizardData;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  const handleComplete = t0;
  let t1;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Byline><KeyboardShortcutHint shortcut={"\u2191\u2193"} action="navigate" /><KeyboardShortcutHint shortcut="Enter" action="select" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" /></Byline>;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  let t2;
  if ($[4] !== goBack || $[5] !== handleComplete || $[6] !== wizardData.selectedModel) {
    t2 = <WizardDialogLayout subtitle="Select model" footerText={t1}><ModelSelector initialModel={wizardData.selectedModel} onComplete={handleComplete} onCancel={goBack} /></WizardDialogLayout>;
    $[4] = goBack;
    $[5] = handleComplete;
    $[6] = wizardData.selectedModel;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  return t2;
}
