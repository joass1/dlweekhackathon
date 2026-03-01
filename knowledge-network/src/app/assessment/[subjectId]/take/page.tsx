'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  classifyMistake,
  evaluateAnswer,
  generateQuiz,
  getMicroCheckpoint,
  overrideClassification,
  submitMicroCheckpoint,
  type QuizQuestionClient,
  type ClassifyResult,
} from '@/services/assessment';

type AnswersMap = Record<string, number>;
type ConfidenceMap = Record<string, number>;

function getStudentId() {
  if (typeof window === 'undefined') {
    return 'student-demo';
  }
  const existing = window.localStorage.getItem('student_id');
  if (existing) {
    return existing;
  }
  const created = `student-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem('student_id', created);
  return created;
}

export default function AssessmentTakePage() {
  const router = useRouter();
  const params = useParams();
  const subjectId = params.subjectId as string;

  const [questions, setQuestions] = useState<QuizQuestionClient[]>([]);
  const [answers, setAnswers] = useState<AnswersMap>({});
  const [confidenceRatings, setConfidenceRatings] = useState<ConfidenceMap>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingQuiz, setIsLoadingQuiz] = useState(true);
  const [checkpoint, setCheckpoint] = useState<QuizQuestionClient | null>(null);
  const [checkpointAnswer, setCheckpointAnswer] = useState<number | null>(null);
  const [classificationResult, setClassificationResult] = useState<ClassifyResult | null>(null);
  const studentId = useMemo(() => getStudentId(), []);

  useEffect(() => {
    let cancelled = false;
    async function loadQuiz() {
      setIsLoadingQuiz(true);
      try {
        const generated = await generateQuiz(studentId, subjectId, 5);
        if (!cancelled) {
          setQuestions(generated);
        }
      } catch (error) {
        console.error('Error generating quiz:', error);
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
  }, [studentId, subjectId]);

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

  const runMicroCheckpoint = async (result: ClassifyResult) => {
    const conceptual = result.classifications.find((c) => c.mistake_type === 'conceptual');
    if (!conceptual) {
      return false;
    }
    try {
      const cp = await getMicroCheckpoint(studentId, subjectId, conceptual.missing_concept || undefined);
      setCheckpoint(cp);
      return true;
    } catch (error) {
      console.error('Error loading micro-checkpoint:', error);
      return false;
    }
  };

  const handleSubmit = async () => {
    if (Object.keys(answers).length < questions.length) {
      alert('Please answer all questions.');
      return;
    }
    if (Object.keys(confidenceRatings).length < questions.length) {
      alert('Please rate your confidence for each answer.');
      return;
    }

    setIsSubmitting(true);
    try {
      const answerPayload = getAnswerPayload();
      const evaluation = await evaluateAnswer(studentId, subjectId, answerPayload);
      const classification = await classifyMistake(studentId, subjectId, answerPayload);
      setClassificationResult(classification);

      saveRunToSession({
        studentId,
        subjectId,
        questions,
        answers,
        confidenceRatings,
        evaluation,
        classification,
      });

      const checkpointStarted = await runMicroCheckpoint(classification);
      if (!checkpointStarted) {
        router.push(`/assessment/${subjectId}/matching`);
      }
    } catch (error) {
      console.error('Error submitting assessment:', error);
      alert('Failed to submit assessment. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOverride = async (questionId: string) => {
    try {
      await overrideClassification(studentId, questionId);
      if (classificationResult) {
        setClassificationResult({
          ...classificationResult,
          classifications: classificationResult.classifications.map((c) =>
            c.question_id === questionId
              ? { ...c, mistake_type: 'careless', missing_concept: null, rationale: 'User override: rushed.' }
              : c
          ),
        });
      }
      alert('Reclassified as careless.');
    } catch (error) {
      console.error('Override failed:', error);
      alert('Could not override classification.');
    }
  };

  const submitCheckpoint = async () => {
    if (!checkpoint || checkpointAnswer === null) {
      alert('Select a checkpoint answer first.');
      return;
    }
    try {
      const selectedAnswer = checkpoint.options[checkpointAnswer];
      const result = await submitMicroCheckpoint(studentId, checkpoint.question_id, selectedAnswer, 3);
      const currentRaw = window.sessionStorage.getItem(`assessment_result_${subjectId}`);
      const current = currentRaw ? JSON.parse(currentRaw) : {};
      saveRunToSession({
        ...current,
        checkpoint: {
          question_id: checkpoint.question_id,
          is_correct: result.is_correct,
          next_action: result.next_action,
        },
      });
      setCheckpoint(null);
      router.push(`/assessment/${subjectId}/matching`);
    } catch (error) {
      console.error('Checkpoint submit failed:', error);
      alert('Could not submit checkpoint.');
    }
  };

  if (isLoadingQuiz) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Generating quiz...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-3xl mx-auto px-4">
        <h1 className="text-2xl font-bold mb-2">LearnGraph Assessment: {subjectId.replace(/-/g, ' ')}</h1>
        <p className="text-sm text-gray-500 mb-8">Answer each question, then rate how confident you are in your answer.</p>

        <div className="space-y-8">
          {questions.map((question) => (
            <div key={question.question_id} className="bg-white p-6 rounded-lg shadow-sm">
              <h3 className="text-lg font-medium mb-1">{question.stem}</h3>
              <span className="inline-block text-xs px-2 py-1 rounded-full mb-4 bg-blue-100 text-blue-700">
                {question.difficulty}
              </span>

              <div className="space-y-2">
                {question.options.map((option, index) => (
                  <div
                    key={index}
                    className={`flex items-center p-3 rounded-lg border cursor-pointer transition-colors ${
                      answers[question.question_id] === index
                        ? 'border-emerald-500 bg-emerald-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => handleAnswer(question.question_id, index)}
                  >
                    <input
                      type="radio"
                      id={`${question.question_id}-${index}`}
                      name={question.question_id}
                      checked={answers[question.question_id] === index}
                      onChange={() => handleAnswer(question.question_id, index)}
                      className="mr-3 accent-emerald-600"
                    />
                    <label htmlFor={`${question.question_id}-${index}`} className="cursor-pointer flex-1">
                      {option}
                    </label>
                  </div>
                ))}
              </div>

              {answers[question.question_id] !== undefined && (
                <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <label className="block text-sm font-medium text-gray-700 mb-2">How confident are you in this answer?</label>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-red-500 w-14">Guessing</span>
                    <input
                      type="range"
                      min="1"
                      max="5"
                      value={confidenceRatings[question.question_id] || 3}
                      onChange={(e) =>
                        setConfidenceRatings((prev) => ({
                          ...prev,
                          [question.question_id]: parseInt(e.target.value, 10),
                        }))
                      }
                      className="flex-1 accent-emerald-600"
                    />
                    <span className="text-xs text-green-600 w-14 text-right">Certain</span>
                  </div>
                </div>
              )}

              {classificationResult?.classifications
                .filter((c) => c.question_id === question.question_id && c.mistake_type === 'conceptual')
                .map((c) => (
                  <div key={c.question_id} className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-sm text-amber-800">{c.rationale}</p>
                    <button
                      className="mt-2 text-xs px-3 py-1 rounded bg-white border border-amber-300 hover:bg-amber-100"
                      onClick={() => handleOverride(c.question_id)}
                    >
                      I understand this, I just rushed
                    </button>
                  </div>
                ))}
            </div>
          ))}
        </div>

        <div className="mt-8 flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || questions.length === 0}
            className="bg-emerald-600 text-white px-6 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Analyzing...' : 'Submit Assessment'}
          </button>
        </div>
      </div>

      {checkpoint && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="max-w-xl w-full bg-white rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-2">Micro-checkpoint</h2>
            <p className="text-gray-700 mb-4">{checkpoint.stem}</p>
            <div className="space-y-2 mb-4">
              {checkpoint.options.map((option, index) => (
                <button
                  key={index}
                  onClick={() => setCheckpointAnswer(index)}
                  className={`w-full text-left p-3 border rounded-lg ${
                    checkpointAnswer === index ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button className="px-4 py-2 rounded border border-gray-300" onClick={() => setCheckpoint(null)}>
                Skip
              </button>
              <button className="px-4 py-2 rounded bg-emerald-600 text-white" onClick={submitCheckpoint}>
                Submit checkpoint
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
