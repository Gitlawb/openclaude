'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const nav = [
  { href: '/settings', label: 'General', icon: '⚙️' },
  { href: '/settings/account', label: 'Account', icon: '👤' },
  { href: '/settings/privacy', label: 'Privacy', icon: '🔒' },
  { href: '/settings/billing', label: 'Billing', icon: '💳' },
  { href: '/settings/usage', label: 'Usage', icon: '📊' },
  { href: '/settings/capabilities', label: 'Capabilities', icon: '✨' },
  { href: '/settings/connectors', label: 'Connectors', icon: '🔌' },
  { href: '/settings/claude-code', label: 'Claude Code', icon: '💻' },
  { href: '/settings/claude-chrome', label: 'Claude in Chrome', icon: '🌐' },
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <div className="min-h-screen bg-gray-950 text-white flex">
      {/* Sidebar */}
      <aside className="w-56 border-r border-gray-800 flex flex-col py-6 px-4 shrink-0">
        <Link href="/dashboard" className="text-xl font-bold text-orange-400 mb-8 px-2">⚡ Gateway</Link>
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-3 px-3">Settings</p>
        <nav className="space-y-0.5 flex-1">
          {nav.map(n => {
            const active = pathname === n.href
            return (
              <Link key={n.href} href={n.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
                  ${active ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'}`}>
                <span className="text-base">{n.icon}</span>{n.label}
              </Link>
            )
          })}
        </nav>
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-white px-3 py-2">← Dashboard</Link>
      </aside>
      <main className="flex-1 max-w-3xl px-10 py-10">{children}</main>
    </div>
  )
}
