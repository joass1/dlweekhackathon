import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Brain, BookOpen } from 'lucide-react';

interface Props {
  groupId: string;
}

export function ConceptualGapAnalysis({ groupId }: Props) {
  // Mock data - replace with real data fetching
  const conceptGaps = [
    {
      concept: "Binary Tree Balancing",
      confidenceScore: 65,
      recommendedResources: ["Video: AVL Trees", "Practice: Tree Rotations"],
      priority: "high"
    },
    {
      concept: "Red-Black Tree Properties",
      confidenceScore: 72,
      recommendedResources: ["Interactive Demo", "Quiz Set"],
      priority: "medium"
    }
  ];

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5" />
          Conceptual Gaps Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {conceptGaps.map((gap, idx) => (
            <div key={idx} className="border rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <span className="font-medium">{gap.concept}</span>
                <span className={`px-2 py-1 rounded text-sm ${
                  gap.priority === 'high' ? 'bg-red-100 text-red-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>
                  {gap.priority} priority
                </span>
              </div>
              <div className="mb-4">
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-gray-600">Confidence Score: {gap.confidenceScore}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-purple-600 h-2 rounded-full"
                    style={{ width: `${gap.confidenceScore}%` }}
                  />
                </div>
              </div>
              <div className="space-y-2">
                {gap.recommendedResources.map((resource, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-blue-600">
                    <BookOpen className="w-4 h-4" />
                    <a href="#" className="hover:underline">{resource}</a>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}