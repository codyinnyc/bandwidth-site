import type { Metadata } from 'next';
import './globals.css';

// Set per deploy target; defaults to the canonical Cloudflare-hosted origin.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bandwidth.cooop.io';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Bandwidth Lab',
  description: 'A configurable bandwidth transfer utility using Cloudflare speed-test endpoints.',
  openGraph: {
    title: 'Bandwidth Lab',
    description: 'Use the bandwidth. See every byte.',
    images: [{ url: '/og.png', width: 1731, height: 909, alt: 'Bandwidth Lab speedometer' }],
  },
  twitter: { card: 'summary_large_image', title: 'Bandwidth Lab', description: 'Use the bandwidth. See every byte.', images: ['/og.png'] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
