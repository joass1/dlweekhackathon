// src/components/groups/PeerSessionScheduler.tsx
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Video } from 'lucide-react';

interface Props {
  groupId: string;
}

export function PeerSessionScheduler({ groupId }: Props) {
  // Mock data - replace with real data fetching
  const members = [
    {
      id: "1",
      name: "Alice Chen",
      availability: ["Mon 2-4pm", "Wed 3-5pm"]
    },
    {
      id: "2",
      name: "Bob Smith",
      availability: ["Tue 1-3pm", "Thu 4-6pm"]
    }
  ];

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Video className="w-5 h-5" />
          Upcoming Peer Learning Sessions
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {members.map((member) => (
            <div key={member.id} className="border rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <span className="font-medium">{member.name}</span>
                <span className="text-sm text-gray-500">
                  Available: {member.availability.join(", ")}
                </span>
              </div>
              <button className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors">
                Schedule Session
              </button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}