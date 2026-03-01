'use client';

import React from 'react';
import { Lightbulb, ArrowRight } from 'lucide-react';

export function AIInsightsPanel() {
  const insights = [
    {
      id: 1,
      type: "pattern",
      content: "Students who start with data structures show 40% better performance in algorithms",
      action: "Consider restructuring learning path"
    },
    {
      id: 2,
      type: "suggestion",
      content: "High correlation between peer sessions and concept mastery",
      action: "Promote more peer learning sessions"
    }
  ];

  return (
    <div className="space-y-4">
      {insights.map((insight) => (
        <div key={insight.id} className="p-4 border rounded-lg bg-purple-50">
          <div className="flex items-start gap-3">
            <Lightbulb className="w-5 h-5 text-purple-600 mt-1" />
            <div className="flex-1">
              <p className="text-gray-800 mb-2">{insight.content}</p>
              <div className="flex items-center text-purple-600 text-sm">
                <ArrowRight className="w-4 h-4 mr-1" />
                {insight.action}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
} 