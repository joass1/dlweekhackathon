'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthedApi } from '@/hooks/useAuthedApi';
import { CourseOption, DEFAULT_COURSES } from '@/lib/courses';
import { useAuth } from '@/contexts/AuthContext';
import { getAssessmentHistory, type AssessmentHistoryRun } from '@/services/assessment';
import { useStudentId } from '@/hooks/useStudentId';

interface GraphNode {
  id: string;
  title?: string;
  category?: string;
  courseId?: string;
  mastery?: number;
  status?: string;
}

export default function AssessmentSelectionPage() {
  const router = useRouter();
  const { apiFetchWithAuth } = useAuthedApi();
  const { getIdToken } = useAuth();
  const studentId = useStudentId();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>(DEFAULT_COURSES);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [pastRuns, setPastRuns] = useState<AssessmentHistoryRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [graphData, courseData] = await Promise.all([
          apiFetchWithAuth<{ nodes?: GraphNode[] }>('/api/kg/graph'),
          apiFetchWithAuth<{ courses?: CourseOption[] }>('/api/courses').catch(() => ({ courses: DEFAULT_COURSES })),
        ]);
        if (!cancelled) {
          setNodes(Array.isArray(graphData?.nodes) ? graphData.nodes : []);
          const incomingCourses = Array.isArray(courseData?.courses) ? courseData.courses : DEFAULT_COURSES;
          setCourses(incomingCourses);
        }
      } catch (e) {
        if (!cancelled) {
          setNodes([]);
          setCourses(DEFAULT_COURSES);
          setError(e instanceof Error ? e.message : 'Failed to load assessment concepts');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [apiFetchWithAuth]);

  useEffect(() => {
    let cancelled = false;
    const loadHistory = async () => {
      try {
        const token = await getIdToken();
        let runs = await getAssessmentHistory(token, undefined, 20);
        if (!runs.length) {
          const progress = await apiFetchWithAuth<{ recent_attempts?: any[] }>(
            `/api/students/${studentId}/progress`
          ).catch(() => ({ recent_attempts: [] }));
          const recent = Array.isArray(progress?.recent_attempts) ? progress.recent_attempts : [];
          if (recent.length) {
            const byConcept = new Map<string, any[]>();
            for (const a of recent) {
              const key = String(a?.concept || 'unknown');
              const arr = byConcept.get(key) || [];
              arr.push(a);
              byConcept.set(key, arr);
            }
            runs = Array.from(byConcept.entries()).map(([concept, attempts], idx) => {
              const total = attempts.length;
              const correct = attempts.filter((a) => !!a?.is_correct).length;
              const submitted_at = String(attempts[attempts.length - 1]?.timestamp || new Date().toISOString());
              return {
                run_id: `recent-${concept}-${idx}`,
                student_id: studentId,
                concept,
                submitted_at,
                score: total ? Math.round((correct / total) * 10000) / 100 : 0,
                correct_count: correct,
                total_questions: total,
                blind_spot_found_count: 0,
                blind_spot_resolved_count: 0,
                questions: [],
              } as AssessmentHistoryRun;
            });
            runs.sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));
          }
        }
        if (!cancelled) {
          setPastRuns(runs);
        }
      } catch {
        if (!cancelled) {
          setPastRuns([]);
        }
      }
    };
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [getIdToken, apiFetchWithAuth, studentId]);

  const concepts = useMemo(
    () =>
      nodes.map((n) => ({
        id: String(n.id),
        title: String(n.title || n.id).trim(),
        category: String(n.category || 'General'),
        courseId: n.courseId ? String(n.courseId) : '',
        masteryPct: (() => {
          const value = Number(n.mastery ?? 0);
          if (Number.isNaN(value)) return 0;
          const pct = value <= 1 ? value * 100 : value;
          return Math.round(Math.max(0, Math.min(100, pct)));
        })(),
      })),
    [nodes]
  );

  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const belongsToCourse = (concept: { courseId: string; category: string }, course: CourseOption) => {
    if (concept.courseId) return concept.courseId === course.id;
    const categoryNorm = normalize(concept.category);
    const courseNameNorm = normalize(course.name).replace(/\b\d+\b/g, '').trim();
    if (!categoryNorm || !courseNameNorm) return false;
    return (
      categoryNorm === courseNameNorm ||
      categoryNorm.includes(courseNameNorm) ||
      courseNameNorm.includes(categoryNorm)
    );
  };

  const coursesWithCounts = useMemo(
    () =>
      courses.map((course) => ({
        ...course,
        topicCount: concepts.filter((c) => belongsToCourse(c, course)).length,
      })),
    [courses, concepts]
  );

  const selectedCourseMeta = useMemo(
    () => coursesWithCounts.find((c) => c.id === selectedCourse) || null,
    [coursesWithCounts, selectedCourse]
  );

  const selectedCourseConcepts = useMemo(() => {
    if (!selectedCourseMeta) return [];
    return concepts.filter((c) => belongsToCourse(c, selectedCourseMeta));
  }, [concepts, selectedCourseMeta]);

  return (
    <div className="min-h-screen bg-background py-12">
      <div className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold mb-4">LearnGraph Assessments</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Assessments are generated from your uploaded materials and current knowledge map.
          </p>
        </div>

        {loading ? (
          <div className="bg-white border rounded-xl p-10 text-center text-muted-foreground">Loading concepts...</div>
        ) : null}

        {!loading && error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
            <p className="text-red-700 font-medium">Could not load assessment concepts</p>
            <p className="text-sm text-red-600 mt-1">{error}</p>
          </div>
        ) : null}

        {!loading && !error && concepts.length === 0 ? (
          <div className="bg-white border rounded-xl p-10 text-center">
            <h2 className="text-xl font-semibold mb-2">No concepts found yet</h2>
            <p className="text-muted-foreground mb-6">
              Upload course materials first. Your assessments will only appear after concepts exist in your knowledge map.
            </p>
            <Link
              href="/upload"
              className="inline-flex items-center px-5 py-2 rounded-full bg-[#03b2e6] text-white hover:bg-[#029ad0]"
            >
              Upload Materials
            </Link>
          </div>
        ) : null}

        {!loading && !error && concepts.length > 0 && !selectedCourse ? (
          <div>
            <h2 className="text-xl font-semibold mb-4">Select A Course</h2>
            <div className="grid md:grid-cols-3 gap-6">
              {coursesWithCounts.map((course) => (
                <button
                  key={course.id}
                  className={`text-left bg-white rounded-xl shadow-sm overflow-hidden transition-shadow ${
                    course.topicCount > 0 ? 'hover:shadow-md' : 'opacity-70'
                  }`}
                  onClick={() => setSelectedCourse(course.id)}
                >
                  <div className="p-6">
                    <h3 className="text-xl font-semibold mb-2">{course.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {course.topicCount} topic{course.topicCount === 1 ? '' : 's'} ready
                    </p>
                  </div>
                  <div className="bg-[#e0f4fb] p-4 text-center">
                    <span className="text-[#03b2e6] font-medium">
                      {course.topicCount > 0 ? 'View Topics' : 'No Topics Yet'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {!loading && !error && selectedCourse && selectedCourseMeta ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold">{selectedCourseMeta.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {selectedCourseConcepts.length} topic{selectedCourseConcepts.length === 1 ? '' : 's'} available
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCourse(null)}
                className="px-4 py-2 rounded-full border border-gray-300 text-sm hover:bg-gray-50"
              >
                Back To Courses
              </button>
            </div>

            {selectedCourseConcepts.length === 0 ? (
              <div className="bg-white border rounded-xl p-8 text-center text-muted-foreground">
                No topics found for this course yet.
              </div>
            ) : (
              <div className="grid md:grid-cols-3 gap-6">
                {selectedCourseConcepts.map((concept) => (
                  <button
                    key={concept.id}
                    className="text-left bg-white rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow"
                    onClick={() => router.push(`/assessment/${concept.id}/intro?courseId=${selectedCourse}`)}
                  >
                    <div className="p-6">
                      <h3 className="text-xl font-semibold mb-2">{concept.title}</h3>
                      <p className="text-muted-foreground mb-4">{concept.category}</p>
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>5 questions</span>
                        <span>{concept.masteryPct}% mastery</span>
                      </div>
                    </div>
                    <div className="bg-[#e0f4fb] p-4 text-center">
                      <span className="text-[#03b2e6] font-medium">Begin Assessment</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {!loading && !error ? (
          <div className="mt-10 bg-white border rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4">Past Assessments</h2>
            {pastRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No past assessments yet. Complete one to see history.</p>
            ) : (
              <div className="space-y-3">
                {pastRuns.map((run) => (
                  <div key={run.run_id} className="rounded-lg border border-gray-200 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <p className="font-medium">{String(run.concept || '').replace(/-/g, ' ')}</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(run.submitted_at).toLocaleString()} • {run.correct_count}/{run.total_questions} correct
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold">{Math.round(Number(run.score || 0))}%</span>
                      <button
                        className="px-4 py-2 rounded-full bg-[#03b2e6] text-white hover:bg-[#029ad0] text-sm"
                        onClick={() => router.push(`/assessment/${run.concept}/take?retry=${Date.now()}`)}
                      >
                        Retake
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
