import { c as _c } from "react-compiler-runtime";
import React, { type ReactNode } from 'react';
import { isAutoMemoryEnabled } from '../../../memdir/paths.js';
import type { Tools } from '../../../Tool.js';
import type { AgentDefinition } from '../../../tools/AgentTool/loadAgentsDir.js';
import { WizardProvider } from '../../wizard/index.js';
import type { WizardStepComponent } from '../../wizard/types.js';
import type { AgentWizardData } from './types.js';
import { ColorStep } from './wizard-steps/ColorStep.js';
import { ConfirmStepWrapper } from './wizard-steps/ConfirmStepWrapper.js';
import { DescriptionStep } from './wizard-steps/DescriptionStep.js';
import { GenerateStep } from './wizard-steps/GenerateStep.js';
import { LocationStep } from './wizard-steps/LocationStep.js';
import { MemoryStep } from './wizard-steps/MemoryStep.js';
import { MethodStep } from './wizard-steps/MethodStep.js';
import { ModelStep } from './wizard-steps/ModelStep.js';
import { PromptStep } from './wizard-steps/PromptStep.js';
import { ToolsStep } from './wizard-steps/ToolsStep.js';
import { TypeStep } from './wizard-steps/TypeStep.js';
type Props = {
  tools: Tools;
  existingAgents: AgentDefinition[];
  onComplete: (message: string) => void;
  onCancel: () => void;
};
export function CreateAgentWizard(t0) {
  const $ = _c(17);
  const {
    tools,
    existingAgents,
    onComplete,
    onCancel
  } = t0;
  let t1;
  if ($[0] !== existingAgents) {
    t1 = () => <TypeStep existingAgents={existingAgents} />;
    $[0] = existingAgents;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] !== tools) {
    t2 = () => <ToolsStep tools={tools} />;
    $[2] = tools;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = isAutoMemoryEnabled() ? [MemoryStep] : [];
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== existingAgents || $[6] !== onComplete || $[7] !== tools) {
    t4 = () => <ConfirmStepWrapper tools={tools} existingAgents={existingAgents} onComplete={onComplete} />;
    $[5] = existingAgents;
    $[6] = onComplete;
    $[7] = tools;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  let t5;
  if ($[9] !== t1 || $[10] !== t2 || $[11] !== t4) {
    t5 = [LocationStep, MethodStep, GenerateStep, t1, PromptStep, DescriptionStep, t2, ModelStep, ColorStep, ...t3, t4];
    $[9] = t1;
    $[10] = t2;
    $[11] = t4;
    $[12] = t5;
  } else {
    t5 = $[12];
  }
  const steps = t5;
  let t6;
  if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = {};
    $[13] = t6;
  } else {
    t6 = $[13];
  }
  let t7;
  if ($[14] !== onCancel || $[15] !== steps) {
    t7 = <WizardProvider steps={steps} initialData={t6} onComplete={_temp} onCancel={onCancel} title="Create new agent" showStepCounter={false} />;
    $[14] = onCancel;
    $[15] = steps;
    $[16] = t7;
  } else {
    t7 = $[16];
  }
  return t7;
}
function _temp() {}
