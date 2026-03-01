'use client';

import React from 'react';
import { useRouter, useParams } from 'next/navigation';

export default function AssessmentIntroPage() {
  const router = useRouter();
  const params = useParams();
  const subjectId = params.subjectId;

  const getSubjectInfo = (id: string) => {
    // This would be replaced with actual data lookup
    return {
      title: "Newton's Laws of Motion",
      description: "Test your understanding of the fundamental principles of motion and forces.",
      topics: [
        "First Law - Inertia",
        "Second Law - Force and Acceleration",
        "Third Law - Action and Reaction"
      ]
    };
  };

  const subject = getSubjectInfo(subjectId as string);

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-white rounded-xl shadow-sm p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-4">{subject.title} Assessment</h1>
            <p className="text-gray-600 max-w-2xl mx-auto">
              {subject.description}
            </p>
          </div>

          <div className="bg-blue-50 rounded-lg p-6 mb-8">
            <h2 className="text-xl font-semibold mb-4">Topics Covered</h2>
            <ul className="space-y-3">
              {subject.topics.map((topic, index) => (
                <li key={index} className="flex items-start">
                  <span className="text-blue-500 mr-2">•</span>
                  {topic}
                </li>
              ))}
            </ul>
          </div>

          <div className="text-center">
            <button
              onClick={() => router.push(`/assessment/${subjectId}/take`)}
              className="bg-blue-500 text-white px-8 py-3 rounded-lg hover:bg-blue-600 transform hover:scale-105 transition-all"
            >
              Start Assessment
            </button>
            <p className="mt-4 text-sm text-gray-500">
              Your results will be used to create optimal study groups
            </p>
          </div>
        </div>
      </div>
    </div>
  );
} 