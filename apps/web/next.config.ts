import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Proxy socket connections so client doesn't need CORS config in prod.
  // In dev, SOCKET_SERVER_URL = http://localhost:3001
  // In prod, set it to your socket server's internal URL.
  rewrites: async () => [
    {
      source:      '/socket.io/:path*',
      destination: `${process.env.SOCKET_SERVER_URL ?? 'http://localhost:3001'}/socket.io/:path*`,
    },
  ],
  // These packages use Node.js APIs and can't be bundled by Next.js
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'pg', 'pino'],
}

export default nextConfig