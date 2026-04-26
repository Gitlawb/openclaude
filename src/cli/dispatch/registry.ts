import { Command as CommanderCommand } from '@commander-js/extra-typings';

export type CommandModule = {
  name: string;
  description: string;
  alias?: string;
  hidden?: boolean;
  register: (program: CommanderCommand) => void;
};

const registry: CommandModule[] = [];

/**
 * Registers a command module into the global registry.
 */
export function registerCommand(module: CommandModule) {
  registry.push(module);
}

/**
 * Attaches all registered commands to the provided Commander program.
 */
export function attachCommands(program: CommanderCommand) {
  for (const module of registry) {
    module.register(program);
  }
}
