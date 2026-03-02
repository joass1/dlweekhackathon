import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

interface Props {
  groupId: string;
}

export function GroupFeed({ groupId }: Props) {
  return (
    <Card>
      <CardContent className="pt-6 text-sm text-muted-foreground">
        No feed activity yet for group <span className="font-medium">{groupId}</span>.
      </CardContent>
    </Card>
  );
}
