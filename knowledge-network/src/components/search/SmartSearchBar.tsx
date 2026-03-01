'use client';

import React from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface SmartSearchBarProps {
  placeholder: string;
  filters: string[];
}

export function SmartSearchBar({ placeholder, filters }: SmartSearchBarProps) {
  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
        <Input
          placeholder={placeholder}
          className="pl-10 h-12"
        />
      </div>
      <div className="flex gap-2">
        {filters.map((filter) => (
          <button
            key={filter}
            className="px-3 py-1 text-sm bg-purple-50 text-purple-700 rounded-full hover:bg-purple-100"
          >
            {filter}
          </button>
        ))}
      </div>
    </div>
  );
} 