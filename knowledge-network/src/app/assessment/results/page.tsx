'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
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
      <div className="min-h-full flex items-center justify-center">
        <div className="text-center rounded-xl border border-black/10 bg-white/65 backdrop-blur-sm shadow-lg px-8 py-10 text-slate-900">
          <div className="flex items-center justify-center">
            <Image src="/logo-images/favicon.png" alt="Loading" width={48} height={48} className="animate-bounce" priority />
          </div>
          <p className="mt-4 text-slate-700">Finding your perfect study group...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full py-8">
      <div className="max-w-4xl mx-auto px-4 text-slate-900">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold mb-4">Group Matching Complete!</h1>
          <p className="text-slate-700">You've been matched with peers who complement your learning style</p>
        </div>

        <div className="rounded-xl border border-black/10 bg-white/65 backdrop-blur-sm shadow-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Match Details</h2>
          <div className="prose max-w-none text-slate-800">{matchResult?.matches}</div>
        </div>

        <div className="mt-12 text-center">
          <button onClick={() => router.push('/')} className="bg-[#03b2e6] text-white px-8 py-3 rounded-full hover:bg-[#029ad0]">
            Start Collaborating
          </button>
        </div>
      </div>
    </div>
  );
}



