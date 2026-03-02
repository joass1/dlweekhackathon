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
  const recentAttempts = progress?.recent_attempts ?? [];

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
    if (!isNeedsAttentionOpen && !isActivityOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsNeedsAttentionOpen(false);
        setIsActivityOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isNeedsAttentionOpen, isActivityOpen]);

  return (
    <div className="p-6 max-w-7xl mx-auto relative">
      <div className={`space-y-6 transition-opacity duration-300 ${isKGExpanded ? faded : visible}`}>
        <section>
          <h1 className="text-3xl font-bold">Welcome back, {displayName}</h1>
          <p className="text-muted-foreground mt-1">Here&apos;s your learning overview</p>
        </section>

        <Card className="border-[#03b2e6]/30 bg-gradient-to-r from-[#03b2e6]/10 via-card to-card">
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

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setIsNeedsAttentionOpen(true)}
                className="px-4 py-2 text-sm rounded-full border hover:bg-accent transition-colors"
              >
                View Attention List
              </button>
              <Link
                href="/study-mission"
                className="px-4 py-2 text-sm rounded-full bg-[#03b2e6] text-white hover:bg-[#029ad0] transition-colors inline-flex items-center gap-1.5"
              >
                Start Study Mission
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </Card>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">
          <Card className="p-5 h-full min-h-[140px]">
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

          <button
            type="button"
            onClick={() => setIsNeedsAttentionOpen(true)}
            className="w-full h-full text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open needs attention details"
          >
            <Card className="p-5 h-full min-h-[140px] transition-shadow hover:shadow-md">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Needs Attention</p>
                  {loading ? (
                    <div className="mt-3 text-muted-foreground"><BounceLoader size={20} /></div>
                  ) : (
                    <>
                      <p className="text-3xl font-bold mt-2 text-yellow-600">{attentionTotal}</p>
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
            className="w-full h-full text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open activity history"
          >
            <Card className="p-5 h-full min-h-[140px] transition-shadow hover:shadow-md">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Activity</p>
                  {loading ? (
                    <div className="mt-3 text-muted-foreground"><BounceLoader size={20} /></div>
                  ) : (
                    <>
                      <p className="text-3xl font-bold mt-2">{totalAttempts}</p>
                      <p className="text-sm text-muted-foreground mt-1">{Math.round(accuracy * 100)}% accuracy</p>
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

      <div className="grid grid-cols-1 gap-6 mt-8">
        <div
          className={`group transition-all duration-300 ${
            isKGExpanded ? 'fixed inset-8 z-40' : ''
          }`}
        >
          <Card className="overflow-hidden h-full flex flex-col">
            <div className="p-4 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="font-semibold">Knowledge Map</h3>
                <p className="text-xs text-muted-foreground mt-1">Use labels toggle for a cleaner map when many topics are present.</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={selectedCourse}
                  onChange={e => setSelectedCourse(e.target.value)}
                  className="text-sm p-1.5 border rounded-lg bg-card"
                >
                  {courses.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowMapLabels(prev => !prev)}
                  className="text-xs px-2.5 py-1.5 rounded-lg border hover:bg-accent transition-colors"
                >
                  {showMapLabels ? 'Hide Labels' : 'Show Labels'}
                </button>
                <button
                  onClick={toggleKG}
                  className="p-1 rounded hover:bg-accent text-muted-foreground"
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
            <div className={`${isKGExpanded ? 'flex-1 min-h-0' : 'h-[680px]'}`}>
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
    </div>
  );
}
