import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Brain } from 'lucide-react';

interface Props {
  groupId: string;
}

export function ConceptualGapAnalysis({ groupId }: Props) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5" />
          Conceptual Gaps Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          No conceptual-gap analysis available yet for group <span className="font-medium">{groupId}</span>.
        </p>
      </CardContent>
    </Card>
  );
}
