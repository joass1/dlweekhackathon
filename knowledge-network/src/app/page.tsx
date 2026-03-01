'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card } from "@/components/ui/card";
import { BookOpen, AlertTriangle, Flame, Rocket, ArrowRight, Loader2, Target, Brain, Eye } from 'lucide-react';
import Link from 'next/link';
import KnowledgeGraph from '@/components/graphs/KnowledgeGraph';
import { apiFetch, getStudentId } from '@/services/api';

interface KGNode {
  id: string;
  title: string;
  mastery: number;
  status: 'mastered' | 'learning' | 'weak' | 'not_started';
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
  const studentId = useMemo(() => getStudentId(), []);

  useEffect(() => {
    async function loadData() {
      try {
        // Load KG graph and student progress in parallel
        const [graphData, progressData] = await Promise.all([
          apiFetch<{ nodes: KGNode[]; links: KGLink[] }>('/api/kg/graph'),
          apiFetch<StudentProgress>(`/api/students/${studentId}/progress`).catch(() => null),
        ]);

        setNodes(
          (graphData.nodes ?? []).map((n: any) => ({
            id: String(n.id),
            title: String(n.title ?? n.id),
            mastery: Number(n.mastery ?? 0),
            status: (n.status ?? 'not_started') as KGNode['status'],
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
  }, [studentId]);

  // Use Firebase progress data when available, fall back to KG-computed stats
  const kgStats = progress?.kg_stats;
  const mastered = kgStats?.mastered ?? nodes.filter(n => n.status === 'mastered').length;
  const total = kgStats?.total_concepts ?? nodes.length;
  const masteryRate = total > 0 ? Math.round((mastered / total) * 100) : 0;
  const weakCount = kgStats?.weak ?? nodes.filter(n => n.status === 'weak').length;
  const learningCount = kgStats?.learning ?? nodes.filter(n => n.status === 'learning').length;

  const now = Date.now();
  const needsReview = weakCount + nodes.filter(n => {
    if (!n.decayTimestamp || n.status === 'mastered' || n.status === 'weak') return false;
    return new Date(n.decayTimestamp).getTime() < now;
  }).length;

  const weakConcepts = nodes.filter(n => n.status === 'weak' || n.status === 'learning')
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 5);

  const priorityConcepts = weakConcepts.map(n => ({
    name: n.title,
    mastery: n.mastery,
    status: n.status as 'weak' | 'learning',
    decayDays: n.decayTimestamp
      ? Math.max(0, Math.round((new Date(n.decayTimestamp).getTime() - now) / (1000 * 60 * 60 * 24)))
      : 99,
  }));

  const totalAttempts = progress?.total_attempts ?? 0;
  const accuracy = progress?.accuracy ?? 0;
  const blindSpots = progress?.blind_spots ?? { found: 0, resolved: 0 };
  const selfAwareness = progress?.self_awareness ?? { score: 0, calibration_gap: 0, total_attempts: 0 };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">LearnGraph AI Dashboard</h1>
        <p className="text-sm text-gray-500">Your adaptive learning companion</p>
      </div>

      {/* Row 1: KG Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Card className="p-5">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-medium text-sm text-muted-foreground">Concepts Mastered</h3>
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin mt-2 text-gray-400" />
              ) : (
                <>
                  <p className="text-2xl font-bold mt-1">{mastered}<span className="text-base font-normal text-gray-400">/{total}</span></p>
                  <p className="text-sm text-green-600">{masteryRate}% mastery rate</p>
                </>
              )}
            </div>
            <BookOpen className="h-5 w-5 text-green-500" />
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-medium text-sm text-muted-foreground">Need Review</h3>
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin mt-2 text-gray-400" />
              ) : (
                <>
                  <p className="text-2xl font-bold mt-1 text-yellow-600">{needsReview}</p>
                  <p className="text-sm text-yellow-600">{needsReview > 0 ? 'Concepts need attention' : 'All caught up!'}</p>
                </>
              )}
            </div>
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-medium text-sm text-muted-foreground">Weak Concepts</h3>
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin mt-2 text-gray-400" />
              ) : (
                <>
                  <p className="text-2xl font-bold mt-1 text-red-600">{weakCount}</p>
                  <p className="text-sm text-red-600">{weakCount > 0 ? 'Deep gaps to fix' : 'No gaps detected'}</p>
                </>
              )}
            </div>
            <Flame className="h-5 w-5 text-orange-500" />
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-medium text-sm text-muted-foreground">Next Mission</h3>
              <p className="text-2xl font-bold mt-1">25 min</p>
              <p className="text-sm text-emerald-600">{weakConcepts.length} concepts queued</p>
            </div>
            <Rocket className="h-5 w-5 text-emerald-500" />
          </div>
        </Card>
      </div>

      {/* Row 2: Firebase Assessment Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card className="p-5">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-medium text-sm text-muted-foreground">Total Attempts</h3>
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin mt-2 text-gray-400" />
              ) : (
                <>
                  <p className="text-2xl font-bold mt-1">{totalAttempts}</p>
                  <p className="text-sm text-blue-600">{Math.round(accuracy * 100)}% accuracy</p>
                </>
              )}
            </div>
            <Target className="h-5 w-5 text-blue-500" />
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-medium text-sm text-muted-foreground">Blind Spots</h3>
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin mt-2 text-gray-400" />
              ) : (
                <>
                  <p className="text-2xl font-bold mt-1">{blindSpots.found}<span className="text-base font-normal text-gray-400"> found</span></p>
                  <p className="text-sm text-purple-600">{blindSpots.resolved} resolved</p>
                </>
              )}
            </div>
            <Eye className="h-5 w-5 text-purple-500" />
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-medium text-sm text-muted-foreground">Self-Awareness</h3>
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin mt-2 text-gray-400" />
              ) : (
                <>
                  <p className="text-2xl font-bold mt-1">{Math.round(selfAwareness.score * 100)}%</p>
                  <p className="text-sm text-indigo-600">Calibration: {(selfAwareness.calibration_gap * 100).toFixed(0)}% gap</p>
                </>
              )}
            </div>
            <Brain className="h-5 w-5 text-indigo-500" />
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-medium text-sm text-muted-foreground">Mistake Types</h3>
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin mt-2 text-gray-400" />
              ) : (
                <>
                  <div className="flex gap-3 mt-1">
                    <div>
                      <p className="text-lg font-bold text-orange-600">{progress?.careless_count ?? 0}</p>
                      <p className="text-xs text-gray-500">Careless</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-red-600">{progress?.conceptual_count ?? 0}</p>
                      <p className="text-xs text-gray-500">Conceptual</p>
                    </div>
                  </div>
                </>
              )}
            </div>
            <AlertTriangle className="h-5 w-5 text-orange-400" />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-3 overflow-hidden">
          <div className="p-4 border-b flex justify-between items-center">
            <h3 className="font-semibold">Knowledge Map Preview</h3>
            <Link href="/knowledge-map" className="text-sm text-emerald-600 hover:text-emerald-700 flex items-center gap-1">
              Full Map <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="h-[380px]">
            {loading ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading knowledge graph...
              </div>
            ) : (
              <KnowledgeGraph
                nodes={nodes.map(n => ({
                  id: n.id,
                  title: n.title,
                  mastery: n.mastery,
                  status: n.status,
                  lastReviewed: '',
                  decayRate: 0,
                  category: n.category ?? 'General',
                }))}
                links={links}
              />
            )}
          </div>
        </Card>

        <div className="lg:col-span-2 space-y-6">
          <Card>
            <div className="p-4 border-b">
              <h3 className="font-semibold">Priority Concepts</h3>
              <p className="text-xs text-gray-500">Ranked by gap severity + decay risk</p>
            </div>
            <div className="p-4 space-y-3">
              {loading ? (
                <div className="text-center py-4"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" /></div>
              ) : priorityConcepts.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No concepts to review. Upload materials to get started!</p>
              ) : (
                priorityConcepts.map((concept, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      concept.status === 'weak' ? 'bg-red-500' : 'bg-yellow-500'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{concept.name}</p>
                      <div className="w-full bg-gray-200 rounded-full h-1 mt-1">
                        <div className={`h-1 rounded-full ${
                          concept.mastery >= 70 ? 'bg-green-500' : concept.mastery >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                        }`} style={{ width: `${concept.mastery}%` }} />
                      </div>
                    </div>
                    <span className="text-xs text-gray-500 flex-shrink-0">{concept.mastery}%</span>
                    {concept.decayDays <= 1 && (
                      <AlertTriangle className="w-3 h-3 text-orange-500 flex-shrink-0" />
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Recent Activity from Firebase */}
          {progress && progress.recent_attempts.length > 0 && (
            <Card>
              <div className="p-4 border-b">
                <h3 className="font-semibold">Recent Activity</h3>
                <p className="text-xs text-gray-500">Your latest assessment attempts</p>
              </div>
              <div className="p-4 space-y-2">
                {progress.recent_attempts.slice(-5).reverse().map((attempt, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className={`w-2 h-2 rounded-full ${attempt.is_correct ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="flex-1 truncate">{attempt.concept || 'Assessment'}</span>
                    {attempt.mistake_type && attempt.mistake_type !== 'normal' && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
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

          <Card>
            <div className="p-4 border-b">
              <h3 className="font-semibold">Quick Actions</h3>
            </div>
            <div className="p-4 space-y-2">
              <Link href="/study-mission" className="block w-full p-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-center text-sm font-medium">
                Start 25-Minute Study Mission
              </Link>
              <Link href="/upload" className="block w-full p-3 border border-emerald-600 text-emerald-700 rounded-lg hover:bg-emerald-50 text-center text-sm font-medium">
                Upload Course Materials
              </Link>
              <Link href="/assessment" className="block w-full p-3 border rounded-lg hover:bg-gray-50 text-center text-sm font-medium">
                Take an Assessment
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
