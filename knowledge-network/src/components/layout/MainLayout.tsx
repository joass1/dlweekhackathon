'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardCheck, Home, LogOut, MessageSquare, Rocket, Upload, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSidebar } from '@/contexts/SidebarContext';
import { motion } from 'framer-motion';
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

export const MainLayout = ({ children }: MainLayoutProps) => {
  const pathname = usePathname();
  const { loading, user, signOut } = useAuth();
  const { isCollapsed } = useSidebar();
  const isAuthPage = pathname === '/auth/signin';
  const navRef = useRef<HTMLDivElement | null>(null);
  const [isDocked, setIsDocked] = useState(false);
  const [isHoverExpanded, setIsHoverExpanded] = useState(false);
  const [isClickLocked, setIsClickLocked] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isExpanded = isHoverExpanded || isClickLocked;

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Student';
  const initials = displayName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setIsHoverExpanded(true);
  };

  const handleMouseLeave = () => {
    if (isClickLocked) return;
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHoverExpanded(false);
    }, 300);
  };

  const handleContainerClick = () => {
    setIsClickLocked((prev) => !prev);
    setIsHoverExpanded(false);
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (isAuthPage) return;

    const updateAccountLayout = () => {
      const viewportWidth = window.innerWidth;
      const navRect = navRef.current?.getBoundingClientRect();
      const rightSideSpace = navRect ? Math.max(0, viewportWidth - navRect.right) : viewportWidth;

      setIsDocked(viewportWidth < 640 || rightSideSpace < 126);
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

      {/* User profile pill */}
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleContainerClick}
        className={cn(
          'fixed z-50 cursor-pointer select-none rounded-2xl border border-white/10 bg-slate-950/85 text-white shadow-[0_20px_60px_rgba(2,6,23,0.4)] backdrop-blur-xl transition-[opacity,transform] duration-300',
          isDocked
            ? 'bottom-4 right-4 md:bottom-6 md:right-6'
            : 'right-4 top-1 md:right-6 md:top-2',
          isCollapsed && 'pointer-events-none translate-y-2 opacity-0'
        )}
      >
        <div className="flex items-center px-1.5 py-1.5">
          {/* Expandable section — slides in to the left of the avatar */}
          <motion.div
            animate={{ width: isExpanded ? 210 : 0, opacity: isExpanded ? 1 : 0 }}
            initial={false}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            style={{ overflow: 'hidden', display: 'flex', alignItems: 'center' }}
          >
            <div className="flex items-center gap-2 pl-2 pr-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  signOut();
                }}
                className="flex-shrink-0 rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 transition-colors hover:bg-red-500/10 hover:text-red-300"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
              <Link
                href="/profile"
                onClick={(e) => e.stopPropagation()}
                className="w-36 min-w-0 hover:opacity-80 transition-opacity"
                aria-label="Go to profile"
              >
                <p className="truncate text-sm font-semibold text-white">{displayName}</p>
                <p className="truncate text-xs text-slate-400">{user?.email ?? ''}</p>
              </Link>
            </div>
          </motion.div>

          {/* Avatar — always visible, click navigates to /profile */}
          <Link
            href="/profile"
            onClick={(e) => e.stopPropagation()}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-cyan-500/20 text-sm font-semibold text-cyan-100 ring-1 ring-white/10 transition-colors hover:bg-cyan-500/30"
            aria-label="Go to profile"
          >
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              initials
            )}
          </Link>
        </div>
      </div>

      <main className="h-full min-w-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </main>
    </div>
  );
};
