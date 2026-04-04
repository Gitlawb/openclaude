import { c as _c } from "react-compiler-runtime";
import figures from 'figures';
import React, { useEffect, useState } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { Box, color, Text, useTheme } from '../../ink.js';
import { useMcpReconnect } from '../../services/mcp/MCPConnectionManager.js';
import { useAppStateStore } from '../../state/AppState.js';
import { Spinner } from '../Spinner.js';
type Props = {
  serverName: string;
  onComplete: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
export function MCPReconnect(t0) {
  const $ = _c(25);
  const {
    serverName,
    onComplete
  } = t0;
  const [theme] = useTheme();
  const store = useAppStateStore();
  const reconnectMcpServer = useMcpReconnect();
  const [isReconnecting, setIsReconnecting] = useState(true);
  const [error, setError] = useState(null);
  let t1;
  let t2;
  if ($[0] !== onComplete || $[1] !== reconnectMcpServer || $[2] !== serverName || $[3] !== store) {
    t1 = () => {
      const attemptReconnect = async function attemptReconnect() {
        ;
        try {
          const server = store.getState().mcp.clients.find(c => c.name === serverName);
          if (!server) {
            setError(`MCP server "${serverName}" not found`);
            setIsReconnecting(false);
            onComplete(`MCP server "${serverName}" not found`);
            return;
          }
          const result = await reconnectMcpServer(serverName);
          bb43: switch (result.client.type) {
            case "connected":
              {
                setIsReconnecting(false);
                onComplete(`Successfully reconnected to ${serverName}`);
                break bb43;
              }
            case "needs-auth":
              {
                setError(`${serverName} requires authentication`);
                setIsReconnecting(false);
                onComplete(`${serverName} requires authentication. Use /mcp to authenticate.`);
                break bb43;
              }
            case "pending":
            case "failed":
            case "disabled":
              {
                setError(`Failed to reconnect to ${serverName}`);
                setIsReconnecting(false);
                onComplete(`Failed to reconnect to ${serverName}`);
              }
          }
        } catch (t3) {
          const err = t3;
          const errorMessage = err instanceof Error ? err.message : String(err);
          setError(errorMessage);
          setIsReconnecting(false);
          onComplete(`Error: ${errorMessage}`);
        }
      };
      attemptReconnect();
    };
    t2 = [serverName, reconnectMcpServer, store, onComplete];
    $[0] = onComplete;
    $[1] = reconnectMcpServer;
    $[2] = serverName;
    $[3] = store;
    $[4] = t1;
    $[5] = t2;
  } else {
    t1 = $[4];
    t2 = $[5];
  }
  useEffect(t1, t2);
  if (isReconnecting) {
    let t3;
    if ($[6] !== serverName) {
      t3 = <Text color="text">Reconnecting to <Text bold={true}>{serverName}</Text></Text>;
      $[6] = serverName;
      $[7] = t3;
    } else {
      t3 = $[7];
    }
    let t4;
    if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = <Box><Spinner /><Text> Establishing connection to MCP server</Text></Box>;
      $[8] = t4;
    } else {
      t4 = $[8];
    }
    let t5;
    if ($[9] !== t3) {
      t5 = <Box flexDirection="column" gap={1} padding={1}>{t3}{t4}</Box>;
      $[9] = t3;
      $[10] = t5;
    } else {
      t5 = $[10];
    }
    return t5;
  }
  if (error) {
    let t3;
    if ($[11] !== theme) {
      t3 = color("error", theme)(figures.cross);
      $[11] = theme;
      $[12] = t3;
    } else {
      t3 = $[12];
    }
    let t4;
    if ($[13] !== t3) {
      t4 = <Text>{t3} </Text>;
      $[13] = t3;
      $[14] = t4;
    } else {
      t4 = $[14];
    }
    let t5;
    if ($[15] !== serverName) {
      t5 = <Text color="error">Failed to reconnect to {serverName}</Text>;
      $[15] = serverName;
      $[16] = t5;
    } else {
      t5 = $[16];
    }
    let t6;
    if ($[17] !== t4 || $[18] !== t5) {
      t6 = <Box>{t4}{t5}</Box>;
      $[17] = t4;
      $[18] = t5;
      $[19] = t6;
    } else {
      t6 = $[19];
    }
    let t7;
    if ($[20] !== error) {
      t7 = <Text dimColor={true}>Error: {error}</Text>;
      $[20] = error;
      $[21] = t7;
    } else {
      t7 = $[21];
    }
    let t8;
    if ($[22] !== t6 || $[23] !== t7) {
      t8 = <Box flexDirection="column" gap={1} padding={1}>{t6}{t7}</Box>;
      $[22] = t6;
      $[23] = t7;
      $[24] = t8;
    } else {
      t8 = $[24];
    }
    return t8;
  }
  return null;
}
