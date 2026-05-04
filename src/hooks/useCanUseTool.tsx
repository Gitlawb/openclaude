import { c as _c } from "react-compiler-runtime";
import { APIUserAbortError } from '@anthropic-ai/sdk';
import * as React from 'react';
import { useCallback } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { sanitizeToolNameForAnalytics } from 'src/services/analytics/metadata.js';
import type { ToolUseConfirm } from '../components/permissions/PermissionRequest.js';
import { Text } from '../ink.js';
import type { ToolPermissionContext, Tool as ToolType, ToolUseContext } from '../Tool.js';
import { consumeSpeculativeClassifierCheck, peekSpeculativeClassifierCheck } from '../tools/BashTool/bashPermissions.js';
import { BASH_TOOL_NAME } from '../tools/BashTool/toolName.js';
import type { AssistantMessage } from '../types/message.js';
import { recordAutoModeDenial } from '../utils/autoModeDenials.js';
import { clearClassifierChecking, setClassifierApproval, setYoloClassifierApproval } from '../utils/classifierApprovals.js';
import { logForDebugging } from '../utils/debug.js';
import { AbortError } from '../utils/errors.js';
import { logError } from '../utils/log.js';
import type { PermissionDecision } from '../utils/permissions/PermissionResult.js';
import { hasPermissionsToUseTool } from '../utils/permissions/permissions.js';
import { jsonStringify } from '../utils/slowOperations.js';
import { handleCoordinatorPermission } from './toolPermission/handlers/coordinatorHandler.js';
import { handleInteractivePermission } from './toolPermission/handlers/interactiveHandler.js';
import { handleSwarmWorkerPermission } from './toolPermission/handlers/swarmWorkerHandler.js';
import { createPermissionContext, createPermissionQueueOps } from './toolPermission/PermissionContext.js';
import { logPermissionDecision } from './toolPermission/permissionLogging.js';
export type CanUseToolFn<Input extends Record<string, unknown> = Record<string, unknown>> = (tool: ToolType, input: Input, toolUseContext: ToolUseContext, assistantMessage: AssistantMessage, toolUseID: string, forceDecision?: PermissionDecision<Input>) => Promise<PermissionDecision<Input>>;
function useCanUseTool(setToolUseConfirmQueue, setToolPermissionContext) {
  const $ = _c(3);
  let t0;
  if ($[0] !== setToolPermissionContext || $[1] !== setToolUseConfirmQueue) {
    t0 = async (tool, input, toolUseContext, assistantMessage, toolUseID, forceDecision) => new Promise(resolve => {
      const ctx = createPermissionContext(tool, input, toolUseContext, assistantMessage, toolUseID, setToolPermissionContext, createPermissionQueueOps(setToolUseConfirmQueue));
      if (ctx.resolveIfAborted(resolve)) {
        return;
      }
      const decisionPromise = forceDecision !== undefined ? Promise.resolve(forceDecision) : hasPermissionsToUseTool(tool, input, toolUseContext, assistantMessage, toolUseID);
      return decisionPromise.then(async result => {
        if (result.behavior === "allow") {
          if (ctx.resolveIfAborted(resolve)) {
            return;
          }
          if (true && result.decisionReason?.type === "classifier" && result.decisionReason.classifier === "auto-mode") {
            setYoloClassifierApproval(toolUseID, result.decisionReason.reason);
          }
          ctx.logDecision({
            decision: "accept",
            source: "config"
          });
          resolve(ctx.buildAllow(result.updatedInput ?? input, {
            decisionReason: result.decisionReason
          }));
          return;
        }
        const appState = toolUseContext.getAppState();
        const description = await tool.description(input as never, {
          isNonInteractiveSession: toolUseContext.options.isNonInteractiveSession,
          toolPermissionContext: appState.toolPermissionContext,
          tools: toolUseContext.options.tools
        });
        if (ctx.resolveIfAborted(resolve)) {
          return;
        }
        switch (result.behavior) {
          case "deny":
            {
              logPermissionDecision({
                tool,
                input,
                toolUseContext,
                messageId: ctx.messageId,
                toolUseID
              }, {
                decision: "reject",
                source: "config"
              });
              if (true && result.decisionReason?.type === "classifier" && result.decisionReason.classifier === "auto-mode") {
                recordAutoModeDenial({
                  toolName: tool.name,
                  display: description,
                  reason: result.decisionReason.reason ?? "",
                  timestamp: Date.now()
                });
                toolUseContext.addNotification?.({
                  key: "auto-mode-denied",
                  priority: "immediate",
                  jsx: <><Text color="error">{tool.userFacingName(input).toLowerCase()} denied by auto mode</Text><Text dimColor={true}> · /permissions</Text></>
                });
              }
              resolve(result);
              return;
            }
          case "ask":
            {
              if (appState.toolPermissionContext.awaitAutomatedChecksBeforeDialog) {
                const coordinatorDecision = await handleCoordinatorPermission({
                  ctx,
                  ...(false ? {
                    pendingClassifierCheck: result.pendingClassifierCheck
                  } : {}),
                  updatedInput: result.updatedInput,
                  suggestions: result.suggestions,
                  permissionMode: appState.toolPermissionContext.mode
                });
                if (coordinatorDecision) {
                  resolve(coordinatorDecision);
                  return;
                }
              }
              if (ctx.resolveIfAborted(resolve)) {
                return;
              }
              const swarmDecision = await handleSwarmWorkerPermission({
                ctx,
                description,
                ...(false ? {
                  pendingClassifierCheck: result.pendingClassifierCheck
                } : {}),
                updatedInput: result.updatedInput,
                suggestions: result.suggestions
              });
              if (swarmDecision) {
                resolve(swarmDecision);
                return;
              }
              if (false && result.pendingClassifierCheck && tool.name === BASH_TOOL_NAME && !appState.toolPermissionContext.awaitAutomatedChecksBeforeDialog) {
                const speculativePromise = peekSpeculativeClassifierCheck((input as {
                  command: string;
                }).command);
                if (speculativePromise) {
                  const raceResult = await Promise.race([speculativePromise.then(_temp), new Promise(_temp2)]);
                  if (ctx.resolveIfAborted(resolve)) {
                    return;
                  }
                  if (raceResult.type === "result" && raceResult.result.matches && raceResult.result.confidence === "high" && false) {
                    consumeSpeculativeClassifierCheck((input as {
                      command: string;
                    }).command);
                    const matchedRule = raceResult.result.matchedDescription ?? undefined;
                    if (matchedRule) {
                      setClassifierApproval(toolUseID, matchedRule);
                    }
                    ctx.logDecision({
                      decision: "accept",
                      source: {
                        type: "classifier"
                      }
                    });
                    resolve(ctx.buildAllow(result.updatedInput ?? input as Record<string, unknown>, {
                      decisionReason: {
                        type: "classifier" as const,
                        classifier: "bash_allow" as const,
                        reason: `Allowed by prompt rule: "${raceResult.result.matchedDescription}"`
                      }
                    }));
                    return;
                  }
                }
              }
              handleInteractivePermission({
                ctx,
                description,
                result,
                awaitAutomatedChecksBeforeDialog: appState.toolPermissionContext.awaitAutomatedChecksBeforeDialog,
                bridgeCallbacks: false ? appState.replBridgePermissionCallbacks : undefined,
                channelCallbacks: false || false ? appState.channelPermissionCallbacks : undefined
              }, resolve);
              return;
            }
        }
      }).catch(error => {
        if (error instanceof AbortError || error instanceof APIUserAbortError) {
          logForDebugging(`Permission check threw ${error.constructor.name} for tool=${tool.name}: ${error.message}`);
          ctx.logCancelled();
          resolve(ctx.cancelAndAbort(undefined, true));
        } else {
          logError(error);
          resolve(ctx.cancelAndAbort(undefined, true));
        }
      }).finally(() => {
        clearClassifierChecking(toolUseID);
      });
    });
    $[0] = setToolPermissionContext;
    $[1] = setToolUseConfirmQueue;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  return t0;
}
function _temp2(res) {
  return setTimeout(res, 2000, {
    type: "timeout" as const
  });
}
function _temp(r) {
  return {
    type: "result" as const,
    result: r
  };
}
export default useCanUseTool;
