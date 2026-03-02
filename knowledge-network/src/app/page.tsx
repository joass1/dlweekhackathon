'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card } from "@/components/ui/card";
import { BookOpen, AlertTriangle, Target, Maximize2, Minimize2, X, ArrowRight, Sparkles } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import KnowledgeGraph from '@/components/graphs/KnowledgeGraph';
import { useStudentId } from '@/hooks/useStudentId';
import { useAuth } from '@/contexts/AuthContext';
import { useSidebar } from '@/contexts/SidebarContext';
import { CourseOption, DEFAULT_COURSES } from '@/lib/courses';
import { useAuthedApi } from '@/hooks/useAuthedApi';

interface KGNode {
  id: string;
  title: string;
  mastery: number;
  status: 'mastered' | 'learning' | 'weak' | 'not_started';
  courseId?: string;
  category?: string;
  decayTimestamp?: string | null;
}

interface KGLink {
  source: string;
  target: string;
  type: 'prerequisite' | 'related';
}

interface StudentProgress {
  student_id: string;
  total_attempts: number;
  correct_attempts: number;
  accuracy: number;
  careless_count: number;
  conceptual_count: number;
  blind_spots: { found: number; resolved: number };
  self_awareness: { score: number; calibration_gap: number; total_attempts: number };
  concept_mastery: { concept_id: string; mastery: number; attempts: number; correct: number; careless_count: number; last_updated: string | null }[];
  recent_attempts: any[];
  kg_stats: { total_concepts: number; mastered: number; learning: number; weak: number; not_started: number };
}

export default function Page() {
  const [nodes, setNodes] = useState<KGNode[]>([]);
  const [links, setLinks] = useState<KGLink[]>([]);
  const [progress, setProgress] = useState<StudentProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState<CourseOption[]>([{ id: 'all', name: 'All Courses' }, ...DEFAULT_COURSES]);
  const [selectedCourse, setSelectedCourse] = useState('all');
  const [isKGExpanded, setIsKGExpanded] = useState(false);
  const [isNeedsAttentionOpen, setIsNeedsAttentionOpen] = useState(false);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [isCourseProgressOpen, setIsCourseProgressOpen] = useState(false);
  const [showMapLabels, setShowMapLabels] = useState(false);
  const studentId = useStudentId();
  const { user } = useAuth();
  const { setIsCollapsed } = useSidebar();
  const { apiFetchWithAuth } = useAuthedApi();

  const toggleKG = () => {
    const next = !isKGExpanded;
    setIsKGExpanded(next);
    setIsCollapsed(next);
  };

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Student';

  useEffect(() => {
    async function loadData() {
      try {
        const [graphData, courseData, progressData] = await Promise.all([
          apiFetchWithAuth<{ nodes: KGNode[]; links: KGLink[] }>('/api/kg/graph'),
          apiFetchWithAuth<{ courses: CourseOption[] }>('/api/courses').catch(() => ({ courses: DEFAULT_COURSES })),
          apiFetchWithAuth<StudentProgress>(`/api/students/${studentId}/progress`).catch(() => null),
        ]);

        const incoming: CourseOption[] = Array.isArray(courseData.courses) ? courseData.courses : DEFAULT_COURSES;
        setCourses([{ id: 'all', name: 'All Courses' }, ...incoming]);

        setNodes(
          (graphData.nodes ?? []).map((n: any) => ({
            id: String(n.id),
            title: String(n.title ?? n.id),
            mastery: Number(n.mastery ?? 0),
            status: (n.status ?? 'not_started') as KGNode['status'],
            courseId: n.courseId ? String(n.courseId) : undefined,
            category: String(n.category ?? 'General'),
            decayTimestamp: n.decayTimestamp ?? null,
          }))
        );
        setLinks(
          (graphData.links ?? []).map((l: any) => ({
            source: String(l.source),
            target: String(l.target),
            type: l.type === 'prerequisite' ? 'prerequisite' : 'related',
          }))
        );
        if (progressData) setProgress(progressData);
      } catch {
        // Backend unavailable
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [studentId, apiFetchWithAuth]);

  const filteredNodes = useMemo(() => {
    if (selectedCourse === 'all') return nodes;
    const selected = courses.find(c => c.id === selectedCourse);
    if (!selected) return nodes;

    const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const courseNameNorm = normalize(selected.name).replace(/\b\d+\b/g, '').trim();

    return nodes.filter(n => {
      if (n.courseId) return n.courseId === selectedCourse;
      const categoryNorm = normalize(n.category ?? '');
      if (!categoryNorm || !courseNameNorm) return false;
      return categoryNorm === courseNameNorm || categoryNorm.includes(courseNameNorm) || courseNameNorm.includes(categoryNorm);
    });
  }, [nodes, selectedCourse, courses]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map(n => n.id)), [filteredNodes]);
  const linkNodeId = (end: string | { id?: string }) => typeof end === 'string' ? end : String(end?.id ?? '');
  const filteredLinks = useMemo(
    () => links.filter(l => filteredNodeIds.has(linkNodeId(l.source as any)) && filteredNodeIds.has(linkNodeId(l.target as any))),
    [links, filteredNodeIds]
  );

  const kgStats = progress?.kg_stats;
  const mastered = kgStats?.mastered ?? nodes.filter(n => n.status === 'mastered').length;
  const total = kgStats?.total_concepts ?? nodes.length;
  const masteryRate = total > 0 ? Math.round((mastered / total) * 100) : 0;
  const weakCount = kgStats?.weak ?? nodes.filter(n => n.status === 'weak').length;
  const learningCount = kgStats?.learning ?? nodes.filter(n => n.status === 'learning').length;

  const attentionConcepts = useMemo(
    () => nodes
      .filter(n => n.status === 'weak' || n.status === 'learning')
      .sort((a, b) => a.mastery - b.mastery),
    [nodes]
  );

  const attentionTotal = weakCount + learningCount;
  const nextFocusConcept = attentionConcepts[0];
  const totalAttempts = progress?.total_attempts ?? 0;
  const accuracy = progress?.accuracy ?? 0;
  const accuracyPct = Math.round(accuracy * 100);
  const recentAttempts = progress?.recent_attempts ?? [];
  const courseProgress = useMemo(() => {
    const grouped: Record<string, KGNode[]> = {};
    nodes.forEach((n) => {
      const key = n.courseId || n.category || 'General';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(n);
    });

    return Object.entries(grouped)
      .map(([key, courseNodes]) => {
        const course = courses.find(c => c.id === key);
        const masteredCount = courseNodes.filter(n => n.status === 'mastered').length;
        const weakCountForCourse = courseNodes.filter(n => n.status === 'weak').length;
        const totalMastery = courseNodes.reduce((sum, n) => sum + n.mastery, 0);
        const avgMastery = courseNodes.length > 0 ? Math.round(totalMastery / courseNodes.length) : 0;
        return {
          name: course?.name || key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          total: courseNodes.length,
          mastered: masteredCount,
          weak: weakCountForCourse,
          progress: avgMastery,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [nodes, courses]);

  const faded = 'opacity-0 pointer-events-none';
  const visible = 'opacity-100';
  const BounceLoader = ({ size = 20 }: { size?: number }) => (
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
    if (!isNeedsAttentionOpen && !isActivityOpen && !isCourseProgressOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsNeedsAttentionOpen(false);
        setIsActivityOpen(false);
        setIsCourseProgressOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isNeedsAttentionOpen, isActivityOpen, isCourseProgressOpen]);

  return (
    <div className="relative p-6 max-w-7xl mx-auto">
      <div className="pointer-events-none absolute -top-6 -left-10 h-40 w-40 rounded-full bg-cyan-200/40 blur-3xl" />
      <div className="pointer-events-none absolute top-28 right-0 h-56 w-56 rounded-full bg-amber-200/35 blur-3xl" />

      <div className={`space-y-6 transition-opacity duration-300 ${isKGExpanded ? faded : visible}`}>
        <section className="relative overflow-hidden rounded-3xl border border-cyan-200/50 bg-gradient-to-br from-cyan-50 via-sky-50 to-white p-6 shadow-sm">
          <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full border border-cyan-200/80" />
          <div className="pointer-events-none absolute right-16 bottom-0 h-24 w-24 rounded-full bg-cyan-200/30 blur-2xl" />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-cyan-700 mb-2">Mentora Dashboard</p>
              <h1 className="text-3xl md:text-4xl font-bold text-slate-900">Welcome back, {displayName}</h1>
              <p className="text-slate-600 mt-2 max-w-2xl">
                Your learning command center for mastery, attention signals, and concept navigation.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setIsNeedsAttentionOpen(true)}
                className="px-4 py-2 text-sm rounded-full border border-cyan-300/70 bg-white/70 hover:bg-white transition-colors"
              >
                Attention Queue
              </button>
              <button
                type="button"
                onClick={() => setIsActivityOpen(true)}
                className="px-4 py-2 text-sm rounded-full border border-slate-300/70 bg-white/70 hover:bg-white transition-colors"
              >
                Recent Activity
              </button>
              <Link
                href="/study-mission"
                className="px-4 py-2 text-sm rounded-full bg-[#03b2e6] text-white hover:bg-[#029ad0] transition-colors inline-flex items-center gap-1.5"
              >
                Start Mission
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </section>

        <Card className="border-cyan-200/60 bg-gradient-to-r from-cyan-100/70 via-white to-amber-50/80">
          <div className="p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#0289b9] flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5" /> Next Best Action
              </p>
              {loading ? (
                <div className="flex items-center text-sm text-muted-foreground">
                  <span className="mr-2 inline-flex"><BounceLoader size={16} /></span>
                  Preparing your focus queue...
                </div>
              ) : attentionTotal === 0 ? (
                <p className="text-lg font-semibold">You&apos;re on track. Keep momentum with a study mission.</p>
              ) : (
                <p className="text-lg font-semibold">
                  Review {nextFocusConcept?.title ?? `${attentionTotal} concepts`} first, then clear the remaining focus queue.
                </p>
              )}
              {!loading && attentionTotal > 0 && (
                <p className="text-sm text-muted-foreground">
                  {weakCount} weak and {learningCount} learning concepts currently need attention.
                </p>
              )}
            </div>
          </div>
        </Card>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">
          <button
            type="button"
            onClick={() => setIsCourseProgressOpen(true)}
            className="w-full h-full text-left rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open course mastery progress"
          >
            <Card className="p-5 rounded-2xl border-green-200/50 bg-white/90 backdrop-blur h-full min-h-[148px] transition-shadow hover:shadow-md">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Mastery Progress</p>
                  {loading ? (
                    <div className="mt-3 text-muted-foreground"><BounceLoader size={20} /></div>
                  ) : (
                    <>
                      <p className="text-3xl font-bold mt-2">{masteryRate}%</p>
                      <p className="text-sm text-muted-foreground mt-1">{mastered} of {total} concepts mastered</p>
                    </>
                  )}
                </div>
                <div className="p-2.5 rounded-xl bg-green-50">
                  <BookOpen className="h-5 w-5 text-green-500" />
                </div>
              </div>
            </Card>
          </button>

          <button
            type="button"
            onClick={() => setIsNeedsAttentionOpen(true)}
            className="w-full h-full text-left rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open needs attention details"
          >
            <Card className="p-5 rounded-2xl border-amber-200/60 bg-white/90 backdrop-blur h-full min-h-[148px] transition-shadow hover:shadow-md">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Needs Attention</p>
                  {loading ? (
                    <div className="mt-3 text-muted-foreground"><BounceLoader size={20} /></div>
                  ) : (
                    <>
                      <p className="text-3xl font-bold mt-2 text-amber-600">{attentionTotal}</p>
                      <p className="text-sm text-muted-foreground mt-1">{weakCount} weak &middot; {learningCount} learning</p>
                    </>
                  )}
                </div>
                <div className="p-2.5 rounded-xl bg-yellow-50">
                  <AlertTriangle className="h-5 w-5 text-yellow-500" />
                </div>
              </div>
            </Card>
          </button>

          <button
            type="button"
            onClick={() => setIsActivityOpen(true)}
            className="w-full h-full text-left rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open activity history"
          >
            <Card className="p-5 rounded-2xl border-blue-200/60 bg-white/90 backdrop-blur h-full min-h-[148px] transition-shadow hover:shadow-md">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Activity</p>
                  {loading ? (
                    <div className="mt-3 text-muted-foreground"><BounceLoader size={20} /></div>
                  ) : (
                    <>
                      <p className="text-3xl font-bold mt-2">{totalAttempts}</p>
                      <p className="text-sm text-muted-foreground mt-1">{accuracyPct}% accuracy</p>
                    </>
                  )}
                </div>
                <div className="p-2.5 rounded-xl bg-blue-50">
                  <Target className="h-5 w-5 text-blue-500" />
                </div>
              </div>
            </Card>
          </button>
        </section>
      </div>

      <section className={`mt-8 space-y-6 transition-opacity duration-300 ${isKGExpanded ? faded : visible}`}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {progress && progress.self_awareness.total_attempts > 0 && (
            <Card className="rounded-2xl border-indigo-200/60 bg-white/95 p-5">
              <h3 className="font-semibold mb-3">Self-Awareness Score</h3>
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-3xl font-bold text-indigo-600">{Math.round(progress.self_awareness.score * 100)}%</p>
                  <p className="text-xs text-muted-foreground">Confidence calibration</p>
                </div>
                <div className="flex-1">
                  <div className="w-full bg-muted rounded-full h-3">
                    <div className="bg-indigo-500 h-3 rounded-full" style={{ width: `${progress.self_awareness.score * 100}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>Over-confident</span>
                    <span>Well-calibrated</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">{(progress.self_awareness.calibration_gap * 100).toFixed(0)}% gap</p>
                  <p className="text-xs text-muted-foreground">{progress.self_awareness.total_attempts} rated</p>
                </div>
              </div>
            </Card>
          )}

          {progress && progress.total_attempts > 0 && (
            <Card className="rounded-2xl border-orange-200/60 bg-white/95 p-5">
              <h3 className="font-semibold mb-3">Mistake Breakdown</h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-green-600">{progress.correct_attempts}</p>
                  <p className="text-xs text-muted-foreground">Correct</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-orange-600">{progress.careless_count}</p>
                  <p className="text-xs text-muted-foreground">Careless</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-600">{progress.conceptual_count}</p>
                  <p className="text-xs text-muted-foreground">Conceptual</p>
                </div>
              </div>
            </Card>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 mt-8">
        <div
          className={`group transition-all duration-300 ${
            isKGExpanded ? 'fixed inset-8 z-40' : ''
          }`}
        >
          <Card className="overflow-hidden h-full flex flex-col rounded-3xl border-cyan-200/50 bg-white/95 backdrop-blur">
            <div className="p-5 border-b bg-gradient-to-r from-cyan-50 to-sky-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">Knowledge Map</h3>
                <p className="text-xs text-slate-600 mt-1">Explore dependencies and identify suggested start points quickly.</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={selectedCourse}
                  onChange={e => setSelectedCourse(e.target.value)}
                  className="text-sm p-2 border border-cyan-200 rounded-xl bg-white"
                >
                  {courses.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowMapLabels(prev => !prev)}
                  className="text-xs px-3 py-2 rounded-xl border border-cyan-200 hover:bg-cyan-50 transition-colors"
                >
                  {showMapLabels ? 'Hide Labels' : 'Show Labels'}
                </button>
                <button
                  onClick={toggleKG}
                  className="p-2 rounded-xl border border-cyan-200 hover:bg-cyan-50 text-muted-foreground"
                  title={isKGExpanded ? 'Collapse' : 'Expand'}
                  aria-label={isKGExpanded ? 'Collapse knowledge map' : 'Expand knowledge map'}
                >
                  {isKGExpanded
                    ? <Minimize2 className="w-4 h-4" />
                    : <Maximize2 className="w-4 h-4" />
                  }
                </button>
              </div>
            </div>
            <div className={`${isKGExpanded ? 'flex-1 min-h-0' : 'h-[620px]'}`}>
              {loading ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  <span className="mr-2 inline-flex"><BounceLoader size={20} /></span> Loading knowledge graph...
                </div>
              ) : (
                <KnowledgeGraph
                  nodes={filteredNodes.map(n => ({
                    id: n.id,
                    title: n.title,
                    mastery: n.mastery,
                    status: n.status,
                    lastReviewed: '',
                    decayRate: 0,
                    category: n.category ?? 'General',
                  }))}
                  links={filteredLinks}
                  showLabels={showMapLabels}
                />
              )}
            </div>
          </Card>
        </div>
      </div>

      {isNeedsAttentionOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setIsNeedsAttentionOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Needs attention details"
            className="w-full max-w-2xl max-h-[80vh] bg-card rounded-xl shadow-xl border overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Needs Attention</h3>
                <p className="text-sm text-muted-foreground">Concepts that are weak or still learning</p>
              </div>
              <button
                type="button"
                onClick={() => setIsNeedsAttentionOpen(false)}
                className="p-1 rounded hover:bg-accent text-muted-foreground"
                aria-label="Close needs attention details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto max-h-[calc(80vh-72px)]">
              {loading ? (
                <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                  <span className="mr-2 inline-flex"><BounceLoader size={20} /></span>
                  Loading concepts...
                </div>
              ) : attentionConcepts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No concepts currently need attention.</p>
              ) : (
                <div className="space-y-3">
                  {attentionConcepts.map((concept) => (
                    <div key={concept.id} className="border rounded-lg p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium">{concept.title}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          concept.status === 'weak' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {concept.status === 'weak' ? 'Weak' : 'Learning'}
                        </span>
                      </div>
                      <div className="mt-2">
                        <div className="w-full bg-muted rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${
                              concept.mastery >= 70 ? 'bg-green-500' : concept.mastery >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${concept.mastery}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Mastery: {concept.mastery}%</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isActivityOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setIsActivityOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Recent activity history"
            className="w-full max-w-2xl max-h-[80vh] bg-card rounded-xl shadow-xl border overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Recent Activity</h3>
                <p className="text-sm text-muted-foreground">Your latest assessment outcomes</p>
              </div>
              <button
                type="button"
                onClick={() => setIsActivityOpen(false)}
                className="p-1 rounded hover:bg-accent text-muted-foreground"
                aria-label="Close activity history"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto max-h-[calc(80vh-72px)]">
              {loading ? (
                <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                  <span className="mr-2 inline-flex"><BounceLoader size={20} /></span>
                  Loading activity...
                </div>
              ) : recentAttempts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No activity yet. Take an assessment to generate history.</p>
              ) : (
                <div className="space-y-2">
                  {recentAttempts.slice(-12).reverse().map((attempt, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm border rounded-lg p-3">
                      <span className={`w-2 h-2 rounded-full ${attempt.is_correct ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="flex-1 truncate">{attempt.concept || 'Assessment'}</span>
                      {attempt.mistake_type && attempt.mistake_type !== 'normal' && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                          attempt.mistake_type === 'careless' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {attempt.mistake_type}
                        </span>
                      )}
                      <span className={`text-xs ${attempt.is_correct ? 'text-green-600' : 'text-red-600'}`}>
                        {attempt.is_correct ? 'Correct' : 'Incorrect'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isCourseProgressOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setIsCourseProgressOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Knowledge graph progress by course"
            className="w-full max-w-2xl max-h-[80vh] bg-card rounded-xl shadow-xl border overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Knowledge Graph Progress By Course</h3>
                <p className="text-sm text-muted-foreground">Course-level mastery breakdown</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCourseProgressOpen(false)}
                className="p-1 rounded hover:bg-accent text-muted-foreground"
                aria-label="Close course progress"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[calc(80vh-72px)]">
              {loading ? (
                <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                  <span className="mr-2 inline-flex"><BounceLoader size={18} /></span>
                  Loading course progress...
                </div>
              ) : courseProgress.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No course data yet. Upload materials to get started.</p>
              ) : (
                <div className="space-y-3">
                  {courseProgress.map((course, index) => (
                    <div key={index} className="rounded-xl border border-cyan-100 p-4">
                      <div className="flex justify-between items-center mb-3">
                        <div>
                          <h4 className="font-medium">{course.name}</h4>
                          <p className="text-xs text-muted-foreground">{course.total} concepts</p>
                        </div>
                        <p className="font-semibold">{course.progress}%</p>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2 mb-2">
                        <div className="bg-[#03b2e6] h-2 rounded-full" style={{ width: `${course.progress}%` }} />
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-green-600">{course.mastered} mastered</span>
                        <span className="text-red-600">{course.weak} weak</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
