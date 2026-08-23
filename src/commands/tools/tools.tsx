import * as React from 'react'
import { ToolModeManager } from '../../components/ToolModeManager.js'
import { getToolsForModeManager } from '../../tools.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

export const call: LocalJSXCommandCall = async (onDone, context) => {
  const appState = context.getAppState()
  const permissionContext = appState.toolPermissionContext
  // Manager list must include tools configured to 'off' (so they can be cycled
  // back on) and the MCP tools in the active pool. getTools() would strip both.
  const tools = getToolsForModeManager(permissionContext, appState.mcp.tools)
  return <ToolModeManager tools={tools} onClose={onDone} />
}
