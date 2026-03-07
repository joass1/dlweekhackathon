// src/app/layout.tsx
import './globals.css';
import 'katex/dist/katex.min.css';
import type { Metadata } from 'next';
import { ClientLayout } from '@/components/layout';

export const metadata: Metadata = {
  title: 'Mentora',
  description: 'Adaptive learning platform powered by knowledge graphs, mastery tracking, and peer collaboration',
  icons: {
    icon: '/logo-images/favicon.png',
    shortcut: '/logo-images/favicon.png',
    apple: '/logo-images/favicon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Ubuntu:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,500;1,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
