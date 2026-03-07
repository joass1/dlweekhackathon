'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Users, MessageSquare, ClipboardCheck, Rocket, Home, LogOut, PanelLeftClose } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSidebar } from '@/contexts/SidebarContext';

export const Sidebar = () => {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const { toggle } = useSidebar();

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Student';
  const initials = displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const navigationItems = [
    { name: 'Dashboard', path: '/', icon: Home },
    { name: 'Assessment', path: '/assessment', icon: ClipboardCheck },
    { name: 'Study Missions', path: '/study-mission', icon: Rocket },
    { name: 'Socratic Tutor', path: '/ai-assistant', icon: MessageSquare },
    { name: 'Peer Hubs', path: '/groups', icon: Users },
  ];

  return (
    <div className="w-64 h-full bg-slate-900/70 backdrop-blur-md border-r border-white/10 p-5 flex flex-col overflow-y-auto overscroll-contain">
      {/* Brand */}
      <div className="mb-6">
        <div className="mb-4 flex items-start justify-between">
          <Image
            src="/logo-images/logo_dark_mode.png"
            alt="Mentora"
            width={280}
            height={88}
            className="h-14 w-auto"
            priority
          />
          <button
            onClick={toggle}
            className="mt-1 flex-shrink-0 p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        {/* User profile */}
        <div className="flex items-center gap-3 mt-2 p-3 rounded-xl bg-white/5 border border-white/10">
          {user?.photoURL ? (
            <img
              src={user.photoURL}
              alt=""
              className="w-10 h-10 rounded-full object-cover ring-2 ring-white/20"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-10 h-10 bg-[#03b2e6] rounded-full flex items-center justify-center text-white text-sm font-semibold ring-2 ring-white/20">
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{displayName}</p>
            <p className="text-xs text-white/40 truncate">{user?.email}</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="space-y-1 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30 mb-2 px-3">Navigation</p>
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path));
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`w-full px-3 py-2.5 text-left rounded-xl flex items-center gap-3 text-sm transition-colors ${
                isActive
                  ? 'bg-[#03b2e6]/20 text-[#4cc9f0] font-medium border border-[#03b2e6]/30'
                  : 'text-white/70 hover:bg-white/8 hover:text-white'
              }`}
            >
              <Icon size={18} className={isActive ? 'text-[#4cc9f0]' : 'text-white/50'} />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Sign out */}
      <div className="pt-4 border-t border-white/10">
        <button
          onClick={signOut}
          className="w-full px-3 py-2.5 text-left rounded-xl flex items-center gap-3 text-sm text-red-400/80 hover:bg-red-500/10 hover:text-red-400 transition-colors"
        >
          <LogOut size={18} />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
};
