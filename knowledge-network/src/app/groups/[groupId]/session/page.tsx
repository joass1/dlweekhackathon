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
import { FluidDropdown } from '@/components/ui/fluid-dropdown';
import { TutorMarkdown } from '@/components/ai/TutorMarkdown';

interface KGNodeOption {
  id: string;
  title: string;
  courseId?: string | null;
  category?: string | null;
  topicIds?: string[];
}

type BossCharacterId = 'punk' | 'spacesuit' | 'swat' | 'suit';

const LEVEL_TO_BOSS: Record<number, BossCharacterId> = {
  1: 'punk',
  2: 'spacesuit',
  3: 'swat',
  4: 'suit',
};
const VICTORY_CUTSCENE_MS = 3000;

const UID_LIKE_RE = /^[a-z0-9_-]{20,}$/i;

function looksLikeUid(value: string): boolean {
  const text = String(value || '').trim();
  if (!text) return true;
  if (text.includes(' ')) return false;
  return UID_LIKE_RE.test(text);
}

const PLACEHOLDER_CHOICE_RE = /^(?:option|choice)?\s*[\(\[]?\s*(?:[a-z]|[1-9])\s*[\)\].:\-]?\s*$/i;
const CONCEPT_MATCH_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'their', 'what', 'which', 'when', 'where',
  'into', 'onto', 'over', 'under', 'just', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'could',
  'should', 'about', 'explain', 'question', 'answer', 'topic', 'week', 'slide', 'slides', 'chapter', 'lecture',
  'concept', 'material', 'materials', 'course', 'study',
]);

function normalizeMatchText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeMatchText(value: string): string[] {
  const normalized = normalizeMatchText(value);
  if (!normalized) return [];
  return normalized
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !CONCEPT_MATCH_STOPWORDS.has(token));
}

function normalizeMatchKey(value: string): string {
  return normalizeMatchText(value).replace(/\s+/g, '');
}

function scoreConceptMatch(questionText: string, hintText: string, node: KGNodeOption): number {
  const qNorm = normalizeMatchText(questionText);
  const qTokens = tokenizeMatchText(questionText);
  const hintNorm = normalizeMatchText(hintText);
  const hintTokens = tokenizeMatchText(hintText);
  if (!qNorm && qTokens.length === 0 && !hintNorm) return 0;

  const nodeTitle = String(node.title || '').trim();
  const nodeId = String(node.id || '').trim();
  const nodeNorm = normalizeMatchText(`${nodeTitle} ${nodeId}`);
  const nodeTokens = new Set(tokenizeMatchText(`${nodeTitle} ${nodeId}`));
  if (!nodeNorm && nodeTokens.size === 0) return 0;

  let score = 0;
  let stemOverlap = 0;
  for (const token of qTokens) {
    if (nodeTokens.has(token)) {
      score += 8;
      stemOverlap += 1;
    }
  }

  const titleNorm = normalizeMatchText(nodeTitle);
  const idNorm = normalizeMatchText(nodeId);
  const stemContainsTitle = Boolean(titleNorm && titleNorm.length >= 6 && qNorm.includes(titleNorm));
  const stemContainsId = Boolean(idNorm && idNorm.length >= 5 && qNorm.includes(idNorm));
  if (stemContainsTitle) score += 35;
  if (stemContainsId) score += 24;

  for (const token of hintTokens) {
    if (nodeTokens.has(token)) {
      score += 5;
    }
  }
  if (hintNorm && titleNorm && hintNorm === titleNorm) score += 24;
  if (hintNorm && idNorm && hintNorm === idNorm) score += 18;

  for (const token of qTokens) {
    if (token.length < 4) continue;
    if (titleNorm.includes(token)) score += 3;
    if (idNorm.includes(token)) score += 2;
  }

  const qBigrams = new Set<string>();
  for (let i = 0; i < qTokens.length - 1; i += 1) {
    qBigrams.add(`${qTokens[i]} ${qTokens[i + 1]}`);
  }
  const nodeTokensArr = Array.from(nodeTokens);
  const nodeBigrams = new Set<string>();
  for (let i = 0; i < nodeTokensArr.length - 1; i += 1) {
    nodeBigrams.add(`${nodeTokensArr[i]} ${nodeTokensArr[i + 1]}`);
  }
  for (const bg of qBigrams) {
    if (nodeBigrams.has(bg)) score += 10;
  }

  // If there is no overlap at all, treat as non-match and avoid bad defaults.
  if (stemOverlap <= 0 && !stemContainsTitle && !stemContainsId) {
    return 0;
  }

  const denom = Math.max(1, Math.min(nodeTokens.size, 8));
  score += (stemOverlap / denom) * 6;
  return score;
}

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

function humanizeMasteryStatus(status?: string | null): string {
  if (status === 'mastered') return 'Mastered';
  if (status === 'learning') return 'In progress';
  if (status === 'weak') return 'Needs work';
  if (status === 'not_started') return 'Not started';
  return 'In progress';
}

function humanizeConceptId(value?: string | null): string {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.replace(/[-_]+/g, ' ');
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
  const [victoryCutsceneActive, setVictoryCutsceneActive] = useState(false);
  const lastBossAttackCountRef = useRef(0);
  const lastAutoQuestionIdRef = useRef<string>('');
  const victoryCutsceneTimerRef = useRef<number | null>(null);
  const lastVictoryStateRef = useRef<{ bossDefeated: boolean; status: string | null; sessionId: string | null }>({
    bossDefeated: false,
    status: null,
    sessionId: null,
  });
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

    const pollMs = session?.status === 'completed' && !victoryCutsceneActive ? 2500 : 1000;
    const interval = setInterval(() => {
      if (!cancelled) void fetchSession();
    }, pollMs);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fetchSession, session?.status, victoryCutsceneActive]);

  useEffect(() => {
    const syncNow = () => {
      void fetchSession();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncNow();
      }
    };

    window.addEventListener('focus', syncNow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', syncNow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchSession]);

  useEffect(() => {
    let cancelled = false;
    const loadConceptOptions = async () => {
      try {
        const token = await getIdToken();
        const graph = await apiFetch<{
          nodes: Array<{
            id: string;
            title?: string;
            courseId?: string | null;
            course_id?: string | null;
            category?: string | null;
            topicIds?: string[] | null;
            topic_ids?: string[] | null;
          }>;
        }>('/api/kg/graph', undefined, token);
        if (cancelled) return;
        const nodes = graph.nodes ?? [];
        setConceptOptions(nodes.map((n) => ({
          id: n.id,
          title: n.title || n.id,
          courseId: n.courseId || n.course_id || null,
          category: n.category || null,
          topicIds: Array.isArray(n.topicIds)
            ? n.topicIds
            : (Array.isArray(n.topic_ids) ? n.topic_ids : []),
        })));
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

  useEffect(() => {
    return () => {
      if (victoryCutsceneTimerRef.current !== null) {
        window.clearTimeout(victoryCutsceneTimerRef.current);
        victoryCutsceneTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const prev = lastVictoryStateRef.current;
    const sessionKey = session?.session_id || null;
    const currentStatus = session?.status || null;
    const currentBossDefeated = Boolean(session?.boss_defeated) || session?.battle_outcome === 'victory';
    const currentPartyDefeated = Boolean(session?.party_defeated) || session?.battle_outcome === 'defeat';

    const justWon =
      Boolean(sessionKey) &&
      !currentPartyDefeated &&
      (
        (prev.sessionId === sessionKey && !prev.bossDefeated && currentBossDefeated) ||
        (prev.sessionId === sessionKey && prev.status !== 'completed' && currentStatus === 'completed' && currentBossDefeated)
      );

    if (justWon) {
      setVictoryCutsceneActive(true);
      if (victoryCutsceneTimerRef.current !== null) {
        window.clearTimeout(victoryCutsceneTimerRef.current);
      }
      victoryCutsceneTimerRef.current = window.setTimeout(() => {
        setVictoryCutsceneActive(false);
        victoryCutsceneTimerRef.current = null;
      }, VICTORY_CUTSCENE_MS);
    }

    if (prev.sessionId !== sessionKey) {
      setVictoryCutsceneActive(false);
      if (victoryCutsceneTimerRef.current !== null) {
        window.clearTimeout(victoryCutsceneTimerRef.current);
        victoryCutsceneTimerRef.current = null;
      }
    }

    lastVictoryStateRef.current = {
      bossDefeated: currentBossDefeated,
      status: currentStatus,
      sessionId: sessionKey,
    };
  }, [session?.session_id, session?.boss_defeated, session?.party_defeated, session?.battle_outcome, session?.status]);

  // ── Reset answer state when question changes ──────────────────────────

  useEffect(() => {
    setAnswerText('');
    setMcqSelection(null);
    setFeedback(null);
  }, [session?.current_question_index]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const currentQuestion: PeerQuestion | null =
    session?.questions?.[session.current_question_index] ?? null;
  const scopedConceptOptions = useMemo(() => {
    if (conceptOptions.length === 0) return conceptOptions;

    const topicKey = normalizeMatchKey(String(session?.topic || ''));
    const weakKey = normalizeMatchKey(String(currentQuestion?.weak_concept || ''));
    const sessionCourseKey = normalizeMatchKey(String(session?.course_id || ''));
    const sessionCourseNameKey = normalizeMatchKey(String(session?.course_name || ''));

    const inTopic = conceptOptions.filter((node) => {
      const topicIds = Array.isArray(node.topicIds) ? node.topicIds : [];
      if (topicIds.length === 0) return false;
      return topicIds.some((topicId) => {
        const nodeTopicKey = normalizeMatchKey(String(topicId || ''));
        if (!nodeTopicKey) return false;
        if (topicKey && (nodeTopicKey === topicKey || nodeTopicKey.includes(topicKey) || topicKey.includes(nodeTopicKey))) {
          return true;
        }
        return Boolean(weakKey && (nodeTopicKey === weakKey || nodeTopicKey.includes(weakKey) || weakKey.includes(nodeTopicKey)));
      });
    });
    if (inTopic.length > 0) return inTopic;

    const inCourse = conceptOptions.filter((node) => {
      const nodeCourseKey = normalizeMatchKey(String(node.courseId || ''));
      if (sessionCourseKey && nodeCourseKey && nodeCourseKey === sessionCourseKey) {
        return true;
      }
      const nodeCategoryKey = normalizeMatchKey(String(node.category || ''));
      return Boolean(sessionCourseNameKey && nodeCategoryKey && nodeCategoryKey === sessionCourseNameKey);
    });
    return inCourse.length > 0 ? inCourse : conceptOptions;
  }, [conceptOptions, session?.course_id, session?.course_name, session?.topic, currentQuestion?.weak_concept]);
  const lexicalQuestionSignal = useMemo(
    () => String(currentQuestion?.stem || '').trim(),
    [currentQuestion?.stem],
  );
  const lexicalHintSignal = useMemo(
    () => [currentQuestion?.weak_concept, session?.topic].filter(Boolean).join(' '),
    [currentQuestion?.weak_concept, session?.topic],
  );
  const lexicalBestConceptId = useMemo(() => {
    if (!scopedConceptOptions.length) return '';
    let bestId = '';
    let bestScore = 0;
    for (const option of scopedConceptOptions) {
      const score = scoreConceptMatch(lexicalQuestionSignal, lexicalHintSignal, option);
      if (score > bestScore) {
        bestScore = score;
        bestId = option.id;
      }
    }
    return bestScore >= 6 ? bestId : '';
  }, [scopedConceptOptions, lexicalQuestionSignal, lexicalHintSignal]);
  const weakConceptFallbackId = useMemo(() => {
    const weakKey = normalizeMatchKey(String(currentQuestion?.weak_concept || ''));
    if (!weakKey || !scopedConceptOptions.length) return '';
    const exact = scopedConceptOptions.find((option) => {
      const idKey = normalizeMatchKey(option.id);
      const titleKey = normalizeMatchKey(option.title);
      return weakKey === idKey || weakKey === titleKey;
    });
    if (exact) return exact.id;
    const partial = scopedConceptOptions.find((option) => {
      const idKey = normalizeMatchKey(option.id);
      const titleKey = normalizeMatchKey(option.title);
      if (!idKey && !titleKey) return false;
      return (
        (idKey.length >= 4 && (idKey.includes(weakKey) || weakKey.includes(idKey)))
        || (titleKey.length >= 4 && (titleKey.includes(weakKey) || weakKey.includes(titleKey)))
      );
    });
    return partial?.id || '';
  }, [currentQuestion?.weak_concept, scopedConceptOptions]);
  const autoConceptId =
    String(
      lexicalBestConceptId ||
      weakConceptFallbackId ||
      ''
    ).trim();
  const conceptDropdownOptions = useMemo(() => {
    const byId = new Map<string, string>();
    if (autoConceptId) {
      byId.set(autoConceptId, `Auto-selected (${autoConceptId})`);
    }
    for (const opt of scopedConceptOptions) {
      if (!opt?.id) continue;
      if (!byId.has(opt.id)) {
        byId.set(opt.id, `${opt.title} (${opt.id})`);
      }
    }
    return [
      { value: '', label: 'Auto fallback (question/topic)' },
      ...Array.from(byId.entries()).map(([value, label]) => ({ value, label })),
    ];
  }, [autoConceptId, scopedConceptOptions]);
  const currentMcqOptions = useMemo(
    () => sanitizeMcqOptions(currentQuestion?.options),
    [currentQuestion?.options],
  );

  useEffect(() => {
    if (mcqSelection !== null && mcqSelection >= currentMcqOptions.length) {
      setMcqSelection(null);
    }
  }, [mcqSelection, currentMcqOptions.length]);

  useEffect(() => {
    const qid = String(currentQuestion?.question_id || '');
    if (!qid) return;
    if (lastAutoQuestionIdRef.current !== qid) {
      lastAutoQuestionIdRef.current = qid;
      setSelectedConceptId(autoConceptId);
      return;
    }
    if (!selectedConceptId && autoConceptId) {
      setSelectedConceptId(autoConceptId);
    }
  }, [currentQuestion?.question_id, autoConceptId, selectedConceptId]);

  const answersForCurrentQuestion = currentQuestion
    ? (session?.answers?.filter((a) => a.question_id === currentQuestion.question_id) ?? [])
    : [];
  const existingAnswer = answersForCurrentQuestion.find((a) => a.submitted_by === studentId);
  const answeredMemberIds = new Set(answersForCurrentQuestion.map((a) => a.submitted_by));
  const rawWaitingMembers = (session?.members ?? []).filter((m) => !answeredMemberIds.has(m.student_id));

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
    if (/only the session creator can continue the shared round/i.test(detail)) {
      return 'Waiting for the session creator to continue the shared round.';
    }
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
        selectedConceptId || autoConceptId || null,
        token,
      );
      setFeedback(result);
      setSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          boss_health_max: result.boss_health_max ?? prev.boss_health_max,
          boss_health_current: typeof result.boss_health_current === 'number'
            ? result.boss_health_current
            : prev.boss_health_current,
          boss_defeated: result.boss_defeated ?? prev.boss_defeated,
          battle_outcome: result.battle_outcome ?? prev.battle_outcome,
          boss_attack_count: typeof result.boss_attack_count === 'number'
            ? result.boss_attack_count
            : prev.boss_attack_count,
          party_health_max: result.party_health_max ?? prev.party_health_max,
          party_health_current: typeof result.party_health_current === 'number'
            ? result.party_health_current
            : prev.party_health_current,
          party_defeated: result.party_defeated ?? prev.party_defeated,
          status: result.boss_defeated || result.battle_outcome === 'victory'
            ? 'completed'
            : prev.status,
        };
      });
      if (result.boss_defeated || result.battle_outcome === 'victory') {
        setVictoryCutsceneActive(true);
        if (victoryCutsceneTimerRef.current !== null) {
          window.clearTimeout(victoryCutsceneTimerRef.current);
        }
        victoryCutsceneTimerRef.current = window.setTimeout(() => {
          setVictoryCutsceneActive(false);
          victoryCutsceneTimerRef.current = null;
        }, VICTORY_CUTSCENE_MS);
        setSession((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            boss_health_current: 0,
            boss_defeated: true,
            status: 'completed',
            battle_outcome: 'victory',
          };
        });
      }
      await fetchSession();
    } catch (err) {
      console.error('Failed to submit answer:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdvance = async () => {
    if (!session) return;
    if (!isSessionCreator) {
      setAdvanceError('Waiting for the session creator to continue the shared round.');
      return;
    }
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
  const levelNumber = Number(session?.level ?? 1);
  const hasPartyHealth = Number.isFinite(levelNumber) && levelNumber >= 2;
  const partyMax = hasPartyHealth ? Math.max(1, session?.party_health_max ?? 100) : 0;
  const partyCurrent = hasPartyHealth ? Math.max(0, Math.min(partyMax, session?.party_health_current ?? partyMax)) : 0;
  const partyPct = hasPartyHealth ? Math.max(0, Math.min(100, (partyCurrent / partyMax) * 100)) : 0;
  const partyDefeated = Boolean(session?.party_defeated) || (hasPartyHealth && partyCurrent <= 0);
  const bossDefeated =
    Boolean(session?.boss_defeated) ||
    bossCurrent <= 0 ||
    session?.battle_outcome === 'victory';
  const waitingMembers = bossDefeated ? [] : rawWaitingMembers;
  const allMembersAnswered = bossDefeated || (waitingMembers.length === 0 && (session?.members?.length ?? 0) > 0);
  const battleOutcome = partyDefeated
    ? 'defeat'
    : bossDefeated
      ? 'victory'
      : (session?.battle_outcome ?? 'pending');
  const bossDisplayCurrent = bossDefeated ? 0 : bossCurrent;
  const bossPct = Math.max(0, Math.min(100, (bossDisplayCurrent / bossMax) * 100));
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
  const isSessionCreator = Boolean(studentId && session?.created_by === studentId);

  const getQuestionTargetName = (question: PeerQuestion) => {
    const raw = String(question.target_member_name || '').trim();
    if (raw && raw !== question.target_member && !looksLikeUid(raw)) {
      return raw;
    }
    return getMemberName(question.target_member);
  };
  const getConceptLabel = (conceptId?: string | null) => {
    const text = String(conceptId || '').trim();
    if (!text) return '';
    const matched = conceptOptions.find((option) => option.id === text);
    if (matched?.title) {
      return `${matched.title} (${matched.id})`;
    }
    return humanizeConceptId(text);
  };

  const currentFeedbackMasteryDelta = feedback?.mastery_delta ?? existingAnswer?.mastery_delta;
  const currentFeedbackUpdatedMastery = feedback?.updated_mastery ?? existingAnswer?.updated_mastery;
  const currentFeedbackMasteryStatus = feedback?.mastery_status ?? existingAnswer?.mastery_status;
  const currentFeedbackConceptId = feedback?.concept_id ?? existingAnswer?.concept_id ?? currentQuestion?.concept_id ?? currentQuestion?.weak_concept;

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

  const showCompletedSummary = session.status === 'completed' && !(battleOutcome === 'victory' && victoryCutsceneActive);

  if (showCompletedSummary) {
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
    const myAnswers = session.answers.filter((a) => a.submitted_by === studentId);
    const myTimeoutRows = timeoutRows.filter((row) => String(row.student_id || '') === studentId);
    const myAnswerMasteryDelta = myAnswers.reduce((sum, answer) => sum + Number(answer.mastery_delta ?? 0), 0);
    const myTimeoutMasteryDelta = myTimeoutRows.reduce((sum, row) => sum + Number(row.mastery_delta ?? 0), 0);
    const myNetMasteryDelta = myAnswerMasteryDelta + myTimeoutMasteryDelta;
    const myLatestMasteryEvent = [
      ...myAnswers
        .filter((answer) => typeof answer.updated_mastery === 'number')
        .map((answer) => ({
          updated_mastery: Number(answer.updated_mastery ?? 0),
          mastery_status: answer.mastery_status ?? null,
          concept_id: answer.concept_id ?? null,
          timestamp: new Date((answer as { submitted_at?: string }).submitted_at || 0).getTime(),
        })),
      ...myTimeoutRows
        .filter((row) => typeof row.updated_mastery === 'number')
        .map((row) => ({
          updated_mastery: Number(row.updated_mastery ?? 0),
          mastery_status: typeof row.mastery_status === 'string' ? row.mastery_status : null,
          concept_id: typeof row.concept_id === 'string' ? row.concept_id : null,
          timestamp: new Date(String(row.applied_at || 0)).getTime(),
        })),
    ]
      .sort((a, b) => {
        const aTime = Number.isFinite(a.timestamp) ? a.timestamp : 0;
        const bTime = Number.isFinite(b.timestamp) ? b.timestamp : 0;
        return bTime - aTime;
      })[0];

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

            <div className={`grid gap-4 ${hasPartyHealth ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-4'}`}>
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
              <div className={`${glassLight} p-4 text-center`}>
                <p className={`text-2xl font-bold ${myNetMasteryDelta >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {myNetMasteryDelta >= 0 ? '+' : ''}{(myNetMasteryDelta * 100).toFixed(1)}
                </p>
                <p className="text-xs text-white/50">Your Mastery Shift</p>
              </div>
            </div>

            {(myAnswers.length > 0 || myTimeoutRows.length > 0) && (
              <div className={`${glassLight} p-4`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">Your mastery changes</p>
                    <p className="text-xs text-white/50">
                      Peer answers now apply smaller BKT updates, so one session cannot instantly master a topic.
                    </p>
                  </div>
                  {typeof myLatestMasteryEvent?.updated_mastery === 'number' && (
                    <div className="text-right">
                      <p className="text-sm font-semibold text-cyan-300">
                        {Math.round(myLatestMasteryEvent.updated_mastery * 100)}%
                      </p>
                      <p className="text-xs text-white/50">
                        {humanizeMasteryStatus(myLatestMasteryEvent.mastery_status)}
                      </p>
                      {myLatestMasteryEvent.concept_id && (
                        <p className="text-xs text-white/50">
                          Node: {getConceptLabel(myLatestMasteryEvent.concept_id)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-emerald-200/80">Answer gains</p>
                    <p className={`mt-1 text-sm font-semibold ${myAnswerMasteryDelta >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {myAnswerMasteryDelta >= 0 ? '+' : ''}{(myAnswerMasteryDelta * 100).toFixed(1)} pts
                    </p>
                  </div>
                  <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-amber-100/80">Timeout penalties</p>
                    <p className={`mt-1 text-sm font-semibold ${myTimeoutMasteryDelta >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {myTimeoutMasteryDelta >= 0 ? '+' : ''}{(myTimeoutMasteryDelta * 100).toFixed(1)} pts
                    </p>
                  </div>
                  <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-cyan-100/80">Net shift</p>
                    <p className={`mt-1 text-sm font-semibold ${myNetMasteryDelta >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {myNetMasteryDelta >= 0 ? '+' : ''}{(myNetMasteryDelta * 100).toFixed(1)} pts
                    </p>
                  </div>
                </div>
                {myTimeoutRows.length > 0 && (
                  <div className="mt-4 space-y-2 rounded-xl border border-amber-400/15 bg-amber-500/[0.08] p-3">
                    <p className="text-xs uppercase tracking-wide text-amber-100/80">Applied timeout penalties</p>
                    {myTimeoutRows.map((row, idx) => (
                      <p key={`${String(row.question_id || 'timeout')}-${idx}`} className="text-xs text-white/70">
                        {typeof row.mastery_delta === 'number' && Number(row.mastery_delta) < 0
                          ? `${(Number(row.mastery_delta) * 100).toFixed(1)} pts`
                          : `${(Number(row.mastery_delta ?? 0) * 100).toFixed(1)} pts`}
                        {' '}on {getConceptLabel(String(row.concept_id || 'current concept'))}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

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
                      Shared prompt inspired by {getQuestionTargetName(q)}&apos;s gap in {q.weak_concept}
                    </p>
                    {answers.length > 0 && (
                      <div className="mt-2 text-sm">
                        {answers.map((a, i) => (
                          <div key={`${a.submitted_by}-${i}`} className="mb-1 text-white/70">
                            <span className="font-medium text-white/90">{getMemberName(a.submitted_by)}:</span>{' '}
                            <BossMarkdown content={a.answer_text} className="inline-block align-top text-white/70" /> ({Math.round(a.score * 100)}%)
                            {typeof a.mastery_delta === 'number' && typeof a.updated_mastery === 'number' && (
                              <span className={`ml-2 text-xs ${a.mastery_delta >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                                mastery {a.mastery_delta >= 0 ? '+' : ''}{(a.mastery_delta * 100).toFixed(1)} pts
                                {' '}{"->"} {Math.round(a.updated_mastery * 100)}%
                                {a.concept_id ? ` on ${getConceptLabel(a.concept_id)}` : ''}
                              </span>
                            )}
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
  const showBossScene =
    session.status === 'active' ||
    session.status === 'waiting' ||
    (battleOutcome === 'victory' && victoryCutsceneActive);

  return (
    <div className="fixed inset-0 bg-slate-950 overflow-hidden text-white">
      {/* ── Fullscreen background ─────────────────────────────────────── */}
      <div className="absolute inset-0 z-0">
        {showBossScene ? (
          <BossBattleScene3D
            healthCurrent={bossDisplayCurrent}
            healthMax={bossMax}
            lobbyId={session.session_id || sessionId}
            forcedBossId={forcedBossId}
            bossAttackTrigger={bossAttackTrigger}
            allowAmbientAttacks={true}
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
              <Heart className={`w-4 h-4 ${bossDefeated ? 'text-emerald-400' : 'text-red-400'}`} />
              <span className="text-sm font-bold text-white">
                {session.boss_name || 'Knowledge Warden'}
              </span>
              {bossDefeated && (
                <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full">DEFEATED</span>
              )}
            </div>
            <span className="text-xs font-mono text-white/60">
              {Math.round(bossDisplayCurrent)} / {Math.round(bossMax)} HP
            </span>
          </div>
          <div className="h-3 w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className={`h-full transition-all duration-700 ease-out rounded-full ${
                bossDefeated
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
                    Shared discussion
                  </span>
                </div>
                <p className="text-xs text-white/40">
                  Inspired by: <span className="text-white/60">{getQuestionTargetName(currentQuestion)}&apos;s gap in {currentQuestion.weak_concept}</span>
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
                      <FluidDropdown
                        ariaLabel="Select knowledge node for this answer"
                        className="w-full"
                        options={conceptDropdownOptions}
                        value={selectedConceptId}
                        onValueChange={setSelectedConceptId}
                        placeholder={autoConceptId || 'Auto fallback (question/topic)'}
                      />
                      <p className="text-[11px] text-white/35">
                        Auto-selected default: <span className="text-white/60">{autoConceptId || 'Current topic'}</span>
                      </p>
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
                    {(currentFeedbackMasteryDelta !== undefined || currentFeedbackUpdatedMastery !== undefined) && (
                      <div
                        className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
                          Number(currentFeedbackMasteryDelta ?? 0) >= 0
                            ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
                            : 'border-rose-400/30 bg-rose-500/10 text-rose-100'
                        }`}
                      >
                        {typeof currentFeedbackMasteryDelta === 'number' && (
                          <p className="font-semibold">
                            Mastery {currentFeedbackMasteryDelta >= 0 ? '+' : ''}{(currentFeedbackMasteryDelta * 100).toFixed(1)} pts
                          </p>
                        )}
                        {typeof currentFeedbackUpdatedMastery === 'number' && (
                          <p className="mt-1 text-white/80">
                            Current mastery: {Math.round(currentFeedbackUpdatedMastery * 100)}% ({humanizeMasteryStatus(currentFeedbackMasteryStatus)})
                          </p>
                        )}
                        {currentFeedbackConceptId && (
                          <p className="mt-1 text-white/80">
                            Updated node: {getConceptLabel(currentFeedbackConceptId)}
                          </p>
                        )}
                      </div>
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

                {(existingAnswer || feedback) && !allMembersAnswered && !bossDefeated && (
                  <p className="text-xs text-amber-300/70 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Waiting for: {waitingMembers.map((m) => getMemberName(m.student_id)).join(', ')}
                  </p>
                )}
                {allMembersAnswered && !bossDefeated && !isSessionCreator && (
                  <p className="text-xs text-cyan-200/75 flex items-center gap-1">
                    <Clock3 className="w-3 h-3" />
                    Waiting for the session creator to continue the shared round.
                  </p>
                )}

                {/* Next question / generate round */}
                {allMembersAnswered && isSessionCreator && session.current_question_index < session.questions.length - 1 && (
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
                {allMembersAnswered && isSessionCreator && session.current_question_index >= session.questions.length - 1 && !bossDefeated && (
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

                {bossDefeated && (
                  <div className="rounded-xl bg-emerald-500/[0.08] border border-emerald-500/20 p-3 text-center">
                    <p className="text-sm text-emerald-300 font-medium">Boss Defeated!</p>
                    <p className="text-xs text-white/40 mt-1">
                      {victoryCutsceneActive ? 'Playing death animation and preparing summary...' : 'Battle resolved. Results are ready.'}
                    </p>
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
