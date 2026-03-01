// src/app/assessment/page.tsx
'use client';

import React from 'react';
import { useRouter } from 'next/navigation';

interface Subject {
  id: string;
  title: string;
  description: string;
  totalQuestions: number;
  timeEstimate: string;
  icon: string;
}

const subjects: Subject[] = [
  {
    id: 'newtons-laws',
    title: "Newton's Laws of Motion",
    description: "Test your understanding of the fundamental principles of motion and forces.",
    totalQuestions: 5,
    timeEstimate: "10-15 minutes",
    icon: "🎯"
  },
  {
    id: 'energy-work',
    title: "Energy and Work",
    description: "Assess your knowledge of energy conservation, work, and power.",
    totalQuestions: 5,
    timeEstimate: "10-15 minutes",
    icon: "⚡"
  },
  {
    id: 'momentum',
    title: "Momentum and Collisions",
    description: "Evaluate your grasp of momentum conservation and collision analysis.",
    totalQuestions: 5,
    timeEstimate: "10-15 minutes",
    icon: "🎱"
  }
];

export default function AssessmentSelectionPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold mb-4">Knowledge Assessments</h1>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Choose a subject to assess your understanding and get matched with study partners 
            who complement your learning style.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {subjects.map((subject) => (
            <div 
              key={subject.id}
              className="bg-white rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => router.push(`/assessment/${subject.id}/intro`)}
            >
              <div className="p-6">
                <div className="text-4xl mb-4">{subject.icon}</div>
                <h2 className="text-xl font-semibold mb-2">{subject.title}</h2>
                <p className="text-gray-600 mb-4">{subject.description}</p>
                <div className="flex items-center justify-between text-sm text-gray-500">
                  <span>{subject.totalQuestions} questions</span>
                  <span>{subject.timeEstimate}</span>
                </div>
              </div>
              <div className="bg-blue-50 p-4 text-center">
                <span className="text-blue-600 font-medium">Start Assessment →</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}