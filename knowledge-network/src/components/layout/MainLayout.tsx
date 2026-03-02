'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Loader2, ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSidebar } from '@/contexts/SidebarContext';
import { Sidebar } from './Sidebar';

interface MainLayoutProps {
  children: React.ReactNode;
}

export const MainLayout = ({ children }: MainLayoutProps) => {
  const pathname = usePathname();
  const { loading } = useAuth();
  const { isCollapsed, toggle } = useSidebar();
  const isAuthPage = pathname === '/auth/signin';

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#03b2e6]" />
      </div>
    );
  }

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar container — clips and animates width to slide in/out */}
      <div
        className={`flex-shrink-0 overflow-hidden transition-all duration-300 ease-in-out ${
          isCollapsed ? 'w-0' : 'w-64'
        }`}
      >
        <Sidebar />
      </div>

      {/* Persistent re-open tab — slides in from the left when sidebar is collapsed */}
      <button
        onClick={toggle}
        className={`fixed left-0 top-6 z-[60] flex items-center justify-center w-6 h-8 bg-card border border-l-0 border-border rounded-r-lg shadow-md hover:bg-accent transition-transform duration-300 ease-in-out ${
          isCollapsed ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Open sidebar"
      >
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
      </button>

      <main className="flex-1 overflow-auto min-w-0">
        {children}
      </main>
    </div>
  );
};
