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
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto"></div>
        </div>
        
        <h2 className="text-2xl font-bold mb-4">Finding Your Perfect Study Group</h2>
        
        <div className="max-w-md mx-auto space-y-4">
          <p className="text-gray-600">
            Analyzing your responses and matching you with peers who complement your learning style...
          </p>
          
          <div className="flex flex-col gap-2">
            <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg animate-pulse">
              Evaluating comprehension patterns...
            </div>
            <div className="bg-green-50 text-green-700 px-4 py-2 rounded-lg animate-pulse delay-100">
              Identifying implementation strengths...
            </div>
            <div className="bg-purple-50 text-purple-700 px-4 py-2 rounded-lg animate-pulse delay-200">
              Matching integration capabilities...
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 