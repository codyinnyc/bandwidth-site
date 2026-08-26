import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://speed.codycoop.chatgpt.site'),
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
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
