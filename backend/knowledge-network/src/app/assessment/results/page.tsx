'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Student {
  id: string;
  student_name: string;
  scores: {
    comprehension: number;
    implementation: number;
    integration: number;
  };
}

interface MatchResult {
  matches: string;
  nodes: Student[];
}

export default function ResultsPage() {
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const response = await fetch('/api/assessment/results');
        if (!response.ok) throw new Error('Failed to fetch results');
        const data = await response.json();
        setMatchResult(data);
      } catch (error) {
        console.error('Error fetching results:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchResults();
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Finding your perfect study group...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold mb-4">🎉 Group Matching Complete!</h1>
          <p className="text-gray-600">
            You've been matched with peers who complement your learning style
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Match Details</h2>
          <div className="prose">
            {matchResult?.matches}
          </div>
        </div>

        <div className="mt-12 text-center">
          <button 
            onClick={() => router.push('/dashboard')}
            className="bg-blue-500 text-white px-8 py-3 rounded-lg hover:bg-blue-600"
          >
            Start Collaborating
          </button>
        </div>
      </div>
    </div>
  );
} 