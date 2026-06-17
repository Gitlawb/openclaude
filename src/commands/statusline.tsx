import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import type { Command } from '../commands.js';
import { AGENT_TOOL_NAME } from '../tools/AgentTool/constants.js';
import { getSettingsFilePathForSource } from '../utils/settings/settings.js';

function getUserSettingsPath(): string {
  return getSettingsFilePathForSource('userSettings') ?? '~/.openclaude/settings.json';
}

const statusline = {
  type: 'prompt',
  description: "Set up OpenClaude's status line UI",
  contentLength: 0,
  // Dynamic content
  aliases: [],
  name: 'statusline',
  progressMessage: 'setting up statusLine',
  get allowedTools() {
    return [AGENT_TOOL_NAME, 'Read(~/**)', `Edit(${getUserSettingsPath()})`];
  },
  source: 'builtin',
  disableNonInteractive: true,
  async getPromptForCommand(args): Promise<ContentBlockParam[]> {
    const prompt = args.trim() || 'Configure my statusLine from my shell PS1 configuration';
    return [{
      type: 'text',
      text: `Create an ${AGENT_TOOL_NAME} with subagent_type "statusline-setup" and the prompt "${prompt}"`
    }];
  }
} satisfies Command;
export default statusline;
