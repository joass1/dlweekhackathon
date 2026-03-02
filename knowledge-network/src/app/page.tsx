'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card } from "@/components/ui/card";
import { BookOpen, AlertTriangle, Loader2, Target, Maximize2, Minimize2 } from 'lucide-react';
import Link from 'next/link';
import KnowledgeGraph from '@/components/graphs/KnowledgeGraph';
import { useStudentId } from '@/hooks/useStudentId';
import { useAuth } from '@/contexts/AuthContext';
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
  const studentId = useStudentId();
  const { user } = useAuth();
  const { apiFetchWithAuth } = useAuthedApi();

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

  const weakConcepts = nodes.filter(n => n.status === 'weak' || n.status === 'learning')
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 5);

  const priorityConcepts = weakConcepts.map(n => ({
    name: n.title,
    mastery: n.mastery,
    status: n.status as 'weak' | 'learning',
    decayDays: n.decayTimestamp
      ? Math.max(0, Math.round((new Date(n.decayTimestamp).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : 99,
  }));

  const totalAttempts = progress?.total_attempts ?? 0;
  const accuracy = progress?.accuracy ?? 0;

  const faded = 'opacity-0 pointer-events-none';
  const visible = 'opacity-100';

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Welcome Section */}
      <div className={`mb-8 transition-opacity duration-300 ${isKGExpanded ? faded : visible}`}>
        <h1 className="text-3xl font-bold">Welcome back, {displayName}</h1>
        <p className="text-muted-foreground mt-1">Here&apos;s your learning overview</p>
      </div>

      {/* Stats Row — 3 key metrics */}
      <div className={`grid grid-cols-1 md:grid-cols-3 gap-5 mb-8 transition-opacity duration-300 ${isKGExpanded ? faded : visible}`}>
        <Card className="p-6">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Mastery Progress</p>
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin mt-3 text-muted-foreground" />
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

        <Card className="p-6">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Needs Attention</p>
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin mt-3 text-muted-foreground" />
              ) : (
                <>
                  <p className="text-3xl font-bold mt-2 text-yellow-600">{weakCount + learningCount}</p>
                  <p className="text-sm text-muted-foreground mt-1">{weakCount} weak &middot; {learningCount} learning</p>
                </>
              )}
            </div>
            <div className="p-2.5 rounded-xl bg-yellow-50">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Activity</p>
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin mt-3 text-muted-foreground" />
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
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Knowledge Map — expands to fixed viewport card */}
        <div
          className={`group lg:col-span-3 transition-all duration-300 ${
            isKGExpanded ? 'fixed inset-8 z-40' : ''
          }`}
        >
          <Card className="overflow-hidden h-full flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="font-semibold">Knowledge Map</h3>
              <div className="flex items-center gap-3">
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
                  onClick={() => setIsKGExpanded(v => !v)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 rounded hover:bg-accent text-muted-foreground"
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
            <div className={`${isKGExpanded ? 'flex-1 min-h-0' : 'h-[380px]'}`}>
              {loading ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading knowledge graph...
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
                />
              )}
            </div>
          </Card>
        </div>

        {/* Right Column — fades out when KG is expanded */}
        <div className={`lg:col-span-2 space-y-6 transition-opacity duration-300 ${isKGExpanded ? faded : visible}`}>
          {/* Priority Concepts */}
          <Card>
            <div className="p-4 border-b">
              <h3 className="font-semibold">Priority Concepts</h3>
              <p className="text-xs text-muted-foreground">Ranked by gap severity</p>
            </div>
            <div className="p-4 space-y-3">
              {loading ? (
                <div className="text-center py-4"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>
              ) : priorityConcepts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No concepts to review. Upload materials to get started!</p>
              ) : (
                priorityConcepts.map((concept, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      concept.status === 'weak' ? 'bg-red-500' : 'bg-yellow-500'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{concept.name}</p>
                      <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                        <div className={`h-1.5 rounded-full ${
                          concept.mastery >= 70 ? 'bg-green-500' : concept.mastery >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                        }`} style={{ width: `${concept.mastery}%` }} />
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground flex-shrink-0">{concept.mastery}%</span>
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Recent Activity */}
          {progress && progress.recent_attempts.length > 0 && (
            <Card>
              <div className="p-4 border-b">
                <h3 className="font-semibold">Recent Activity</h3>
              </div>
              <div className="p-4 space-y-2">
                {progress.recent_attempts.slice(-5).reverse().map((attempt, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className={`w-2 h-2 rounded-full ${attempt.is_correct ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="flex-1 truncate">{attempt.concept || 'Assessment'}</span>
                    {attempt.mistake_type && attempt.mistake_type !== 'normal' && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        attempt.mistake_type === 'careless' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'
                      }`}>{attempt.mistake_type}</span>
                    )}
                    <span className={`text-xs ${attempt.is_correct ? 'text-green-600' : 'text-red-600'}`}>
                      {attempt.is_correct ? 'Correct' : 'Incorrect'}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Quick Actions */}
          <Card>
            <div className="p-4 border-b">
              <h3 className="font-semibold">Quick Actions</h3>
            </div>
            <div className="p-4 space-y-2">
              <Link href="/study-mission" className="block w-full p-3 bg-[#03b2e6] text-white rounded-full hover:bg-[#029ad0] text-center text-sm font-medium transition-colors">
                Start Study Mission
              </Link>
              <Link href="/upload" className="block w-full p-3 border border-[#03b2e6] text-[#03b2e6] rounded-full hover:bg-[#03b2e6]/5 text-center text-sm font-medium transition-colors">
                Upload Course Materials
              </Link>
              <Link href="/assessment" className="block w-full p-3 border rounded-full hover:bg-accent text-center text-sm font-medium transition-colors">
                Take an Assessment
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
