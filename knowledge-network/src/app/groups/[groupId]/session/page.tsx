'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useStudentId } from '@/hooks/useStudentId';
import {
  getSession,
  submitAnswer,
  advanceQuestion,
  endSession,
  type SessionState,
  type PeerQuestion,
  type SubmitAnswerResponse,
} from '@/services/peer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Users,
  Loader2,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Send,
  LogOut,
  Code,
  HelpCircle,
  Calculator,
  ListChecks,
} from 'lucide-react';
import { WebRTCVideo } from '@/components/groups/WebRTCVideo';

// ── Question type icon helper ─────────────────────────────────────────────

function QuestionTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'code': return <Code className="w-4 h-4" />;
    case 'math': return <Calculator className="w-4 h-4" />;
    case 'mcq': return <ListChecks className="w-4 h-4" />;
    default: return <HelpCircle className="w-4 h-4" />;
  }
}

// ── Main Session Page ─────────────────────────────────────────────────────

export default function PeerSessionPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const groupId = params.groupId as string;
  const sessionId = searchParams.get('id') || '';
  const { getIdToken } = useAuth();
  const studentId = useStudentId();

  const [session, setSession] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [answerText, setAnswerText] = useState('');
  const [mcqSelection, setMcqSelection] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<SubmitAnswerResponse | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [ending, setEnding] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // ── Poll session state every 3s ──────────────────────────────────────

  const fetchSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const token = await getIdToken();
      const s = await getSession(sessionId, token);
      setSession(s);
    } catch (err) {
      console.error('Failed to fetch session:', err);
    }
  }, [sessionId, getIdToken]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      await fetchSession();
      if (!cancelled) setLoading(false);
    };
    load();

    const interval = setInterval(() => {
      if (!cancelled) fetchSession();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fetchSession]);

  // ── Session timer ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!session?.created_at) return;
    const start = new Date(session.created_at).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [session?.created_at]);

  // ── Reset answer state when question changes ──────────────────────────

  useEffect(() => {
    setAnswerText('');
    setMcqSelection(null);
    setFeedback(null);
  }, [session?.current_question_index]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const currentQuestion: PeerQuestion | null =
    session?.questions?.[session.current_question_index] ?? null;

  // Check if this question already has an answer
  const existingAnswer = session?.answers?.find(
    (a) => a.question_id === currentQuestion?.question_id
  );

  const handleSubmitAnswer = async () => {
    if (!session || !currentQuestion) return;
    const text = currentQuestion.type === 'mcq' && mcqSelection !== null
      ? currentQuestion.options?.[mcqSelection] || ''
      : answerText.trim();
    if (!text) return;

    setSubmitting(true);
    try {
      const token = await getIdToken();
      const result = await submitAnswer(session.session_id, currentQuestion.question_id, text, token);
      setFeedback(result);
      await fetchSession();
    } catch (err) {
      console.error('Failed to submit answer:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdvance = async () => {
    if (!session) return;
    setAdvancing(true);
    try {
      const token = await getIdToken();
      await advanceQuestion(session.session_id, token);
      await fetchSession();
    } catch (err) {
      console.error('Failed to advance question:', err);
    } finally {
      setAdvancing(false);
    }
  };

  const handleEndSession = async () => {
    if (!session) return;
    setEnding(true);
    try {
      const token = await getIdToken();
      await endSession(session.session_id, token);
      router.push(`/groups/${groupId}`);
    } catch (err) {
      console.error('Failed to end session:', err);
      setEnding(false);
    }
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-[#03b2e6] mr-2" />
        <span className="text-muted-foreground">Loading session...</span>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-6">
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">Session not found.</p>
          <Button onClick={() => router.push(`/groups/${groupId}`)} className="mt-4">
            Back to Hub
          </Button>
        </Card>
      </div>
    );
  }

  if (session.status === 'completed') {
    const totalQuestions = session.questions.length;
    const correctCount = session.answers.filter(a => a.is_correct).length;
    const avgScore = session.answers.length
      ? session.answers.reduce((sum, a) => sum + a.score, 0) / session.answers.length
      : 0;

    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              Session Complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-accent rounded-lg p-4 text-center">
                <p className="text-2xl font-bold">{correctCount}/{totalQuestions}</p>
                <p className="text-xs text-muted-foreground">Questions Correct</p>
              </div>
              <div className="bg-accent rounded-lg p-4 text-center">
                <p className="text-2xl font-bold">{Math.round(avgScore * 100)}%</p>
                <p className="text-xs text-muted-foreground">Average Score</p>
              </div>
              <div className="bg-accent rounded-lg p-4 text-center">
                <p className="text-2xl font-bold">{formatTime(elapsed)}</p>
                <p className="text-xs text-muted-foreground">Duration</p>
              </div>
            </div>

            {/* Review each question */}
            <div className="space-y-3">
              {session.questions.map((q, idx) => {
                const ans = session.answers.find(a => a.question_id === q.question_id);
                return (
                  <div
                    key={q.question_id}
                    className={`rounded-lg border p-4 ${
                      ans?.is_correct ? 'border-green-200 bg-green-50/50' : 'border-red-200 bg-red-50/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">Q{idx + 1}. {q.stem}</p>
                      {ans && (
                        <span className={`text-xs px-2 py-1 rounded-full flex-shrink-0 ${
                          ans.is_correct ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {ans.is_correct ? 'Correct' : 'Incorrect'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Targeting: {q.target_member_name}&apos;s gap in {q.weak_concept}
                    </p>
                    {ans && (
                      <div className="mt-2 text-sm">
                        <p><span className="font-medium">Answer:</span> {ans.answer_text}</p>
                        <p className="text-muted-foreground mt-1">{ans.ai_feedback}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <Button onClick={() => router.push(`/groups/${groupId}`)} className="w-full">
              Back to Hub
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Active / Waiting Session ──────────────────────────────────────────

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-white rounded-lg shadow-sm p-4">
        <div className="flex items-center gap-4">
          <h1 className="font-semibold text-lg">{session.topic}</h1>
          <span className="text-sm text-muted-foreground">{formatTime(elapsed)}</span>
          <span className={`text-xs px-2 py-1 rounded-full ${
            session.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {session.status === 'active' ? 'In Progress' : 'Waiting for members'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Users className="w-4 h-4" />
            {session.members.length}/{session.expected_members}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleEndSession}
            disabled={ending}
            className="text-red-600 border-red-200 hover:bg-red-50"
          >
            {ending ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4 mr-1" />}
            End
          </Button>
        </div>
      </div>

      {/* Two-column layout: Video | Question */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Video panel */}
        <Card className="overflow-hidden">
          <CardContent className="p-3">
            <WebRTCVideo
              sessionId={session.session_id}
              studentId={studentId}
              members={session.members}
            />
          </CardContent>
        </Card>

        {/* Question panel */}
        <div className="space-y-4">
          {/* Progress */}
          <div className="flex items-center gap-2">
            {session.questions.map((_, idx) => (
              <div
                key={idx}
                className={`h-2 flex-1 rounded-full ${
                  idx < session.current_question_index
                    ? 'bg-green-400'
                    : idx === session.current_question_index
                      ? 'bg-[#03b2e6]'
                      : 'bg-gray-200'
                }`}
              />
            ))}
          </div>

          {currentQuestion ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <QuestionTypeIcon type={currentQuestion.type} />
                    Question {session.current_question_index + 1} of {session.questions.length}
                  </CardTitle>
                  <span className="text-xs bg-[#e0f4fb] text-[#03b2e6] px-2 py-1 rounded-full">
                    {currentQuestion.target_member_name}&apos;s turn
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Targeting gap in: <span className="font-medium">{currentQuestion.weak_concept}</span>
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Question stem */}
                <div className="bg-accent rounded-lg p-4">
                  <p className="text-sm whitespace-pre-wrap">{currentQuestion.stem}</p>
                </div>

                {/* Answer area — depends on question type */}
                {!existingAnswer && !(feedback) ? (
                  <>
                    {currentQuestion.type === 'mcq' && currentQuestion.options ? (
                      <div className="space-y-2">
                        {currentQuestion.options.map((opt, idx) => (
                          <button
                            key={idx}
                            onClick={() => setMcqSelection(idx)}
                            className={`w-full text-left p-3 rounded-lg border text-sm transition-colors ${
                              mcqSelection === idx
                                ? 'border-[#03b2e6] bg-[#e0f4fb]'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <span className="font-medium mr-2">{String.fromCharCode(65 + idx)}.</span>
                            {opt}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <textarea
                        value={answerText}
                        onChange={(e) => setAnswerText(e.target.value)}
                        placeholder={
                          currentQuestion.type === 'code'
                            ? 'Write your code here...'
                            : currentQuestion.type === 'math'
                              ? 'Show your work and final answer...'
                              : 'Type your answer...'
                        }
                        rows={currentQuestion.type === 'code' ? 8 : 4}
                        className={`w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-[#03b2e6] focus:border-transparent resize-none ${
                          currentQuestion.type === 'code' ? 'font-mono bg-gray-50' : ''
                        }`}
                      />
                    )}

                    <Button
                      onClick={handleSubmitAnswer}
                      disabled={
                        submitting ||
                        (currentQuestion.type === 'mcq' ? mcqSelection === null : !answerText.trim())
                      }
                      className="w-full bg-[#03b2e6] hover:bg-[#029ad0] text-white"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Evaluating...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 mr-2" />
                          Submit Answer
                        </>
                      )}
                    </Button>
                  </>
                ) : null}

                {/* Feedback display */}
                {(feedback || existingAnswer) && (
                  <div className={`rounded-lg border p-4 ${
                    (feedback?.is_correct ?? existingAnswer?.is_correct)
                      ? 'border-green-200 bg-green-50'
                      : 'border-red-200 bg-red-50'
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      {(feedback?.is_correct ?? existingAnswer?.is_correct) ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-600" />
                      )}
                      <span className="font-medium text-sm">
                        {(feedback?.is_correct ?? existingAnswer?.is_correct) ? 'Correct!' : 'Not quite right'}
                      </span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        Score: {Math.round((feedback?.score ?? existingAnswer?.score ?? 0) * 100)}%
                      </span>
                    </div>
                    <p className="text-sm">
                      {feedback?.ai_feedback || existingAnswer?.ai_feedback}
                    </p>
                    {(feedback?.hint || existingAnswer?.hint) && (
                      <p className="text-sm text-amber-700 mt-2">
                        Hint: {feedback?.hint || existingAnswer?.hint}
                      </p>
                    )}
                    {feedback?.explanation && (
                      <p className="text-sm text-muted-foreground mt-2">
                        {feedback.explanation}
                      </p>
                    )}
                  </div>
                )}

                {/* Next question button */}
                {(feedback || existingAnswer) && session.current_question_index < session.questions.length - 1 && (
                  <Button
                    onClick={handleAdvance}
                    disabled={advancing}
                    className="w-full"
                    variant="outline"
                  >
                    {advancing ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <ChevronRight className="w-4 h-4 mr-2" />
                    )}
                    Next Question
                  </Button>
                )}

                {/* Complete session if last question answered */}
                {(feedback || existingAnswer) && session.current_question_index >= session.questions.length - 1 && (
                  <Button
                    onClick={handleEndSession}
                    disabled={ending}
                    className="w-full bg-green-600 hover:bg-green-700 text-white"
                  >
                    {ending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                    )}
                    Complete Session
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">Waiting for questions to load...</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
