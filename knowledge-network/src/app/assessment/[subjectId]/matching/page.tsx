'use client';

import React, { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

export default function MatchingPage() {
  const router = useRouter();
  const params = useParams();
  const subjectId = params.subjectId;

  useEffect(() => {
    // Simulate matching process
    const timer = setTimeout(() => {
      router.push(`/assessment/${subjectId}/results`);
    }, 3000);

    return () => clearTimeout(timer);
  }, [router, subjectId]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center px-4">
        <div className="mb-8">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-emerald-500 mx-auto"></div>
        </div>

        <h2 className="text-2xl font-bold mb-4">Analyzing Your Knowledge Graph</h2>

        <div className="max-w-md mx-auto space-y-4">
          <p className="text-gray-600">
            Processing your responses and confidence ratings to update your knowledge map...
          </p>

          <div className="flex flex-col gap-2">
            <div className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-lg animate-pulse">
              Mapping concept mastery levels...
            </div>
            <div className="bg-yellow-50 text-yellow-700 px-4 py-2 rounded-lg animate-pulse delay-100">
              Identifying knowledge gaps and unknown unknowns...
            </div>
            <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg animate-pulse delay-200">
              Finding complementary study partners...
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 