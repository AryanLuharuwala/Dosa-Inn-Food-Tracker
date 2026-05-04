import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // canvas is a native addon used server-side for receipt rendering — keep it external
  serverExternalPackages: ['canvas'],
};

export default nextConfig;
