'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Users, MessageSquare, ClipboardCheck, LineChart, Upload, Map, Rocket, Home, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export const Sidebar = () => {
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Student';
  const initials = displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const navigationItems = [
    { name: 'Dashboard', path: '/', icon: Home },
    { name: 'Knowledge Map', path: '/knowledge-map', icon: Map },
    { name: 'Upload Materials', path: '/upload', icon: Upload },
    { name: 'Assessment', path: '/assessment', icon: ClipboardCheck },
    { name: 'Study Missions', path: '/study-mission', icon: Rocket },
    { name: 'Socratic Tutor', path: '/ai-assistant', icon: MessageSquare },
    { name: 'Peer Hubs', path: '/groups', icon: Users },
    { name: 'Progress', path: '/profile', icon: LineChart },
  ];

  return (
    <div className="w-64 h-screen bg-slate-100 p-6 flex flex-col">
      {/* Brand */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-10 h-10 bg-emerald-600 rounded-lg flex items-center justify-center">
            <Map className="w-6 h-6 text-white" />
          </div>
          <span className="text-lg font-bold text-emerald-700">LearnGraph AI</span>
        </div>
        {user?.photoURL ? (
          <img
            src={user.photoURL}
            alt=""
            className="w-12 h-12 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-12 h-12 bg-emerald-600 rounded-full flex items-center justify-center text-white text-lg">
            {initials}
          </div>
        )}
        <h2 className="text-base font-semibold mt-2">{displayName}</h2>
        <p className="text-sm text-gray-600 truncate">{user?.email}</p>
      </div>

      {/* Navigation */}
      <nav className="space-y-2 flex-1">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path));
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`w-full p-3 text-left rounded-lg flex items-center space-x-3 ${
                isActive ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-200'
              }`}
            >
              <Icon size={20} />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Sign out */}
      <button
        onClick={signOut}
        className="mt-2 p-3 text-left rounded-lg flex items-center space-x-3 hover:bg-red-50 text-red-600 transition-colors"
      >
        <LogOut size={20} />
        <span>Sign Out</span>
      </button>
    </div>
  );
};
