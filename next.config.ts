import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ['10.0.0.2'],
  // The proxy no longer sees uploads: its matcher skips /v1 except song downloads, which
  // are GETs. The limit stays as a guard for any future matched route that takes a body.
  experimental: {
    proxyClientMaxBodySize: '100mb',
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version,
  },
  async rewrites() {
    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:8000'
    return {
      // Song downloads skip the /v1 route handler. Since 15.5.28 Next drops
      // content-length from every route handler response (send-response.js,
      // FORBIDDEN_HEADERS), and a full audio response without its length leaves
      // the player not knowing the duration until the whole file arrives. A
      // rewrite proxies the upstream response with its headers intact. It runs
      // before the app routes, after the middleware's token refresh.
      beforeFiles: [
        {
          source: '/v1/download/:id',
          destination: `${apiBase}/v1/download/:id`,
        },
      ],
      afterFiles: [
        {
          source: '/v1/songs/:id/artwork/:size',
          destination: `${apiBase}/v1/songs/:id/artwork/:size`,
        },
        {
          // The version is part of the URL only (see songArtworkUrl).
          source: '/v1/songs/:id/artwork/:size/:version',
          destination: `${apiBase}/v1/songs/:id/artwork/:size/:version`,
        },
      ],
      fallback: [],
    }
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
