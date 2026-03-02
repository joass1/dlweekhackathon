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

interface MicroCheckpointProps {
  checkpoint: CheckpointQuestion;
  onSubmit: (answer: string, confidence: number) => Promise<{ is_correct: boolean | null } | void>;
  onSkip: () => void;
  onClose: () => void;
}

const AUTO_DISMISS_SECONDS = 8;

function optionKey(value: string): string {
  const m = value.trim().match(/^([A-D])(?:[.)\s]|$)/i);
  if (m) return m[1].toUpperCase();
  return value.trim().toLowerCase();
}

export function MicroCheckpoint({ checkpoint, onSubmit, onSkip, onClose }: MicroCheckpointProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [confidence, setConfidence] = useState(3);
  const [phase, setPhase] = useState<'question' | 'result'>('question');
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [countdown, setCountdown] = useState(AUTO_DISMISS_SECONDS);
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-dismiss after result is shown
  useEffect(() => {
    if (phase !== 'result') return;
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          onClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase, onClose]);

  const handleConfirm = async () => {
    if (!selected || submitting) return;
    const localCorrect = optionKey(selected) === optionKey(checkpoint.correct_answer);
    setSubmitting(true);
    try {
      const submitResult = await onSubmit(selected, confidence);
      const serverCorrect = submitResult?.is_correct;
      setIsCorrect(typeof serverCorrect === 'boolean' ? serverCorrect : localCorrect);
      setPhase('result');
    } catch {
      setIsCorrect(localCorrect);
      setPhase('result');
    } finally {
      setSubmitting(false);
    }
  };

  const confidenceLabel = (v: number) =>
    ['', 'Very unsure', 'Unsure', 'Neutral', 'Confident', 'Very confident'][v] ?? '';

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[380px] rounded-xl border border-slate-200 bg-white shadow-lg animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-white">?</span>
          <span className="text-xs font-semibold uppercase tracking-widest text-sky-600">Quick Check</span>
        </div>
        <button
          onClick={phase === 'question' ? onSkip : onClose}
          className="text-slate-400 hover:text-slate-700 transition-colors text-lg leading-none"
          aria-label="Close checkpoint"
        >
          ×
        </button>
      </div>

      <div className="px-4 py-3 space-y-3">
        {phase === 'question' ? (
          <>
            {/* Concept chip */}
            <span className="inline-block rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-medium text-sky-700">
              {checkpoint.concept_tested}
            </span>

            {/* Question */}
            <p className="text-sm font-medium text-slate-800 leading-snug">{checkpoint.question}</p>

            {/* Options */}
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

            {/* Confidence slider */}
            <div className="pt-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-slate-500">Confidence</span>
                <span className="text-[11px] text-sky-600 font-medium">{confidenceLabel(confidence)}</span>
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

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={onSkip}
                className="flex-1 rounded-lg border border-slate-200 bg-white py-2 text-sm text-slate-500 hover:bg-slate-50 transition-colors"
              >
                Skip
              </button>
              <button
                disabled={!selected || submitting}
                onClick={handleConfirm}
                className="flex-1 rounded-lg bg-sky-500 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? 'Checking...' : 'Submit'}
              </button>
            </div>
          </>
        ) : (
          /* Result phase */
          <div className="space-y-3 py-1">
            <div className={`flex items-center gap-2 ${isCorrect ? 'text-emerald-600' : 'text-rose-600'}`}>
              <span className="text-xl">{isCorrect ? '✓' : '✗'}</span>
              <span className="font-semibold text-sm">{isCorrect ? 'Correct!' : 'Not quite.'}</span>
            </div>
            {!isCorrect && (
              <p className="text-xs text-slate-500">
                Correct answer: <span className="text-slate-800 font-medium">{checkpoint.correct_answer}</span>
              </p>
            )}
            <p className="text-xs text-slate-500 leading-relaxed">{checkpoint.explanation}</p>
            <p className="text-[11px] text-slate-400">Closing in {countdown}s…</p>
          </div>
        )}
      </div>
    </div>
  );
}
