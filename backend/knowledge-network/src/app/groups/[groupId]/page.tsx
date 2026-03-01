// src/app/groups/[groupId]/page.tsx
'use client';

import React from 'react';
import GroupDetailView from '@/components/groups/GroupDetailView';
import { notFound } from 'next/navigation';
import { use } from 'react';

import { HubMetrics } from '@/components/groups/HubMetrics';

interface PageProps {
  params: Promise<{
    groupId: string;
  }>;
}

export default function GroupDetailPage({ params }: PageProps) {
  const validGroups = ['data-structures', 'physics-101', 'biology-intro'];
  const resolvedParams = use(params);
  
  if (!validGroups.includes(resolvedParams.groupId)) {
    notFound();
  }

  return (
    <div className="p-6 space-y-6">
      
      

      {/* Hub Metrics */}
      <section className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-2xl font-bold mb-4">Hub Performance</h2>
        <HubMetrics groupId={resolvedParams.groupId} />
      </section>

      {/* Existing Group Detail View */}
      <GroupDetailView groupId={resolvedParams.groupId} />
    </div>
  );
}