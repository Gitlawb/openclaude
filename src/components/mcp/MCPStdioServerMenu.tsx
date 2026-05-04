import figures from 'figures';
import React, { useState } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, color, Text, useTheme } from '../../ink.js';
import { getMcpConfigByName } from '../../services/mcp/config.js';
import { useMcpReconnect, useMcpToggleEnabled } from '../../services/mcp/MCPConnectionManager.js';
import { describeMcpConfigFilePath, filterMcpPromptsByServer } from '../../services/mcp/utils.js';
import { useAppState } from '../../state/AppState.js';
import { errorMessage } from '../../utils/errors.js';
import { capitalize } from '../../utils/stringUtils.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Select } from '../CustomSelect/index.js';
import { Byline } from '../design-system/Byline.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import { Spinner } from '../Spinner.js';
import { CapabilitiesSection } from './CapabilitiesSection.js';
import type { StdioServerInfo } from './types.js';
import { handleReconnectError, handleReconnectResult } from './utils/reconnectHelpers.js';
type Props = {
  server: StdioServerInfo;
  serverToolsCount: number;
  onViewTools: () => void;
  onCancel: () => void;
  onComplete: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  borderless?: boolean;
};
export function MCPStdioServerMenu({
  server,
  serverToolsCount,
  onViewTools,
  onCancel,
  onComplete,
  borderless = false
}: Props): React.ReactNode {
  const [theme] = useTheme();
  const exitState = useExitOnCtrlCDWithKeybindings();
  const mcp = useAppState(s => s.mcp);
  const reconnectMcpServer = useMcpReconnect();
  const toggleMcpServer = useMcpToggleEnabled();
  const [isReconnecting, setIsReconnecting] = useState(false);
  const handleToggleEnabled = React.useCallback(async () => {
    const wasEnabled = server.client.type !== 'disabled';
    try {
      await toggleMcpServer(server.name);
      // Return to the server list so user can continue managing other servers
      onCancel();
    } catch (err) {
      const action = wasEnabled ? 'disable' : 'enable';
      onComplete(`Failed to ${action} MCP server '${server.name}': ${errorMessage(err)}`);
    }
  }, [server.client.type, server.name, toggleMcpServer, onCancel, onComplete]);
  const capitalizedServerName = capitalize(String(server.name));

  // Count MCP prompts for this server (skills are shown in /skills, not here)
  const serverCommandsCount = filterMcpPromptsByServer(mcp.commands, server.name).length;
  const menuOptions = [];

  // Only show "View tools" if server is not disabled and has tools
  if (server.client.type !== 'disabled' && serverToolsCount > 0) {
    // @ts-expect-error any-to-never (stub types cause narrowing)
    menuOptions.push({
      label: 'View tools',
      value: 'tools'
    });
  }

  // Only show reconnect option if the server is not disabled
  if (server.client.type !== 'disabled') {
    // @ts-expect-error any-to-never (stub types cause narrowing)
    menuOptions.push({
      label: 'Reconnect',
      value: 'reconnectMcpServer'
    });
  }
  // @ts-expect-error any-to-never (stub types cause narrowing)
  menuOptions.push({
    label: server.client.type !== 'disabled' ? 'Disable' : 'Enable',
    value: 'toggle-enabled'
  });

  // If there are no other options, add a back option so Select handles escape
  if (menuOptions.length === 0) {
    // @ts-expect-error any-to-never (stub types cause narrowing)
    menuOptions.push({
      label: 'Back',
      value: 'back'
    });
  }
  if (isReconnecting) {
    return <Box flexDirection="column" gap={1} padding={1}>
        <Text color="text">
          Reconnecting to <Text bold>{server.name}</Text>
        </Text>
        <Box>
          <Spinner />
          <Text> Restarting MCP server process</Text>
        </Box>
        <Text dimColor>This may take a few moments.</Text>
      </Box>;
  }
  return <Box flexDirection="column">
      <Box flexDirection="column" paddingX={1} borderStyle={borderless ? undefined : 'round'}>
        <Box marginBottom={1}>
          <Text bold>{capitalizedServerName} MCP Server</Text>
        </Box>

        <Box flexDirection="column" gap={0}>
          <Box>
            <Text bold>Status: </Text>
            {server.client.type === 'disabled' ? <Text>{color('inactive', theme)(figures.radioOff)} disabled</Text> : server.client.type === 'connected' ? <Text>{color('success', theme)(figures.tick)} connected</Text> : server.client.type === 'pending' ? <>
                <Text dimColor>{figures.radioOff}</Text>
                <Text> connecting…</Text>
              </> : <Text>{color('error', theme)(figures.cross)} failed</Text>}
          </Box>

          <Box>
            <Text bold>Command: </Text>
            <Text dimColor>{server.config.command}</Text>
          </Box>

          {server.config.args && server.config.args.length > 0 && <Box>
              <Text bold>Args: </Text>
              <Text dimColor>{server.config.args.join(' ')}</Text>
            </Box>}

          <Box>
            <Text bold>Config location: </Text>
            <Text dimColor>
              {describeMcpConfigFilePath(getMcpConfigByName(server.name)?.scope ?? 'dynamic')}
            </Text>
          </Box>

          {server.client.type === 'connected' && <CapabilitiesSection serverToolsCount={serverToolsCount} serverPromptsCount={serverCommandsCount} serverResourcesCount={mcp.resources[server.name]?.length || 0} />}

          {server.client.type === 'connected' && serverToolsCount > 0 && <Box>
              <Text bold>Tools: </Text>
              <Text dimColor>{serverToolsCount} tools</Text>
            </Box>}
        </Box>

        {menuOptions.length > 0 && <Box marginTop={1}>
            <Select options={menuOptions} onChange={async value => {
          if (value === 'tools') {
            onViewTools();
          } else if (value === 'reconnectMcpServer') {
            setIsReconnecting(true);
            try {
              const result = await reconnectMcpServer(server.name);
              const {
                message
              } = handleReconnectResult(result, server.name);
              onComplete?.(message);
            } catch (err_0) {
              onComplete?.(handleReconnectError(err_0, server.name));
            } finally {
              setIsReconnecting(false);
            }
          } else if (value === 'toggle-enabled') {
            await handleToggleEnabled();
          } else if (value === 'back') {
            onCancel();
          }
        }} onCancel={onCancel} />
          </Box>}
      </Box>

      <Box marginTop={1}>
        <Text dimColor italic>
          {exitState.pending ? <>Press {exitState.keyName} again to exit</> : <Byline>
              <KeyboardShortcutHint shortcut="↑↓" action="navigate" />
              <KeyboardShortcutHint shortcut="Enter" action="select" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
            </Byline>}
        </Text>
      </Box>
    </Box>;
}
