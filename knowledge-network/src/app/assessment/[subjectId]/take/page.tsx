'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import {
  classifyMistake,
  evaluateAnswer,
  generateQuiz,
  type QuizQuestionClient,
  type ClassifyResult,
} from '@/services/assessment';
import { useStudentId } from '@/hooks/useStudentId';
import { useAuth } from '@/contexts/AuthContext';

type AnswersMap = Record<string, number>;
type ConfidenceMap = Record<string, number>;

const GENERATING_QUIZ_PHRASES = [
  'Building your next quiz...',
  'Analyzing your knowledge map...',
  'Choosing concepts to test...',
  'Adjusting question difficulty to your mastery...',
  'Crafting fresh questions...',
  'Finalizing your quiz...',
];

const SUBMITTING_QUIZ_PHRASES = [
  'Checking your answers...',
  'Scoring your responses...',
  'Classifying mistakes (careless vs conceptual)...',
  'Updating your mastery profile...',
  'Preparing your summary...',
  'Almost done...',
];

const glassCardClass = 'rounded-2xl border border-white/20 bg-slate-900/45 backdrop-blur-xl shadow-[0_24px_60px_-24px_rgba(2,6,23,0.85)]';

export default function AssessmentTakePage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const subjectId = params.subjectId as string;
  const retryKey = searchParams.get('retry') || '';
  const uploadTicketFromQuery = searchParams.get('ticket') || '';
  const isComprehensive = subjectId === 'all-concepts';

  const [questions, setQuestions] = useState<QuizQuestionClient[]>([]);
  const [answers, setAnswers] = useState<AnswersMap>({});
  const [confidenceRatings, setConfidenceRatings] = useState<ConfidenceMap>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingQuiz, setIsLoadingQuiz] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isEmptyAssessment, setIsEmptyAssessment] = useState(false);
  const [, setClassificationResult] = useState<ClassifyResult | null>(null);
  const [loadingPhraseIdx, setLoadingPhraseIdx] = useState(0);
  const [submitPhraseIdx, setSubmitPhraseIdx] = useState(0);
  const studentId = useStudentId();
  const { getIdToken } = useAuth();
  const [effectiveUploadTicket, setEffectiveUploadTicket] = useState(uploadTicketFromQuery);

  useEffect(() => {
    if (!isComprehensive) return;
    const fromQuery = uploadTicketFromQuery.trim();
    if (fromQuery) {
      setEffectiveUploadTicket(fromQuery);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('comprehensive_quiz_ticket', fromQuery);
      }
      return;
    }
    if (typeof window !== 'undefined') {
      const fromSession = window.sessionStorage.getItem('comprehensive_quiz_ticket') || '';
      setEffectiveUploadTicket(fromSession);
    }
  }, [isComprehensive, uploadTicketFromQuery]);

  useEffect(() => {
    let cancelled = false;
    async function loadQuiz() {
      setIsLoadingQuiz(true);
      setLoadError(null);
      setIsEmptyAssessment(false);
      try {
        const token = await getIdToken();
        const generated = await generateQuiz(
          studentId,
          subjectId,
          isComprehensive ? 20 : 5,
          token,
          isComprehensive ? effectiveUploadTicket : undefined
        );
        if (isComprehensive && typeof window !== 'undefined') {
          window.sessionStorage.removeItem('comprehensive_quiz_ticket');
        }
        if (!cancelled) {
          setQuestions(generated);
          setIsEmptyAssessment(generated.length === 0);
        }
      } catch (error) {
        console.error('Error generating quiz:', error);
        if (!cancelled) {
          const msg = error instanceof Error ? error.message : '';
          const isNoConceptState =
            msg.includes('No knowledge-map concepts found') ||
            msg.includes('not found in your knowledge map') ||
            msg.includes('API 400') ||
            msg.includes('API 404');

          if (isNoConceptState) {
            setQuestions([]);
            setIsEmptyAssessment(true);
            setLoadError(null);
          } else {
            setLoadError(msg || 'Could not generate the quiz. Please retry.');
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoadingQuiz(false);
        }
      }
    }
    loadQuiz();
    return () => {
      cancelled = true;
    };
  }, [studentId, subjectId, retryKey, getIdToken, isComprehensive, effectiveUploadTicket, router]);

  useEffect(() => {
    if (!isLoadingQuiz) return;
    setLoadingPhraseIdx(0);
    const id = window.setInterval(() => {
      setLoadingPhraseIdx((prev) => (prev + 1) % GENERATING_QUIZ_PHRASES.length);
    }, 1200);
    return () => window.clearInterval(id);
  }, [isLoadingQuiz]);

  useEffect(() => {
    if (!isSubmitting) return;
    setSubmitPhraseIdx(0);
    const id = window.setInterval(() => {
      setSubmitPhraseIdx((prev) => (prev + 1) % SUBMITTING_QUIZ_PHRASES.length);
    }, 1200);
    return () => window.clearInterval(id);
  }, [isSubmitting]);

  const handleAnswer = (questionId: string, answerIndex: number) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: answerIndex,
    }));
  };

  const saveRunToSession = (payload: unknown) => {
    if (typeof window === 'undefined') {
      return;
    }
    window.sessionStorage.setItem(`assessment_result_${subjectId}`, JSON.stringify(payload));
  };

  const getAnswerPayload = () =>
    questions.map((q) => ({
      question_id: q.question_id,
      selected_answer: q.options[answers[q.question_id]],
      confidence_1_to_5: confidenceRatings[q.question_id] || 3,
    }));

  const handleSubmit = async () => {
    if (Object.keys(answers).length < questions.length) {
      alert('Please answer all questions.');
      return;
    }

    setIsSubmitting(true);
    try {
      const token = await getIdToken();
      const answerPayload = getAnswerPayload();
      const classification = await classifyMistake(studentId, subjectId, answerPayload, token);
      setClassificationResult(classification);
      const evaluation = classification.per_question?.length
        ? {
            score: Number(classification.score || 0),
            per_question: classification.per_question,
          }
        : await evaluateAnswer(studentId, subjectId, answerPayload, token);

      saveRunToSession({
        studentId,
        subjectId,
        questions,
        answers,
        confidenceRatings,
        evaluation,
        classification,
      });

      router.push(`/assessment/${subjectId}/matching`);
    } catch (error) {
      console.error('Error submitting assessment:', error);
      alert('Failed to submit assessment. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingQuiz) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className={`text-center ${glassCardClass} px-8 py-10 text-white`}>
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#03b2e6] mx-auto"></div>
          <p className="mt-4 text-white/70">{GENERATING_QUIZ_PHRASES[loadingPhraseIdx]}</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-full flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center rounded-2xl border border-red-300/30 bg-red-500/15 backdrop-blur-xl p-6 text-white shadow-lg">
          <h2 className="text-lg font-semibold text-red-100 mb-2">Quiz load failed</h2>
          <p className="text-sm text-red-100/90 mb-4">{loadError}</p>
          <button className="bg-[#03b2e6] text-white px-4 py-2 rounded-full hover:bg-[#029ad0]" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (isEmptyAssessment) {
    return (
      <div className="min-h-full flex items-center justify-center px-4">
        <div className={`max-w-md w-full text-center ${glassCardClass} p-6 text-white`}>
          <h2 className="text-lg font-semibold mb-2">No assessment available yet</h2>
          <p className="text-sm text-white/70 mb-4">
            Your knowledge map has no concepts for this assessment yet. Upload study materials first.
          </p>
          <button className="bg-[#03b2e6] text-white px-4 py-2 rounded-full hover:bg-[#029ad0]" onClick={() => router.push('/upload')}>
            Upload Materials
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full nav-safe-top pb-8">
      <div className="max-w-3xl mx-auto px-4">
        <h1 className="text-2xl font-bold mb-2 text-white">Mentora Assessment: {subjectId.replace(/-/g, ' ')}</h1>
        <p className="text-sm text-white/70 mb-8">Answer each question, then rate how confident you are in your answer.</p>

        <div className="space-y-8">
          {questions.map((question) => (
            <div key={question.question_id} className={`${glassCardClass} p-6 text-white`}>
              <h3 className="text-lg font-medium mb-1">{question.stem}</h3>
              <span className="inline-block text-xs px-2 py-1 rounded-full mb-4 bg-[#03b2e6]/20 border border-[#03b2e6]/30 text-[#4cc9f0]">
                {question.difficulty}
              </span>

              <div className="space-y-2">
                {question.options.map((option, index) => (
                  <div
                    key={index}
                    className={`flex items-center p-3 rounded-lg border cursor-pointer transition-colors ${
                      answers[question.question_id] === index
                        ? 'border-[#03b2e6]/70 bg-[#03b2e6]/20'
                        : 'border-white/15 bg-white/5 hover:bg-white/10'
                    }`}
                    onClick={() => handleAnswer(question.question_id, index)}
                  >
                    <input
                      type="radio"
                      id={`${question.question_id}-${index}`}
                      name={question.question_id}
                      checked={answers[question.question_id] === index}
                      onChange={() => handleAnswer(question.question_id, index)}
                      className="mr-3 accent-[#03b2e6]"
                    />
                    <label htmlFor={`${question.question_id}-${index}`} className="cursor-pointer flex-1 text-white">
                      {option}
                    </label>
                  </div>
                ))}
              </div>

              {answers[question.question_id] !== undefined && (
                <div className="mt-4 p-4 bg-white/5 rounded-lg border border-white/15">
                  <label className="block text-sm font-medium text-white mb-2">How confident are you in this answer?</label>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-red-300 w-14">Guessing</span>
                    <input
                      type="range"
                      min="1"
                      max="5"
                      step="1"
                      value={confidenceRatings[question.question_id] || 3}
                      onChange={(e) =>
                        setConfidenceRatings((prev) => ({
                          ...prev,
                          [question.question_id]: parseInt(e.target.value, 10),
                        }))
                      }
                      className="flex-1 accent-[#03b2e6] cursor-pointer"
                    />
                    <span className="text-sm font-semibold w-6 text-center text-white">{confidenceRatings[question.question_id] || 3}</span>
                    <span className="text-xs text-green-300 w-14 text-right">Certain</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-8 flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || questions.length === 0}
            className="bg-[#03b2e6] text-white px-6 py-2 rounded-full hover:bg-[#029ad0] disabled:opacity-50"
          >
            {isSubmitting ? SUBMITTING_QUIZ_PHRASES[submitPhraseIdx] : 'Submit Assessment'}
          </button>
        </div>
      </div>
    </div>
  );
}
