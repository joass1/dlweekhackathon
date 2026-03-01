'use client';

import { AuthProvider } from '@/contexts/AuthContext';
import { MainLayout } from './MainLayout';

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <MainLayout>{children}</MainLayout>
    </AuthProvider>
  );
}
