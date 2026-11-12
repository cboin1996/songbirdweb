import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ['10.0.0.2'],
  // Middleware no longer sees uploads: its matcher skips /v1 except song downloads, which
  // are GETs. The limit stays as a guard for any future matched route that takes a body.
  experimental: {
    middlewareClientMaxBodySize: '100mb',
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version,
  },
  async rewrites() {
    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:8000'
    return [
      {
        source: '/v1/songs/:id/artwork/:size',
        destination: `${apiBase}/v1/songs/:id/artwork/:size`,
      },
    ]
  },
  // Lint is a separate CI step (`make lint`); don't gate the build on it.
  // Pre-existing source-level warnings/errors shouldn't block deploy.
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    // Remote artwork is requested at two widths (app/lib/artwork.ts), cached 30 days.
    minimumCacheTTL: 60 * 60 * 24 * 30,
    imageSizes: [200],
    deviceSizes: [600],
    localPatterns: [
      { pathname: "/v1/**" },
    ],
    remotePatterns: [
      { protocol: "https", hostname: "**.mzstatic.com" },
      { protocol: "http", hostname: "localhost" },
    ],
  },
};

export default nextConfig;
