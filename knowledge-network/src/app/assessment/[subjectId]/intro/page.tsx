'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useParams } from 'next/navigation';
import { useAuthedApi } from '@/hooks/useAuthedApi';
import { useAuth } from '@/contexts/AuthContext';
import { getAssessmentHistory, type AssessmentHistoryRun } from '@/services/assessment';

interface ConceptDetails {
  concept: string;
  title?: string;
  category?: string;
  summary?: string;
  prerequisites?: { id?: string; title?: string }[];
}

const glassCardClass = 'rounded-2xl border border-white/20 bg-slate-900/45 backdrop-blur-xl shadow-[0_24px_60px_-24px_rgba(2,6,23,0.85)]';

export default function AssessmentIntroPage() {
  const router = useRouter();
  const params = useParams();
  const subjectId = params.subjectId as string;
  const { apiFetchWithAuth } = useAuthedApi();
  const { getIdToken } = useAuth();
  const [subject, setSubject] = useState<ConceptDetails | null>(null);
  const [pastRuns, setPastRuns] = useState<AssessmentHistoryRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetchWithAuth<ConceptDetails>(`/api/kg/concepts/${encodeURIComponent(subjectId)}`);
        if (!cancelled) {
          setSubject(data);
        }
      } catch (e) {
        if (!cancelled) {
          setSubject(null);
          setError(e instanceof Error ? e.message : 'Failed to load concept');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [apiFetchWithAuth, subjectId]);

  useEffect(() => {
    let cancelled = false;
    const loadHistory = async () => {
      try {
        const token = await getIdToken();
        const runs = await getAssessmentHistory(token, subjectId, 20);
        if (!cancelled) {
          setPastRuns(runs);
        }
      } catch (err) {
        console.error('Failed to load assessment history:', err);
        if (!cancelled) {
          setPastRuns([]);
        }
      }
    };
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [getIdToken, subjectId]);

  if (loading) {
    return (
      <div className="min-h-full nav-safe-top pb-8">
        <div className="max-w-4xl mx-auto px-4">
          <div className={`${glassCardClass} p-8 text-center text-white/70`}>
            <div className="flex items-center justify-center mb-3">
              <Image src="/logo-images/favicon.png" alt="Loading" width={28} height={28} className="animate-bounce" priority />
            </div>
            Loading concept...
          </div>
        </div>
      </div>
    );
  }

  if (error || !subject) {
    return (
      <div className="min-h-full nav-safe-top pb-8">
        <div className="max-w-4xl mx-auto px-4">
          <div className={`${glassCardClass} p-8 text-center text-white`}>
            <h1 className="text-2xl font-semibold mb-2">Concept unavailable</h1>
            <p className="text-white/70 mb-6">
              This assessment concept is not in your knowledge map. Upload materials first or choose an existing concept.
            </p>
            <div className="flex justify-center gap-3">
              <Link href="/upload" className="px-5 py-2 rounded-full bg-[#03b2e6] text-white hover:bg-[#029ad0]">
                Upload Materials
              </Link>
              <Link href="/assessment" className="px-5 py-2 rounded-full border border-white/20 text-white hover:bg-white/10">
                Back to Assessments
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const prereqs = Array.isArray(subject.prerequisites) ? subject.prerequisites : [];

  return (
    <div className="min-h-full nav-safe-top pb-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className={`${glassCardClass} p-8 text-white`}>
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-3">Mentora: {subject.title || subject.concept}</h1>
            <p className="text-white/70 max-w-2xl mx-auto">
              {subject.summary || `Assess your current mastery for ${subject.title || subject.concept}.`}
            </p>
          </div>

          <div className="bg-white/5 border border-white/15 rounded-xl p-6 mb-8">
            <h2 className="text-xl font-semibold mb-4 text-white">Prerequisites</h2>
            {prereqs.length === 0 ? (
              <p className="text-sm text-white/70">No prerequisites detected for this concept.</p>
            ) : (
              <ul className="space-y-3">
                {prereqs.map((p, index) => (
                  <li key={`${p.id || p.title || 'p'}-${index}`} className="flex items-start text-white/80">
                    <span className="text-[#4cc9f0] mr-2">•</span>
                    {p.title || p.id}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="text-center">
            <button
              onClick={() => router.push(`/assessment/${subjectId}/take`)}
              className="bg-[#03b2e6] text-white px-8 py-3 rounded-full hover:bg-[#029ad0]"
            >
              Start Assessment
            </button>
            <p className="mt-4 text-sm text-white/55">Results will update your knowledge graph and concept mastery.</p>
          </div>
        </div>

        <div className={`${glassCardClass} p-6 mt-6 text-white`}>
          <h2 className="text-xl font-semibold mb-4">Past Assessments</h2>
          {pastRuns.length === 0 ? (
            <p className="text-sm text-white/70">No past assessments for this topic yet.</p>
          ) : (
            <div className="space-y-3">
              {pastRuns.map((run) => (
                <div key={run.run_id} className="rounded-xl border border-white/15 bg-white/5 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">{String(run.concept || '').replace(/-/g, ' ')}</p>
                    <p className="text-sm text-white/60">
                      {new Date(run.submitted_at).toLocaleString()} • {run.correct_count}/{run.total_questions} correct
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-white">{Math.round(Number(run.score || 0))}%</span>
                    <button
                      className="px-4 py-2 rounded-full bg-[#03b2e6] text-white hover:bg-[#029ad0] text-sm"
                      onClick={() => router.push(`/assessment/${subjectId}/results?run_id=${encodeURIComponent(run.run_id)}`)}
                    >
                      View Results
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
