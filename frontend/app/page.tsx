import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <nav className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <span className="text-xl font-bold text-orange-400">⚡ Gateway</span>
        <div className="flex gap-6 text-sm text-gray-300">
          <Link href="/pricing" className="hover:text-white">Pricing</Link>
          <Link href="#docs" className="hover:text-white">Docs</Link>
          <Link href="/login" className="bg-orange-500 hover:bg-orange-400 text-white px-4 py-1.5 rounded-md">Login</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 py-28 text-center">
        <div className="inline-block bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs px-3 py-1 rounded-full mb-6">
          Anthropic-compatible API Gateway
        </div>
        <h1 className="text-5xl font-bold mb-6 leading-tight">
          Your own AI API.<br />
          <span className="text-orange-400">Any model. Any client.</span>
        </h1>
        <p className="text-gray-400 text-lg mb-10 max-w-2xl mx-auto">
          Drop-in replacement for api.anthropic.com. Works with Claude Code,
          openclaude, and any Anthropic SDK out of the box.
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/login" className="bg-orange-500 hover:bg-orange-400 text-white px-8 py-3 rounded-lg font-medium">
            Get started free
          </Link>
          <Link href="/pricing" className="border border-gray-700 hover:border-gray-500 text-gray-300 px-8 py-3 rounded-lg">
            See pricing
          </Link>
        </div>

        {/* Code block */}
        <div className="mt-16 bg-gray-900 border border-gray-800 rounded-xl p-6 text-left text-sm font-mono">
          <p className="text-gray-500 mb-3"># Connect openclaude to your gateway</p>
          <p><span className="text-green-400">ANTHROPIC_BASE_URL</span>=<span className="text-orange-300">https://your-gateway.com</span></p>
          <p><span className="text-green-400">ANTHROPIC_API_KEY</span>=<span className="text-orange-300">sk-ant-api03-your-key</span></p>
          <p className="mt-2 text-blue-400">openclaude</p>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 py-16 grid grid-cols-3 gap-6">
        {[
          { icon: '🔀', title: 'Multi-model routing', desc: 'Claude, Qwen, and local models under one API' },
          { icon: '📊', title: 'Usage dashboard', desc: 'Track tokens, costs, and requests in real time' },
          { icon: '🔑', title: 'API key management', desc: 'Create and revoke sk-ant-... keys instantly' },
          { icon: '⚡', title: 'SSE streaming', desc: 'Full streaming support, token by token' },
          { icon: '🛡️', title: 'Rate limiting', desc: 'Per-plan limits via Redis, no overages' },
          { icon: '🐳', title: 'Self-hosted', desc: 'One docker compose up and you\'re live' },
        ].map(f => (
          <div key={f.title} className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="text-2xl mb-3">{f.icon}</div>
            <h3 className="font-semibold mb-1">{f.title}</h3>
            <p className="text-gray-400 text-sm">{f.desc}</p>
          </div>
        ))}
      </section>
    </main>
  )
}
