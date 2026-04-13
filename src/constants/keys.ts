export function getGrowthBookClientKey(): string {
  return process.env.GROWTHBOOK_CLIENT_KEY ?? ''
}
