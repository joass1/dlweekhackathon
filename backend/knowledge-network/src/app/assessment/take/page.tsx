'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function AssessmentTakeRootPage() {
  const router = useRouter();

  return (
    <div className="p-6">
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Select a Subject First</CardTitle>
            <CardDescription>
              Assessment questions are organized by subject. Choose a subject to begin your assessment flow.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push('/assessment')}>Go to Assessment Selection</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
