// src/app/network-balance/page.tsx
'use client';

import SubjectHubVisualizer from '@/components/network/SubjectHubVisualizer';

export default function NetworkBalancePage() {
  return (
    <div className="container mx-auto">
      <h1 className="text-2xl font-bold mb-6">Network Balance</h1>
      <SubjectHubVisualizer />
    </div>
  );
}