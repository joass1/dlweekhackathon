'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type SubjectInfo = {
  title: string;
  description: string;
  topics: string[];
  estimatedTime: string;
};

const SUBJECTS: Record<string, SubjectInfo> = {
  'newtons-laws': {
    title: "Newton's Laws of Motion",
    description: 'Test your understanding of the fundamental principles of motion and forces.',
    topics: ['First Law - Inertia', 'Second Law - Force and Acceleration', 'Third Law - Action and Reaction'],
    estimatedTime: '10-15 minutes',
  },
  'energy-work': {
    title: 'Energy and Work',
    description: 'Assess your knowledge of energy conservation, work, and power.',
    topics: ['Work-Energy Theorem', 'Kinetic and Potential Energy', 'Power and Efficiency'],
    estimatedTime: '10-15 minutes',
  },
  momentum: {
    title: 'Momentum and Collisions',
    description: 'Evaluate your grasp of momentum conservation and collision analysis.',
    topics: ['Linear Momentum', 'Impulse and Change in Momentum', 'Elastic vs Inelastic Collisions'],
    estimatedTime: '10-15 minutes',
  },
};

function formatSubjectId(subjectId: string): string {
  return subjectId
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function AssessmentIntroPage() {
  const router = useRouter();
  const params = useParams<{ subjectId: string }>();
  const subjectId = params.subjectId;

  const subject = SUBJECTS[subjectId] ?? {
    title: formatSubjectId(subjectId),
    description: 'Review key concepts and complete this assessment to personalize your study matching results.',
    topics: ['Concept understanding', 'Applied reasoning', 'Integration with related ideas'],
    estimatedTime: '10-15 minutes',
  };

  return (
    <div className="p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <Button variant="outline" onClick={() => router.push('/assessment')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Assessments
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{subject.title} Assessment</CardTitle>
            <CardDescription>{subject.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-sm text-muted-foreground">Estimated time</p>
              <p className="text-sm font-medium">{subject.estimatedTime}</p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold">Topics Covered</h2>
              <ul className="space-y-2">
                {subject.topics.map((topic) => (
                  <li key={topic} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{topic}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">Your results will be used to build optimal study groups.</p>
              <Button onClick={() => router.push(`/assessment/${subjectId}/take`)}>Start Assessment</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
