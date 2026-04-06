'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AccountSettings() {
  const router = useRouter()
  const [info, setInfo] = useState<{ email: string; uuid: string; display_name: string } | null>(null)
  const [password, setPassword] = useState({ current: '', next: '', confirm: '' })
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/settings`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json()).then(d => setInfo(d.account))
  }, [])

  function deleteAccount() {
    if (!confirm('Are you sure? This cannot be undone.')) return
    localStorage.clear()
    router.push('/')
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Account</h1>
        <p className="text-gray-400 mt-1 text-sm">Manage your account details and security</p>
      </div>

      {/* Account info */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <h2 className="font-medium">Account information</h2>
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Email</span>
            <span className="text-gray-200">{info?.email}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Account ID</span>
            <span className="text-gray-500 font-mono text-xs">{info?.uuid}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Display name</span>
            <span className="text-gray-200">{info?.display_name || '—'}</span>
          </div>
        </div>
      </div>

      {/* Change password */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <h2 className="font-medium">Change password</h2>
        {msg && <p className="text-green-400 text-sm">{msg}</p>}
        <div className="space-y-3">
          {[
            { label: 'Current password', key: 'current' },
            { label: 'New password', key: 'next' },
            { label: 'Confirm new password', key: 'confirm' },
          ].map(f => (
            <div key={f.key}>
              <label className="text-sm text-gray-400 mb-1 block">{f.label}</label>
              <input type="password"
                value={password[f.key as keyof typeof password]}
                onChange={e => setPassword(p => ({ ...p, [f.key]: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-orange-500 text-sm" />
            </div>
          ))}
          <button className="bg-orange-500 hover:bg-orange-400 text-white px-5 py-2 rounded-lg text-sm font-medium">
            Update password
          </button>
        </div>
      </div>

      {/* Danger zone */}
      <div className="bg-gray-900 border border-red-900/40 rounded-xl p-6 space-y-3">
        <h2 className="font-medium text-red-400">Danger zone</h2>
        <p className="text-gray-400 text-sm">Once you delete your account, there is no going back.</p>
        <button onClick={deleteAccount}
          className="text-sm text-red-400 border border-red-400/40 hover:bg-red-400/10 px-4 py-2 rounded-lg">
          Delete account
        </button>
      </div>
    </div>
  )
}
