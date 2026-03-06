'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { getSelfAwarenessScore, getAssessmentRun } from '@/services/assessment';
import { useAuth } from '@/contexts/AuthContext';
import { useStudentId } from '@/hooks/useStudentId';

type ReviewItem = {
  question_id: string;
  stem: string;
  selected_answer: string;
  correct_answer: string;
  is_correct: boolean;
  confidence_1_to_5: number;
  mistake_type?: string;
  rationale?: string;
};

export default function AssessmentResultsPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const subjectId = params.subjectId as string;
  const runId = searchParams.get('run_id');
  const { getIdToken } = useAuth();
  const studentId = useStudentId();

  const [summary, setSummary] = useState<{
    score: number;
    blind_spot_found_count: number;
    blind_spot_resolved_count: number;
    review: ReviewItem[];
  } | null>(null);
  const [selfAwareness, setSelfAwareness] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setLoading(true);
    const loadRun = async () => {
      try {
        const token = await getIdToken();
        const run = await getAssessmentRun(runId, token);
        if (cancelled) return;
        const review: ReviewItem[] = (run.questions || []).map((q) => ({
          question_id: q.question_id,
          stem: q.stem || '',
          selected_answer: q.selected_answer || '-',
          correct_answer: q.correct_answer || '-',
          is_correct: !!q.is_correct,
          confidence_1_to_5: q.confidence_1_to_5 || 3,
          mistake_type: q.mistake_type,
          rationale: q.rationale,
        }));
        setSummary({
          score: run.score || 0,
          blind_spot_found_count: run.blind_spot_found_count || 0,
          blind_spot_resolved_count: run.blind_spot_resolved_count || 0,
          review,
        });
        getSelfAwarenessScore(studentId, token)
          .then((s) => setSelfAwareness(s.score))
          .catch(() => setSelfAwareness(null));
      } catch (err) {
        console.error('Failed to load assessment run:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadRun();
    return () => {
      cancelled = true;
    };
  }, [runId, getIdToken, studentId]);

  useEffect(() => {
    if (runId) return;
    const storageKey = `assessment_result_${subjectId}`;
    const raw = typeof window !== 'undefined' ? window.sessionStorage.getItem(storageKey) : null;
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
      const answerMap = parsed?.answers || {};
      const confidenceMap = parsed?.confidenceRatings || {};
      const evaluationById = new Map<string, any>((parsed?.evaluation?.per_question || []).map((p: any) => [String(p.question_id), p]));
      const classificationById = new Map<string, any>((parsed?.classification?.classifications || []).map((c: any) => [String(c.question_id), c]));

      const review: ReviewItem[] = questions.map((q: any) => {
        const selectedIndex = answerMap?.[q.question_id];
        const selected_answer = typeof selectedIndex === 'number' && Array.isArray(q.options) ? q.options[selectedIndex] : '-';
        const evalResult = evaluationById.get(q.question_id);
        const cls = classificationById.get(q.question_id);
        return {
          question_id: q.question_id,
          stem: q.stem || '',
          selected_answer,
          correct_answer: evalResult?.correct_answer || '-',
          is_correct: !!evalResult?.is_correct,
          confidence_1_to_5: Number(confidenceMap?.[q.question_id] || 3),
          mistake_type: cls?.mistake_type,
          rationale: cls?.rationale,
        };
      });

      setSummary({
        score: Number(parsed?.evaluation?.score || 0),
        blind_spot_found_count: Number(parsed?.classification?.blind_spot_found_count || 0),
        blind_spot_resolved_count: Number(parsed?.classification?.blind_spot_resolved_count || 0),
        review,
      });

      if (parsed?.studentId) {
        getIdToken()
          .then((token) => getSelfAwarenessScore(parsed.studentId, token))
          .then((s) => setSelfAwareness(s.score))
          .catch(() => setSelfAwareness(null));
      }
    } catch {
      setSummary(null);
    }
  }, [subjectId, getIdToken, runId]);

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="text-center rounded-xl border border-black/10 bg-white/65 backdrop-blur-sm shadow-lg px-8 py-10 text-slate-900">
          <div className="flex items-center justify-center">
            <Image src="/logo-images/favicon.png" alt="Loading" width={48} height={48} className="animate-bounce" priority />
          </div>
          <p className="mt-4 text-slate-700">Loading results...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full nav-safe-top pb-8">
      <div className="max-w-5xl mx-auto px-4 text-slate-900">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold mb-3">Quiz Summary</h1>
          <p className="text-slate-700">{(subjectId || '').replace(/-/g, ' ')}</p>
        </div>

        <div className="grid md:grid-cols-4 gap-4 mb-8">
          <div className="rounded-lg p-4 shadow-lg border border-black/10 bg-white/65 backdrop-blur-sm">
            <p className="text-xs text-slate-600">Score</p>
            <p className="text-2xl font-semibold">{Math.round(summary?.score ?? 0)}%</p>
          </div>
          <div className="rounded-lg p-4 shadow-lg border border-black/10 bg-white/65 backdrop-blur-sm">
            <p className="text-xs text-slate-600">Blind Spots Found</p>
            <p className="text-2xl font-semibold">{summary?.blind_spot_found_count ?? 0}</p>
          </div>
          <div className="rounded-lg p-4 shadow-lg border border-black/10 bg-white/65 backdrop-blur-sm">
            <p className="text-xs text-slate-600">Blind Spots Resolved</p>
            <p className="text-2xl font-semibold">{summary?.blind_spot_resolved_count ?? 0}</p>
          </div>
          <div className="rounded-lg p-4 shadow-lg border border-black/10 bg-white/65 backdrop-blur-sm">
            <p className="text-xs text-slate-600">Self-Awareness</p>
            <p className="text-2xl font-semibold">{selfAwareness !== null ? `${Math.round(selfAwareness * 100)}%` : '-'}</p>
          </div>
        </div>

        {!summary?.review?.length && !loading ? (
          <div className="rounded-xl border border-black/10 bg-white/65 backdrop-blur-sm shadow-lg p-6 mb-8 text-center text-slate-700">
            No detailed results available for this assessment.
          </div>
        ) : null}

        {!!summary?.review?.length && (
          <div className="rounded-xl border border-black/10 bg-white/65 backdrop-blur-sm shadow-lg p-6 mb-8">
            <h2 className="text-lg font-semibold mb-3">Question Review</h2>
            <div className="space-y-4">
              {summary.review.map((item, idx) => (
                <div
                  key={item.question_id}
                  className={`rounded border p-4 ${
                    item.is_correct
                      ? 'border-emerald-300/40 bg-emerald-100/70'
                      : 'border-red-300/40 bg-red-100/70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">Q{idx + 1}. {item.stem}</p>
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        item.is_correct ? 'bg-emerald-200/80 text-emerald-900' : 'bg-red-200/80 text-red-900'
                      }`}
                    >
                      {item.is_correct ? 'Correct' : 'Incorrect'}
                    </span>
                  </div>
                  <div className="mt-3 grid md:grid-cols-2 gap-3 text-sm text-slate-800">
                    <p><span className="font-medium">Your answer:</span> {item.selected_answer}</p>
                    <p><span className="font-medium">Correct answer:</span> {item.correct_answer}</p>
                    <p><span className="font-medium">Confidence:</span> {item.confidence_1_to_5}/5</p>
                    <p><span className="font-medium">Classification:</span> {item.mistake_type || 'none'}</p>
                  </div>
                  {!item.is_correct && item.rationale ? <p className="mt-2 text-sm text-slate-600">{item.rationale}</p> : null}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-center space-x-4">
          <button
            onClick={() => router.push(`/assessment/${subjectId}/take?retry=${Date.now()}`)}
            className="bg-[#03b2e6] text-white px-8 py-3 rounded-full hover:bg-[#029ad0]"
          >
            Retry This Topic
          </button>
          <button
            onClick={() => router.push('/assessment')}
            className="border border-black/20 text-slate-900 px-8 py-3 rounded-full hover:bg-white/400"
          >
            Back to Assessments
          </button>
        </div>
      </div>
    </div>
  );
}



