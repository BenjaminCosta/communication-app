import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import '@fontsource/sora/300.css'
import '@fontsource/sora/400.css'
import '@fontsource/sora/500.css'
import '@fontsource/sora/600.css'
import '@fontsource/sora/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'SVC Messaging — MVP',
  description: 'Capture messages fast, organize later. Three screens, one flow.',
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#0B0F14',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-visual',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="bg-background h-full">
      <body suppressHydrationWarning className="font-sans antialiased h-dvh overflow-hidden no-select" style={{ position: 'fixed', width: '100%', top: 0, left: 0 }}>
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
