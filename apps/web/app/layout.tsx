import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Monorepo Starter',
  description: 'A production-ready monorepo starter',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
