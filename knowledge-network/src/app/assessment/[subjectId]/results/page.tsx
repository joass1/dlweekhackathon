'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getSelfAwarenessScore } from '@/services/assessment';
import { useAuth } from '@/contexts/AuthContext';

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
  const subjectId = params.subjectId as string;
  const { getIdToken } = useAuth();

  const [summary, setSummary] = useState<{
    score: number;
    blind_spot_found_count: number;
    blind_spot_resolved_count: number;
    review: ReviewItem[];
  } | null>(null);
  const [selfAwareness, setSelfAwareness] = useState<number | null>(null);

  useEffect(() => {
    const storageKey = `assessment_result_${subjectId}`;
    const raw = typeof window !== 'undefined' ? window.sessionStorage.getItem(storageKey) : null;
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
      const answerMap = parsed?.answers || {};
      const confidenceMap = parsed?.confidenceRatings || {};
      const evaluationById = new Map<string, any>(
        (parsed?.evaluation?.per_question || []).map((p: any) => [String(p.question_id), p])
      );
      const classificationById = new Map<string, any>(
        (parsed?.classification?.classifications || []).map((c: any) => [String(c.question_id), c])
      );

      const review: ReviewItem[] = questions.map((q: any) => {
        const selectedIndex = answerMap?.[q.question_id];
        const selected_answer =
          typeof selectedIndex === 'number' && Array.isArray(q.options) ? q.options[selectedIndex] : '-';
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
  }, [subjectId, getIdToken]);

  return (
    <div className="min-h-screen bg-background py-12">
      <div className="max-w-5xl mx-auto px-4">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold mb-3">Quiz Summary</h1>
          <p className="text-muted-foreground">
            {(subjectId || '').replace(/-/g, ' ')}
          </p>
        </div>

        <div className="grid md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Score</p>
            <p className="text-2xl font-semibold">{Math.round(summary?.score ?? 0)}%</p>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Blind Spots Found</p>
            <p className="text-2xl font-semibold">{summary?.blind_spot_found_count ?? 0}</p>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Blind Spots Resolved</p>
            <p className="text-2xl font-semibold">{summary?.blind_spot_resolved_count ?? 0}</p>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Self-Awareness</p>
            <p className="text-2xl font-semibold">{selfAwareness !== null ? `${Math.round(selfAwareness * 100)}%` : '-'}</p>
          </div>
        </div>

        {!!summary?.review?.length && (
          <div className="bg-white rounded-xl shadow-sm p-6 mb-8">
            <h2 className="text-lg font-semibold mb-3">Question Review</h2>
            <div className="space-y-4">
              {summary.review.map((item, idx) => (
                <div
                  key={item.question_id}
                  className={`rounded border p-4 ${
                    item.is_correct ? 'border-green-200 bg-green-50/50' : 'border-red-200 bg-red-50/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">Q{idx + 1}. {item.stem}</p>
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        item.is_correct ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {item.is_correct ? 'Correct' : 'Incorrect'}
                    </span>
                  </div>
                  <div className="mt-3 grid md:grid-cols-2 gap-3 text-sm">
                    <p><span className="font-medium">Your answer:</span> {item.selected_answer}</p>
                    <p><span className="font-medium">Correct answer:</span> {item.correct_answer}</p>
                    <p><span className="font-medium">Confidence:</span> {item.confidence_1_to_5}/5</p>
                    <p><span className="font-medium">Classification:</span> {item.mistake_type || 'none'}</p>
                  </div>
                  {!item.is_correct && item.rationale ? (
                    <p className="mt-2 text-sm text-muted-foreground">{item.rationale}</p>
                  ) : null}
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
            className="bg-muted text-foreground px-8 py-3 rounded-full hover:bg-accent"
          >
            Back to Assessments
          </button>
        </div>
      </div>
    </div>
  );
}

