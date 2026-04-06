'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'

type Stats = {
  month: { input_tokens: number; output_tokens: number; total_tokens: number; requests: number }
  daily: { day: string; input: number; output: number; requests: number }[]
  subscription: { plan: string; monthly_token_limit: number; percent_used: number; rpm_limit: number }
}
type APIKey = { id: string; name: string; key_prefix: string; last_used: string | null; created_at: string }

function useAPI<T>(url: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) return
    fetch(`${process.env.NEXT_PUBLIC_API_URL}${url}`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json()).then(setData).catch(() => {})
  }, deps)
  return data
}

export default function Dashboard() {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [keys, setKeys] = useState<APIKey[]>([])
  const stats = useAPI<Stats>('/api/dashboard/stats')

  useEffect(() => {
    if (!localStorage.getItem('access_token')) router.push('/login')
    fetchKeys()
  }, [])

  async function fetchKeys() {
    const token = localStorage.getItem('access_token')
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/dashboard/keys`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.ok) setKeys(await res.json())
  }

  async function createKey() {
    setCreating(true)
    const token = localStorage.getItem('access_token')
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/claude_cli/api_key`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }
    })
    if (res.ok) { const d = await res.json(); setNewKey(d.raw_key); fetchKeys() }
    setCreating(false)
  }

  async function deleteKey(id: string) {
    const token = localStorage.getItem('access_token')
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/dashboard/keys?id=${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
    })
    fetchKeys()
  }

  const plan = stats?.subscription?.plan ?? 'free'
  const planColors: Record<string, string> = { free: 'gray', pro: 'orange', max: 'purple', team: 'blue', enterprise: 'green' }
  const planColor = planColors[plan] ?? 'gray'

  return (
    <div className="min-h-screen bg-gray-950 text-white flex">
      {/* Sidebar */}
      <aside className="w-56 border-r border-gray-800 flex flex-col py-6 px-4 shrink-0">
        <Link href="/" className="text-xl font-bold text-orange-400 mb-8 px-2">⚡ Gateway</Link>
        <nav className="space-y-1 flex-1">
          {[
            { href: '/dashboard', label: 'Dashboard', icon: '📊' },
            { href: '/settings', label: 'Settings', icon: '⚙️' },
            { href: '/pricing', label: 'Billing', icon: '💳' },
          ].map(n => (
            <Link key={n.href} href={n.href}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800 hover:text-white">
              <span>{n.icon}</span>{n.label}
            </Link>
          ))}
        </nav>
        <button onClick={() => { localStorage.clear(); router.push('/login') }}
          className="text-sm text-gray-500 hover:text-white px-3 py-2 text-left">
          Logout
        </button>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto p-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <span className={`text-xs px-3 py-1 rounded-full border border-${planColor}-500/40 text-${planColor}-400 bg-${planColor}-500/10 uppercase font-medium`}>
            {plan} plan
          </span>
        </div>

        {/* Usage stats */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Input tokens', value: (stats?.month.input_tokens ?? 0).toLocaleString() },
            { label: 'Output tokens', value: (stats?.month.output_tokens ?? 0).toLocaleString() },
            { label: 'Total tokens', value: (stats?.month.total_tokens ?? 0).toLocaleString() },
            { label: 'Requests', value: (stats?.month.requests ?? 0).toLocaleString() },
          ].map(s => (
            <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-gray-400 text-xs uppercase tracking-wide">{s.label}</p>
              <p className="text-2xl font-bold mt-2">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Token limit progress */}
        {stats && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-400">Monthly token usage</span>
              <span className="text-gray-300">{stats.subscription.percent_used.toFixed(1)}% of {(stats.subscription.monthly_token_limit / 1_000_000).toFixed(1)}M</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${stats.subscription.percent_used > 90 ? 'bg-red-500' : stats.subscription.percent_used > 70 ? 'bg-yellow-500' : 'bg-orange-500'}`}
                style={{ width: `${Math.min(stats.subscription.percent_used, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Chart */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="font-semibold mb-4">Tokens — last 30 days</h2>
          {stats?.daily && stats.daily.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={stats.daily}>
                <defs>
                  <linearGradient id="inputGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="outputGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={v => v > 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                  labelStyle={{ color: '#9ca3af' }} itemStyle={{ color: '#e5e7eb' }} />
                <Area type="monotone" dataKey="input" name="Input" stroke="#f97316" fill="url(#inputGrad)" strokeWidth={2} />
                <Area type="monotone" dataKey="output" name="Output" stroke="#60a5fa" fill="url(#outputGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-gray-600 text-sm">
              No data yet — make your first API call
            </div>
          )}
        </div>

        {/* Quick connect */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="font-semibold mb-3">Connect openclaude</h2>
          <div className="bg-gray-950 rounded-lg p-4 font-mono text-sm space-y-1">
            <p><span className="text-green-400">ANTHROPIC_BASE_URL</span>=<span className="text-orange-300">{typeof window !== 'undefined' ? window.location.origin : ''}</span></p>
            <p><span className="text-green-400">ANTHROPIC_API_KEY</span>=<span className="text-orange-300">sk-ant-api03-your-key</span></p>
            <p className="text-blue-400 mt-2">openclaude</p>
          </div>
        </div>

        {/* New key banner */}
        {newKey && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-5">
            <p className="text-green-400 font-semibold mb-2">Copy your key now — it won't be shown again</p>
            <code className="text-sm bg-gray-950 px-3 py-2 rounded block break-all">{newKey}</code>
            <button onClick={() => { navigator.clipboard.writeText(newKey); setNewKey('') }}
              className="mt-3 text-sm bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded">
              Copy & dismiss
            </button>
          </div>
        )}

        {/* API Keys */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">API Keys</h2>
            <button onClick={createKey} disabled={creating}
              className="bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg">
              {creating ? 'Creating...' : '+ New key'}
            </button>
          </div>
          <div className="space-y-2">
            {keys.length === 0 && <p className="text-gray-500 text-sm">No keys yet.</p>}
            {keys.map(k => (
              <div key={k.id} className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{k.name}</p>
                  <p className="text-gray-400 text-xs font-mono mt-0.5">{k.key_prefix}</p>
                </div>
                <div className="flex items-center gap-4">
                  <p className="text-gray-500 text-xs">{k.last_used ? `Used ${new Date(k.last_used).toLocaleDateString()}` : 'Never used'}</p>
                  <button onClick={() => deleteKey(k.id)}
                    className="text-xs text-red-400 hover:text-red-300 border border-red-400/30 px-3 py-1 rounded-md">
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
