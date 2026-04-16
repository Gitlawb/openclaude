export async function load() {
  const mod = await import('./b.js')
  return mod.default
}
