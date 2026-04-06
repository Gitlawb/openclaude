export default function PrivacySettings() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Privacy</h1>
        <p className="text-gray-400 mt-1 text-sm">Control your data and privacy settings</p>
      </div>

      <Section title="Data collection" desc="How we use your data">
        <Toggle label="Usage analytics" desc="Help improve the service by sharing anonymous usage data" enabled />
        <Toggle label="Error reporting" desc="Automatically send error reports to help us fix bugs" enabled />
      </Section>

      <Section title="API logs" desc="Request and response logging">
        <Toggle label="Log API requests" desc="Store API request metadata for debugging (no prompt content)" enabled />
        <p className="text-gray-500 text-sm">Logs are retained for 30 days and never include prompt content or responses.</p>
      </Section>

      <Section title="Data export" desc="Download your data">
        <button className="text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded-lg">
          Request data export
        </button>
        <p className="text-gray-500 text-sm mt-2">We'll email you a download link within 24 hours.</p>
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

function Toggle({ label, desc, enabled }: { label: string; desc: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-gray-500 text-xs mt-0.5">{desc}</p>
      </div>
      <button className={`w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-orange-500' : 'bg-gray-700'}`}>
        <div className={`w-4 h-4 bg-white rounded-full transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  )
}
