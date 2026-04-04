import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { Box, Text } from '../../ink.js';
import type { Workflow } from './types.js';
interface CreatingStepProps {
  currentWorkflowInstallStep: number;
  secretExists: boolean;
  useExistingSecret: boolean;
  secretName: string;
  skipWorkflow?: boolean;
  selectedWorkflows: Workflow[];
}
export function CreatingStep(t0) {
  const $ = _c(10);
  const {
    currentWorkflowInstallStep,
    secretExists,
    useExistingSecret,
    secretName,
    skipWorkflow: t1,
    selectedWorkflows
  } = t0;
  const skipWorkflow = t1 === undefined ? false : t1;
  let t2;
  if ($[0] !== secretExists || $[1] !== secretName || $[2] !== selectedWorkflows || $[3] !== skipWorkflow || $[4] !== useExistingSecret) {
    t2 = skipWorkflow ? ["Getting repository information", secretExists && useExistingSecret ? "Using existing API key secret" : `Setting up ${secretName} secret`] : ["Getting repository information", "Creating branch", selectedWorkflows.length > 1 ? "Creating workflow files" : "Creating workflow file", secretExists && useExistingSecret ? "Using existing API key secret" : `Setting up ${secretName} secret`, "Opening pull request page"];
    $[0] = secretExists;
    $[1] = secretName;
    $[2] = selectedWorkflows;
    $[3] = skipWorkflow;
    $[4] = useExistingSecret;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  const progressSteps = t2;
  let t3;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Box flexDirection="column" marginBottom={1}><Text bold={true}>Install GitHub App</Text><Text dimColor={true}>Create GitHub Actions workflow</Text></Box>;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  let t4;
  if ($[7] !== currentWorkflowInstallStep || $[8] !== progressSteps) {
    t4 = <><Box flexDirection="column" borderStyle="round" paddingX={1}>{t3}{progressSteps.map((stepText, index) => {
          let status = "pending";
          if (index < currentWorkflowInstallStep) {
            status = "completed";
          } else {
            if (index === currentWorkflowInstallStep) {
              status = "in-progress";
            }
          }
          return <Box key={index}><Text color={status === "completed" ? "success" : status === "in-progress" ? "warning" : undefined}>{status === "completed" ? "\u2713 " : ""}{stepText}{status === "in-progress" ? "\u2026" : ""}</Text></Box>;
        })}</Box></>;
    $[7] = currentWorkflowInstallStep;
    $[8] = progressSteps;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  return t4;
}
