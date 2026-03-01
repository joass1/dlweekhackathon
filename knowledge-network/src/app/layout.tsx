// src/app/layout.tsx
import './globals.css';
import type { Metadata } from 'next';
import { ClientLayout } from '@/components/layout';

export const metadata: Metadata = {
  title: 'LearnGraph AI',
  description: 'Adaptive learning platform powered by knowledge graphs, mastery tracking, and peer collaboration',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans">
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
