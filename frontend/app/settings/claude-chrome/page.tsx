export default function ClaudeChromeSettings() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Claude in Chrome</h1>
        <p className="text-gray-400 mt-1 text-sm">Browser extension integration</p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <h2 className="font-medium">Coming soon</h2>
        <p className="text-gray-400 text-sm">
          Browser extension support is in development. You'll be able to use your gateway API directly from Chrome.
        </p>
        <button disabled className="text-sm bg-gray-800 text-gray-500 px-4 py-2 rounded-lg cursor-not-allowed">
          Install extension (coming soon)
        </button>
      </div>
    </div>
  )
}
