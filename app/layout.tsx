import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { ServiceWorkerRegister } from '@/components/ui/ServiceWorkerRegister'
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
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SVC',
  },
  icons: {
    icon: '/icon-192x192.png',
    apple: '/icon-192x192.png',
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
      <head>
        {/* Android PWA: env(safe-area-inset-bottom) often returns 0 on Android.
            Measure it with a test element; if < 20px, override --sab to cover the nav bar. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){if(!/android/i.test(navigator.userAgent))return;if(!window.matchMedia('(display-mode: standalone)').matches)return;var e=document.createElement('div');e.style.cssText='position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px);width:0;pointer-events:none';document.documentElement.appendChild(e);var h=e.offsetHeight;document.documentElement.removeChild(e);if(h<20)document.documentElement.style.setProperty('--sab','48px');})();` }} />
      </head>
      <body suppressHydrationWarning className="font-sans antialiased h-dvh overflow-hidden no-select" style={{ position: 'fixed', width: '100%', top: 0, left: 0 }}>
        <ServiceWorkerRegister />
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
