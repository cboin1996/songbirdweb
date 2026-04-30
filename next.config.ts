import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Audio uploads routed through middleware can exceed the default 10MB.
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
