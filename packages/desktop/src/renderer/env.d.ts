export {}

declare global {
  interface Window {
    platform: {
      os: string
      arch: string
    }
  }
}
