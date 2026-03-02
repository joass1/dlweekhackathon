'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
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
  const [lastUploadedCourseId, setLastUploadedCourseId] = useState<string | null>(null);
  const [lastUploadedConceptIds, setLastUploadedConceptIds] = useState<Set<string>>(new Set());
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
        const runs = await getAssessmentHistory(token, undefined, 20);
        if (!cancelled) setPastRuns(runs);
      } catch {
        if (!cancelled) setPastRuns([]);
      }
    };
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [getIdToken]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const value = window.sessionStorage.getItem('last_uploaded_course_id');
    setLastUploadedCourseId(value && value.trim() ? value.trim() : null);
    try {
      const raw = window.sessionStorage.getItem('last_uploaded_concept_ids');
      const parsed = raw ? JSON.parse(raw) : [];
      const ids = Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        : [];
      setLastUploadedConceptIds(new Set(ids));
    } catch {
      setLastUploadedConceptIds(new Set());
    }
  }, []);

  const concepts = useMemo(
    () =>
      nodes.map((n) => ({
        id: String(n.id),
        title: String(n.title || n.id).trim(),
        category: String(n.category || 'General'),
        courseId: (() => {
          const cid = (n as unknown as { courseId?: string; course_id?: string }).courseId
            || (n as unknown as { courseId?: string; course_id?: string }).course_id;
          return cid ? String(cid).trim() : '';
        })(),
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
  const normalizeId = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const belongsToCourse = (concept: { courseId: string; category: string }, course: CourseOption) => {
    const courseNameNorm = normalize(course.name).replace(/\b\d+\b/g, '').trim();
    if (concept.courseId) {
      const idMatched =
        concept.courseId === course.id
        || normalizeId(concept.courseId) === normalizeId(course.id)
      if (idMatched) return true;

      // Compatibility fallback: older/legacy data may store a textual course label
      // in courseId rather than the canonical slug id.
      const conceptCourseNorm = normalize(concept.courseId).replace(/\b\d+\b/g, '').trim();
      if (
        conceptCourseNorm
        && courseNameNorm
        && (
          conceptCourseNorm === courseNameNorm
          || conceptCourseNorm.includes(courseNameNorm)
          || courseNameNorm.includes(conceptCourseNorm)
        )
      ) {
        return true;
      }
    }
    const categoryNorm = normalize(concept.category);
    if (!categoryNorm || !courseNameNorm) return false;
    return categoryNorm === courseNameNorm || categoryNorm.includes(courseNameNorm) || courseNameNorm.includes(categoryNorm);
  };

  const coursesWithCounts = useMemo(
    () => {
      const baseCounts = courses.map((course) => ({
        ...course,
        topicCount: concepts.filter((c) => belongsToCourse(c, course)).length,
      }));

      const unmappedConcepts = concepts.filter(
        (concept) => !courses.some((course) => belongsToCourse(concept, course))
      );

      if (!lastUploadedCourseId || unmappedConcepts.length === 0) {
        return baseCounts;
      }

      return baseCounts.map((course) => {
        if (course.id !== lastUploadedCourseId) return course;
        const uploadedMatches = concepts.filter((c) => lastUploadedConceptIds.has(c.id)).length;
        if (course.topicCount > 0 || uploadedMatches > 0) {
          return { ...course, topicCount: Math.max(course.topicCount, uploadedMatches) };
        }
        return { ...course, topicCount: unmappedConcepts.length };
      });
    },
    [courses, concepts, lastUploadedCourseId, lastUploadedConceptIds]
  );

  const selectedCourseMeta = useMemo(
    () => coursesWithCounts.find((c) => c.id === selectedCourse) || null,
    [coursesWithCounts, selectedCourse]
  );

  const selectedCourseConcepts = useMemo(() => {
    if (!selectedCourseMeta) return [];
    const mapped = concepts.filter((c) => belongsToCourse(c, selectedCourseMeta));
    if (mapped.length > 0) return mapped;

    if (lastUploadedCourseId && selectedCourseMeta.id === lastUploadedCourseId) {
      const uploadedConcepts = concepts.filter((c) => lastUploadedConceptIds.has(c.id));
      if (uploadedConcepts.length > 0) return uploadedConcepts;

      const unmapped = concepts.filter(
        (concept) => !courses.some((course) => belongsToCourse(concept, course))
      );
      if (unmapped.length > 0) return unmapped;
    }
    return mapped;
  }, [concepts, selectedCourseMeta, courses, lastUploadedCourseId, lastUploadedConceptIds]);

  return (
    <div className="min-h-full py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold mb-4 text-slate-900">Mentora Assessments</h1>
          <p className="text-slate-700 max-w-2xl mx-auto">
            Assessments are generated from your uploaded materials and current knowledge map.
          </p>
        </div>

        {loading ? (
          <div className="rounded-xl p-10 text-center text-slate-700 border border-black/10 bg-white/65 backdrop-blur-sm shadow-lg">
            <div className="flex items-center justify-center mb-3">
              <Image src="/logo-images/favicon.png" alt="Loading" width={28} height={28} className="animate-bounce" priority />
            </div>
            Loading concepts...
          </div>
        ) : null}

        {!loading && error ? (
          <div className="rounded-xl p-6 text-center border border-red-300/50 bg-red-500/20 backdrop-blur-sm text-slate-900 shadow-lg">
            <p className="text-red-100 font-medium">Could not load assessment concepts</p>
            <p className="text-sm text-red-100/90 mt-1">{error}</p>
          </div>
        ) : null}

        {!loading && !error && concepts.length === 0 ? (
          <div className="rounded-xl p-10 text-center border border-black/10 bg-white/65 backdrop-blur-sm shadow-lg text-slate-900">
            <h2 className="text-xl font-semibold mb-2">No concepts found yet</h2>
            <p className="text-slate-700 mb-6">
              Upload course materials first. Your assessments will only appear after concepts exist in your knowledge map.
            </p>
            <Link href="/upload" className="inline-flex items-center px-5 py-2 rounded-full bg-[#03b2e6] text-white hover:bg-[#029ad0]">
              Upload Materials
            </Link>
          </div>
        ) : null}

        {!loading && !error && concepts.length > 0 && !selectedCourse ? (
          <div>
            <h2 className="text-xl font-semibold mb-4 text-slate-900">Select A Course</h2>
            <div className="grid md:grid-cols-3 gap-6">
              {coursesWithCounts.map((course) => (
                <button
                  key={course.id}
                  className={`text-left rounded-xl shadow-lg overflow-hidden transition-shadow border border-black/10 bg-white/65 backdrop-blur-sm text-slate-900 ${
                    course.topicCount > 0 ? 'hover:shadow-xl' : 'opacity-70'
                  }`}
                  onClick={() => setSelectedCourse(course.id)}
                >
                  <div className="p-6">
                    <h3 className="text-xl font-semibold mb-2">{course.name}</h3>
                    <p className="text-sm text-slate-700">
                      {course.topicCount} topic{course.topicCount === 1 ? '' : 's'} ready
                    </p>
                  </div>
                  <div className="bg-white/400 p-4 text-center border-t border-black/10">
                    <span className="text-[#4cc9f0] font-medium">{course.topicCount > 0 ? 'View Topics' : 'No Topics Yet'}</span>
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
                <h2 className="text-xl font-semibold text-slate-900">{selectedCourseMeta.name}</h2>
                <p className="text-sm text-slate-700">
                  {selectedCourseConcepts.length} topic{selectedCourseConcepts.length === 1 ? '' : 's'} available
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCourse(null)}
                className="px-4 py-2 rounded-full border border-black/20 text-sm text-slate-900 hover:bg-white/400"
              >
                Back To Courses
              </button>
            </div>

            {selectedCourseConcepts.length === 0 ? (
              <div className="rounded-xl p-8 text-center text-slate-700 border border-black/10 bg-white/65 backdrop-blur-sm shadow-lg">
                No topics found for this course yet.
              </div>
            ) : (
              <div className="grid md:grid-cols-3 gap-6">
                {selectedCourseConcepts.map((concept) => (
                  <div
                    key={concept.id}
                    className="rounded-xl shadow-lg overflow-hidden hover:shadow-xl transition-shadow border border-black/10 bg-white/65 backdrop-blur-sm text-slate-900"
                  >
                    <div className="p-6">
                      <h3 className="text-xl font-semibold mb-2">{concept.title}</h3>
                      <p className="text-slate-700 mb-3">{concept.category}</p>
                      <div className="flex items-center justify-between text-sm text-slate-600">
                        <span>5 questions</span>
                        <span>{concept.masteryPct}% mastery</span>
                      </div>
                    </div>
                    <div className="bg-white/400 p-4 text-center border-t border-black/10">
                      <button
                        type="button"
                        className="text-[#4cc9f0] font-medium"
                        onClick={() => router.push(`/assessment/${concept.id}/intro`)}
                      >
                        Begin Assessment
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {!loading && !error ? (
          <div className="mt-10 border border-black/10 rounded-xl p-6 bg-white/65 backdrop-blur-sm shadow-lg text-slate-900">
            <h2 className="text-xl font-semibold mb-4">Past Assessments</h2>
            {pastRuns.length === 0 ? (
              <p className="text-sm text-slate-700">No past assessments yet. Complete one to see history.</p>
            ) : (
              <div className="space-y-3">
                {pastRuns.map((run) => (
                  <div key={run.run_id} className="rounded-lg border border-black/10 bg-white/40 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <p className="font-medium">{String(run.concept || '').replace(/-/g, ' ')}</p>
                      <p className="text-sm text-slate-600">
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



