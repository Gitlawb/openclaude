import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Gateway — Anthropic-compatible API',
  description: 'Your own AI API gateway',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
