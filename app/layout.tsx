import type { Metadata, Viewport } from 'next';
import './globals.css';

export const viewport: Viewport = { themeColor: '#080809', colorScheme: 'dark' };

export const metadata: Metadata = {
  metadataBase: new URL('https://codyinnyc.github.io/bandwidth-site/'),
  title: 'Bandwidth Lab',
  description: 'A configurable bandwidth transfer utility using Cloudflare speed-test endpoints.',
  openGraph: {
    title: 'Bandwidth Lab',
    description: 'Every byte. Beautifully clear.',
    images: [{ url: '/bandwidth-site/og.png', width: 1731, height: 909, alt: 'Bandwidth Lab speedometer' }],
  },
  twitter: { card: 'summary_large_image', title: 'Bandwidth Lab', description: 'Every byte. Beautifully clear.', images: ['/bandwidth-site/og.png'] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
