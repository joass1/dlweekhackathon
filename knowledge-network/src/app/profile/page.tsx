'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Brain, Book, Target, Eye, AlertTriangle, Loader2 } from 'lucide-react';
import { useStudentId } from '@/hooks/useStudentId';
import { useAuthedApi } from '@/hooks/useAuthedApi';

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

interface KGNode {
  id: string;
  title: string;
  mastery: number;
  status: string;
  courseId?: string;
  category?: string;
}

interface CourseOption {
  id: string;
  name: string;
}

export default function ProfilePage() {
  const [progress, setProgress] = useState<StudentProgress | null>(null);
  const [nodes, setNodes] = useState<KGNode[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const studentId = useStudentId();
  const { apiFetchWithAuth } = useAuthedApi();

  useEffect(() => {
    async function loadData() {
      try {
        const [progressData, graphData, courseData] = await Promise.all([
          apiFetchWithAuth<StudentProgress>(`/api/students/${studentId}/progress`).catch(() => null),
          apiFetchWithAuth<{ nodes: KGNode[] }>('/api/kg/graph').catch(() => ({ nodes: [] })),
          apiFetchWithAuth<{ courses: CourseOption[] }>('/api/courses').catch(() => ({ courses: [] })),
        ]);

        if (progressData) setProgress(progressData);
        setNodes(
          (graphData.nodes ?? []).map((n: any) => ({
            id: String(n.id),
            title: String(n.title ?? n.id),
            mastery: Number(n.mastery ?? 0),
            status: String(n.status ?? 'not_started'),
            courseId: n.courseId ? String(n.courseId) : undefined,
            category: String(n.category ?? 'General'),
          }))
        );
        setCourses(courseData.courses ?? []);
      } catch {
        // Backend unavailable
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [studentId, apiFetchWithAuth]);

  const kgStats = progress?.kg_stats ?? {
    total_concepts: nodes.length,
    mastered: nodes.filter(n => n.status === 'mastered').length,
    learning: nodes.filter(n => n.status === 'learning').length,
    weak: nodes.filter(n => n.status === 'weak').length,
    not_started: nodes.filter(n => n.status === 'not_started').length,
  };

  // Group nodes by course/category for per-course progress
  const courseProgress = useMemo(() => {
    const grouped: Record<string, KGNode[]> = {};
    nodes.forEach(n => {
      const key = n.courseId || n.category || 'General';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(n);
    });

    return Object.entries(grouped).map(([key, courseNodes]) => {
      const course = courses.find(c => c.id === key);
      const masteredCount = courseNodes.filter(n => n.status === 'mastered').length;
      const weakCount = courseNodes.filter(n => n.status === 'weak').length;
      const totalMastery = courseNodes.reduce((sum, n) => sum + n.mastery, 0);
      const avgMastery = courseNodes.length > 0 ? Math.round(totalMastery / courseNodes.length) : 0;

      return {
        name: course?.name || key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        total: courseNodes.length,
        mastered: masteredCount,
        weak: weakCount,
        progress: avgMastery,
      };
    }).sort((a, b) => b.total - a.total);
  }, [nodes, courses]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-[#03b2e6] mr-2" />
        <span className="text-muted-foreground">Loading profile...</span>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-6 mb-8">
        <div className="w-24 h-24 bg-[#03b2e6] rounded-full flex items-center justify-center text-white text-3xl">
          {studentId.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-bold">Student Profile</h1>
          <p className="text-muted-foreground text-sm">ID: {studentId}</p>
          <p className="text-muted-foreground text-sm">{courses.length} course{courses.length !== 1 ? 's' : ''} enrolled</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Concepts Mastered</CardTitle>
            <Brain className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{kgStats.mastered}/{kgStats.total_concepts}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Need Work</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{kgStats.weak + kgStats.learning}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Attempts</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{progress?.total_attempts ?? 0}</div>
            <p className="text-xs text-muted-foreground">{Math.round((progress?.accuracy ?? 0) * 100)}% accuracy</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Blind Spots</CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{progress?.blind_spots.found ?? 0}</div>
            <p className="text-xs text-muted-foreground">{progress?.blind_spots.resolved ?? 0} resolved</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Courses</CardTitle>
            <Book className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{courses.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Self-Awareness Card */}
      {progress && progress.self_awareness.total_attempts > 0 && (
        <Card className="mb-8 p-5">
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

      {/* Mistake Breakdown */}
      {progress && progress.total_attempts > 0 && (
        <Card className="mb-8 p-5">
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

      <h2 className="text-xl font-semibold mb-4">Knowledge Graph Progress</h2>
      {courseProgress.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground text-sm">
          No course data yet. Upload materials to get started!
        </Card>
      ) : (
        <div className="space-y-4">
          {courseProgress.map((course, index) => (
            <Card key={index}>
              <CardContent className="pt-6">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h3 className="font-semibold">{course.name}</h3>
                    <p className="text-sm text-muted-foreground">{course.total} concepts</p>
                  </div>
                  <div className="text-right flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full ${
                      course.progress >= 80 ? 'bg-green-500' : course.progress >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                    }`} />
                    <p className="font-semibold">{course.progress}%</p>
                  </div>
                </div>
                <div className="w-full bg-muted rounded-full h-2 mb-4">
                  <div
                    className="bg-[#03b2e6] h-2 rounded-full"
                    style={{ width: `${course.progress}%` }}
                  />
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-green-600">{course.mastered} concepts mastered</span>
                  <span className="text-red-600">{course.weak} needs work</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
