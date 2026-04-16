export function getConfig() {
  return {
    port: process.env.PORT ?? '3000',
    secret: process.env.JWT_SECRET ?? 'dev',
  }
}
export const CONFIG_VERSION = '1.0.0'
