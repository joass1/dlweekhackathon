'use client';

import React, { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface Question {
  id: number;
  text: string;
  type: 'comprehension' | 'implementation' | 'integration';
  options: string[];
}

const questionsBySubject: Record<string, Question[]> = {
  'newtons-laws': [
    {
      id: 1,
      text: "How would you explain Newton's First Law to a peer?",
      type: 'comprehension',
      options: [
        'Objects stay still or keep moving unless a force acts on them',
        'Force equals mass times acceleration',
        'Every action has an equal and opposite reaction',
        'Objects always slow down naturally',
      ],
    },
    {
      id: 2,
      text: "When solving a problem involving forces, what's your approach?",
      type: 'implementation',
      options: [
        'Draw a free body diagram and identify all forces',
        'Immediately start plugging numbers into equations',
        'Look for similar solved examples',
        'Ask for help without trying first',
      ],
    },
    {
      id: 3,
      text: "How do you connect Newton's Laws to real-world scenarios?",
      type: 'integration',
      options: [
        'I can identify multiple examples in daily life and explain them',
        'I understand the basics but struggle with applications',
        'I prefer to stick to textbook problems',
        'I find it difficult to see real-world connections',
      ],
    },
    {
      id: 4,
      text: 'What happens to acceleration when force is doubled but mass stays constant?',
      type: 'comprehension',
      options: ['Acceleration doubles', 'Acceleration stays the same', 'Acceleration halves', "Can't determine"],
    },
    {
      id: 5,
      text: "How confident are you in helping others understand Newton's Laws?",
      type: 'integration',
      options: [
        'Very confident and clear when explaining',
        'Somewhat confident with occasional uncertainty',
        'Not very confident and still reviewing',
        'Not confident and need support',
      ],
    },
  ],
  'energy-work': [
    {
      id: 1,
      text: 'What is the relationship between work and energy?',
      type: 'comprehension',
      options: [
        'Work done equals the change in energy',
        'Work and energy are unrelated',
        'Work is always greater than energy',
        'Energy cannot be changed by work',
      ],
    },
    {
      id: 2,
      text: 'How would you solve a problem involving gravitational potential energy?',
      type: 'implementation',
      options: [
        'Identify reference height and apply U = mgh carefully',
        'Use kinetic energy regardless of context',
        'Memorize answers from examples only',
        'Estimate without formulas',
      ],
    },
    {
      id: 3,
      text: 'When can mechanical energy be treated as conserved?',
      type: 'comprehension',
      options: [
        'When only conservative forces act significantly',
        'In every situation',
        'Only when velocity is zero',
        'Only when mass is constant',
      ],
    },
    {
      id: 4,
      text: 'How do you connect power with real-world engineering systems?',
      type: 'integration',
      options: [
        'I relate power output to efficiency and design constraints',
        'I can define power but rarely apply it',
        'I avoid power calculations unless required',
        'I am not sure how power is used in practice',
      ],
    },
    {
      id: 5,
      text: 'If friction is present, what changes in your energy analysis?',
      type: 'implementation',
      options: [
        'Account for non-conservative work and energy loss',
        'Ignore friction for easier math',
        'Switch to momentum only',
        'Assume potential energy increases',
      ],
    },
  ],
  momentum: [
    {
      id: 1,
      text: 'What best describes momentum?',
      type: 'comprehension',
      options: [
        'Product of mass and velocity',
        'Product of force and distance',
        'Rate of change of energy',
        'Product of mass and acceleration',
      ],
    },
    {
      id: 2,
      text: 'How do you set up a collision problem?',
      type: 'implementation',
      options: [
        'Define a system and apply conservation of momentum',
        'Use only kinetic energy equations',
        'Assume all collisions are elastic',
        'Skip vector directions',
      ],
    },
    {
      id: 3,
      text: 'What does impulse represent?',
      type: 'comprehension',
      options: [
        'Change in momentum over a time interval',
        'Change in acceleration over distance',
        'Work done per unit time',
        'Mass multiplied by displacement',
      ],
    },
    {
      id: 4,
      text: 'How do you connect collision types to real systems?',
      type: 'integration',
      options: [
        'I compare idealized models to practical constraints',
        'I only remember definitions',
        'I avoid collision analysis if possible',
        'I cannot distinguish collision types yet',
      ],
    },
    {
      id: 5,
      text: 'In an inelastic collision, which quantity is always conserved?',
      type: 'comprehension',
      options: ['Total momentum', 'Kinetic energy', 'Both momentum and kinetic energy', 'Neither quantity'],
    },
  ],
};

const typeLabel: Record<Question['type'], string> = {
  comprehension: 'Comprehension',
  implementation: 'Implementation',
  integration: 'Integration',
};

function formatSubjectId(subjectId: string): string {
  return subjectId
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function AssessmentTakePage() {
  const router = useRouter();
  const params = useParams<{ subjectId: string }>();
  const subjectId = params.subjectId;
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const questions = useMemo(() => questionsBySubject[subjectId] ?? [], [subjectId]);

  const handleAnswer = (questionId: number, answerIndex: number) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: answerIndex,
    }));
  };

  const handleSubmit = async () => {
    if (questions.length === 0) {
      return;
    }

    if (Object.keys(answers).length < questions.length) {
      window.alert('Please answer all questions before submitting.');
      return;
    }

    setIsSubmitting(true);

    try {
      router.push(`/assessment/${subjectId}/matching`);
    } catch (error) {
      console.error('Error submitting assessment:', error);
      setIsSubmitting(false);
    }
  };

  const answeredCount = Object.keys(answers).length;

  return (
    <div className="p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">{formatSubjectId(subjectId)} Assessment</h1>
            <p className="text-sm text-muted-foreground">
              Progress: {answeredCount}/{questions.length} questions completed
            </p>
          </div>

          <Button variant="outline" onClick={() => router.push(`/assessment/${subjectId}/intro`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </div>

        {questions.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No questions available</CardTitle>
              <CardDescription>This subject does not have a configured question set yet.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => router.push('/assessment')}>Return to Assessment List</Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="space-y-4">
              {questions.map((question, index) => (
                <Card key={question.id}>
                  <CardHeader>
                    <CardTitle className="text-base font-semibold">
                      Question {index + 1}: {question.text}
                    </CardTitle>
                    <CardDescription>{typeLabel[question.type]}</CardDescription>
                  </CardHeader>

                  <CardContent>
                    <fieldset className="space-y-2" aria-label={`Question ${index + 1}`}>
                      {question.options.map((option, optionIndex) => {
                        const inputId = `q${question.id}-${optionIndex}`;
                        const selected = answers[question.id] === optionIndex;

                        return (
                          <label
                            key={inputId}
                            htmlFor={inputId}
                            className={cn(
                              'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors',
                              selected ? 'border-primary bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                            )}
                          >
                            <input
                              id={inputId}
                              type="radio"
                              name={`question-${question.id}`}
                              checked={selected}
                              onChange={() => handleAnswer(question.id, optionIndex)}
                              className="mt-0.5"
                            />
                            <span>{option}</span>
                          </label>
                        );
                      })}
                    </fieldset>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? 'Submitting...' : 'Submit Assessment'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
