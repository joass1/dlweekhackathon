'use client';

import React, { useEffect, useRef, useState } from 'react';

export interface CheckpointQuestion {
  session_id: string;
  concept_tested: string;
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
}

interface CheckpointSubmitResult {
  is_correct: boolean | null;
  mastery_delta?: number | null;
  updated_mastery?: number | null;
  mastery_status?: string | null;
  concept_id?: string | null;
}

interface MicroCheckpointProps {
  checkpoint: CheckpointQuestion;
  onSubmit: (answer: string, confidence: number) => Promise<CheckpointSubmitResult | void>;
  onSkip: () => void;
  onClose: () => void;
}

const AUTO_DISMISS_SECONDS = 8;

function optionKey(value: string): string {
  const m = value.trim().match(/^([A-D])(?:[.)\s]|$)/i);
  if (m) return m[1].toUpperCase();
  return value.trim().toLowerCase();
}

function humanizeMasteryStatus(status: string | null): string | null {
  if (status === 'mastered') return 'Mastered';
  if (status === 'learning') return 'In progress';
  if (status === 'weak') return 'Needs work';
  if (status === 'not_started') return 'Not started';
  return null;
}

export function MicroCheckpoint({ checkpoint, onSubmit, onSkip, onClose }: MicroCheckpointProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [confidence, setConfidence] = useState(3);
  const [phase, setPhase] = useState<'question' | 'result'>('question');
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [masteryDelta, setMasteryDelta] = useState<number | null>(null);
  const [updatedMastery, setUpdatedMastery] = useState<number | null>(null);
  const [masteryStatus, setMasteryStatus] = useState<string | null>(null);
  const [updatedConceptId, setUpdatedConceptId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(AUTO_DISMISS_SECONDS);
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (phase !== 'result') return;
    setCountdown(AUTO_DISMISS_SECONDS);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => Math.max(prev - 1, 0));
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'result' || countdown > 0) return;
    const closeTimer = setTimeout(() => {
      onClose();
    }, 0);
    return () => clearTimeout(closeTimer);
  }, [countdown, onClose, phase]);

  const handleConfirm = async () => {
    if (!selected || submitting) return;
    const localCorrect = optionKey(selected) === optionKey(checkpoint.correct_answer);
    setSubmitting(true);
    try {
      const submitResult = await onSubmit(selected, confidence);
      const serverCorrect = submitResult?.is_correct;
      setIsCorrect(typeof serverCorrect === 'boolean' ? serverCorrect : localCorrect);
      setMasteryDelta(typeof submitResult?.mastery_delta === 'number' ? submitResult.mastery_delta : null);
      setUpdatedMastery(typeof submitResult?.updated_mastery === 'number' ? submitResult.updated_mastery : null);
      setMasteryStatus(typeof submitResult?.mastery_status === 'string' ? submitResult.mastery_status : null);
      setUpdatedConceptId(typeof submitResult?.concept_id === 'string' ? submitResult.concept_id : null);
      setPhase('result');
    } catch {
      setIsCorrect(localCorrect);
      setMasteryDelta(null);
      setUpdatedMastery(null);
      setMasteryStatus(null);
      setUpdatedConceptId(null);
      setPhase('result');
    } finally {
      setSubmitting(false);
    }
  };

  const confidenceLabel = (v: number) =>
    ['', 'Very unsure', 'Unsure', 'Neutral', 'Confident', 'Very confident'][v] ?? '';
  const masteryDeltaPoints =
    typeof masteryDelta === 'number' && Number.isFinite(masteryDelta) ? masteryDelta * 100 : null;
  const updatedMasteryPercent =
    typeof updatedMastery === 'number' && Number.isFinite(updatedMastery) ? updatedMastery * 100 : null;
  const masteryToneClass =
    masteryDeltaPoints == null
      ? 'border-white/15 bg-white/5 text-white/80'
      : masteryDeltaPoints >= 0
        ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
        : 'border-rose-400/40 bg-rose-500/10 text-rose-100';
  const humanizedStatus = humanizeMasteryStatus(masteryStatus);
  const updatedNodeLabel = updatedConceptId || checkpoint.concept_tested;
  const rootClassName =
    phase === 'result'
      ? 'fixed bottom-6 right-6 z-50 w-[380px] rounded-xl border border-slate-700 bg-slate-950 text-white shadow-2xl animate-slide-up'
      : 'fixed bottom-6 right-6 z-50 w-[380px] rounded-xl border border-slate-200 bg-white shadow-lg animate-slide-up';
  const headerClassName =
    phase === 'result'
      ? 'flex items-center justify-between border-b border-slate-800 px-4 py-3'
      : 'flex items-center justify-between border-b border-slate-100 px-4 py-3';
  const closeButtonClassName =
    phase === 'result'
      ? 'text-slate-400 transition-colors hover:text-white'
      : 'text-slate-400 transition-colors hover:text-slate-700';
  const explanationClassName = phase === 'result' ? 'text-sm leading-relaxed text-slate-200' : 'text-xs leading-relaxed text-slate-500';
  const answerClassName = phase === 'result' ? 'text-sm text-slate-200' : 'text-xs text-slate-500';
  const countdownClassName = phase === 'result' ? 'text-xs text-slate-400' : 'text-[11px] text-slate-400';

  return (
    <div className={rootClassName}>
      <div className={headerClassName}>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-white">?</span>
          <span className="text-xs font-semibold uppercase tracking-widest text-sky-600">Quick Check</span>
        </div>
        <button
          onClick={phase === 'question' ? onSkip : onClose}
          className={closeButtonClassName}
          aria-label="Close checkpoint"
        >
          x
        </button>
      </div>

      <div className="space-y-3 px-4 py-3">
        {phase === 'question' ? (
          <>
            <span className="inline-block rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-medium text-sky-700">
              {checkpoint.concept_tested}
            </span>

            <p className="text-sm font-medium leading-snug text-slate-800">{checkpoint.question}</p>

            <div className="space-y-1.5">
              {checkpoint.options.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setSelected(opt)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-all ${
                    selected === opt
                      ? 'border-sky-400 bg-sky-50 text-sky-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50/50'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>

            <div className="pt-1">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] text-slate-500">Confidence</span>
                <span className="text-[11px] font-medium text-sky-600">{confidenceLabel(confidence)}</span>
              </div>
              <input
                type="range"
                min={1}
                max={5}
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
                className="w-full accent-sky-500"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={onSkip}
                className="flex-1 rounded-lg border border-slate-200 bg-white py-2 text-sm text-slate-500 transition-colors hover:bg-slate-50"
              >
                Skip
              </button>
              <button
                disabled={!selected || submitting}
                onClick={handleConfirm}
                className="flex-1 rounded-lg bg-sky-500 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? 'Checking...' : 'Submit'}
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-3 py-1">
            <div className={`flex items-center gap-2 ${isCorrect ? 'text-emerald-600' : 'text-rose-600'}`}>
              <span className="text-xl">{isCorrect ? 'Correct' : 'Review'}</span>
              <span className={`font-semibold text-sm ${phase === 'result' ? 'text-white' : ''}`}>
                {isCorrect ? 'Checkpoint passed.' : 'Checkpoint missed.'}
              </span>
            </div>
            {!isCorrect && (
              <p className={answerClassName}>
                Correct answer: <span className={`font-medium ${phase === 'result' ? 'text-white' : 'text-slate-800'}`}>{checkpoint.correct_answer}</span>
              </p>
            )}
            {(masteryDeltaPoints !== null || updatedMasteryPercent !== null) && (
              <div className={`rounded-lg border px-3 py-2 text-xs ${masteryToneClass}`}>
                {masteryDeltaPoints !== null && (
                  <p className="font-semibold">
                    Mastery {masteryDeltaPoints >= 0 ? '+' : ''}{masteryDeltaPoints.toFixed(1)} pts
                  </p>
                )}
                {updatedMasteryPercent !== null && (
                  <p className="mt-1">
                    Current mastery: {updatedMasteryPercent.toFixed(1)}%
                    {humanizedStatus ? ` (${humanizedStatus})` : ''}
                  </p>
                )}
                {updatedNodeLabel && (
                  <p className="mt-1 text-white/80">
                    Updated node: {updatedNodeLabel}
                  </p>
                )}
              </div>
            )}
            <p className={explanationClassName}>{checkpoint.explanation}</p>
            <p className={countdownClassName}>Closing in {countdown}s...</p>
          </div>
        )}
      </div>
    </div>
  );
}
