// src/app/groups/[groupId]/page.tsx
'use client';

import React from 'react';
import GroupDetailView from '@/components/groups/GroupDetailView';
import { use } from 'react';

import { HubMetrics } from '@/components/groups/HubMetrics';

interface PageProps {
  params: Promise<{
    groupId: string;
  }>;
}

export default function GroupDetailPage({ params }: PageProps) {
  const resolvedParams = use(params);

  return (
    <div className="p-6 space-y-6">
      
      

      {/* Hub Metrics */}
      <section className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-2xl font-bold mb-4">Peer Hub Performance</h2>
        <HubMetrics groupId={resolvedParams.groupId} />
      </section>

      {/* Existing Group Detail View */}
      <GroupDetailView groupId={resolvedParams.groupId} />
    </div>
  );
}
