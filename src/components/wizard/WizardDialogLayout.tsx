import { c as _c } from "react-compiler-runtime";
import React, { type ReactNode } from 'react';
import type { Theme } from '../../utils/theme.js';
import { Dialog } from '../design-system/Dialog.js';
import { useWizard } from './useWizard.js';
import { WizardNavigationFooter } from './WizardNavigationFooter.js';
type Props = {
  title?: string;
  color?: keyof Theme;
  children: ReactNode;
  subtitle?: string;
  footerText?: ReactNode;
};
export function WizardDialogLayout(t0) {
  const $ = _c(11);
  const {
    title: titleOverride,
    color: t1,
    children,
    subtitle,
    footerText
  } = t0;
  const color = t1 === undefined ? "suggestion" : t1;
  const {
    currentStepIndex,
    totalSteps,
    title: providerTitle,
    showStepCounter,
    goBack
  } = useWizard();
  const title = titleOverride || providerTitle || "Wizard";
  const stepSuffix = showStepCounter !== false ? ` (${currentStepIndex + 1}/${totalSteps})` : "";
  const t2 = `${title}${stepSuffix}`;
  let t3;
  if ($[0] !== children || $[1] !== color || $[2] !== goBack || $[3] !== subtitle || $[4] !== t2) {
    t3 = <Dialog title={t2} subtitle={subtitle} onCancel={goBack} color={color} hideInputGuide={true} isCancelActive={false}>{children}</Dialog>;
    $[0] = children;
    $[1] = color;
    $[2] = goBack;
    $[3] = subtitle;
    $[4] = t2;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] !== footerText) {
    t4 = <WizardNavigationFooter instructions={footerText} />;
    $[6] = footerText;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] !== t3 || $[9] !== t4) {
    t5 = <>{t3}{t4}</>;
    $[8] = t3;
    $[9] = t4;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  return t5;
}
