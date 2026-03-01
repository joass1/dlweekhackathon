'use client';

import React from 'react';
import { TrendingUp, Users } from 'lucide-react';

export function TrendingClusters() {
  const clusters = [
    {
      id: 1,
      topic: "Advanced Data Structures",
      participants: 45,
      growth: "+28%",
      tags: ["algorithms", "optimization"]
    },
    {
      id: 2,
      topic: "Machine Learning Fundamentals",
      participants: 32,
      growth: "+15%",
      tags: ["AI", "mathematics"]
    }
  ];

  return (
    <div className="space-y-4">
      {clusters.map((cluster) => (
        <div key={cluster.id} className="p-4 border rounded-lg">
          <div className="flex justify-between items-start mb-2">
            <h3 className="font-medium">{cluster.topic}</h3>
            <span className="text-green-600 text-sm flex items-center">
              <TrendingUp className="w-4 h-4 mr-1" />
              {cluster.growth}
            </span>
          </div>
          <div className="flex items-center text-sm text-gray-600 mb-2">
            <Users className="w-4 h-4 mr-1" />
            {cluster.participants} active learners
          </div>
          <div className="flex gap-2">
            {cluster.tags.map((tag) => (
              <span key={tag} className="px-2 py-1 bg-gray-100 rounded-full text-xs">
                {tag}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
} 