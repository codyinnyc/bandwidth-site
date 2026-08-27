import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://codyinnyc.github.io/bandwidth-site/'),
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
