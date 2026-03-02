'use client';

import { AuthProvider } from '@/contexts/AuthContext';
import { SidebarProvider } from '@/contexts/SidebarContext';
import { MainLayout } from './MainLayout';

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SidebarProvider>
        <MainLayout>{children}</MainLayout>
      </SidebarProvider>
    </AuthProvider>
  );
}
