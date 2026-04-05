import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { logError } from '../../utils/log.js';
import { useEffect } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import { getIsRemoteMode } from '../../bootstrap/state.js';
import { Text } from '../../ink.js';
import { hasClaudeAiMcpEverConnected } from '../../services/mcp/claudeai.js';
import type { MCPServerConnection } from '../../services/mcp/types.js';
type Props = {
  mcpClients?: MCPServerConnection[];
};
const EMPTY_MCP_CLIENTS: MCPServerConnection[] = [];
export function useMcpConnectivityStatus(t0) {
  const $ = _c(4);
  const {
    mcpClients: t1
  } = t0;
  const mcpClients = t1 === undefined ? EMPTY_MCP_CLIENTS : t1;
  const {
    addNotification
  } = useNotifications();
  let t2;
  let t3;
  if ($[0] !== addNotification || $[1] !== mcpClients) {
    t2 = () => {
      try {
        if (getIsRemoteMode()) {
          return;
        }
        const failedLocalClients = mcpClients.filter(_temp);
        const failedClaudeAiClients = mcpClients.filter(_temp2);
        const needsAuthLocalServers = mcpClients.filter(_temp3);
        const needsAuthClaudeAiServers = mcpClients.filter(_temp4);
        if (failedLocalClients.length === 0 && failedClaudeAiClients.length === 0 && needsAuthLocalServers.length === 0 && needsAuthClaudeAiServers.length === 0) {
          return;
        }
        if (failedLocalClients.length > 0) {
          addNotification({
            key: "mcp-failed",
            jsx: <><Text color="error">{failedLocalClients.length} MCP{" "}{failedLocalClients.length === 1 ? "server" : "servers"} failed</Text><Text dimColor={true}> · /mcp</Text></>,
            priority: "medium"
          });
        }
        if (failedClaudeAiClients.length > 0) {
          addNotification({
            key: "mcp-claudeai-failed",
            jsx: <><Text color="error">{failedClaudeAiClients.length} claude.ai{" "}{failedClaudeAiClients.length === 1 ? "connector" : "connectors"}{" "}unavailable</Text><Text dimColor={true}> · /mcp</Text></>,
            priority: "medium"
          });
        }
        if (needsAuthLocalServers.length > 0) {
          addNotification({
            key: "mcp-needs-auth",
            jsx: <><Text color="warning">{needsAuthLocalServers.length} MCP{" "}{needsAuthLocalServers.length === 1 ? "server needs" : "servers need"}{" "}auth</Text><Text dimColor={true}> · /mcp</Text></>,
            priority: "medium"
          });
        }
        if (needsAuthClaudeAiServers.length > 0) {
          addNotification({
            key: "mcp-claudeai-needs-auth",
            jsx: <><Text color="warning">{needsAuthClaudeAiServers.length} claude.ai{" "}{needsAuthClaudeAiServers.length === 1 ? "connector needs" : "connectors need"}{" "}auth</Text><Text dimColor={true}> · /mcp</Text></>,
            priority: "medium"
          });
        }
      } catch (error) {
        logError(error);
      }
    };
    t3 = [addNotification, mcpClients];
    $[0] = addNotification;
    $[1] = mcpClients;
    $[2] = t2;
    $[3] = t3;
  } else {
    t2 = $[2];
    t3 = $[3];
  }
  useEffect(t2, t3);
}
function _temp4(client_2) {
  return client_2.type === "needs-auth" && client_2.config.type === "claudeai-proxy" && hasClaudeAiMcpEverConnected(client_2.name);
}
function _temp3(client_1) {
  return client_1.type === "needs-auth" && client_1.config.type !== "claudeai-proxy";
}
function _temp2(client_0) {
  return client_0.type === "failed" && client_0.config.type === "claudeai-proxy" && hasClaudeAiMcpEverConnected(client_0.name);
}
function _temp(client) {
  return client.type === "failed" && client.config.type !== "sse-ide" && client.config.type !== "ws-ide" && client.config.type !== "claudeai-proxy";
}
