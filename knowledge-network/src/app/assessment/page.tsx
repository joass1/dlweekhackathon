'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthedApi } from '@/hooks/useAuthedApi';
import { CourseOption, DEFAULT_COURSES } from '@/lib/courses';

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
  const searchParams = useSearchParams();
  const { apiFetchWithAuth } = useAuthedApi();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>(DEFAULT_COURSES);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
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

  useEffect(() => {
    const requestedCourseId = (searchParams.get('courseId') || '').trim();
    if (!requestedCourseId || selectedCourse) return;
    if (courses.some((course) => course.id === requestedCourseId)) {
      setSelectedCourse(requestedCourseId);
    }
  }, [courses, searchParams, selectedCourse]);

  const BounceLoader = ({ size = 28 }: { size?: number }) => (
    <Image
      src="/logo-images/favicon.png"
      alt="Loading"
      width={size}
      height={size}
      className="animate-bounce"
      priority
    />
  );

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute -left-16 top-20 h-64 w-64 rounded-full bg-cyan-500/20 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-0 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="max-w-6xl mx-auto px-4 py-10 md:py-12 relative">
        <div className="rounded-3xl border border-white/20 bg-slate-900/55 backdrop-blur-sm shadow-lg p-8 md:p-10 mb-8 text-center text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#4cc9f0] mb-3">Assessment Center</p>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">Mentora Assessments</h1>
          <p className="text-white/70 max-w-2xl mx-auto">
            Assessments are generated from your uploaded materials and current knowledge map.
          </p>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-white/20 bg-slate-900/55 backdrop-blur-sm shadow-lg p-10 text-center text-white/70">
            <div className="flex items-center justify-center mb-3">
              <BounceLoader />
            </div>
            Loading concepts...
          </div>
        ) : null}

        {!loading && error ? (
          <div className="rounded-2xl border border-red-400/40 bg-red-900/20 backdrop-blur-sm p-6 text-center text-red-100">
            <p className="font-medium">Could not load assessment concepts</p>
            <p className="text-sm text-red-100/80 mt-1">{error}</p>
          </div>
        ) : null}

        {!loading && !error && concepts.length === 0 ? (
          <div className="rounded-2xl border border-white/20 bg-slate-900/55 backdrop-blur-sm shadow-lg p-10 text-center text-white">
            <h2 className="text-xl font-semibold mb-2">No concepts found yet</h2>
            <p className="text-white/70 mb-6">
              Upload course materials first. Your assessments will only appear after concepts exist in your knowledge map.
            </p>
            <Link
              href="/upload"
              className="inline-flex items-center px-5 py-2 rounded-full bg-[#03b2e6] text-white hover:bg-[#029ad0] transition-colors"
            >
              Upload Materials
            </Link>
          </div>
        ) : null}

        {!loading && !error && concepts.length > 0 && !selectedCourse ? (
          <div>
            <h2 className="text-xl font-semibold mb-4 text-white">Select A Course</h2>
            <div className="grid md:grid-cols-3 gap-6">
              {coursesWithCounts.map((course) => (
                <button
                  key={course.id}
                  className={`text-left rounded-2xl border border-white/20 bg-slate-900/55 backdrop-blur-sm shadow-lg overflow-hidden transition-all ${
                    course.topicCount > 0 ? 'hover:shadow-xl hover:-translate-y-0.5' : 'opacity-70'
                  }`}
                  onClick={() => setSelectedCourse(course.id)}
                >
                  <div className="p-6">
                    <h3 className="text-xl font-semibold mb-2 text-white">{course.name}</h3>
                    <p className="text-sm text-white/70">
                      {course.topicCount} topic{course.topicCount === 1 ? '' : 's'} ready
                    </p>
                  </div>
                  <div className="bg-[#03b2e6]/12 border-t border-[#03b2e6]/25 p-4 text-center">
                    <span className="text-[#4cc9f0] font-medium">
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
                <h2 className="text-xl font-semibold text-white">{selectedCourseMeta.name}</h2>
                <p className="text-sm text-white/70">
                  {selectedCourseConcepts.length} topic{selectedCourseConcepts.length === 1 ? '' : 's'} available
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCourse(null)}
                className="px-4 py-2 rounded-full border border-white/30 bg-white/10 text-sm text-white hover:bg-white/20 transition-colors"
              >
                Back To Courses
              </button>
            </div>

            {selectedCourseConcepts.length === 0 ? (
              <div className="rounded-2xl border border-white/20 bg-slate-900/55 backdrop-blur-sm shadow-lg p-8 text-center text-white/70">
                No topics found for this course yet.
              </div>
            ) : (
              <div className="grid md:grid-cols-3 gap-6">
                {selectedCourseConcepts.map((concept) => (
                  <button
                    key={concept.id}
                    className="text-left rounded-2xl border border-white/20 bg-slate-900/55 backdrop-blur-sm shadow-lg overflow-hidden hover:shadow-xl hover:-translate-y-0.5 transition-all"
                    onClick={() => router.push(`/assessment/${concept.id}/intro`)}
                  >
                    <div className="p-6">
                      <h3 className="text-xl font-semibold mb-2 text-white">{concept.title}</h3>
                      <p className="text-white/70 mb-4">{concept.category}</p>
                      <div className="flex items-center justify-between text-sm text-white/70">
                        <span>5 questions</span>
                        <span>{concept.masteryPct}% mastery</span>
                      </div>
                    </div>
                    <div className="bg-[#03b2e6]/12 border-t border-[#03b2e6]/25 p-4 text-center">
                      <span className="text-[#4cc9f0] font-medium">Begin Assessment</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

      </div>
    </div>
  );
}
