import type { SDKMessage, SDKUserMessage, SDKResultMessage } from '@gitlawb/openclaude/sdk'

// Discriminated union check — if types are broken, this won't compile
function handle(msg: SDKMessage) {
  if (msg.type === 'user') {
    const u: SDKUserMessage = msg
    console.log(u.message.content)
  }
  if (msg.type === 'result') {
    const r: SDKResultMessage = msg
    console.log(r.type)
  }
}