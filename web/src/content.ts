export const installCommand = 'npm install -g @gitlawb/openclaude'

export const features = [
  {
    title: 'any model, one terminal',
    body: 'local ollama, openai-compatible apis, gemini, codex, github models — switch with one command, no rewrites.',
  },
  {
    title: 'real tools, not just chat',
    body: 'bash, file edits, grep, glob, mcp servers, slash commands — wired into the agent loop, not bolted on.',
  },
  {
    title: 'profiles per repo',
    body: 'save model, base url, auth, and runtime defaults to .openclaude-profile.json so every clone boots the same way.',
  },
  {
    title: 'streaming, not batch',
    body: 'watch the agent think, call tools, and produce diffs live. no opaque background jobs.',
  },
  {
    title: 'routes through a gateway',
    body: 'plug into litellm, openrouter, or an internal proxy for policy, cost control, and failover.',
  },
  {
    title: 'editor and server modes',
    body: 'vs code extension and a grpc server so external systems can drive the same loop.',
  },
] as const

export const navLinks = [
  { href: '#features', label: 'features' },
  { href: '#install', label: 'install' },
  { href: 'https://github.com/Gitlawb/openclaude', label: 'github' },
  { href: 'https://gitlawb.com/node/repos/z6MkqDnb/openclaude', label: 'gitlawb' },
] as const
