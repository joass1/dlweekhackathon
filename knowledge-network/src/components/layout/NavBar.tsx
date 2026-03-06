'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { type LucideIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

interface NavItem {
  name: string;
  url: string;
  icon: LucideIcon;
}

interface NavBarProps {
  items: NavItem[];
  className?: string;
}

export const NavBar = React.forwardRef<HTMLDivElement, NavBarProps>(function NavBar(
  { items, className }: NavBarProps,
  ref
) {
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState(items[0]?.name ?? '');

  useEffect(() => {
    const currentItem = items.find(
      (item) => pathname === item.url || (item.url !== '/' && pathname.startsWith(item.url))
    );
    setActiveTab(currentItem?.name ?? items[0]?.name ?? '');
  }, [items, pathname]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      ref={ref}
      className={cn(
        'pointer-events-none fixed left-1/2 top-1 z-50 -translate-x-1/2 md:top-2',
        className
      )}
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/85 px-1 py-0.5 shadow-[0_24px_70px_rgba(2,6,23,0.45)] backdrop-blur-xl">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.name;

          return (
            <Link
              key={item.name}
              href={item.url}
              onClick={() => setActiveTab(item.name)}
              className={cn(
                'relative flex items-center justify-center rounded-full px-4 py-1.5 text-center text-sm font-semibold transition-colors lg:min-w-[132px] lg:px-6',
                'text-slate-300 hover:text-cyan-300',
                isActive && 'bg-slate-800/90 text-cyan-200'
              )}
              aria-label={item.name}
            >
              <span className="hidden w-full text-center lg:inline">{item.name}</span>
              <span className="lg:hidden">
                <Icon size={18} strokeWidth={2.5} />
              </span>

              {isActive && (
                <motion.div
                  layoutId="lamp"
                  className="absolute inset-0 -z-10 w-full rounded-full bg-cyan-400/10"
                  initial={false}
                  transition={{
                    type: 'spring',
                    stiffness: 300,
                    damping: 30,
                  }}
                >
                  <div className="absolute left-1/2 top-0 h-1.5 w-10 -translate-x-1/2 rounded-b-full bg-cyan-300">
                    <div className="absolute -left-2 -top-2 h-6 w-14 rounded-full bg-cyan-400/25 blur-md" />
                    <div className="absolute left-1 top-0 h-5 w-8 rounded-full bg-sky-300/25 blur-md" />
                    <div className="absolute left-3 top-0 h-4 w-4 rounded-full bg-white/35 blur-sm" />
                  </div>
                </motion.div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
});

NavBar.displayName = 'NavBar';
