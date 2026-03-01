// src/app/groups/page.tsx
'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import Link from 'next/link';

export default function GroupsPage() {
  const groups = [
    {
      id: "data-structures",
      name: "Data Structures",
      code: "CS201",
      progress: 75,
    },
    {
      id: "physics-101",
      name: "Physics 101",
      code: "PHY101",
      progress: 82,
    },
    {
      id: "biology-intro",
      name: "Introduction to Biology",
      code: "BIO101",
      progress: 68,
    }
  ];

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">My Study Groups</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {groups.map((group) => (
          <Link key={group.id} href={`/groups/${group.id}`}>
            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <CardTitle>{group.name}</CardTitle>
                <p className="text-sm text-gray-500">{group.code}</p>
              </CardHeader>
              <CardContent>
                <div className="mt-2">
                  <div className="flex justify-between mb-2">
                    <span>Group Progress</span>
                    <span>{group.progress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-purple-600 h-2 rounded-full"
                      style={{ width: `${group.progress}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}