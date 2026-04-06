'use client'
import { useEffect, useState } from 'react'

export default function GeneralSettings() {
  const [name, setName] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/settings`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json()).then(d => setName(d.account?.display_name ?? ''))
  }, [])

  async function save() {
    const token = localStorage.getItem('access_token')
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/settings`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: name }),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">General</h1>
        <p className="text-gray-400 mt-1 text-sm">Manage your profile and preferences</p>
      </div>
      <Section title="Display name" desc="Your name shown in the dashboard">
        <div className="flex gap-3">
          <input value={name} onChange={e => setName(e.target.value)}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-orange-500 text-sm"
            placeholder="Your name" />
          <button onClick={save} className="bg-orange-500 hover:bg-orange-400 text-white px-5 py-2 rounded-lg text-sm font-medium">
            {saved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </Section>
      <Section title="Theme" desc="Interface color theme">
        <div className="flex gap-3">
          {['Dark', 'Light', 'System'].map(t => (
            <button key={t} className={`px-4 py-2 rounded-lg text-sm border ${t === 'Dark' ? 'bg-orange-500/10 border-orange-500 text-orange-400' : 'border-gray-700 text-gray-400 hover:border-gray-600'}`}>
              {t}
            </button>
          ))}
        </div>
      </Section>
    </div>
  )
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
      <div>
        <h2 className="font-medium">{title}</h2>
        <p className="text-gray-500 text-sm mt-0.5">{desc}</p>
      </div>
      {children}
    </div>
  )
}
