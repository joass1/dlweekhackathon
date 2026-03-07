'use client';

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
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
  Clock3,
  AlertTriangle,
  Video,
  VideoOff,
} from 'lucide-react';
import { WebRTCVideo } from '@/components/groups/WebRTCVideo';
import BossBattleScene3D from '@/components/groups/BossBattleScene3D';
import { Spotlight } from '@/components/ui/spotlight';
import { TutorMarkdown } from '@/components/ai/TutorMarkdown';

interface KGNodeOption {
  id: string;
  title: string;
}

type BossCharacterId = 'punk' | 'spacesuit' | 'swat' | 'suit';

const LEVEL_TO_BOSS: Record<number, BossCharacterId> = {
  1: 'punk',
  2: 'spacesuit',
  3: 'swat',
  4: 'suit',
};

const UID_LIKE_RE = /^[a-z0-9_-]{20,}$/i;

function looksLikeUid(value: string): boolean {
  const text = String(value || '').trim();
  if (!text) return true;
  if (text.includes(' ')) return false;
  return UID_LIKE_RE.test(text);
}

const PLACEHOLDER_CHOICE_RE = /^(?:option|choice)?\s*[\(\[]?\s*(?:[a-z]|[1-9])\s*[\)\].:\-]?\s*$/i;

function stripChoiceLabel(value: string): string {
  const text = String(value ?? '').trim();
  if (!text) return '';

  const punct = text.match(/^\s*[\(\[]?([a-z]|[1-9])[\)\].:\-]\s*(.*)$/i);
  if (punct) {
    const body = (punct[2] || '').trim();
    return body || String(punct[1] || '').trim();
  }

  const spaced = text.match(/^\s*([a-z]|[1-9])\s+(.+)$/i);
  if (spaced) {
    return String(spaced[2] || '').trim();
  }

  return text;
}

function sanitizeMcqOptions(options: string[] | null | undefined): string[] {
  if (!Array.isArray(options)) return [];

  const cleaned: string[] = [];
  const seen = new Set<string>();

  for (const raw of options) {
    const normalized = stripChoiceLabel(String(raw ?? '').trim());
    if (!normalized) continue;
    if (PLACEHOLDER_CHOICE_RE.test(normalized)) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(normalized);
  }

  return cleaned;
}

function extractApiDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Could not advance yet.';
  const trimmed = raw.replace(/^API\s+\d+:\s*/i, '').trim();
  try {
    const parsed = JSON.parse(trimmed) as { detail?: unknown };
    if (parsed && typeof parsed === 'object' && typeof parsed.detail === 'string') {
      return parsed.detail.trim();
    }
  } catch {
    // keep trimmed string if response is not JSON
  }
  return trimmed;
}

function resolveBossCharacterId(session: SessionState | null): BossCharacterId | undefined {
  const explicit = session?.boss_character_id;
  if (explicit === 'punk' || explicit === 'spacesuit' || explicit === 'swat' || explicit === 'suit') {
    return explicit;
  }
  const level = Number(session?.level);
  if (!Number.isFinite(level)) return undefined;
  return LEVEL_TO_BOSS[level];
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

function BossMarkdown({
  content,
  className = '',
}: {
  content: string;
  className?: string;
}) {
  const text = String(content || '').trim();
  if (!text) return null;
  return (
    <TutorMarkdown
      content={text}
      tone="dark"
      compact
      className={`[&_p]:my-0 [&_ul]:my-1 [&_ol]:my-1 [&_.katex-display]:my-1 ${className}`}
    />
  );
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
  const [questionElapsed, setQuestionElapsed] = useState(0);
  const [bossAttackTrigger, setBossAttackTrigger] = useState(0);
  const lastBossAttackCountRef = useRef(0);
  const forcedBossId = resolveBossCharacterId(session);

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

  useEffect(() => {
    const startedAtRaw = session?.current_question_started_at;
    if (!startedAtRaw) {
      setQuestionElapsed(0);
      return;
    }
    const start = new Date(startedAtRaw).getTime();
    if (!Number.isFinite(start)) {
      setQuestionElapsed(0);
      return;
    }
    const tick = () => setQuestionElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [session?.current_question_started_at, session?.current_question_index]);

  useEffect(() => {
    const count = Number(session?.boss_attack_count ?? 0);
    if (!Number.isFinite(count)) return;
    if (count > lastBossAttackCountRef.current) {
      const diff = count - lastBossAttackCountRef.current;
      setBossAttackTrigger((prev) => prev + diff);
    }
    lastBossAttackCountRef.current = count;
  }, [session?.boss_attack_count]);

  useEffect(() => {
    lastBossAttackCountRef.current = 0;
    setBossAttackTrigger(0);
  }, [sessionId]);

  // ── Reset answer state when question changes ──────────────────────────

  useEffect(() => {
    setAnswerText('');
    setMcqSelection(null);
    setFeedback(null);
  }, [session?.current_question_index]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const currentQuestion: PeerQuestion | null =
    session?.questions?.[session.current_question_index] ?? null;
  const currentMcqOptions = useMemo(
    () => sanitizeMcqOptions(currentQuestion?.options),
    [currentQuestion?.options],
  );

  useEffect(() => {
    if (mcqSelection !== null && mcqSelection >= currentMcqOptions.length) {
      setMcqSelection(null);
    }
  }, [mcqSelection, currentMcqOptions.length]);

  const answersForCurrentQuestion = currentQuestion
    ? (session?.answers?.filter((a) => a.question_id === currentQuestion.question_id) ?? [])
    : [];
  const existingAnswer = answersForCurrentQuestion.find((a) => a.submitted_by === studentId);
  const answeredMemberIds = new Set(answersForCurrentQuestion.map((a) => a.submitted_by));
  const waitingMembers = (session?.members ?? []).filter((m) => !answeredMemberIds.has(m.student_id));
  const allMembersAnswered = waitingMembers.length === 0 && (session?.members?.length ?? 0) > 0;

  const resolveDisplayNameFromId = (memberId: string) => {
    if (memberId === studentId) return displayName;
    const member = session?.members?.find((m) => m.student_id === memberId);
    const rawName = String(member?.name || '').trim();
    if (rawName && rawName !== memberId && !looksLikeUid(rawName)) {
      return rawName;
    }
    return 'Teammate';
  };

  const toFriendlyAdvanceError = (err: unknown): string => {
    const detail = extractApiDetail(err);
    const waitingMatch = detail.match(/^Waiting for answers from:\s*(.+)$/i);
    if (waitingMatch) {
      const rawNames = waitingMatch[1]
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      const cleaned = rawNames.map((nameOrId) => (
        looksLikeUid(nameOrId) ? resolveDisplayNameFromId(nameOrId) : nameOrId
      ));
      if (cleaned.length > 0) {
        return `Waiting for answers from: ${cleaned.join(', ')}`;
      }
      return 'Waiting for teammates to submit answers.';
    }
    return detail || 'Could not advance yet.';
  };

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
      ? currentMcqOptions?.[mcqSelection] || ''
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
      setAdvanceError(toFriendlyAdvanceError(err));
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
  const levelNumber = Number(session?.level ?? 1);
  const hasPartyHealth = Number.isFinite(levelNumber) && levelNumber >= 2;
  const partyMax = hasPartyHealth ? Math.max(1, session?.party_health_max ?? 100) : 0;
  const partyCurrent = hasPartyHealth ? Math.max(0, Math.min(partyMax, session?.party_health_current ?? partyMax)) : 0;
  const partyPct = hasPartyHealth ? Math.max(0, Math.min(100, (partyCurrent / partyMax) * 100)) : 0;
  const partyDefeated = Boolean(session?.party_defeated) || (hasPartyHealth && partyCurrent <= 0);
  const battleOutcome =
    session?.battle_outcome ??
    (partyDefeated ? 'defeat' : session?.boss_defeated ? 'victory' : 'pending');
  const timeLimitSec = levelNumber >= 3 ? Number(session?.question_time_limit_sec ?? 120) : null;
  const questionRemainingSec =
    timeLimitSec && Number.isFinite(timeLimitSec)
      ? Math.max(0, timeLimitSec - questionElapsed)
      : null;
  const timerUrgent = questionRemainingSec !== null && questionRemainingSec <= 30;

  // Helper to get member display name
  const getMemberName = (memberId: string) => {
    return resolveDisplayNameFromId(memberId);
  };

  const getQuestionTargetName = (question: PeerQuestion) => {
    const raw = String(question.target_member_name || '').trim();
    if (raw && raw !== question.target_member && !looksLikeUid(raw)) {
      return raw;
    }
    return getMemberName(question.target_member);
  };

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/backgrounds/peerhubbackground.png')" }}
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-0 bg-slate-950/55" aria-hidden />
        <div className="relative z-10 flex items-center">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400 mr-3" />
          <span className="text-white/60 text-lg">Entering battle...</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="fixed inset-0 flex items-center justify-center overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/backgrounds/peerhubbackground.png')" }}
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-0 bg-slate-950/55" aria-hidden />
        <div className={`${glass} relative z-10 p-8 text-center max-w-sm`}>
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
    const isDefeat = battleOutcome === 'defeat';
    const timeoutRows = Array.isArray(session.question_timeout_penalties)
      ? session.question_timeout_penalties.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      : [];
    const incorrectAnswers = session.answers.filter((a) => !a.is_correct);

    return (
      <div className="fixed inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 overflow-auto">
        <Spotlight className="-top-40 left-0 md:left-60 md:-top-20" fill="#03b2e6" />
        <div className="relative z-10 p-6 max-w-4xl mx-auto min-h-screen flex items-center">
          <div className={`${glass} w-full p-8 space-y-6`}>
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  isDefeat ? 'bg-red-500/20' : 'bg-emerald-500/20'
                }`}
              >
                {isDefeat ? (
                  <XCircle className="w-6 h-6 text-red-400" />
                ) : (
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                )}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">{isDefeat ? 'Defeat' : 'Victory!'}</h1>
                <p className="text-sm text-white/50">
                  {isDefeat ? 'Your party HP reached zero.' : 'Session Complete'}
                </p>
              </div>
            </div>

            <div className={`grid gap-4 ${hasPartyHealth ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-3'}`}>
              {hasPartyHealth && (
                <div className={`${glassLight} p-4 text-center`}>
                  <p className="text-2xl font-bold text-rose-300">{Math.round(partyCurrent)} / {Math.round(partyMax)}</p>
                  <p className="text-xs text-white/50">Party HP</p>
                </div>
              )}
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

            {isDefeat && (
              <div className="rounded-xl border border-red-500/25 bg-red-500/[0.08] p-4 space-y-3">
                <p className="text-sm font-semibold text-red-200">What went wrong</p>
                {incorrectAnswers.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-red-200/80">Low-quality answers</p>
                    {incorrectAnswers.slice(0, 5).map((a, idx) => (
                      <p key={`${a.question_id}-${a.submitted_by}-${idx}`} className="text-sm text-white/75">
                        {getMemberName(a.submitted_by)} on {a.concept_id || a.question_id}: {Math.round(a.score * 100)}%
                      </p>
                    ))}
                  </div>
                )}
                {timeoutRows.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-red-200/80">Timeout penalties</p>
                    {timeoutRows.slice(0, 6).map((row, idx) => {
                      const sid = String(row.student_id || '');
                      const concept = String(row.concept_id || 'current concept');
                      const dmg = Number(row.damage_taken ?? 0);
                      return (
                        <p key={`${sid}-${concept}-${idx}`} className="text-sm text-white/75">
                          {getMemberName(sid)} timed out on {concept} ({Math.round(dmg)} HP)
                        </p>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

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
                      <div className="text-sm font-medium text-white">
                        <span>Q{idx + 1}. </span>
                        <BossMarkdown content={q.stem} className="inline-block align-top text-sm font-medium text-white" />
                      </div>
                      {ans && (
                        <span className={`text-xs px-2 py-1 rounded-full flex-shrink-0 ${
                          ans.is_correct ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                        }`}>
                          {ans.is_correct ? 'Correct' : 'Incorrect'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/40 mt-1">
                      Targeting: {getQuestionTargetName(q)}&apos;s gap in {q.weak_concept}
                    </p>
                    {answers.length > 0 && (
                      <div className="mt-2 text-sm">
                        {answers.map((a, i) => (
                          <div key={`${a.submitted_by}-${i}`} className="mb-1 text-white/70">
                            <span className="font-medium text-white/90">{getMemberName(a.submitted_by)}:</span>{' '}
                            <BossMarkdown content={a.answer_text} className="inline-block align-top text-white/70" /> ({Math.round(a.score * 100)}%)
                          </div>
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
  const showBossScene = session.status === 'active' || session.status === 'waiting';

  return (
    <div className="fixed inset-0 bg-slate-950 overflow-hidden text-white">
      {/* ── Fullscreen background ─────────────────────────────────────── */}
      <div className="absolute inset-0 z-0">
        {showBossScene ? (
          <BossBattleScene3D
            healthCurrent={bossCurrent}
            healthMax={bossMax}
            lobbyId={session.session_id || sessionId}
            forcedBossId={forcedBossId}
            bossAttackTrigger={bossAttackTrigger}
            allowAmbientAttacks={!hasPartyHealth}
          />
        ) : (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center bg-no-repeat"
              style={{ backgroundImage: "url('/backgrounds/peerhubbackground.png')" }}
              aria-hidden
            />
            <div className="absolute inset-0 bg-slate-950/55" aria-hidden />
          </>
        )}
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
            {hasPartyHealth && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${partyDefeated ? 'bg-red-500/20 text-red-300' : 'bg-cyan-500/20 text-cyan-300'}`}>
                Party {partyDefeated ? 'DOWN' : 'HOLDING'}
              </span>
            )}
            {questionRemainingSec !== null && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-mono ${
                  timerUrgent ? 'bg-red-500/20 text-red-300' : 'bg-cyan-500/20 text-cyan-300'
                }`}
              >
                <Clock3 className="inline w-3 h-3 mr-1" />
                {formatTime(questionRemainingSec)}
              </span>
            )}
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

      {/* ── Party Health Bar (bottom, separate from boss HP) ──────────── */}
      {hasPartyHealth && (
        <div className="pointer-events-none absolute left-1/2 bottom-4 z-20 w-full max-w-xl -translate-x-1/2 px-4">
          <div className={`${glass} px-4 py-3`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Shield className={`w-4 h-4 ${partyDefeated ? 'text-red-400' : 'text-cyan-300'}`} />
                <span className="text-sm font-bold text-white">Party HP</span>
                {partyDefeated && (
                  <span className="text-xs bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full">DEFEATED</span>
                )}
              </div>
              <span className="text-xs font-mono text-white/60">
                {Math.round(partyCurrent)} / {Math.round(partyMax)} HP
              </span>
            </div>
            <div className="h-3 w-full rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={`h-full transition-all duration-700 ease-out rounded-full ${
                  partyDefeated
                    ? 'bg-gradient-to-r from-red-700 to-red-500'
                    : 'bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-500'
                }`}
                style={{ width: `${partyPct}%` }}
              />
            </div>
            {questionRemainingSec !== null && (
              <p className={`mt-2 text-xs flex items-center gap-1 ${timerUrgent ? 'text-red-300' : 'text-cyan-200/80'}`}>
                <Clock3 className="w-3 h-3" />
                Answer timer: {formatTime(questionRemainingSec)} remaining
              </p>
            )}
          </div>
        </div>
      )}

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
                    {getQuestionTargetName(currentQuestion)}&apos;s turn
                  </span>
                </div>
                <p className="text-xs text-white/40">
                  Gap: <span className="text-white/60">{currentQuestion.weak_concept}</span>
                </p>
              </div>

              <div className="p-5 space-y-4">
                {/* Question stem */}
                <div className={`${glassLight} p-4`}>
                  <BossMarkdown
                    content={currentQuestion.stem}
                    className="text-sm text-white/90 whitespace-pre-wrap leading-relaxed"
                  />
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
                    {questionRemainingSec !== null && (
                      <p className={`text-xs flex items-center gap-1 ${timerUrgent ? 'text-red-300' : 'text-cyan-200/75'}`}>
                        <Clock3 className="w-3 h-3" />
                        Time left to avoid boss counterattack: {formatTime(questionRemainingSec)}
                      </p>
                    )}

                    {currentQuestion.type === 'mcq' && currentMcqOptions.length > 0 ? (
                      <div className="space-y-2">
                        {currentMcqOptions.map((opt, idx) => (
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
                            <BossMarkdown content={opt} className="inline-block align-top text-sm text-inherit" />
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
                    <div className="text-sm text-white/70">
                      <BossMarkdown content={feedback?.ai_feedback || existingAnswer?.ai_feedback || ''} />
                    </div>
                    {(feedback?.hint || existingAnswer?.hint) && (
                      <div className="text-sm text-amber-300/80 mt-2">
                        <span>Hint: </span>
                        <BossMarkdown content={feedback?.hint || existingAnswer?.hint || ''} className="inline-block align-top text-amber-300/80" />
                      </div>
                    )}
                    {feedback?.explanation && (
                      <div className="text-sm text-white/50 mt-2">
                        <BossMarkdown content={feedback.explanation} className="text-white/50" />
                      </div>
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
                    {(feedback?.boss_attacked || existingAnswer?.boss_attacked) && (
                      <p className="text-xs text-rose-300 mt-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Boss counterattack: -{Math.round(feedback?.party_damage_taken ?? existingAnswer?.party_damage_taken ?? 0)} party HP
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
                              {(memberAnswer.party_damage_taken ?? 0) > 0 && (
                                <span className="text-rose-300">
                                  &middot; party -{Math.round(memberAnswer.party_damage_taken ?? 0)}
                                </span>
                              )}
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
