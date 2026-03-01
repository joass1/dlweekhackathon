// src/components/groups/HubMetrics.tsx
'use client';

import React from 'react';

interface HubMetricsProps {
  groupId: string;
}

interface MetricCardProps {
  title: string;
  value: string;
  change: string;
  description: string;
}

export function HubMetrics({ groupId }: HubMetricsProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <MetricCard 
        title="Knowledge Balance"
        value="78%"
        change="+12%"
        description="Hub's overall learning distribution"
      />
      <MetricCard 
        title="Transfer Rate"
        value="85%"
        change="+8%"
        description="Effectiveness of peer learning"
      />
      <MetricCard 
        title="Collective Growth"
        value="92%"
        change="+15%"
        description="Group's overall improvement"
      />
    </div>
  );
}

function MetricCard({ title, value, change, description }: MetricCardProps) {
  const isPositive = change.startsWith('+');
  
  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <h3 className="text-sm text-gray-600">{title}</h3>
      <div className="flex items-end space-x-2 mt-2">
        <span className="text-2xl font-bold">{value}</span>
        <span className={`text-sm ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
          {change}
        </span>
      </div>
      <p className="text-xs text-gray-500 mt-2">{description}</p>
    </div>
  );
}