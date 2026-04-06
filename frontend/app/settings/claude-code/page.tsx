export default function ClaudeCodeSettings() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Claude Code</h1>
        <p className="text-gray-400 mt-1 text-sm">Configure openclaude CLI integration</p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <h2 className="font-medium">Quick setup</h2>
        <p className="text-gray-400 text-sm">Connect openclaude to your gateway in 3 steps:</p>
        <div className="space-y-3">
          {[
            { step: '1', text: 'Install openclaude', cmd: 'npm install -g @gitlawb/openclaude' },
            { step: '2', text: 'Set environment variables', cmd: `ANTHROPIC_BASE_URL=${typeof window !== 'undefined' ? window.location.origin : 'http://your-gateway'}\nANTHROPIC_API_KEY=sk-ant-api03-your-key` },
            { step: '3', text: 'Run openclaude', cmd: 'openclaude' },
          ].map(s => (
            <div key={s.step} className="flex gap-4">
              <div className="w-6 h-6 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-xs font-bold shrink-0">
                {s.step}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium mb-1">{s.text}</p>
                <pre className="text-xs bg-gray-950 p-3 rounded-lg text-gray-300 overflow-x-auto">{s.cmd}</pre>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-3">
        <h2 className="font-medium">Compatibility</h2>
        <p className="text-gray-400 text-sm">This gateway is compatible with:</p>
        <ul className="text-sm text-gray-300 space-y-1">
          <li>✓ openclaude CLI</li>
          <li>✓ Official Claude Code CLI</li>
          <li>✓ Any Anthropic SDK client</li>
          <li>✓ curl / HTTP clients</li>
        </ul>
      </div>
    </div>
  )
}
