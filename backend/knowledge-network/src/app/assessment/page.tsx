'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { Atom, Gauge, Orbit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface Subject {
  id: string;
  title: string;
  description: string;
  totalQuestions: number;
  timeEstimate: string;
  icon: LucideIcon;
}

const subjects: Subject[] = [
  {
    id: 'newtons-laws',
    title: "Newton's Laws of Motion",
    description: 'Test your understanding of the fundamental principles of motion and forces.',
    totalQuestions: 5,
    timeEstimate: '10-15 minutes',
    icon: Atom,
  },
  {
    id: 'energy-work',
    title: 'Energy and Work',
    description: 'Assess your knowledge of energy conservation, work, and power.',
    totalQuestions: 5,
    timeEstimate: '10-15 minutes',
    icon: Gauge,
  },
  {
    id: 'momentum',
    title: 'Momentum and Collisions',
    description: 'Evaluate your grasp of momentum conservation and collision analysis.',
    totalQuestions: 5,
    timeEstimate: '10-15 minutes',
    icon: Orbit,
  },
];

export default function AssessmentSelectionPage() {
  const router = useRouter();

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Knowledge Assessments</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Choose a subject to assess your understanding and get matched with study partners who complement your learning
          style.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {subjects.map((subject) => {
          const Icon = subject.icon;

          return (
            <Card key={subject.id} className="flex h-full flex-col justify-between transition-shadow hover:shadow-lg">
              <CardHeader className="space-y-3">
                <div className="flex items-center justify-between">
                  <CardTitle>{subject.title}</CardTitle>
                  <Icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <CardDescription>{subject.description}</CardDescription>
              </CardHeader>

              <CardContent className="pb-0">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{subject.totalQuestions} questions</span>
                  <span>{subject.timeEstimate}</span>
                </div>
              </CardContent>

              <CardFooter>
                <Button className="w-full" onClick={() => router.push(`/assessment/${subject.id}/intro`)}>
                  Start Assessment
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
