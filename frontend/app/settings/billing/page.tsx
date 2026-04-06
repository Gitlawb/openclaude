'use client'
import { useEffect, useState } from 'react'

const plans = [
  { id: 'free', name: 'Free', price: '$0', tokens: '100K', rpm: 10 },
  { id: 'pro', name: 'Pro', price: '$20', tokens: '5M', rpm: 60 },
  { id: 'max', name: 'Max', price: '$100', tokens: '100M', rpm: 200 },
  { id: 'team', name: 'Team', price: '$500', tokens: '500M', rpm: 500 },
]

export default function BillingSettings() {
  const [currentPlan, setCurrentPlan] = useState('free')

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/settings`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json()).then(d => setCurrentPlan(d.organization?.plan ?? 'free'))
  }, [])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-gray-400 mt-1 text-sm">Manage your subscription and payment</p>
      </div>

      {/* Current plan */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="font-medium mb-4">Current plan</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-bold capitalize">{currentPlan}</p>
            <p className="text-gray-400 text-sm">
              {plans.find(p => p.id === currentPlan)?.tokens} tokens/month ·{' '}
              {plans.find(p => p.id === currentPlan)?.rpm} req/min
            </p>
          </div>
          <span className="bg-orange-500/10 text-orange-400 border border-orange-500/30 text-xs px-3 py-1 rounded-full uppercase">
            {currentPlan}
          </span>
        </div>
      </div>

      {/* Plan picker */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <h2 className="font-medium">Change plan</h2>
        <div className="grid grid-cols-2 gap-3">
          {plans.map(p => (
            <div key={p.id}
              className={`p-4 rounded-xl border cursor-pointer transition-colors ${currentPlan === p.id ? 'border-orange-500 bg-orange-500/5' : 'border-gray-700 hover:border-gray-600'}`}>
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-gray-400 text-xs mt-1">{p.tokens} tokens/mo · {p.rpm} rpm</p>
                </div>
                <p className="text-sm font-bold">{p.price}<span className="text-gray-500 font-normal">/mo</span></p>
              </div>
              {currentPlan !== p.id && (
                <button className="mt-3 w-full text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 py-1.5 rounded-lg">
                  {p.id === 'free' ? 'Downgrade' : 'Upgrade'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Payment */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-3">
        <h2 className="font-medium">Payment method</h2>
        <p className="text-gray-500 text-sm">No payment method added — free plan requires none.</p>
        <button className="text-sm bg-orange-500 hover:bg-orange-400 text-white px-4 py-2 rounded-lg">
          Add payment method
        </button>
      </div>
    </div>
  )
}
