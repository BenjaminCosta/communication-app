import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import { Analytics } from '@vercel/analytics/next'
import { ServiceWorkerRegister } from '@/components/ui/ServiceWorkerRegister'
import { ViewportSync } from '@/components/ui/ViewportSync'
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
    statusBarStyle: 'black',
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
  viewportFit: 'auto',
  interactiveWidget: 'resizes-visual',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const cookieStore = await cookies()
  const launchModule = cookieStore.get('svc-last-module')?.value
  return (
    <html
      lang="en"
      className="bg-background h-full"
      data-svc-launch-module={launchModule === 'directory' ? 'directory' : undefined}
    >
      <head>
        {/* Android PWA: env(safe-area-inset-bottom) often returns 0 on Android.
            Measure it with a test element; if < 20px, override --sab to cover the nav bar. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){if(!/android/i.test(navigator.userAgent))return;if(!window.matchMedia('(display-mode: standalone)').matches)return;var e=document.createElement('div');e.style.cssText='position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px);width:0;pointer-events:none';document.documentElement.appendChild(e);var h=e.offsetHeight;document.documentElement.removeChild(e);if(h<20)document.documentElement.style.setProperty('--sab','48px');})();` }} />
      </head>
      <body
        suppressHydrationWarning
        className="font-sans antialiased overflow-hidden no-select"
        style={{
          position: 'fixed',
          top: 'var(--app-y, 0px)',
          left: 'var(--app-x, 0px)',
          width: 'var(--app-w, 100%)',
          height: 'var(--app-h, 100%)',
        }}
      >
        {/* Migration fallback for sessions with the older localStorage key but
            not the server-readable cookie yet. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(localStorage.getItem('svc-last-module')==='directory'){document.body.dataset.svcLaunchModule='directory';document.cookie='svc-last-module=directory; path=/; max-age=31536000; samesite=lax';}}catch(_){}})();` }} />
        <ViewportSync />
        <ServiceWorkerRegister />
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
