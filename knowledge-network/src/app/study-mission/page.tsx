'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Clock, Play, Pause, RotateCcw, CheckCircle, AlertTriangle, BookOpen, Rocket, TrendingUp, ShieldAlert, GitBranch, Layers, ChevronLeft, ChevronRight, Repeat, Minus, Plus } from 'lucide-react';
import Link from 'next/link';
import { useAuthedApi } from '@/hooks/useAuthedApi';
import Image from 'next/image';
import { CourseOption } from '@/lib/courses';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

interface StudyPlanItem {
  concept_id: string;
  title: string;
  estimated_minutes: number;
  score: number;
  factors: {
    gap_severity: number;
    prereq_depth: number;
    decay_risk: number;
    careless_frequency: number;
  };
  mastery: number;
}

interface StudyPlanResponse {
  minutes_requested: number;
  minutes_allocated: number;
  remaining_minutes: number;
  selected_concepts: StudyPlanItem[];
  mission_briefing: string;
}

interface KGNode {
  id: string;
  title: string;
  mastery: number;
  status: string;
  courseId?: string;
  category?: string;
  decayTimestamp?: string | null;
  attempts?: number;
  careless_count?: number;
}

interface KGLink {
  source: string;
  target: string;
  type: string;
}

type PlanMode = 'grade_boost' | 'foundation_repair';

interface Flashcard {
  id: string;
  conceptId: string;
  front: string;
  back: string;
  tags: string[];
}

interface StudyMissionGeneratedFlashcard {
  id?: string;
  concept_id?: string;
  front?: string;
  back?: string;
  tags?: string[];
  source?: string;
}

const STUDY_MISSION_TIMER_KEY = 'mentora:studyMissionTimer';
const STUDY_MISSION_SESSION_KEY = 'mentora:studyMissionSession';
const getReasonTags = (concept: StudyPlanItem) => {
  const tags: string[] = [];
  if (concept.factors.gap_severity >= 0.55) tags.push('Gap');
  if (concept.factors.prereq_depth >= 2) tags.push('Prereq');
  if (concept.factors.decay_risk >= 0.45) tags.push('Decay');
  if (concept.factors.careless_frequency >= 0.35) tags.push('Careless');
  return tags.length > 0 ? tags : ['Priority'];
};

const sanitizeText = (value: string) => value.replace(/\s+/g, ' ').trim();

interface PersistedStudyMissionSession {
  version: 1;
  missionStarted: boolean;
  missionActive: boolean;
  studyMinutes: number;
  flashcardCount: number;
  timeRemaining: number;
  timerEndsAt: number | null;
  selectedCourse: string;
  planMode: PlanMode;
  confidenceTrapEnabled: boolean;
  studyPlan: StudyPlanResponse | null;
  missionBriefing: string;
  currentConceptIndex: number;
  completedConceptIds: string[];
  currentFlashcardIndex: number;
  isFlashcardFlipped: boolean;
}

export default function StudyMissionPage() {
  const pageShellClass = 'relative min-h-full overflow-hidden';
  const pageContentClass = 'relative z-10 p-6 max-w-7xl mx-auto overflow-x-hidden text-white';
  const surfaceCardClass = 'rounded-3xl border border-white/20 bg-slate-900/45 backdrop-blur-xl shadow-[0_24px_60px_-24px_rgba(2,6,23,0.85)] text-white';

  const router = useRouter();
  const [missionActive, setMissionActive] = useState(false);
  const [studyMinutes, setStudyMinutes] = useState(25);
  const [flashcardCount, setFlashcardCount] = useState(20);
  const [timeRemaining, setTimeRemaining] = useState(25 * 60);
  const [timerEndsAt, setTimerEndsAt] = useState<number | null>(null);
  const [currentConceptIndex, setCurrentConceptIndex] = useState(0);
  const [completedConcepts, setCompletedConcepts] = useState<Set<string>>(new Set());
  const [missionStarted, setMissionStarted] = useState(false);
  const [studyPlan, setStudyPlan] = useState<StudyPlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missionBriefing, setMissionBriefing] = useState('');
  const [planMode, setPlanMode] = useState<PlanMode>('grade_boost');
  const [confidenceTrapEnabled, setConfidenceTrapEnabled] = useState(true);
  const [trapConcept, setTrapConcept] = useState<StudyPlanItem | null>(null);
  const [trapConfidence, setTrapConfidence] = useState<number | null>(null);
  const [trapReflection, setTrapReflection] = useState('');
  const [trapError, setTrapError] = useState<string | null>(null);
  const [courses, setCourses] = useState<CourseOption[]>([{ id: 'all', name: 'All Courses' }]);
  const [selectedCourse, setSelectedCourse] = useState('all');
  const [currentFlashcardIndex, setCurrentFlashcardIndex] = useState(0);
  const [isFlashcardFlipped, setIsFlashcardFlipped] = useState(false);
  const [hasTimedOutRedirected, setHasTimedOutRedirected] = useState(false);
  const [generatedFlashcards, setGeneratedFlashcards] = useState<Flashcard[]>([]);
  const [isLoadingFlashcards, setIsLoadingFlashcards] = useState(false);
  const [hasHydratedSession, setHasHydratedSession] = useState(false);

  const { loading: authLoading, user } = useAuth();
  const { apiFetchWithAuth } = useAuthedApi();
  const BounceLoader = ({ size = 18 }: { size?: number }) => (
    <Image
      src="/logo-images/favicon.png"
      alt="Loading"
      width={size}
      height={size}
      className="animate-bounce"
      priority
    />
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const raw = window.localStorage.getItem(STUDY_MISSION_SESSION_KEY);
      if (!raw) {
        setHasHydratedSession(true);
        return;
      }

      const parsed = JSON.parse(raw) as Partial<PersistedStudyMissionSession>;
      if (typeof parsed.studyMinutes === 'number' && parsed.studyMinutes > 0) {
        setStudyMinutes(parsed.studyMinutes);
      }
      if (typeof parsed.flashcardCount === 'number' && parsed.flashcardCount > 0) {
        setFlashcardCount(Math.max(1, Math.min(70, Math.round(parsed.flashcardCount))));
      }
      if (typeof parsed.selectedCourse === 'string' && parsed.selectedCourse.trim()) {
        setSelectedCourse(parsed.selectedCourse);
      }
      if (parsed.planMode === 'grade_boost' || parsed.planMode === 'foundation_repair') {
        setPlanMode(parsed.planMode);
      }
      if (typeof parsed.confidenceTrapEnabled === 'boolean') {
        setConfidenceTrapEnabled(parsed.confidenceTrapEnabled);
      }
      if (typeof parsed.missionStarted === 'boolean') {
        setMissionStarted(parsed.missionStarted);
      }
      if (parsed.studyPlan && Array.isArray(parsed.studyPlan.selected_concepts)) {
        setStudyPlan(parsed.studyPlan);
      }
      if (typeof parsed.missionBriefing === 'string') {
        setMissionBriefing(parsed.missionBriefing);
      }
      if (typeof parsed.currentConceptIndex === 'number' && parsed.currentConceptIndex >= 0) {
        setCurrentConceptIndex(parsed.currentConceptIndex);
      }
      if (Array.isArray(parsed.completedConceptIds)) {
        setCompletedConcepts(new Set(parsed.completedConceptIds.map((id) => String(id))));
      }
      if (typeof parsed.currentFlashcardIndex === 'number' && parsed.currentFlashcardIndex >= 0) {
        setCurrentFlashcardIndex(parsed.currentFlashcardIndex);
      }
      if (typeof parsed.isFlashcardFlipped === 'boolean') {
        setIsFlashcardFlipped(parsed.isFlashcardFlipped);
      }

      const remaining =
        typeof parsed.timeRemaining === 'number' && parsed.timeRemaining >= 0
          ? parsed.timeRemaining
          : null;
      if (remaining !== null) {
        setTimeRemaining(remaining);
      }

      if (typeof parsed.timerEndsAt === 'number' && parsed.timerEndsAt > Date.now() && parsed.missionActive) {
        setTimerEndsAt(parsed.timerEndsAt);
        setMissionActive(true);
        setTimeRemaining(Math.max(0, Math.ceil((parsed.timerEndsAt - Date.now()) / 1000)));
      } else {
        setTimerEndsAt(null);
        if (typeof parsed.missionActive === 'boolean') {
          setMissionActive(false);
        }
      }
    } catch {
      // Ignore malformed persisted session; continue with defaults.
    } finally {
      setHasHydratedSession(true);
    }
  }, []);

  useEffect(() => {
    if (!missionActive || !timerEndsAt) return;

    const syncRemaining = () => {
      const secondsLeft = Math.max(0, Math.ceil((timerEndsAt - Date.now()) / 1000));
      setTimeRemaining(secondsLeft);
      if (secondsLeft <= 0) {
        setMissionActive(false);
        setTimerEndsAt(null);
      }
    };

    syncRemaining();
    const interval = setInterval(syncRemaining, 1000);
    return () => clearInterval(interval);
  }, [missionActive, timerEndsAt]);

  useEffect(() => {
    if (typeof window === 'undefined' || !hasHydratedSession) return;
    const isTimerActive = missionActive && timerEndsAt !== null && timeRemaining > 0;
    if (!isTimerActive) {
      window.localStorage.removeItem(STUDY_MISSION_TIMER_KEY);
      return;
    }

    const snapshot = {
      active: true,
      endAt: timerEndsAt,
      selectedCourse,
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(STUDY_MISSION_TIMER_KEY, JSON.stringify(snapshot));
  }, [hasHydratedSession, missionActive, selectedCourse, timeRemaining, timerEndsAt]);

  useEffect(() => {
    if (typeof window === 'undefined' || !hasHydratedSession) return;

    const shouldClearSessionCache =
      !missionStarted &&
      !missionActive &&
      studyPlan === null &&
      !missionBriefing &&
      completedConcepts.size === 0 &&
      currentConceptIndex === 0 &&
      currentFlashcardIndex === 0 &&
      !isFlashcardFlipped;

    if (shouldClearSessionCache) {
      window.localStorage.removeItem(STUDY_MISSION_SESSION_KEY);
      return;
    }

    const sessionSnapshot: PersistedStudyMissionSession = {
      version: 1,
      missionStarted,
      missionActive,
      studyMinutes,
      flashcardCount,
      timeRemaining,
      timerEndsAt,
      selectedCourse,
      planMode,
      confidenceTrapEnabled,
      studyPlan,
      missionBriefing,
      currentConceptIndex,
      completedConceptIds: Array.from(completedConcepts),
      currentFlashcardIndex,
      isFlashcardFlipped,
    };
    window.localStorage.setItem(STUDY_MISSION_SESSION_KEY, JSON.stringify(sessionSnapshot));
  }, [
    completedConcepts,
    confidenceTrapEnabled,
    currentConceptIndex,
    currentFlashcardIndex,
    hasHydratedSession,
    isFlashcardFlipped,
    missionActive,
    missionBriefing,
    missionStarted,
    planMode,
    selectedCourse,
    flashcardCount,
    studyMinutes,
    studyPlan,
    timeRemaining,
    timerEndsAt,
  ]);

  const clearStudyMissionCache = () => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(STUDY_MISSION_TIMER_KEY);
    window.localStorage.removeItem(STUDY_MISSION_SESSION_KEY);
  };

  const resetMissionToLanding = () => {
    setMissionActive(false);
    setTimerEndsAt(null);
    setMissionStarted(false);
    setStudyPlan(null);
    setMissionBriefing('');
    setCurrentConceptIndex(0);
    setCompletedConcepts(new Set());
    setCurrentFlashcardIndex(0);
    setIsFlashcardFlipped(false);
    setGeneratedFlashcards([]);
    setIsLoadingFlashcards(false);
    setTrapConcept(null);
    setTrapConfidence(null);
    setTrapReflection('');
    setTrapError(null);
    setTimeRemaining(studyMinutes * 60);
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setCourses([{ id: 'all', name: 'All Courses' }]);
      setSelectedCourse('all');
      return;
    }
    let cancelled = false;
    const fetchCourses = async () => {
      try {
        const courseData = await apiFetchWithAuth<{ courses?: CourseOption[] }>('/api/courses');
        if (cancelled) return;
        const incoming = Array.isArray(courseData?.courses) ? courseData.courses : [];
        const options = [{ id: 'all', name: 'All Courses' }, ...incoming];
        setCourses(options);
        setSelectedCourse((prev) => {
          if (options.some((course) => course.id === prev)) return prev;
          return options[1]?.id ?? 'all';
        });
      } catch {
        if (cancelled) return;
        const fallback = [{ id: 'all', name: 'All Courses' }];
        setCourses(fallback);
        setSelectedCourse('all');
      }
    };
    void fetchCourses();
    return () => {
      cancelled = true;
    };
  }, [apiFetchWithAuth, authLoading, user]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const clampStudyMinutes = (value: number) => Math.max(1, Math.min(60, value));
  const clampFlashcardCount = (value: number) => Math.max(1, Math.min(70, value));

  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const belongsToCourse = (node: Pick<KGNode, 'courseId' | 'category'>, course: CourseOption) => {
    if (node.courseId) return node.courseId === course.id;
    const categoryNorm = normalize(node.category ?? '');
    const courseNameNorm = normalize(course.name).replace(/\b\d+\b/g, '').trim();
    if (!categoryNorm || !courseNameNorm) return false;
    return (
      categoryNorm === courseNameNorm ||
      categoryNorm.includes(courseNameNorm) ||
      courseNameNorm.includes(categoryNorm)
    );
  };

  const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
  const normalizedMastery = (concept: StudyPlanItem) => {
    const masteryValue = Number(concept.mastery ?? 0);
    if (!Number.isFinite(masteryValue)) return 0;
    return clamp01(masteryValue <= 1 ? masteryValue : masteryValue / 100);
  };
  const conceptPriorityScore = (concept: StudyPlanItem) => {
    const explicit = Number(concept.score ?? 0);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;

    const gapSeverity = clamp01(Number(concept.factors.gap_severity ?? 0));
    const prereqDepthNorm = clamp01((Number(concept.factors.prereq_depth ?? 0)) / 4);
    const decayRisk = clamp01(Number(concept.factors.decay_risk ?? 0));
    const careless = clamp01(Number(concept.factors.careless_frequency ?? 0));
    const masteryGap = 1 - normalizedMastery(concept);

    // Fallback priority model when planner score is missing/zero.
    return (
      gapSeverity * 0.45 +
      prereqDepthNorm * 0.2 +
      decayRisk * 0.2 +
      careless * 0.1 +
      masteryGap * 0.05
    );
  };

  const rankConcepts = (items: StudyPlanItem[], mode: PlanMode) => {
    const ranked = [...items];
    ranked.sort((a, b) => {
      if (mode === 'foundation_repair') {
        const aFoundationScore =
          a.factors.prereq_depth * 1.6 + a.factors.gap_severity * 1.4 + a.factors.decay_risk * 0.8;
        const bFoundationScore =
          b.factors.prereq_depth * 1.6 + b.factors.gap_severity * 1.4 + b.factors.decay_risk * 0.8;
        if (bFoundationScore !== aFoundationScore) return bFoundationScore - aFoundationScore;
        return a.mastery - b.mastery;
      }

      const aBoostFactor = a.mastery >= 0.35 && a.mastery <= 0.85 ? 1.2 : 1;
      const bBoostFactor = b.mastery >= 0.35 && b.mastery <= 0.85 ? 1.2 : 1;
      const aROI = (conceptPriorityScore(a) * aBoostFactor) / Math.max(1, a.estimated_minutes);
      const bROI = (conceptPriorityScore(b) * bBoostFactor) / Math.max(1, b.estimated_minutes);
      if (bROI !== aROI) return bROI - aROI;
      return conceptPriorityScore(b) - conceptPriorityScore(a);
    });
    return ranked;
  };

  const rankedConcepts = useMemo(
    () => rankConcepts(studyPlan?.selected_concepts ?? [], planMode),
    [planMode, studyPlan?.selected_concepts]
  );

  const missionBuckets = useMemo(() => {
    const mustDo: StudyPlanItem[] = [];
    const niceToDo: StudyPlanItem[] = [];
    let minutesPlanned = 0;

    for (const concept of rankedConcepts) {
      const estimate = Math.max(1, concept.estimated_minutes);
      if (minutesPlanned + estimate <= studyMinutes) {
        mustDo.push(concept);
        minutesPlanned += estimate;
      } else {
        niceToDo.push(concept);
      }
    }

    // Ensure at least one recommendation is always available.
    if (mustDo.length === 0 && rankedConcepts.length > 0) {
      mustDo.push(rankedConcepts[0]);
      niceToDo.shift();
      minutesPlanned = Math.max(1, rankedConcepts[0].estimated_minutes);
    }

    return { mustDo, niceToDo, minutesPlanned };
  }, [rankedConcepts, studyMinutes]);

  const concepts = [...missionBuckets.mustDo, ...missionBuckets.niceToDo];

  const roiPerMinute = (concept: StudyPlanItem) => {
    const adjustedScore = planMode === 'grade_boost'
      ? conceptPriorityScore(concept) * (concept.mastery >= 0.35 && concept.mastery <= 0.85 ? 1.2 : 1)
      : conceptPriorityScore(concept);
    return (adjustedScore * 100) / Math.max(1, concept.estimated_minutes);
  };

  const reviewedMustDo = missionBuckets.mustDo.filter(c => completedConcepts.has(c.concept_id)).length;
  const missionProgress = missionBuckets.mustDo.length > 0
    ? Math.round((reviewedMustDo / missionBuckets.mustDo.length) * 100)
    : 0;
  const missionSpentSeconds = Math.max(0, studyMinutes * 60 - timeRemaining);
  const projectedImpact = missionBuckets.mustDo.length > 0
    ? Math.round(
        missionBuckets.mustDo.reduce((sum, concept) => sum + conceptPriorityScore(concept) * 100, 0) /
          missionBuckets.mustDo.length
      )
    : 0;
  const selectedCourseName = courses.find((course) => course.id === selectedCourse)?.name ?? 'All Courses';
  const flashcardConcepts = useMemo(() => {
    const seen = new Set<string>();
    const ordered = [...missionBuckets.mustDo];
    return ordered.filter((concept) => {
      if (seen.has(concept.concept_id)) return false;
      seen.add(concept.concept_id);
      return true;
    });
  }, [missionBuckets.mustDo]);
  const flashcardConceptIds = useMemo(
    () => flashcardConcepts.map((concept) => concept.concept_id),
    [flashcardConcepts]
  );
  const flashcardConceptKey = useMemo(() => flashcardConceptIds.join('|'), [flashcardConceptIds]);
  const flashcardTagsByConcept = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const concept of flashcardConcepts) {
      map.set(concept.concept_id, getReasonTags(concept));
    }
    return map;
  }, [flashcardConcepts]);

  useEffect(() => {
    if (!missionStarted) {
      setGeneratedFlashcards([]);
      setIsLoadingFlashcards(false);
      return;
    }

    let cancelled = false;
    const loadFlashcardsFromAiAgent = async () => {
      setIsLoadingFlashcards(true);
      try {
        const requestedCards = Math.max(1, Math.min(70, flashcardCount));
        const response = await apiFetchWithAuth<{ flashcards?: StudyMissionGeneratedFlashcard[] }>('/api/study-mission/flashcards', {
          method: 'POST',
          body: JSON.stringify({
            course_id: selectedCourse,
            concept_ids: flashcardConceptIds,
            num_cards: requestedCards,
            chunk_limit: Math.min(400, requestedCards * 6),
          }),
        });

        if (cancelled) return;

        const agentCards = Array.isArray(response?.flashcards) ? response.flashcards : [];
        const cards: Flashcard[] = [];
        const seenPrompts = new Set<string>();

        for (let i = 0; i < agentCards.length; i += 1) {
          const row = agentCards[i];
          const front = sanitizeText(String(row.front || ''));
          const backRaw = sanitizeText(String(row.back || ''));
          if (!front) continue;

          const back = backRaw.toLowerCase().startsWith('correct answer:')
            ? backRaw
            : `Correct answer: ${backRaw || 'Not available'}`;
          const conceptId = sanitizeText(String(row.concept_id || 'course-material')) || 'course-material';
          const conceptTags = flashcardTagsByConcept.get(conceptId) ?? ['Course'];
          const llmTags = Array.isArray(row.tags)
            ? row.tags.map((tag) => sanitizeText(String(tag))).filter(Boolean)
            : [];
          const tags = [...new Set([...conceptTags, ...llmTags])].slice(0, 5);

          const dedupeKey = `${front.toLowerCase()}|${back.toLowerCase()}`;
          if (seenPrompts.has(dedupeKey)) continue;
          seenPrompts.add(dedupeKey);

          cards.push({
            id: sanitizeText(String(row.id || `ai-${i + 1}`)) || `ai-${i + 1}`,
            conceptId,
            front,
            back,
            tags: tags.length > 0 ? tags : ['AI', 'Flashcard'],
          });
          if (cards.length >= requestedCards) break;
        }

        if (cards.length === 0) {
          for (const concept of flashcardConcepts) {
            cards.push({
              id: `${concept.concept_id}-agent-fallback`,
              conceptId: concept.concept_id,
              front: `Explain the core idea of "${concept.title}" in one sentence.`,
              back: 'Correct answer: Use the most accurate definition from your uploaded materials.',
              tags: getReasonTags(concept),
            });
          }
        }

        if (cards.length > 0 && cards.length < requestedCards) {
          const baseCards = [...cards];
          let cloneIndex = 0;
          while (cards.length < requestedCards) {
            const source = baseCards[cloneIndex % baseCards.length];
            cards.push({
              ...source,
              id: `${source.id}-repeat-${cloneIndex + 1}`,
            });
            cloneIndex += 1;
          }
        }

        if (!cancelled) {
          setGeneratedFlashcards(cards);
        }
      } catch {
        if (!cancelled) {
          setGeneratedFlashcards([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingFlashcards(false);
        }
      }
    };

    void loadFlashcardsFromAiAgent();
    return () => {
      cancelled = true;
    };
  }, [
    apiFetchWithAuth,
    flashcardConceptIds,
    flashcardConceptKey,
    flashcardConcepts,
    flashcardCount,
    flashcardTagsByConcept,
    missionStarted,
    selectedCourse,
  ]);

  const flashcards = generatedFlashcards;
  const activeFlashcard = flashcards[currentFlashcardIndex] ?? null;

  useEffect(() => {
    setCurrentFlashcardIndex(0);
    setIsFlashcardFlipped(false);
  }, [flashcards.length]);

  const assessmentDestination = selectedCourse && selectedCourse !== 'all'
    ? `/assessment?courseId=${encodeURIComponent(selectedCourse)}`
    : '/assessment';

  useEffect(() => {
    if (!missionStarted || hasTimedOutRedirected || timeRemaining > 0) return;
    setHasTimedOutRedirected(true);
    clearStudyMissionCache();
    resetMissionToLanding();
    router.push(assessmentDestination);
  }, [assessmentDestination, hasTimedOutRedirected, missionStarted, router, timeRemaining]);

  const triggerTrapCheck = (concept: StudyPlanItem) => {
    setTrapConcept(concept);
    setTrapConfidence(null);
    setTrapReflection('');
    setTrapError(null);
  };

  const markComplete = async (conceptId: string) => {
    setCompletedConcepts(prev => {
      const updated = new Set(prev);
      updated.add(conceptId);
      const nextIndex = concepts.findIndex(
        (concept, index) => index > currentConceptIndex && !updated.has(concept.concept_id)
      );
      if (nextIndex >= 0) setCurrentConceptIndex(nextIndex);
      return updated;
    });

    // Update mastery in knowledge graph
    try {
      await apiFetchWithAuth('/api/kg/update_mastery', {
        method: 'POST',
        body: JSON.stringify({ concept_id: conceptId, is_correct: true, is_careless: false }),
      });
    } catch {
      // Non-fatal: mastery update is best-effort during study session
    }
  };

  const handleMarkReviewed = (concept: StudyPlanItem) => {
    if (completedConcepts.has(concept.concept_id)) return;
    const requiresTrap = confidenceTrapEnabled && concept.factors.careless_frequency >= 0.35;
    if (requiresTrap) {
      triggerTrapCheck(concept);
      return;
    }
    void markComplete(concept.concept_id);
  };

  const submitTrapCheck = () => {
    if (!trapConcept) return;
    if (trapConfidence === null) {
      setTrapError('Select your confidence level before finishing this concept.');
      return;
    }
    if (trapReflection.trim().length < 10) {
      setTrapError('Add a brief reflection (at least 10 characters) before continuing.');
      return;
    }
    const conceptId = trapConcept.concept_id;
    setTrapConcept(null);
    setTrapConfidence(null);
    setTrapReflection('');
    setTrapError(null);
    void markComplete(conceptId);
  };

  const handleToggleMissionActive = () => {
    if (missionActive) {
      if (timerEndsAt) {
        const secondsLeft = Math.max(0, Math.ceil((timerEndsAt - Date.now()) / 1000));
        setTimeRemaining(secondsLeft);
      }
      setMissionActive(false);
      setTimerEndsAt(null);
      return;
    }

    if (timeRemaining <= 0) return;
    setTimerEndsAt(Date.now() + timeRemaining * 1000);
    setMissionActive(true);
  };

  const handleResetTimer = () => {
    setTimeRemaining(studyMinutes * 60);
    setMissionActive(false);
    setTimerEndsAt(null);
  };

  const handleEndSessionEarly = () => {
    setHasTimedOutRedirected(true);
    clearStudyMissionCache();
    resetMissionToLanding();
    router.push(assessmentDestination);
  };

  const startMission = async () => {
    setLoading(true);
    setError(null);
    setHasTimedOutRedirected(false);
    setGeneratedFlashcards([]);
    setIsLoadingFlashcards(false);

    try {
      // 1. Fetch the knowledge graph to get concept states
      const graphData = await apiFetchWithAuth<{ nodes: KGNode[]; links: KGLink[] }>('/api/kg/graph');
      const nodes = graphData.nodes ?? [];
      const links = graphData.links ?? [];

      const selectedCourseMeta = courses.find((course) => course.id === selectedCourse) ?? null;
      const scopedNodes =
        selectedCourseMeta && selectedCourseMeta.id !== 'all'
          ? nodes.filter((node) => belongsToCourse(node, selectedCourseMeta))
          : nodes;

      if (scopedNodes.length === 0) {
        setError(
          selectedCourseMeta && selectedCourseMeta.id !== 'all'
            ? `No concepts found for ${selectedCourseMeta.name}. Upload materials for this course first.`
            : 'No concepts found. Upload course materials first to build your knowledge graph.'
        );
        setLoading(false);
        return;
      }
      const scopedNodeIds = new Set(scopedNodes.map((node) => String(node.id)));

      // Filter to concepts that need work (not mastered)
      const studyCandidates = scopedNodes.filter(
        n => n.status !== 'mastered' && n.status !== 'not_started'
      );

      if (studyCandidates.length === 0) {
        // If no concepts in progress, include all non-mastered
        studyCandidates.push(...scopedNodes.filter(n => n.status !== 'mastered'));
      }

      if (planMode === 'grade_boost') {
        const easyWins = studyCandidates.filter((n) => n.mastery >= 25 && n.mastery <= 85);
        if (easyWins.length > 0) {
          studyCandidates.splice(0, studyCandidates.length, ...easyWins);
        }
      } else {
        studyCandidates.sort((a, b) => a.mastery - b.mastery);
      }

      if (studyCandidates.length === 0) {
        setError('No concepts found. Upload course materials first to build your knowledge graph.');
        setLoading(false);
        return;
      }

      // 2. Build prerequisite map from links
      const prerequisites: Record<string, string[]> = {};
      for (const link of links) {
        const src = typeof link.source === 'string' ? link.source : String(link.source);
        const tgt = typeof link.target === 'string' ? link.target : String(link.target);
        if (!scopedNodeIds.has(src) || !scopedNodeIds.has(tgt)) continue;
        if (link.type === 'prerequisite') {
          if (!prerequisites[tgt]) prerequisites[tgt] = [];
          prerequisites[tgt].push(src);
        }
      }

      // 3. Call the study plan API
      const plan = await apiFetchWithAuth<StudyPlanResponse>('/api/adaptive/planner/study-plan', {
        method: 'POST',
        body: JSON.stringify({
          minutes: studyMinutes,
          concepts: studyCandidates.map(n => ({
            concept_id: n.id,
            title: n.title,
            mastery: n.mastery / 100, // Backend expects 0-1 range
            decay_rate: 0.02,
            attempts: n.attempts ?? 0,
            careless_count: n.careless_count ?? 0,
            estimated_minutes: 10,
          })),
          prerequisites,
        }),
      });

      setStudyPlan(plan);
      setMissionBriefing(plan.mission_briefing);
      setTimeRemaining(studyMinutes * 60);
      setTimerEndsAt(Date.now() + studyMinutes * 60 * 1000);
      setCurrentConceptIndex(0);
      setCompletedConcepts(new Set());
      setMissionStarted(true);
      setMissionActive(true);
    } catch (err) {
      console.error('Failed to generate study plan:', err);
      setError('Could not generate a study plan. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const renderConceptCard = (concept: StudyPlanItem, lane: 'must' | 'optional') => {
    const masteryPct = Math.round(concept.mastery * 100);
    const isWeak = masteryPct < 40;
    const decayRisk = concept.factors.decay_risk;
    const globalIndex = concepts.findIndex((c) => c.concept_id === concept.concept_id);
    const isCurrent = globalIndex === currentConceptIndex && missionActive;
    const isDone = completedConcepts.has(concept.concept_id);

    return (
      <Card
        key={concept.concept_id}
        className={`${surfaceCardClass} p-4 transition-all ${
          isCurrent ? 'ring-2 ring-[#03b2e6] bg-[#03b2e6]/18' :
          isDone ? 'opacity-65' : ''
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`w-3 h-3 rounded-full ${isWeak ? 'bg-red-500' : 'bg-yellow-500'}`} />
              <h3 className="font-semibold">{concept.title}</h3>
              {lane === 'optional' && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">If time remains</span>
              )}
              {getReasonTags(concept).map((tag) => (
                <span key={`${concept.concept_id}-${tag}`} className="text-xs px-2 py-0.5 rounded-full bg-[#03b2e6]/10 text-[#0287ba]">
                  {tag}
                </span>
              ))}
              {decayRisk > 0.5 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Decaying
                </span>
              )}
            </div>

            <div className="flex items-center gap-4 text-sm text-white/75 mb-2 flex-wrap">
              <span>Mastery: {masteryPct}%</span>
              <span>~{concept.estimated_minutes} min</span>
              <span>ROI: {roiPerMinute(concept).toFixed(1)}/min</span>
            </div>

            <div className="w-full bg-white/15 rounded-full h-1.5 mb-2 max-w-xs">
              <div
                className={`h-1.5 rounded-full ${
                  masteryPct >= 70 ? 'bg-green-500' : masteryPct >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{ width: `${masteryPct}%` }}
              />
            </div>

            <div className="flex gap-4 text-xs text-white/65 flex-wrap">
              <span>Gap: {(concept.factors.gap_severity * 100).toFixed(0)}%</span>
              <span>Prereq depth: {concept.factors.prereq_depth}</span>
              <span>Decay risk: {(concept.factors.decay_risk * 100).toFixed(0)}%</span>
              <span>Careless freq: {(concept.factors.careless_frequency * 100).toFixed(0)}%</span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <button
              onClick={() => handleMarkReviewed(concept)}
              disabled={isDone}
              className={`px-4 py-2 rounded-full text-sm flex-shrink-0 ${
                isDone
                  ? 'bg-emerald-500/25 text-emerald-100'
                  : 'bg-[#03b2e6] text-white hover:bg-[#029ad0]'
              }`}
            >
              {isDone ? (
                <span className="flex items-center gap-1"><CheckCircle className="w-4 h-4" /> Done</span>
              ) : (
                'Mark Reviewed'
              )}
            </button>
            <Link
              href="/ai-assistant"
              className="text-xs text-[#03b2e6] hover:text-[#03b2e6] flex items-center gap-1"
            >
              <BookOpen className="w-3 h-3" /> Study with Tutor
            </Link>
          </div>
        </div>
      </Card>
    );
  };

  if (!missionStarted) {
    return (
      <div className={pageShellClass}>
        <div
          className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/backgrounds/castleviews.jpg')" }}
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-0 bg-slate-950/45" aria-hidden />
        <div className="pointer-events-none absolute -left-24 top-20 h-72 w-72 rounded-full bg-[#03b2e6]/20 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute right-[-5rem] top-[-4rem] h-80 w-80 rounded-full bg-amber-400/15 blur-3xl" aria-hidden />
        <div className={pageContentClass}>
          <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold flex items-center gap-2 mb-2">
          <Rocket className="w-6 h-6 text-[#03b2e6]" />
          Study Mission
        </h1>
        <p className="text-white/75 mb-8">
          Tell us how much time you have. Mentora will create an optimized study queue
          prioritized by knowledge gap severity, prerequisite depth, and decay risk.
        </p>

        <Card className={`${surfaceCardClass} p-6`}>
          <h2 className="font-semibold mb-3 text-white">Select Course</h2>
          <div className="mb-6">
            <select
              value={selectedCourse}
              onChange={(event) => setSelectedCourse(event.target.value)}
              className="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-sm text-white backdrop-blur-sm focus:border-[#03b2e6] focus:outline-none"
            >
              {courses.map((course) => (
                <option key={course.id} value={course.id} className="text-slate-900">
                  {course.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-white/70 mt-2">
              Study Mission and flashcards will be generated for this course.
            </p>
          </div>

          <h2 className="font-semibold mb-4 text-white">How much time do you have?</h2>
          <div className="mb-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-2 py-1">
              <button
                type="button"
                onClick={() => setStudyMinutes((prev) => clampStudyMinutes(prev - 1))}
                className="h-8 w-8 inline-flex items-center justify-center rounded-full border border-white/30 text-white hover:border-[#03b2e6] hover:text-[#03b2e6] transition-colors"
                aria-label="Decrease study minutes"
              >
                <Minus className="w-4 h-4" />
              </button>

              <input
                type="number"
                min={1}
                max={60}
                value={studyMinutes}
                onChange={(event) => {
                  const raw = Number(event.target.value);
                  if (!Number.isFinite(raw)) return;
                  setStudyMinutes(clampStudyMinutes(Math.round(raw)));
                }}
                className="w-16 bg-transparent text-center text-sm font-semibold text-white focus:outline-none"
                aria-label="Study minutes"
              />
              <span className="text-xs text-white/70 pr-1">mins</span>

              <button
                type="button"
                onClick={() => setStudyMinutes((prev) => clampStudyMinutes(prev + 1))}
                className="h-8 w-8 inline-flex items-center justify-center rounded-full border border-white/30 text-white hover:border-[#03b2e6] hover:text-[#03b2e6] transition-colors"
                aria-label="Increase study minutes"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-white/70 mt-2">Set anywhere from 1 to 60 minutes.</p>
          </div>

          <h2 className="font-semibold mb-4 text-white">How many flashcards should we generate?</h2>
          <div className="mb-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-2 py-1">
              <button
                type="button"
                onClick={() => setFlashcardCount((prev) => clampFlashcardCount(prev - 1))}
                className="h-8 w-8 inline-flex items-center justify-center rounded-full border border-white/30 text-white hover:border-[#03b2e6] hover:text-[#03b2e6] transition-colors"
                aria-label="Decrease flashcard count"
              >
                <Minus className="w-4 h-4" />
              </button>

              <input
                type="number"
                min={1}
                max={70}
                value={flashcardCount}
                onChange={(event) => {
                  const raw = Number(event.target.value);
                  if (!Number.isFinite(raw)) return;
                  setFlashcardCount(clampFlashcardCount(Math.round(raw)));
                }}
                className="w-16 bg-transparent text-center text-sm font-semibold text-white focus:outline-none"
                aria-label="Flashcard count"
              />
              <span className="text-xs text-white/70 pr-1">cards</span>

              <button
                type="button"
                onClick={() => setFlashcardCount((prev) => clampFlashcardCount(prev + 1))}
                className="h-8 w-8 inline-flex items-center justify-center rounded-full border border-white/30 text-white hover:border-[#03b2e6] hover:text-[#03b2e6] transition-colors"
                aria-label="Increase flashcard count"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-white/70 mt-2">Choose between 1 and 70 flashcards.</p>
          </div>

          <h3 className="text-sm font-semibold mb-2">Choose your mission strategy</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <button
              onClick={() => setPlanMode('grade_boost')}
              className={`rounded-xl border p-3 text-left transition-colors ${
                planMode === 'grade_boost'
                  ? 'border-[#03b2e6] bg-[#03b2e6]/20'
                  : 'border-white/20 bg-white/5 hover:border-[#03b2e6]/40'
              }`}
            >
              <p className="font-medium flex items-center gap-2"><TrendingUp className="w-4 h-4 text-[#03b2e6]" /> Grade Boost Path</p>
              <p className="text-xs text-white/70 mt-1">Optimize for fastest score gains per minute.</p>
            </button>
            <button
              onClick={() => setPlanMode('foundation_repair')}
              className={`rounded-xl border p-3 text-left transition-colors ${
                planMode === 'foundation_repair'
                  ? 'border-[#03b2e6] bg-[#03b2e6]/20'
                  : 'border-white/20 bg-white/5 hover:border-[#03b2e6]/40'
              }`}
            >
              <p className="font-medium flex items-center gap-2"><GitBranch className="w-4 h-4 text-[#03b2e6]" /> Foundation Repair Path</p>
              <p className="text-xs text-white/70 mt-1">Fix deepest prerequisite gaps first.</p>
            </button>
          </div>

          <div className="flex items-center justify-between bg-white/5 border border-white/15 rounded-lg px-4 py-3 mb-6">
            <div>
              <p className="text-sm font-medium flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-[#03b2e6]" /> Confidence Trap Mode</p>
              <p className="text-xs text-white/70">Adds a quick reflection check on careless-risk concepts.</p>
            </div>
            <button
              onClick={() => setConfidenceTrapEnabled((prev) => !prev)}
              className={`px-3 py-1 rounded-full text-xs font-medium ${
                confidenceTrapEnabled ? 'bg-[#03b2e6] text-white' : 'bg-gray-200 text-gray-700'
              }`}
            >
              {confidenceTrapEnabled ? 'On' : 'Off'}
            </button>
          </div>

          <div className="bg-white/5 border border-white/15 rounded-lg p-4 mb-6">
            <h3 className="text-sm font-medium mb-2">Mission Preview</h3>
            <p className="text-sm text-white/80">
              {planMode === 'grade_boost'
                ? `You selected Grade Boost for ${selectedCourseName}. In ${studyMinutes} minutes, we prioritize high ROI concepts with fast payoff and generate ${flashcardCount} flashcards.`
                : `You selected Foundation Repair for ${selectedCourseName}. In ${studyMinutes} minutes, we prioritize root prerequisite gaps first and generate ${flashcardCount} flashcards.`}
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            onClick={startMission}
            disabled={loading}
            className="w-full py-3 bg-[#03b2e6] text-white rounded-full hover:bg-[#029ad0] font-medium flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <><BounceLoader size={16} /> Generating Study Plan...</>
            ) : (
              <><Play className="w-4 h-4" /> Start {studyMinutes}-Minute Mission</>
            )}
          </button>
        </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={pageShellClass}>
    <div
      className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: "url('/backgrounds/castleviews.jpg')" }}
      aria-hidden
    />
    <div className="pointer-events-none absolute inset-0 bg-slate-950/45" aria-hidden />
    <div className="pointer-events-none absolute -left-20 top-16 h-72 w-72 rounded-full bg-[#03b2e6]/18 blur-3xl" aria-hidden />
    <div className="pointer-events-none absolute right-[-5rem] top-[-5rem] h-96 w-96 rounded-full bg-amber-400/12 blur-3xl" aria-hidden />
    <div className={pageContentClass}>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Rocket className="w-6 h-6 text-[#03b2e6]" />
            Study Mission
          </h1>
          <p className="text-white/75 text-sm">AI-prioritized concepts based on your knowledge graph</p>
          <p className="text-xs text-white/70 mt-1">Course: <span className="font-medium text-white">{selectedCourseName}</span></p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => setPlanMode('grade_boost')}
              className={`px-3 py-1.5 rounded-full text-xs border ${
                planMode === 'grade_boost' ? 'bg-[#03b2e6] text-white border-[#03b2e6]' : 'border-white/30 text-white hover:border-[#03b2e6]'
              }`}
            >
              Grade Boost
            </button>
            <button
              onClick={() => setPlanMode('foundation_repair')}
              className={`px-3 py-1.5 rounded-full text-xs border ${
                planMode === 'foundation_repair' ? 'bg-[#03b2e6] text-white border-[#03b2e6]' : 'border-white/30 text-white hover:border-[#03b2e6]'
              }`}
            >
              Foundation Repair
            </button>
          </div>
        </div>

        <Card className={`${surfaceCardClass} p-4 text-center min-w-[200px]`}>
          <div className="flex items-center justify-center gap-1 text-xs text-white/70 mb-1">
            <Clock className="w-3 h-3" /> Time Remaining
          </div>
          <p className={`text-4xl font-mono font-bold mb-2 ${timeRemaining < 60 ? 'text-red-600' : ''}`}>
            {formatTime(timeRemaining)}
          </p>
          <div className="flex gap-2 justify-center">
            <button onClick={handleToggleMissionActive}
              className="px-4 py-2 bg-[#03b2e6] text-white rounded-full hover:bg-[#029ad0] flex items-center gap-1 text-sm">
              {missionActive ? <><Pause className="w-4 h-4" /> Pause</> : <><Play className="w-4 h-4" /> Resume</>}
            </button>
            <button onClick={handleResetTimer}
              className="px-3 py-2 border rounded-lg hover:bg-accent">
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={handleEndSessionEarly}
            className="mt-2 w-full rounded-full border border-red-300/40 px-3 py-2 text-xs font-medium text-red-200 hover:bg-red-500/20"
          >
            End Session &amp; Take Quiz
          </button>
          <p className="text-[11px] text-white/65 mt-2">
            At timer end, you&apos;ll be redirected to assessment for this course.
          </p>
        </Card>
      </div>

      {/* Mission Briefing */}
      {missionBriefing && (
        <Card className={`${surfaceCardClass} p-4 mb-6 bg-[#03b2e6]/15 border-[#03b2e6]/35`}>
          <p className="text-sm text-white/90">{missionBriefing}</p>
        </Card>
      )}

      <Card className={`${surfaceCardClass} p-4 mb-6`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[#03b2e6] font-semibold">Limited Time Focus</p>
            <h2 className="text-lg font-semibold mt-1">
              {planMode === 'grade_boost' ? 'Grade Boost Path' : 'Foundation Repair Path'}
            </h2>
            <p className="text-sm text-white/75 mt-1">
              Must-do concepts fit within your budget: <span className="font-medium text-white">{missionBuckets.minutesPlanned}/{studyMinutes} min</span>.
              {' '}Expected mission impact: <span className="font-medium text-white">{projectedImpact}%</span>.
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-white/70">Time spent</p>
            <p className="font-semibold">{formatTime(missionSpentSeconds)}</p>
            <p className="text-xs text-white/70 mt-1">
              Trap mode: <span className="font-medium text-white">{confidenceTrapEnabled ? 'On' : 'Off'}</span>
            </p>
          </div>
        </div>
      </Card>

      <Card className={`${surfaceCardClass} p-4 mb-6`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#03b2e6]" />
            Course Flashcards
          </h3>
          <span className="text-xs text-white/70">
            {flashcards.length === 0 ? '0/0' : `${currentFlashcardIndex + 1}/${flashcards.length}`}
          </span>
        </div>

        {isLoadingFlashcards ? (
          <div className="min-h-[180px] flex flex-col items-center justify-center text-sm text-white/70">
            <BounceLoader size={20} />
            <p className="mt-2">AI agent is generating flashcards from your uploaded course chunks...</p>
          </div>
        ) : activeFlashcard ? (
          <>
            <button
              type="button"
              onClick={() => setIsFlashcardFlipped((prev) => !prev)}
              className="w-full rounded-2xl text-left [perspective:1000px]"
              aria-label={isFlashcardFlipped ? 'Show flashcard question side' : 'Show flashcard answer side'}
            >
              <div
                className={`relative min-h-[260px] transition-transform duration-500 [transform-style:preserve-3d] ${
                  isFlashcardFlipped ? '[transform:rotateY(180deg)]' : ''
                }`}
              >
                <div className="absolute inset-0 rounded-2xl border border-[#03b2e6]/25 bg-gradient-to-br from-[#e0f4fb] to-white p-5 [backface-visibility:hidden]">
                  <p className="text-xs uppercase tracking-[0.12em] text-[#0287ba] font-semibold mb-2">Front</p>
                  <div className="whitespace-pre-line text-sm text-slate-700">
                    {activeFlashcard.front}
                  </div>
                  <div className="mt-4 flex gap-2 flex-wrap">
                    {activeFlashcard.tags.map((tag) => (
                      <span key={`${activeFlashcard.id}-front-${tag}`} className="text-[11px] px-2 py-0.5 rounded-full bg-[#03b2e6]/10 text-[#0287ba]">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="absolute inset-0 rounded-2xl border border-[#03b2e6]/25 bg-gradient-to-br from-[#e0f4fb] to-white p-5 [transform:rotateY(180deg)] [backface-visibility:hidden]">
                  <div className="text-sm text-slate-700">
                    {activeFlashcard.back}
                  </div>
                </div>
              </div>
            </button>

            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCurrentFlashcardIndex((prev) => Math.max(0, prev - 1));
                    setIsFlashcardFlipped(false);
                  }}
                  disabled={currentFlashcardIndex === 0}
                  className="px-3 py-1.5 rounded-full border text-xs disabled:opacity-50"
                >
                  <span className="inline-flex items-center gap-1"><ChevronLeft className="w-3 h-3" /> Prev</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCurrentFlashcardIndex((prev) => Math.min(flashcards.length - 1, prev + 1));
                    setIsFlashcardFlipped(false);
                  }}
                  disabled={currentFlashcardIndex >= flashcards.length - 1}
                  className="px-3 py-1.5 rounded-full border text-xs disabled:opacity-50"
                >
                  <span className="inline-flex items-center gap-1">Next <ChevronRight className="w-3 h-3" /></span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsFlashcardFlipped((prev) => !prev)}
                className="px-3 py-1.5 rounded-full border text-xs"
              >
                <span className="inline-flex items-center gap-1"><Repeat className="w-3 h-3" /> Flip</span>
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-white/70">
            No flashcards yet. Start a mission to generate a deck for {selectedCourseName}.
          </p>
        )}
      </Card>

      <Card className={`${surfaceCardClass} p-4 mb-6`}>
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[#03b2e6]" />
          Minute ROI Market
        </h3>
        {rankedConcepts.length === 0 ? (
          <p className="text-sm text-white/70">No concepts ranked yet.</p>
        ) : (
          <div className="space-y-2">
            {rankedConcepts.slice(0, 5).map((concept, index) => (
              <div key={`${concept.concept_id}-roi`} className="flex items-center justify-between gap-4 text-sm border border-white/15 bg-white/5 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium truncate">{index + 1}. {concept.title}</p>
                  <p className="text-xs text-white/65">
                    {concept.estimated_minutes} min | reasons: {getReasonTags(concept).join(', ')}
                  </p>
                </div>
                <p className="font-semibold text-[#03b2e6] whitespace-nowrap">{roiPerMinute(concept).toFixed(1)}/min</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Progress */}
      <div className="mb-6">
        <div className="flex justify-between text-sm mb-1">
          <span>{reviewedMustDo}/{missionBuckets.mustDo.length} must-do concepts reviewed</span>
          <span>{missionProgress}% complete</span>
        </div>
        <div className="w-full bg-white/15 rounded-full h-2">
          <div className="bg-[#03b2e6] h-2 rounded-full transition-all"
            style={{ width: `${missionProgress}%` }} />
        </div>
      </div>

      <div className="space-y-6">
        <section>
          <h3 className="font-semibold mb-3">Do Now ({missionBuckets.mustDo.length})</h3>
          <div className="space-y-4">
            {missionBuckets.mustDo.length === 0 ? (
              <Card className={`${surfaceCardClass} p-4 text-sm text-white/70`}>No must-do concepts generated yet.</Card>
            ) : (
              missionBuckets.mustDo.map((concept) => renderConceptCard(concept, 'must'))
            )}
          </div>
        </section>

        {missionBuckets.niceToDo.length > 0 && (
          <section>
            <h3 className="font-semibold mb-3">If Time Remains ({missionBuckets.niceToDo.length})</h3>
            <div className="space-y-4">
              {missionBuckets.niceToDo.map((concept) => renderConceptCard(concept, 'optional'))}
            </div>
          </section>
        )}
      </div>

      {/* Session complete */}
      {missionBuckets.mustDo.length > 0 && reviewedMustDo === missionBuckets.mustDo.length && (
        <Card className={`${surfaceCardClass} mt-6 p-6 bg-[#03b2e6]/15 border-[#03b2e6]/35 text-center`}>
          <CheckCircle className="w-12 h-12 text-[#03b2e6] mx-auto mb-3" />
          <h2 className="text-xl font-bold text-white mb-2">Mission Complete!</h2>
          <p className="text-[#03b2e6] mb-4">
            You completed all must-do concepts in {Math.ceil(missionSpentSeconds / 60)} minutes.
          </p>
          <div className="flex justify-center gap-3">
            <Link href="/knowledge-map" className="px-4 py-2 bg-[#03b2e6] text-white rounded-full hover:bg-[#029ad0] text-sm">
              View Knowledge Map
            </Link>
            <Link href="/assessment" className="px-4 py-2 border border-[#03b2e6] text-[#7adfff] rounded-full hover:bg-[#03b2e6]/15 text-sm">
              Take Assessment
            </Link>
          </div>
        </Card>
      )}

      {trapConcept && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setTrapConcept(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confidence trap checkpoint"
            className="w-full max-w-lg bg-white rounded-xl border shadow-xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="font-semibold flex items-center gap-2 mb-2">
              <ShieldAlert className="w-4 h-4 text-[#03b2e6]" />
              Confidence Trap Check
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Before marking <span className="font-medium text-foreground">{trapConcept.title}</span> complete,
              rate your confidence and note what mistake you will avoid next time.
            </p>

            <div className="mb-4">
              <p className="text-sm font-medium mb-2">Confidence</p>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((level) => (
                  <button
                    key={level}
                    onClick={() => setTrapConfidence(level)}
                    className={`px-3 py-1.5 rounded-full text-sm border ${
                      trapConfidence === level
                        ? 'bg-[#03b2e6] text-white border-[#03b2e6]'
                        : 'border-gray-300 hover:border-[#03b2e6]'
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <label className="text-sm font-medium block mb-2">Reflection</label>
              <textarea
                value={trapReflection}
                onChange={(event) => setTrapReflection(event.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm min-h-[90px]"
                placeholder="Example: I often skip edge-case checks before locking in my answer."
              />
            </div>

            {trapError && (
              <p className="text-xs text-red-600 mb-3">{trapError}</p>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setTrapConcept(null)}
                className="px-4 py-2 rounded-full border border-gray-300 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={submitTrapCheck}
                className="px-4 py-2 rounded-full bg-[#03b2e6] text-white text-sm hover:bg-[#029ad0]"
              >
                Confirm & Mark Reviewed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
