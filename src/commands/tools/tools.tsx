import * as React from 'react'
import { ToolModeManager } from '../../components/ToolModeManager.js'
import { getTools } from '../../tools.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

export const call: LocalJSXCommandCall = async (onDone, context) => {
  const appState = context.getAppState()
  const permissionContext = appState.toolPermissionContext
  const tools = getTools(permissionContext)
  return <ToolModeManager tools={tools} onClose={onDone} />
}
