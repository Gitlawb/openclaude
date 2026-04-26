import { registerCommand } from './registry.js';
import { getBaseRenderOptions } from '../../utils/renderOptions.js';

export const doctorCommand = {
  name: 'doctor',
  description: 'Check the health of your OpenClaude auto-updater.',
  register: (program: any) => {
    program.command('doctor')
      .description('Check the health of your OpenClaude auto-updater. Note: The workspace trust dialog is skipped and stdio servers from .mcp.json are spawned for health checks. Only use this command in directories you trust.')
      .action(async () => {
        const [{ doctorHandler }, { createRoot }] = await Promise.all([
          import('../../cli/handlers/util.js'),
          import('../../ink.js')
        ]);
        const root = await createRoot(getBaseRenderOptions(false));
        await doctorHandler(root);
      });
  }
};

registerCommand(doctorCommand);
