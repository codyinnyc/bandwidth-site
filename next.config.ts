import type { NextConfig } from 'next';

// Two static-export targets share this config:
//   * Cloudflare Workers (the canonical site) serves the export at the origin
//     root, so it needs no basePath.
//   * The GitHub Pages project site stays reachable at /bandwidth-site/, which
//     does need one.
const isGitHubPages = process.env.GITHUB_PAGES === 'true';
const isStaticExport = isGitHubPages || process.env.STATIC_EXPORT === 'true';

const nextConfig: NextConfig = {
  ...(isStaticExport ? { output: 'export' as const, trailingSlash: true } : {}),
  ...(isGitHubPages ? { basePath: '/bandwidth-site' } : {}),
};

export default nextConfig;
