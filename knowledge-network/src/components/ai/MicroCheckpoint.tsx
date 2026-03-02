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
  onSubmit: (answer: string, confidence: number) => void;
  onSkip: () => void;
}

const AUTO_DISMISS_SECONDS = 8;

export function MicroCheckpoint({ checkpoint, onSubmit, onSkip }: MicroCheckpointProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [confidence, setConfidence] = useState(3);
  const [phase, setPhase] = useState<'question' | 'result'>('question');
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [countdown, setCountdown] = useState(AUTO_DISMISS_SECONDS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-dismiss after result is shown
  useEffect(() => {
    if (phase !== 'result') return;
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          onSkip(); // dismiss
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase, onSkip]);

  const handleConfirm = () => {
    if (!selected) return;
    const correct = selected === checkpoint.correct_answer;
    setIsCorrect(correct);
    setPhase('result');
    onSubmit(selected, confidence);
  };

  const confidenceLabel = (v: number) =>
    ['', 'Very unsure', 'Unsure', 'Neutral', 'Confident', 'Very confident'][v] ?? '';

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[380px] rounded-xl border border-white/30 bg-slate-900/92 shadow-2xl backdrop-blur-md animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-white">?</span>
          <span className="text-xs font-semibold uppercase tracking-widest text-sky-300">Quick Check</span>
        </div>
        <button
          onClick={onSkip}
          className="text-white/40 hover:text-white/80 transition-colors text-lg leading-none"
          aria-label="Skip checkpoint"
        >
          ×
        </button>
      </div>

      <div className="px-4 py-3 space-y-3">
        {phase === 'question' ? (
          <>
            {/* Concept chip */}
            <span className="inline-block rounded-full bg-sky-900/60 px-2.5 py-0.5 text-[11px] font-medium text-sky-300">
              {checkpoint.concept_tested}
            </span>

            {/* Question */}
            <p className="text-sm font-medium text-white leading-snug">{checkpoint.question}</p>

            {/* Options */}
            <div className="space-y-1.5">
              {checkpoint.options.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setSelected(opt)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-all ${
                    selected === opt
                      ? 'border-sky-400 bg-sky-900/60 text-white'
                      : 'border-white/10 bg-white/5 text-white/80 hover:border-white/30 hover:bg-white/10'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>

            {/* Confidence slider */}
            <div className="pt-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-white/50">Confidence</span>
                <span className="text-[11px] text-sky-300 font-medium">{confidenceLabel(confidence)}</span>
              </div>
              <input
                type="range"
                min={1}
                max={5}
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
                className="w-full accent-sky-400"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={onSkip}
                className="flex-1 rounded-lg border border-white/10 bg-white/5 py-2 text-sm text-white/60 hover:bg-white/10 transition-colors"
              >
                Skip
              </button>
              <button
                disabled={!selected}
                onClick={handleConfirm}
                className="flex-1 rounded-lg bg-sky-500 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Submit
              </button>
            </div>
          </>
        ) : (
          /* Result phase */
          <div className="space-y-3 py-1">
            <div className={`flex items-center gap-2 ${isCorrect ? 'text-emerald-400' : 'text-rose-400'}`}>
              <span className="text-xl">{isCorrect ? '✓' : '✗'}</span>
              <span className="font-semibold text-sm">{isCorrect ? 'Correct!' : 'Not quite.'}</span>
            </div>
            {!isCorrect && (
              <p className="text-xs text-white/60">
                Correct answer: <span className="text-white/90 font-medium">{checkpoint.correct_answer}</span>
              </p>
            )}
            <p className="text-xs text-white/60 leading-relaxed">{checkpoint.explanation}</p>
            <p className="text-[11px] text-white/30">Closing in {countdown}s…</p>
          </div>
        )}
      </div>
    </div>
  );
}
