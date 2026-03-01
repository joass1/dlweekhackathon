'use client';

import { SessionProvider } from 'next-auth/react';
import { MainLayout } from './MainLayout';

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <MainLayout>{children}</MainLayout>
    </SessionProvider>
  );
} 