'use client';

import React, { useEffect } from 'react';
import Image from 'next/image';
import { useRouter, useParams } from 'next/navigation';

export default function MatchingPage() {
  const router = useRouter();
  const params = useParams();
  const subjectId = params.subjectId;

  useEffect(() => {
    const timer = setTimeout(() => {
      router.push(`/assessment/${subjectId}/results`);
    }, 3000);

    return () => clearTimeout(timer);
  }, [router, subjectId]);

  return (
    <div className="min-h-full nav-safe-top flex items-center justify-center">
      <div className="text-center px-4 rounded-xl border border-black/10 bg-white/65 backdrop-blur-sm shadow-lg py-10 w-full max-w-xl text-slate-900">
        <div className="mb-8">
          <div className="flex items-center justify-center">
            <Image src="/logo-images/favicon.png" alt="Loading" width={56} height={56} className="animate-bounce" priority />
          </div>
        </div>

        <h2 className="text-2xl font-bold mb-4">Analyzing Your Knowledge Graph</h2>

        <div className="max-w-md mx-auto space-y-4">
          <p className="text-slate-700">Processing your responses and confidence ratings to update your knowledge map...</p>

          <div className="flex flex-col gap-2">
            <div className="bg-[#03b2e6]/20 border border-[#03b2e6]/35 text-[#4cc9f0] px-4 py-2 rounded-lg animate-pulse">
              Mapping concept mastery levels...
            </div>
            <div className="bg-amber-100/80 border border-amber-300/60 text-amber-900 px-4 py-2 rounded-lg animate-pulse delay-100">
              Identifying knowledge gaps and unknown unknowns...
            </div>
            <div className="bg-blue-100/80 border border-blue-300/60 text-blue-900 px-4 py-2 rounded-lg animate-pulse delay-200">
              Finding complementary study partners...
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}



