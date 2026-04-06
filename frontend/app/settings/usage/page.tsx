'use client'
import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

export default function UsageSettings() {
  const [stats, setStats] = useState<any>(null)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/dashboard/stats`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json()).then(setStats)
  }, [])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Usage</h1>
        <p className="text-gray-400 mt-1 text-sm">Token usage and request history</p>
      </div>

      {/* Monthly summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Input tokens', value: stats?.month?.input_tokens ?? 0 },
          { label: 'Output tokens', value: stats?.month?.output_tokens ?? 0 },
          { label: 'Requests', value: stats?.month?.requests ?? 0 },
        ].map(s => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <p className="text-gray-400 text-xs uppercase tracking-wide">{s.label}</p>
            <p className="text-2xl font-bold mt-2">{Number(s.value).toLocaleString()}</p>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      {stats?.subscription && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-400">Monthly limit</span>
            <span>{stats.subscription.percent_used.toFixed(1)}% of {(stats.subscription.monthly_token_limit / 1_000_000).toFixed(1)}M tokens</span>
          </div>
          <div className="h-2.5 bg-gray-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${stats.subscription.percent_used > 90 ? 'bg-red-500' : 'bg-orange-500'}`}
              style={{ width: `${Math.min(stats.subscription.percent_used, 100)}%` }} />
          </div>
        </div>
      )}

      {/* Daily requests chart */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="font-medium mb-4">Requests per day</h2>
        {stats?.daily?.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                labelStyle={{ color: '#9ca3af' }} />
              <Bar dataKey="requests" name="Requests" fill="#f97316" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-gray-600 text-sm">No data yet</div>
        )}
      </div>
    </div>
  )
}
