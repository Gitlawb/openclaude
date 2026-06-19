// Stub — WorkflowTool not included in source snapshot. The WorkflowTool stub
// is disabled, so there are no workflow-backed slash commands to surface.
import type { Command } from '../../commands.js'

export async function getWorkflowCommands(_cwd: string): Promise<Command[]> {
  return []
}
