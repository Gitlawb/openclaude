import { c as _c } from "react-compiler-runtime";
import type { ReactNode } from 'react';
import React from 'react';
import { Text } from 'src/ink.js';
import type { TaskStatus } from 'src/Task.js';
import type { LocalShellTaskState } from 'src/tasks/LocalShellTask/guards.js';
import type { DeepImmutable } from 'src/types/utils.js';
type TaskStatusTextProps = {
  status: TaskStatus;
  label?: string;
  suffix?: string;
};
export function TaskStatusText(t0) {
  const $ = _c(4);
  const {
    status,
    label,
    suffix
  } = t0;
  const displayLabel = label ?? status;
  const color = status === "completed" ? "success" : status === "failed" ? "error" : status === "killed" ? "warning" : undefined;
  let t1;
  if ($[0] !== color || $[1] !== displayLabel || $[2] !== suffix) {
    t1 = <Text color={color} dimColor={true}>({displayLabel}{suffix})</Text>;
    $[0] = color;
    $[1] = displayLabel;
    $[2] = suffix;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  return t1;
}
export function ShellProgress(t0) {
  const $ = _c(4);
  const {
    shell
  } = t0;
  switch (shell.status) {
    case "completed":
      {
        let t1;
        if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <TaskStatusText status="completed" label="done" />;
          $[0] = t1;
        } else {
          t1 = $[0];
        }
        return t1;
      }
    case "failed":
      {
        let t1;
        if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <TaskStatusText status="failed" label="error" />;
          $[1] = t1;
        } else {
          t1 = $[1];
        }
        return t1;
      }
    case "killed":
      {
        let t1;
        if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <TaskStatusText status="killed" label="stopped" />;
          $[2] = t1;
        } else {
          t1 = $[2];
        }
        return t1;
      }
    case "running":
    case "pending":
      {
        let t1;
        if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <TaskStatusText status="running" />;
          $[3] = t1;
        } else {
          t1 = $[3];
        }
        return t1;
      }
  }
}
