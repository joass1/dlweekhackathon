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
import { apiFetch } from '@/services/api';
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
  Swords,
  Shield,
  Heart,
  Zap,
  Video,
  VideoOff,
} from 'lucide-react';
import { WebRTCVideo } from '@/components/groups/WebRTCVideo';
import BossBattleScene3D from '@/components/groups/BossBattleScene3D';
import { Spotlight } from '@/components/ui/spotlight';

interface KGNodeOption {
  id: string;
  title: string;
}

// ── Glass card style ──────────────────────────────────────────────────────
const glass = 'rounded-2xl border border-white/[0.08] bg-black/40 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5)]';
const glassLight = 'rounded-2xl border border-white/[0.06] bg-white/[0.04] backdrop-blur-xl';

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
  const { user, getIdToken } = useAuth();
  const studentId = useStudentId();

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Player';

  const [session, setSession] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [answerText, setAnswerText] = useState('');
  const [mcqSelection, setMcqSelection] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<SubmitAnswerResponse | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [ending, setEnding] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [conceptOptions, setConceptOptions] = useState<KGNodeOption[]>([]);
  const [selectedConceptId, setSelectedConceptId] = useState('');
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [videoCollapsed, setVideoCollapsed] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    const loadConceptOptions = async () => {
      try {
        const token = await getIdToken();
        const graph = await apiFetch<{ nodes: { id: string; title: string }[] }>('/api/kg/graph', undefined, token);
        if (cancelled) return;
        const nodes = graph.nodes ?? [];
        setConceptOptions(nodes.map((n) => ({ id: n.id, title: n.title || n.id })));
      } catch (err) {
        console.error('Failed to load concept options:', err);
      }
    };
    loadConceptOptions();
    return () => {
      cancelled = true;
    };
  }, [getIdToken]);

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

  const answersForCurrentQuestion = currentQuestion
    ? (session?.answers?.filter((a) => a.question_id === currentQuestion.question_id) ?? [])
    : [];
  const existingAnswer = answersForCurrentQuestion.find((a) => a.submitted_by === studentId);
  const answeredMemberIds = new Set(answersForCurrentQuestion.map((a) => a.submitted_by));
  const waitingMembers = (session?.members ?? []).filter((m) => !answeredMemberIds.has(m.student_id));
  const allMembersAnswered = waitingMembers.length === 0 && (session?.members?.length ?? 0) > 0;

  useEffect(() => {
    const defaultConcept =
      currentQuestion?.concept_id ||
      currentQuestion?.weak_concept ||
      session?.selected_concept_id ||
      '';
    if (defaultConcept) {
      setSelectedConceptId(defaultConcept);
    }
  }, [currentQuestion?.question_id, currentQuestion?.concept_id, currentQuestion?.weak_concept, session?.selected_concept_id]);

  const handleSubmitAnswer = async () => {
    if (!session || !currentQuestion) return;
    const text = currentQuestion.type === 'mcq' && mcqSelection !== null
      ? currentQuestion.options?.[mcqSelection] || ''
      : answerText.trim();
    if (!text) return;

    setSubmitting(true);
    try {
      const token = await getIdToken();
      const result = await submitAnswer(
        session.session_id,
        currentQuestion.question_id,
        text,
        selectedConceptId || currentQuestion.concept_id || session.selected_concept_id || null,
        token,
      );
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
    setAdvanceError(null);
    try {
      const token = await getIdToken();
      await advanceQuestion(session.session_id, token);
      await fetchSession();
    } catch (err) {
      console.error('Failed to advance question:', err);
      setAdvanceError(err instanceof Error ? err.message : 'Could not advance yet.');
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

  const bossMax = Math.max(1, session?.boss_health_max ?? 100);
  const bossCurrent = Math.max(0, Math.min(bossMax, session?.boss_health_current ?? bossMax));
  const bossPct = Math.max(0, Math.min(100, (bossCurrent / bossMax) * 100));

  // Helper to get member display name
  const getMemberName = (memberId: string) => {
    const member = session?.members?.find((m) => m.student_id === memberId);
    if (member) {
      // If name looks like a UID (long alphanumeric), show a truncated fallback
      if (member.name && member.name.length < 30 && member.name !== member.student_id) {
        return member.name;
      }
    }
    if (memberId === studentId) return displayName;
    return member?.name || memberId.slice(0, 8);
  };

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400 mr-3" />
        <span className="text-white/60 text-lg">Entering battle...</span>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center">
        <div className={`${glass} p-8 text-center max-w-sm`}>
          <p className="text-white/60 mb-4">Session not found.</p>
          <Button onClick={() => router.push(`/groups/${groupId}`)} className="bg-cyan-500 hover:bg-cyan-600 text-white">
            Back to Hub
          </Button>
        </div>
      </div>
    );
  }

  if (session.status === 'completed') {
    const totalQuestions = session.questions.length;
    const totalAnswers = session.answers.length;
    const correctCount = session.answers.filter(a => a.is_correct).length;
    const avgScore = session.answers.length
      ? session.answers.reduce((sum, a) => sum + a.score, 0) / session.answers.length
      : 0;

    return (
      <div className="fixed inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 overflow-auto">
        <Spotlight className="-top-40 left-0 md:left-60 md:-top-20" fill="#03b2e6" />
        <div className="relative z-10 p-6 max-w-4xl mx-auto min-h-screen flex items-center">
          <div className={`${glass} w-full p-8 space-y-6`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Victory!</h1>
                <p className="text-sm text-white/50">Session Complete</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className={`${glassLight} p-4 text-center`}>
                <p className="text-2xl font-bold text-white">{correctCount}/{totalAnswers || totalQuestions}</p>
                <p className="text-xs text-white/50">Correct</p>
              </div>
              <div className={`${glassLight} p-4 text-center`}>
                <p className="text-2xl font-bold text-cyan-400">{Math.round(avgScore * 100)}%</p>
                <p className="text-xs text-white/50">Avg Score</p>
              </div>
              <div className={`${glassLight} p-4 text-center`}>
                <p className="text-2xl font-bold text-white">{formatTime(elapsed)}</p>
                <p className="text-xs text-white/50">Duration</p>
              </div>
            </div>

            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2">
              {session.questions.map((q, idx) => {
                const answers = session.answers.filter(a => a.question_id === q.question_id);
                const ans = answers[0];
                return (
                  <div
                    key={q.question_id}
                    className={`rounded-xl p-4 border ${
                      ans?.is_correct
                        ? 'border-emerald-500/20 bg-emerald-500/[0.06]'
                        : 'border-red-500/20 bg-red-500/[0.06]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-white">Q{idx + 1}. {q.stem}</p>
                      {ans && (
                        <span className={`text-xs px-2 py-1 rounded-full flex-shrink-0 ${
                          ans.is_correct ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                        }`}>
                          {ans.is_correct ? 'Correct' : 'Incorrect'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/40 mt-1">
                      Targeting: {q.target_member_name}&apos;s gap in {q.weak_concept}
                    </p>
                    {answers.length > 0 && (
                      <div className="mt-2 text-sm">
                        {answers.map((a, i) => (
                          <p key={`${a.submitted_by}-${i}`} className="mb-1 text-white/70">
                            <span className="font-medium text-white/90">{getMemberName(a.submitted_by)}:</span> {a.answer_text} ({Math.round(a.score * 100)}%)
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <Button onClick={() => router.push(`/groups/${groupId}`)} className="w-full bg-cyan-500 hover:bg-cyan-600 text-white">
              Back to Hub
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Active / Waiting Session ──────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-slate-950 overflow-hidden text-white">
      {/* ── Fullscreen 3D Boss Background ─────────────────────────────── */}
      <div className="absolute inset-0 z-0">
        <BossBattleScene3D healthCurrent={bossCurrent} healthMax={bossMax} />
      </div>

      {/* ── Ambient glow effects ──────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 z-[1]">
        <div className="absolute -left-20 top-16 h-72 w-72 rounded-full bg-cyan-500/10 blur-[100px]" />
        <div className="absolute right-[-5rem] bottom-[-5rem] h-96 w-96 rounded-full bg-red-500/8 blur-[120px]" />
        <Spotlight className="-top-40 left-0 md:left-60 md:-top-20" fill="#03b2e6" />
      </div>

      {/* ── Top HUD Bar ───────────────────────────────────────────────── */}
      <div className="absolute left-0 right-0 top-16 z-20 p-3 md:top-20">
        <div className={`${glass} px-4 py-3 flex items-center justify-between`}>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Swords className="w-5 h-5 text-red-400" />
              <h1 className="font-bold text-base text-white">{session.topic}</h1>
            </div>
            <span className="text-xs text-white/40 font-mono">{formatTime(elapsed)}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              session.status === 'active' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
            }`}>
              {session.status === 'active' ? 'LIVE' : 'WAITING'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {/* Party members */}
            <div className="flex items-center gap-1">
              <Shield className="w-3.5 h-3.5 text-white/40" />
              <span className="text-xs text-white/50">{session.members.length}/{session.expected_members}</span>
              {session.members.map((m) => (
                <span
                  key={m.student_id}
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    m.student_id === studentId
                      ? 'bg-cyan-500/20 text-cyan-300 font-medium'
                      : 'bg-white/[0.06] text-white/60'
                  }`}
                >
                  {getMemberName(m.student_id)}{m.student_id === studentId ? ' (you)' : ''}
                </span>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleEndSession}
              disabled={ending}
              className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-8 px-3"
            >
              {ending ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4 mr-1" />}
              End
            </Button>
          </div>
        </div>
      </div>

      {/* ── Boss Health Bar (centered under HUD) ─────────────────────── */}
      <div className="absolute left-1/2 top-[136px] z-20 w-full max-w-xl -translate-x-1/2 px-4 md:top-[144px]">
        <div className={`${glass} px-4 py-3`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Heart className={`w-4 h-4 ${session.boss_defeated ? 'text-emerald-400' : 'text-red-400'}`} />
              <span className="text-sm font-bold text-white">
                {session.boss_name || 'Knowledge Warden'}
              </span>
              {session.boss_defeated && (
                <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full">DEFEATED</span>
              )}
            </div>
            <span className="text-xs font-mono text-white/60">
              {Math.round(bossCurrent)} / {Math.round(bossMax)} HP
            </span>
          </div>
          <div className="h-3 w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className={`h-full transition-all duration-700 ease-out rounded-full ${
                session.boss_defeated
                  ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                  : 'bg-gradient-to-r from-red-600 via-red-500 to-orange-400'
              }`}
              style={{ width: `${bossPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Video Overlay (bottom-left) ───────────────────────────────── */}
      <div className={`absolute bottom-4 left-4 z-20 transition-all duration-300 ${videoCollapsed ? 'w-12 h-12' : 'w-72'}`}>
        {videoCollapsed ? (
          <button
            onClick={() => setVideoCollapsed(false)}
            className={`${glass} w-12 h-12 flex items-center justify-center hover:bg-white/[0.08] transition-colors`}
          >
            <Video className="w-5 h-5 text-cyan-400" />
          </button>
        ) : (
          <div className={`${glass} overflow-hidden`}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
              <span className="text-xs text-white/50 flex items-center gap-1.5">
                <Video className="w-3 h-3" /> Party Cam
              </span>
              <button
                onClick={() => setVideoCollapsed(true)}
                className="text-white/30 hover:text-white/60 transition-colors"
              >
                <VideoOff className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="p-2">
              <WebRTCVideo
                sessionId={session.session_id}
                studentId={studentId}
                members={session.members}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Question Panel Overlay (right side) ──────────────────────── */}
      <div className="absolute right-4 bottom-4 top-[204px] z-20 w-full max-w-md overflow-y-auto md:top-[212px]">
        <div className="space-y-3">
          {/* Progress pips */}
          <div className="flex items-center gap-1.5 px-1">
            {session.questions.map((_, idx) => (
              <div
                key={idx}
                className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                  idx < session.current_question_index
                    ? 'bg-emerald-400/80'
                    : idx === session.current_question_index
                      ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.4)]'
                      : 'bg-white/[0.08]'
                }`}
              />
            ))}
          </div>

          {currentQuestion ? (
            <div className={`${glass} overflow-hidden`}>
              {/* Question header */}
              <div className="px-5 py-4 border-b border-white/[0.06]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-white flex items-center gap-2">
                    <QuestionTypeIcon type={currentQuestion.type} />
                    Q{session.current_question_index + 1} of {session.questions.length}
                  </span>
                  <span className="text-xs bg-cyan-500/15 text-cyan-300 px-2.5 py-1 rounded-full">
                    <Zap className="w-3 h-3 inline mr-1" />
                    {currentQuestion.target_member_name}&apos;s turn
                  </span>
                </div>
                <p className="text-xs text-white/40">
                  Gap: <span className="text-white/60">{currentQuestion.weak_concept}</span>
                </p>
              </div>

              <div className="p-5 space-y-4">
                {/* Question stem */}
                <div className={`${glassLight} p-4`}>
                  <p className="text-sm text-white/90 whitespace-pre-wrap leading-relaxed">{currentQuestion.stem}</p>
                </div>

                {/* Answer area */}
                {!existingAnswer && !feedback ? (
                  <>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-white/40">Knowledge node</label>
                      <select
                        value={selectedConceptId}
                        onChange={(e) => setSelectedConceptId(e.target.value)}
                        className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-sm px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/40 focus:border-transparent outline-none"
                      >
                        <option value="">Use question concept ({currentQuestion.concept_id || currentQuestion.weak_concept})</option>
                        {conceptOptions.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.title} ({opt.id})
                          </option>
                        ))}
                      </select>
                    </div>

                    {currentQuestion.type === 'mcq' && currentQuestion.options ? (
                      <div className="space-y-2">
                        {currentQuestion.options.map((opt, idx) => (
                          <button
                            key={idx}
                            onClick={() => setMcqSelection(idx)}
                            className={`w-full text-left p-3 rounded-xl border text-sm transition-all duration-200 ${
                              mcqSelection === idx
                                ? 'border-cyan-500/40 bg-cyan-500/10 text-white shadow-[0_0_12px_rgba(34,211,238,0.1)]'
                                : 'border-white/[0.06] bg-white/[0.02] text-white/70 hover:bg-white/[0.05] hover:border-white/[0.12]'
                            }`}
                          >
                            <span className="font-semibold mr-2 text-cyan-400">{String.fromCharCode(65 + idx)}.</span>
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
                        className={`w-full rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-sm px-4 py-3 text-sm text-white placeholder-white/30 focus:ring-2 focus:ring-cyan-500/40 focus:border-transparent outline-none resize-none ${
                          currentQuestion.type === 'code' ? 'font-mono' : ''
                        }`}
                      />
                    )}

                    <Button
                      onClick={handleSubmitAnswer}
                      disabled={
                        submitting ||
                        (currentQuestion.type === 'mcq' ? mcqSelection === null : !answerText.trim())
                      }
                      className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white font-semibold h-11 rounded-xl shadow-[0_0_20px_rgba(34,211,238,0.15)] transition-all duration-200"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Evaluating...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 mr-2" />
                          Attack!
                        </>
                      )}
                    </Button>
                  </>
                ) : null}

                {/* Feedback display */}
                {(feedback || existingAnswer) && (
                  <div className={`rounded-xl border p-4 ${
                    (feedback?.is_correct ?? existingAnswer?.is_correct)
                      ? 'border-emerald-500/20 bg-emerald-500/[0.08]'
                      : 'border-red-500/20 bg-red-500/[0.08]'
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      {(feedback?.is_correct ?? existingAnswer?.is_correct) ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-400" />
                      )}
                      <span className="font-semibold text-sm text-white">
                        {(feedback?.is_correct ?? existingAnswer?.is_correct) ? 'Critical Hit!' : 'Missed!'}
                      </span>
                      <span className="text-xs text-white/40 ml-auto">
                        {Math.round((feedback?.score ?? existingAnswer?.score ?? 0) * 100)}%
                      </span>
                    </div>
                    <p className="text-sm text-white/70">
                      {feedback?.ai_feedback || existingAnswer?.ai_feedback}
                    </p>
                    {(feedback?.hint || existingAnswer?.hint) && (
                      <p className="text-sm text-amber-300/80 mt-2">
                        Hint: {feedback?.hint || existingAnswer?.hint}
                      </p>
                    )}
                    {feedback?.explanation && (
                      <p className="text-sm text-white/50 mt-2">
                        {feedback.explanation}
                      </p>
                    )}
                    {(feedback?.updated_mastery !== undefined || existingAnswer?.updated_mastery !== undefined) && (
                      <p className="text-xs text-white/40 mt-2">
                        Mastery: {Math.round((feedback?.updated_mastery ?? existingAnswer?.updated_mastery ?? 0) * 100)}% ({feedback?.mastery_status || existingAnswer?.mastery_status || 'learning'})
                      </p>
                    )}
                    {(feedback?.damage_dealt !== undefined || existingAnswer?.damage_dealt !== undefined) && (
                      <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                        <Swords className="w-3 h-3" />
                        {Math.round(feedback?.damage_dealt ?? existingAnswer?.damage_dealt ?? 0)} damage dealt
                      </p>
                    )}
                  </div>
                )}

                {/* Round answers */}
                <div className={`${glassLight} p-3`}>
                  <p className="text-xs font-medium text-white/40 mb-2 flex items-center gap-1.5">
                    <Users className="w-3 h-3" /> Party Status
                  </p>
                  <div className="space-y-1.5">
                    {session.members.map((m) => {
                      const memberAnswer = answersForCurrentQuestion.find((a) => a.submitted_by === m.student_id);
                      return (
                        <div key={m.student_id} className="flex items-center justify-between text-xs">
                          <span className="text-white/70">
                            {getMemberName(m.student_id)}{m.student_id === studentId ? ' (you)' : ''}
                          </span>
                          {memberAnswer ? (
                            <span className={`flex items-center gap-1 ${memberAnswer.is_correct ? 'text-emerald-400' : 'text-red-400'}`}>
                              {memberAnswer.is_correct ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                              {Math.round(memberAnswer.score * 100)}% &middot; -{Math.round(memberAnswer.damage_dealt ?? 0)} HP
                            </span>
                          ) : (
                            <span className="text-white/30 animate-pulse">Waiting...</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {(existingAnswer || feedback) && !allMembersAnswered && (
                  <p className="text-xs text-amber-300/70 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Waiting for: {waitingMembers.map((m) => getMemberName(m.student_id)).join(', ')}
                  </p>
                )}

                {/* Next question / generate round */}
                {allMembersAnswered && session.current_question_index < session.questions.length - 1 && (
                  <Button
                    onClick={handleAdvance}
                    disabled={advancing}
                    className="w-full bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-white h-10 rounded-xl"
                  >
                    {advancing ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <ChevronRight className="w-4 h-4 mr-2" />
                    )}
                    Next Question
                  </Button>
                )}
                {allMembersAnswered && session.current_question_index >= session.questions.length - 1 && !session.boss_defeated && (
                  <Button
                    onClick={handleAdvance}
                    disabled={advancing}
                    className="w-full bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-white h-10 rounded-xl"
                  >
                    {advancing ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <ChevronRight className="w-4 h-4 mr-2" />
                    )}
                    Generate Next Round
                  </Button>
                )}
                {advanceError && (
                  <p className="text-xs text-red-400">{advanceError}</p>
                )}

                {session.boss_defeated && (
                  <div className="rounded-xl bg-emerald-500/[0.08] border border-emerald-500/20 p-3 text-center">
                    <p className="text-sm text-emerald-300 font-medium">Boss Defeated!</p>
                    <p className="text-xs text-white/40 mt-1">Continue discussing or end the session.</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className={`${glass} p-8 text-center`}>
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400 mx-auto mb-3" />
              <p className="text-white/50">Loading questions...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
