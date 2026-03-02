'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
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
    return () => { cancelled = true; };
  }, [getIdToken, subjectId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background py-12">
        <div className="max-w-4xl mx-auto px-4">
          <div className="bg-white rounded-xl shadow-sm p-8 text-center text-muted-foreground">Loading concept...</div>
        </div>
      </div>
    );
  }

  if (error || !subject) {
    return (
      <div className="min-h-screen bg-background py-12">
        <div className="max-w-4xl mx-auto px-4">
          <div className="bg-white rounded-xl shadow-sm p-8 text-center">
            <h1 className="text-2xl font-semibold mb-2">Concept unavailable</h1>
            <p className="text-muted-foreground mb-6">
              This assessment concept is not in your knowledge map. Upload materials first or choose an existing concept.
            </p>
            <div className="flex justify-center gap-3">
              <Link href="/upload" className="px-5 py-2 rounded-full bg-[#03b2e6] text-white hover:bg-[#029ad0]">
                Upload Materials
              </Link>
              <Link href="/assessment" className="px-5 py-2 rounded-full border border-gray-300 hover:bg-accent">
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
    <div className="min-h-screen bg-background py-12">
      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-white rounded-xl shadow-sm p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-3">LearnGraph: {subject.title || subject.concept}</h1>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              {subject.summary || `Assess your current mastery for ${subject.title || subject.concept}.`}
            </p>
          </div>

          <div className="bg-[#e0f4fb] rounded-lg p-6 mb-8">
            <h2 className="text-xl font-semibold mb-4">Prerequisites</h2>
            {prereqs.length === 0 ? (
              <p className="text-sm text-foreground">No prerequisites detected for this concept.</p>
            ) : (
              <ul className="space-y-3">
                {prereqs.map((p, index) => (
                  <li key={`${p.id || p.title || 'p'}-${index}`} className="flex items-start">
                    <span className="text-[#03b2e6] mr-2">•</span>
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
            <p className="mt-4 text-sm text-muted-foreground">
              Results will update your knowledge graph and concept mastery.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 mt-6">
          <h2 className="text-xl font-semibold mb-4">Past Assessments</h2>
          {pastRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No past assessments for this topic yet.</p>
          ) : (
            <div className="space-y-3">
              {pastRuns.map((run) => (
                <div key={run.run_id} className="rounded-lg border border-gray-200 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <p className="font-medium">{String(run.concept || '').replace(/-/g, ' ')}</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(run.submitted_at).toLocaleString()} &bull; {run.correct_count}/{run.total_questions} correct
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">{Math.round(Number(run.score || 0))}%</span>
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
