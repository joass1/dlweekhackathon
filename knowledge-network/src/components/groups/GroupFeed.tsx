import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { format } from 'date-fns';

interface Props {
  groupId: string;
}

export function GroupFeed({ groupId }: Props) {
  // Mock data - replace with real data fetching
  const feedItems = [
    {
      id: "1",
      userName: "Alice Chen",
      content: "Completed practice set on AVL Trees - Score: 85%",
      timestamp: new Date("2025-02-15"),
      initial: "A"
    },
    {
      id: "2",
      userName: "Bob Smith",
      content: "Scheduled peer learning session with Alice - Topic: Graph Algorithms",
      timestamp: new Date("2025-02-15"),
      initial: "B"
    }
  ];

  return (
    <div className="space-y-4">
      {feedItems.map((item) => (
        <Card key={item.id}>
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                {item.initial}
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-start">
                  <span className="font-medium">{item.userName}</span>
                  <span className="text-sm text-gray-500">
                    {format(item.timestamp, 'dd/MM/yyyy')}
                  </span>
                </div>
                <p className="mt-1 text-gray-600">{item.content}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
