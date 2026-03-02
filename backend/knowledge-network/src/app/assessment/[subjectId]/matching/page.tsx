'use client';

import React, { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const steps = [
  'Evaluating comprehension patterns',
  'Identifying implementation strengths',
  'Matching integration capabilities',
];

function formatSubjectId(subjectId: string): string {
  return subjectId
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function MatchingPage() {
  const router = useRouter();
  const params = useParams<{ subjectId: string }>();
  const subjectId = params.subjectId;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      router.push(`/assessment/${subjectId}/results`);
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [router, subjectId]);

  return (
    <div className="p-6">
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader className="text-center">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
            <CardTitle className="text-2xl">Finding Your Study Group</CardTitle>
            <CardDescription>
              We are matching peers for {formatSubjectId(subjectId)} based on complementary learning strengths.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div className="space-y-3">
              {steps.map((step) => (
                <div key={step} className="rounded-md border bg-muted/40 px-4 py-3 text-sm animate-pulse">
                  {step}...
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
