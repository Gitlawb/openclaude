import React from 'react';
import { MCPServerApprovalDialog } from '../components/MCPServerApprovalDialog.js';
import { MCPServerMultiselectDialog } from '../components/MCPServerMultiselectDialog.js';
import type { Root } from '../ink.js';
import { KeybindingSetup } from '../keybindings/KeybindingProviderSetup.js';
import { AppStateProvider } from '../state/AppState.js';
import { getMcpConfigsByScope } from './mcp/config.js';
import { getProjectMcpServerStatus } from './mcp/utils.js';

/**
 * Show MCP server approval dialogs for pending project servers.
 * Uses the provided Ink root to render (reusing the existing instance
 * from main.tsx instead of creating a separate one).
 */
export async function handleMcpjsonServerApprovals(root: Root): Promise<void> {
  const {
    servers: projectServers
  } = getMcpConfigsByScope('project');
  const pendingServers = Object.keys(projectServers).filter(serverName => getProjectMcpServerStatus(serverName) === 'pending');
  if (pendingServers.length === 0) {
    return;
  }
  await new Promise<void>(resolve => {
    const done = (): void => void resolve();
    if (pendingServers.length === 1 && pendingServers[0] !== undefined) {
      const serverName = pendingServers[0];
      root.render(<AppStateProvider>
          <KeybindingSetup>
            <MCPServerApprovalDialog serverName={serverName} onDone={done} />
          </KeybindingSetup>
        </AppStateProvider>);
    } else {
      root.render(<AppStateProvider>
          <KeybindingSetup>
            <MCPServerMultiselectDialog serverNames={pendingServers} onDone={done} />
          </KeybindingSetup>
        </AppStateProvider>);
    }
  });
}
