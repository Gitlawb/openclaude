export default function CapabilitiesSettings() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Capabilities</h1>
        <p className="text-gray-400 mt-1 text-sm">Available models and features</p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <h2 className="font-medium">Available models</h2>
        <div className="space-y-2">
          {[
            { name: 'kiro/claude-sonnet-4.5', ctx: '200K', desc: 'Best for complex tasks' },
            { name: 'kiro/claude-haiku-4.5', ctx: '200K', desc: 'Fast and efficient' },
            { name: 'qwen/qwen3-coder-plus', ctx: '32K', desc: 'Code generation' },
            { name: 'qwen/qwen3-coder-flash', ctx: '32K', desc: 'Fast coding' },
          ].map(m => (
            <div key={m.name} className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
              <div>
                <p className="text-sm font-mono">{m.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{m.desc}</p>
              </div>
              <span className="text-xs text-gray-400">{m.ctx} context</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-3">
        <h2 className="font-medium">Features</h2>
        <div className="space-y-2 text-sm">
          {['✓ SSE streaming', '✓ Tool use', '✓ Vision (image input)', '✓ Multi-turn conversations'].map(f => (
            <p key={f} className="text-gray-300">{f}</p>
          ))}
        </div>
      </div>
    </div>
  )
}
