'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search, Users, Brain, PieChart, MessageSquare, BarChart2, Home, User, ClipboardCheck, LineChart } from 'lucide-react';

export const Sidebar = () => {
  const pathname = usePathname();

  const navigationItems = [
    { name: 'Progress', path: '/profile', icon: LineChart },
    { name: 'Groups', path: '/groups', icon: Users },
    { name: 'Assessment', path: '/assessment', icon: ClipboardCheck },
    { name: 'Network Balance', path: '/network-balance', icon: BarChart2 },
    { name: 'AI Assistant', path: '/ai-assistant', icon: MessageSquare },
    { name: 'Hive Intelligence', path: '/hive-intelligence', icon: Brain }
  ];

  return (
    <div className="w-64 h-screen bg-slate-100 p-6 flex flex-col">
      {/* Profile Section */}
      <div className="mb-8">
        <div className="w-16 h-16 bg-purple-600 rounded-full flex items-center justify-center text-white text-xl mb-4">
          JS
        </div>
        <h2 className="text-lg font-semibold">John Smith</h2>
        <p className="text-sm text-gray-600">Computer Science</p>
      </div>

      {/* Navigation */}
      <nav className="space-y-2 flex-1">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`w-full p-3 text-left rounded-lg flex items-center space-x-3 ${
                pathname === item.path ? 'bg-purple-100 text-purple-700' : 'hover:bg-gray-200'
              }`}
            >
              <Icon size={20} />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
};