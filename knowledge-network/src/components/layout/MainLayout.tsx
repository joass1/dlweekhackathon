'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardCheck, Home, LogOut, MessageSquare, Rocket, Upload, UserCircle2, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSidebar } from '@/contexts/SidebarContext';
import { cn } from '@/lib/utils';
import { NavBar } from './NavBar';

interface MainLayoutProps {
  children: React.ReactNode;
}

const navigationItems = [
  { name: 'Dashboard', url: '/', icon: Home },
  { name: 'Upload Materials', url: '/upload', icon: Upload },
  { name: 'Assessment', url: '/assessment', icon: ClipboardCheck },
  { name: 'Study Missions', url: '/study-mission', icon: Rocket },
  { name: 'Socratic Tutor', url: '/ai-assistant', icon: MessageSquare },
  { name: 'Peer Hubs', url: '/groups', icon: Users },
];

type AccountLayout = 'inline' | 'compact' | 'dock';

export const MainLayout = ({ children }: MainLayoutProps) => {
  const pathname = usePathname();
  const { loading, user, signOut } = useAuth();
  const { isCollapsed } = useSidebar();
  const isAuthPage = pathname === '/auth/signin';
  const navRef = useRef<HTMLDivElement | null>(null);
  const [accountLayout, setAccountLayout] = useState<AccountLayout>('inline');

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Student';
  const initials = displayName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  useEffect(() => {
    if (isAuthPage) {
      return;
    }

    const updateAccountLayout = () => {
      const viewportWidth = window.innerWidth;
      const navRect = navRef.current?.getBoundingClientRect();

      if (!navRect) {
        setAccountLayout(viewportWidth < 640 ? 'dock' : 'compact');
        return;
      }

      const rightSideSpace = Math.max(0, viewportWidth - navRect.right);

      if (viewportWidth < 640) {
        setAccountLayout('dock');
      } else if (rightSideSpace >= 380) {
        setAccountLayout('inline');
      } else if (rightSideSpace >= 126) {
        setAccountLayout('compact');
      } else {
        setAccountLayout('dock');
      }
    };

    updateAccountLayout();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => updateAccountLayout())
        : null;

    if (navRef.current && resizeObserver) {
      resizeObserver.observe(navRef.current);
    }

    window.addEventListener('resize', updateAccountLayout);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateAccountLayout);
    };
  }, [isAuthPage]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Image
          src="/logo-images/favicon.png"
          alt="Loading"
          width={56}
          height={56}
          className="animate-bounce"
          priority
        />
      </div>
    );
  }

  if (isAuthPage) {
    return <>{children}</>;
  }

  const isInlineAccount = accountLayout === 'inline';
  const isDockedAccount = accountLayout === 'dock';

  return (
    <div
      className="relative flex h-dvh overflow-hidden overscroll-none bg-cover bg-center bg-no-repeat bg-fixed"
      style={{ backgroundImage: "url('/backgrounds/dashboardback2.png')" }}
    >
      <NavBar
        ref={navRef}
        items={navigationItems}
        className={cn(
          'transition-all duration-300',
          isCollapsed && 'pointer-events-none -translate-y-4 opacity-0'
        )}
      />

      <div
        className={cn(
          'fixed z-50 flex items-center rounded-2xl border border-white/10 bg-slate-950/85 text-white shadow-[0_20px_60px_rgba(2,6,23,0.4)] backdrop-blur-xl transition-all duration-300',
          isDockedAccount
            ? 'bottom-4 right-4 gap-1.5 px-1.5 py-1.5 md:bottom-6 md:right-6'
            : 'right-4 top-1 gap-2 px-2 py-1.5 md:right-6 md:top-2',
          !isInlineAccount && !isDockedAccount && 'gap-1.5 px-1.5',
          isCollapsed && 'pointer-events-none translate-y-2 opacity-0'
        )}
      >
        <Link
          href="/profile"
          className={cn(
            'flex items-center rounded-xl transition-colors hover:bg-white/5',
            isInlineAccount ? 'gap-2 px-2 py-1.5' : 'gap-0 px-1.5 py-1.5'
          )}
          aria-label="Open profile"
        >
          {user?.photoURL ? (
            <img
              src={user.photoURL}
              alt=""
              className="h-9 w-9 rounded-full object-cover ring-1 ring-white/20"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-500/20 text-sm font-semibold text-cyan-100 ring-1 ring-white/10">
              {initials}
            </div>
          )}
          <div className={cn('min-w-0', isInlineAccount ? 'hidden md:block' : 'hidden')}>
            <p className="truncate text-sm font-semibold text-white">{displayName}</p>
            <p className="truncate text-xs text-slate-400">{user?.email ?? 'Profile'}</p>
          </div>
          <UserCircle2 className={cn('h-4 w-4 text-slate-400', isInlineAccount ? 'hidden md:block' : 'hidden')} />
        </Link>

        <button
          onClick={signOut}
          className={cn(
            'rounded-xl border border-white/10 bg-white/5 text-slate-300 transition-colors hover:bg-red-500/10 hover:text-red-300',
            isInlineAccount ? 'px-3 py-2' : 'p-2'
          )}
          aria-label="Sign out"
          title="Sign out"
        >
          <span className={cn(isInlineAccount ? 'hidden md:inline' : 'hidden')}>Sign Out</span>
          <LogOut className="h-4 w-4" />
        </button>
      </div>

      <main className="h-full min-w-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </main>
    </div>
  );
};
