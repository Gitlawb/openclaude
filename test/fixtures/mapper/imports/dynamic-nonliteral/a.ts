const moduleName = './b.js'
export async function load() {
  const mod = await import(moduleName)
  return mod.default
}
