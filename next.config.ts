import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // canvas is a native addon used server-side for receipt rendering — keep it external
  serverExternalPackages: ['canvas'],
  // The TTF under lib/printer/fonts/ is read at runtime via fs, not imported,
  // so Next.js can't trace it automatically. Force it into the standalone bundle.
  outputFileTracingIncludes: {
    '/api/print/jobs/**': ['./lib/printer/fonts/**'],
    '/api/print/**':      ['./lib/printer/fonts/**'],
  },
};

export default nextConfig;
