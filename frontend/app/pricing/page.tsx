import Link from 'next/link'

const plans = [
  { name: 'Free', price: '$0', period: '/month', tokens: '100K', rpm: 10, keys: 1, color: 'gray' },
  { name: 'Pro', price: '$20', period: '/month', tokens: '5M', rpm: 60, keys: 10, color: 'orange', popular: true },
  { name: 'Max', price: '$100', period: '/month', tokens: '100M', rpm: 200, keys: 'Unlimited', color: 'purple' },
  { name: 'Team', price: '$500', period: '/month', tokens: '500M', rpm: 500, keys: 'Unlimited', color: 'blue' },
]

export default function Pricing() {
  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <nav className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold text-orange-400">⚡ Gateway</Link>
        <Link href="/login" className="bg-orange-500 hover:bg-orange-400 text-white text-sm px-4 py-1.5 rounded-md">Login</Link>
      </nav>

      <section className="max-w-5xl mx-auto px-6 py-20">
        <h1 className="text-4xl font-bold text-center mb-4">Simple pricing</h1>
        <p className="text-gray-400 text-center mb-14">Start free, upgrade when you need more</p>

        <div className="grid grid-cols-4 gap-5">
          {plans.map(p => (
            <div key={p.name} className={`bg-gray-900 border rounded-xl p-6 flex flex-col ${p.popular ? 'border-orange-500' : 'border-gray-800'}`}>
              {p.popular && (
                <span className="text-xs bg-orange-500 text-white px-2 py-0.5 rounded-full self-start mb-3">Most popular</span>
              )}
              <h2 className="text-xl font-bold">{p.name}</h2>
              <div className="mt-2 mb-6">
                <span className="text-3xl font-bold">{p.price}</span>
                <span className="text-gray-400 text-sm">{p.period}</span>
              </div>
              <ul className="space-y-2 text-sm text-gray-300 flex-1">
                <li>✓ {p.tokens} tokens/month</li>
                <li>✓ {p.rpm} requests/min</li>
                <li>✓ {p.keys} API key{p.keys === 1 ? '' : 's'}</li>
                <li>✓ All models</li>
                <li>✓ SSE streaming</li>
              </ul>
              <Link href="/login"
                className={`mt-6 text-center py-2.5 rounded-lg text-sm font-medium ${p.popular ? 'bg-orange-500 hover:bg-orange-400 text-white' : 'border border-gray-700 hover:border-gray-500 text-gray-300'}`}>
                Get started
              </Link>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
