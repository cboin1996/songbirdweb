import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version,
  },
  images: {
    localPatterns: [
      { pathname: "/v1/**", search: "?size=thumb" },
      { pathname: "/v1/**", search: "?size=full" },
    ],
    remotePatterns: [
      { protocol: "https", hostname: "**.mzstatic.com" },
      { protocol: "http", hostname: "localhost" },
    ],
  },
};

export default nextConfig;
