import type { NextConfig } from 'next';

// Both deploy targets are static exports served from a sub-path, so the base
// path is the only thing that varies between them:
//   * cooop.io/speed        (Cloudflare Worker, canonical)
//   * /bandwidth-site/      (GitHub Pages mirror)
const isStaticExport = process.env.STATIC_EXPORT === 'true';
const basePath = process.env.SITE_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  ...(isStaticExport ? { output: 'export' as const, trailingSlash: true } : {}),
  ...(basePath ? { basePath } : {}),
};

export default nextConfig;
