/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: ['192.168.68.104'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Allow cross-origin popup references (needed for Google OAuth implicit flow)
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
        ],
      },
    ]
  },
}

export default nextConfig
