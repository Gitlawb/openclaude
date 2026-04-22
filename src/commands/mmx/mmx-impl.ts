/**
 * mmx subcommand implementation
 * Proxies all arguments to the mmx CLI (MiniMax AI Platform)
 */
import type { LocalCommandCall } from '../../types/command.js'
import { runMmxCommand } from './index.js'

export const call: LocalCommandCall = async (args: string) => {
  const parsedArgs = args.trim() ? args.trim().split(/\s+/) : []
  const mmxArgs = ['--non-interactive', ...parsedArgs]

  if (mmxArgs.length <= 1) {
    return {
      type: 'text',
      value: `🦆 DuckHive MiniMax Integration

/mmx text chat --message "Hello"     Chat with MiniMax
/mmx image "A cyberpunk cat"         Generate image
/mmx speech synthesize --text "Hi"  Text-to-speech
/mmx music generate --prompt "Jazz"  Generate music
/mmx video generate --prompt "Ocean" Generate video
/mmx vision ./photo.jpg             Analyze image
/mmx search "AI news"               Web search
/mmx quota                           Check usage quota

Run /mmx <subcommand> --help for details.`,
    }
  }

  try {
    await runMmxCommand(mmxArgs)
    return { type: 'text', value: '' }
  } catch (err) {
    return { type: 'text', value: `Error: ${err}` }
  }
}
