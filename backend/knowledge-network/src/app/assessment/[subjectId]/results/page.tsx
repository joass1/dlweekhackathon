'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface GroupMember {
  id: string;
  name: string;
  strengths: string[];
  availability: string[];
}

const mockGroupMembers: GroupMember[] = [
  {
    id: '1',
    name: 'Alex Chen',
    strengths: ['Strong in comprehension', 'Good at explaining concepts'],
    availability: ['Mon 2-4pm', 'Wed 3-5pm'],
  },
  {
    id: '2',
    name: 'Sarah Johnson',
    strengths: ['Excellent problem-solving', 'Implementation focused'],
    availability: ['Tue 1-3pm', 'Thu 4-6pm'],
  },
  {
    id: '3',
    name: 'Miguel Rodriguez',
    strengths: ['Great at integration', 'Real-world applications'],
    availability: ['Mon 3-5pm', 'Fri 2-4pm'],
  },
  {
    id: '4',
    name: 'Emily Zhang',
    strengths: ['Analytical thinking', 'Mathematical modeling'],
    availability: ['Wed 2-4pm', 'Thu 3-5pm'],
  },
];

function formatSubjectId(subjectId: string): string {
  return subjectId
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function initialsFromName(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export default function AssessmentResultsPage() {
  const router = useRouter();
  const params = useParams<{ subjectId: string }>();
  const subjectId = params.subjectId;

  return (
    <div className="p-6">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Your Study Group is Ready</h1>
          <p className="mt-2 text-muted-foreground">
            Meet your study partners for {formatSubjectId(subjectId)}. You were matched based on complementary strengths.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          {mockGroupMembers.map((member) => (
            <Card key={member.id}>
              <CardHeader>
                <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
                  {initialsFromName(member.name)}
                </div>
                <CardTitle className="text-center text-lg">{member.name}</CardTitle>
                <CardDescription className="text-center">Matched peer</CardDescription>
              </CardHeader>

              <CardContent className="space-y-4 text-sm">
                <div>
                  <p className="mb-2 font-medium">Strengths</p>
                  <div className="space-y-2">
                    {member.strengths.map((strength) => (
                      <div key={strength} className="rounded-md border bg-muted/50 px-3 py-2 text-muted-foreground">
                        {strength}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 font-medium">Availability</p>
                  <div className="space-y-2">
                    {member.availability.map((slot) => (
                      <div key={slot} className="rounded-md border bg-accent px-3 py-2 text-accent-foreground">
                        {slot}
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Button onClick={() => router.push('/')}>Go to Dashboard</Button>
          <Button variant="outline" onClick={() => router.push('/assessment')}>
            Take Another Assessment
          </Button>
        </div>
      </div>
    </div>
  );
}
