// src/components/groups/PeerSessionScheduler.tsx
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Video } from 'lucide-react';

interface Props {
  groupId: string;
}

export function PeerSessionScheduler({ groupId }: Props) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Video className="w-5 h-5" />
          Upcoming Peer Learning Sessions
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          No scheduled sessions yet for group <span className="font-medium">{groupId}</span>.
        </p>
      </CardContent>
    </Card>
  );
}
