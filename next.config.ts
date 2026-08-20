import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Never leak source maps of server code to the browser in production.
  productionBrowserSourceMaps: false,
  serverExternalPackages: ['@node-rs/argon2', 'sharp'],
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  images: { formats: ['image/webp'] },
  eslint: { ignoreDuringBuilds: true },
};

export default config;
