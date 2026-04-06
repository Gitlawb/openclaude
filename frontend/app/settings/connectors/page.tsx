export default function ConnectorsSettings() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Connectors</h1>
        <p className="text-gray-400 mt-1 text-sm">Integrate with external services</p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <h2 className="font-medium">Available connectors</h2>
        <p className="text-gray-500 text-sm">Connect your gateway to external LLM providers and services.</p>
        <div className="space-y-3">
          {[
            { name: 'Custom API', desc: 'Your OpenAI-compatible endpoint', status: 'Connected', color: 'green' },
            { name: 'OpenAI', desc: 'Official OpenAI API', status: 'Not configured', color: 'gray' },
            { name: 'Anthropic', desc: 'Official Anthropic API', status: 'Not configured', color: 'gray' },
            { name: 'Ollama', desc: 'Local models', status: 'Not configured', color: 'gray' },
          ].map(c => (
            <div key={c.name} className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg">
              <div>
                <p className="font-medium text-sm">{c.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{c.desc}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${c.color === 'green' ? 'bg-green-500/10 text-green-400 border border-green-500/30' : 'bg-gray-700 text-gray-400'}`}>
                {c.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
