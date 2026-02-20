import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Not Twitch - Live Streaming Platform',
  description: 'A modern livestream platform built with Next.js and NestJS',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
