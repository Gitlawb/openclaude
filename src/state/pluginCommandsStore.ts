import type { Command } from '../commands.js'
import { createStore } from './store.js'

const pluginCommandsStore = createStore<Command[]>([])

export const getPluginCommandsState = (): Command[] =>
  pluginCommandsStore.getState()

export const subscribePluginCommands = pluginCommandsStore.subscribe

export function setPluginCommandsState(commands: Command[]): void {
  pluginCommandsStore.setState(() => [...commands])
}
