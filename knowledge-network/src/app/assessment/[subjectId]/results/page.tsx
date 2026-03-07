'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { getSelfAwarenessScore, getAssessmentRun } from '@/services/assessment';
import { useAuth } from '@/contexts/AuthContext';
import { useStudentId } from '@/hooks/useStudentId';

type ReviewItem = {
  question_id: string;
  concept?: string | null;
  stem: string;
  selected_answer: string;
  correct_answer: string;
  is_correct: boolean;
  confidence_1_to_5: number;
  mistake_type?: string;
  rationale?: string;
  mastery_delta?: number | null;
  updated_mastery?: number | null;
  mastery_status?: string | null;
  updated_node_label?: string | null;
};

const glassCardClass = 'rounded-2xl border border-white/20 bg-slate-900/45 backdrop-blur-xl shadow-[0_24px_60px_-24px_rgba(2,6,23,0.85)]';

function humanizeMasteryStatus(status?: string | null): string | null {
  if (status === 'mastered') return 'Mastered';
  if (status === 'learning') return 'In progress';
  if (status === 'weak') return 'Needs work';
  if (status === 'not_started') return 'Not started';
  return null;
}

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
    net_mastery_delta: number;
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
          concept: q.concept || null,
          stem: q.stem || '',
          selected_answer: q.selected_answer || '-',
          correct_answer: q.correct_answer || '-',
          is_correct: !!q.is_correct,
          confidence_1_to_5: q.confidence_1_to_5 || 3,
          mistake_type: q.mistake_type,
          rationale: q.rationale,
          mastery_delta: typeof q.mastery_delta === 'number' ? q.mastery_delta : null,
          updated_mastery: typeof q.updated_mastery === 'number' ? q.updated_mastery : null,
          mastery_status: typeof q.mastery_status === 'string' ? q.mastery_status : null,
          updated_node_label: typeof q.updated_node_label === 'string'
            ? q.updated_node_label
            : typeof q.concept === 'string'
              ? q.concept
              : null,
        }));
        setSummary({
          score: run.score || 0,
          blind_spot_found_count: run.blind_spot_found_count || 0,
          blind_spot_resolved_count: run.blind_spot_resolved_count || 0,
          net_mastery_delta: review.reduce((sum, item) => sum + (typeof item.mastery_delta === 'number' ? item.mastery_delta : 0), 0),
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
      const actionById = new Map<string, any>((parsed?.classification?.integration_actions || []).map((a: any) => [String(a.question_id), a]));

      const review: ReviewItem[] = questions.map((q: any) => {
        const selectedIndex = answerMap?.[q.question_id];
        const selected_answer = typeof selectedIndex === 'number' && Array.isArray(q.options) ? q.options[selectedIndex] : '-';
        const evalResult = evaluationById.get(q.question_id);
        const cls = classificationById.get(q.question_id);
        const action = actionById.get(q.question_id);
        const kgUpdate = action?.kg_update;
        return {
          question_id: q.question_id,
          concept: q.concept || action?.concept || kgUpdate?.concept_id || null,
          stem: q.stem || '',
          selected_answer,
          correct_answer: evalResult?.correct_answer || '-',
          is_correct: !!evalResult?.is_correct,
          confidence_1_to_5: Number(confidenceMap?.[q.question_id] || 3),
          mistake_type: cls?.mistake_type,
          rationale: cls?.rationale,
          mastery_delta: typeof kgUpdate?.delta_mastery === 'number' ? kgUpdate.delta_mastery : null,
          updated_mastery: typeof kgUpdate?.updated_mastery === 'number' ? kgUpdate.updated_mastery : null,
          mastery_status: typeof kgUpdate?.node?.status === 'string' ? kgUpdate.node.status : null,
          updated_node_label: typeof kgUpdate?.node?.title === 'string'
            ? kgUpdate.node.title
            : typeof kgUpdate?.concept_id === 'string'
              ? kgUpdate.concept_id
              : typeof q.concept === 'string'
                ? q.concept
                : typeof action?.concept === 'string'
                  ? action.concept
                  : null,
        };
      });

      setSummary({
        score: Number(parsed?.evaluation?.score || 0),
        blind_spot_found_count: Number(parsed?.classification?.blind_spot_found_count || 0),
        blind_spot_resolved_count: Number(parsed?.classification?.blind_spot_resolved_count || 0),
        net_mastery_delta: review.reduce((sum, item) => sum + (typeof item.mastery_delta === 'number' ? item.mastery_delta : 0), 0),
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
        <div className={`text-center ${glassCardClass} px-8 py-10 text-white`}>
          <div className="flex items-center justify-center">
            <Image src="/logo-images/favicon.png" alt="Loading" width={48} height={48} className="animate-bounce" priority />
          </div>
          <p className="mt-4 text-white/70">Loading results...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full nav-safe-top pb-8">
      <div className="max-w-5xl mx-auto px-4 text-white">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold mb-3">Quiz Summary</h1>
          <p className="text-white/70">{(subjectId || '').replace(/-/g, ' ')}</p>
        </div>

        <div className="grid md:grid-cols-5 gap-4 mb-8">
          <div className={`${glassCardClass} p-4`}>
            <p className="text-xs text-white/60">Score</p>
            <p className="text-2xl font-semibold text-white">{Math.round(summary?.score ?? 0)}%</p>
          </div>
          <div className={`${glassCardClass} p-4`}>
            <p className="text-xs text-white/60">Blind Spots Found</p>
            <p className="text-2xl font-semibold text-white">{summary?.blind_spot_found_count ?? 0}</p>
          </div>
          <div className={`${glassCardClass} p-4`}>
            <p className="text-xs text-white/60">Blind Spots Resolved</p>
            <p className="text-2xl font-semibold text-white">{summary?.blind_spot_resolved_count ?? 0}</p>
          </div>
          <div className={`${glassCardClass} p-4`}>
            <p className="text-xs text-white/60">Self-Awareness</p>
            <p className="text-2xl font-semibold text-white">{selfAwareness !== null ? `${Math.round(selfAwareness * 100)}%` : '-'}</p>
          </div>
          <div className={`${glassCardClass} p-4`}>
            <p className="text-xs text-white/60">Net Mastery Shift</p>
            <p className={`text-2xl font-semibold ${(summary?.net_mastery_delta ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
              {(summary?.net_mastery_delta ?? 0) >= 0 ? '+' : ''}
              {((summary?.net_mastery_delta ?? 0) * 100).toFixed(1)} pts
            </p>
          </div>
        </div>

        {!summary?.review?.length && !loading ? (
          <div className={`${glassCardClass} p-6 mb-8 text-center text-white/70`}>
            No detailed results available for this assessment.
          </div>
        ) : null}

        {!!summary?.review?.length && (
          <div className={`${glassCardClass} p-6 mb-8`}>
            <h2 className="text-lg font-semibold mb-3 text-white">Question Review</h2>
            <div className="space-y-4">
              {summary.review.map((item, idx) => (
                <div
                  key={item.question_id}
                  className={`rounded-xl border p-4 ${
                    item.is_correct
                      ? 'border-emerald-400/30 bg-emerald-500/15'
                      : 'border-red-400/30 bg-red-500/15'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-white">Q{idx + 1}. {item.stem}</p>
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        item.is_correct ? 'bg-emerald-500/25 text-emerald-200' : 'bg-red-500/25 text-red-200'
                      }`}
                    >
                      {item.is_correct ? 'Correct' : 'Incorrect'}
                    </span>
                  </div>
                  <div className="mt-3 grid md:grid-cols-2 gap-3 text-sm text-white/80">
                    <p><span className="font-medium text-white">Your answer:</span> {item.selected_answer}</p>
                    <p><span className="font-medium text-white">Correct answer:</span> {item.correct_answer}</p>
                    <p><span className="font-medium text-white">Confidence:</span> {item.confidence_1_to_5}/5</p>
                    <p><span className="font-medium text-white">Classification:</span>{' '}
                      <span className={item.mistake_type === 'careless' ? 'text-amber-300' : item.mistake_type === 'conceptual' ? 'text-red-300' : 'text-emerald-300'}>
                        {item.mistake_type || 'correct'}
                      </span>
                    </p>
                  </div>
                  {typeof item.mastery_delta === 'number' && typeof item.updated_mastery === 'number' ? (
                    <div
                      className={`mt-3 rounded-xl border px-3 py-2 text-sm ${
                        item.mastery_delta >= 0
                          ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
                          : 'border-rose-400/30 bg-rose-500/10 text-rose-100'
                      }`}
                    >
                      <p className="font-medium">
                        Mastery {item.mastery_delta >= 0 ? '+' : ''}{(item.mastery_delta * 100).toFixed(1)} pts
                      </p>
                      <p className="mt-1 text-xs text-white/75">
                        Current mastery: {(item.updated_mastery * 100).toFixed(1)}%
                        {humanizeMasteryStatus(item.mastery_status) ? ` (${humanizeMasteryStatus(item.mastery_status)})` : ''}
                      </p>
                      {item.updated_node_label ? (
                        <p className="mt-1 text-xs text-white/75">
                          Updated node: {item.updated_node_label}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {!item.is_correct && item.rationale ? <p className="mt-2 text-sm text-white/60">{item.rationale}</p> : null}
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
            className="border border-white/20 text-white px-8 py-3 rounded-full hover:bg-white/10"
          >
            Back to Assessments
          </button>
        </div>
      </div>
    </div>
  );
}
