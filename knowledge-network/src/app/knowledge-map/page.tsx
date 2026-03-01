'use client';

import React, { useEffect, useMemo, useState } from 'react';
import KnowledgeGraph from '@/components/graphs/KnowledgeGraph';
import { Card } from '@/components/ui/card';
import { CourseOption, DEFAULT_COURSES } from '@/lib/courses';

type GraphStatus = 'mastered' | 'learning' | 'weak' | 'not_started';

interface GraphNode {
  id: string;
  title: string;
  mastery: number;
  status: GraphStatus;
  courseId?: string;
  category?: string;
  decayTimestamp?: string | null;
}

interface GraphLink {
  source: string;
  target: string;
  type: 'prerequisite' | 'related';
}

export default function KnowledgeMapPage() {
  const [selectedCourse, setSelectedCourse] = useState('all');
  const [courses, setCourses] = useState<CourseOption[]>([{ id: 'all', name: 'All Courses' }, ...DEFAULT_COURSES]);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
    const loadCourses = async () => {
      try {
        const res = await fetch(`${base}/api/courses`);
        if (!res.ok) throw new Error('Failed to load courses');
        const data = await res.json();
        const incoming: CourseOption[] = Array.isArray(data.courses) ? data.courses : DEFAULT_COURSES;
        setCourses([{ id: 'all', name: 'All Courses' }, ...incoming]);
      } catch {
        setCourses([{ id: 'all', name: 'All Courses' }, ...DEFAULT_COURSES]);
      }
    };
    loadCourses();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

    const loadGraph = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${base}/api/kg/graph`, { signal: controller.signal });
        if (!res.ok) throw new Error('Failed to load graph');
        const data = await res.json();

        const safeNodes: GraphNode[] = (data.nodes ?? []).map((n: any) => ({
          id: String(n.id),
          title: String(n.title ?? n.id),
          mastery: Number(n.mastery ?? 0),
          status: (n.status ?? 'not_started') as GraphStatus,
          courseId: n.courseId ? String(n.courseId) : undefined,
          category: String(n.category ?? 'General'),
          decayTimestamp: n.decayTimestamp ?? null,
        }));

        const safeLinks: GraphLink[] = (data.links ?? []).map((l: any) => ({
          source: String(l.source),
          target: String(l.target),
          type: l.type === 'prerequisite' ? 'prerequisite' : 'related',
        }));

        setNodes(safeNodes);
        setLinks(safeLinks);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setNodes([]);
          setLinks([]);
        }
      } finally {
        setLoading(false);
      }
    };

    loadGraph();
    return () => controller.abort();
  }, []);

  const filteredNodes = useMemo(() => {
    if (selectedCourse === 'all') return nodes;
    const selected = courses.find((c) => c.id === selectedCourse);
    if (!selected) return nodes;

    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const courseNameNorm = normalize(selected.name).replace(/\b\d+\b/g, '').trim();

    return nodes.filter((n) => {
      // Preferred: new data explicitly tagged with courseId.
      if (n.courseId) return n.courseId === selectedCourse;

      // Backward compatibility: legacy nodes without courseId.
      const categoryNorm = normalize(n.category ?? '');
      if (!categoryNorm || !courseNameNorm) return false;
      return (
        categoryNorm === courseNameNorm ||
        categoryNorm.includes(courseNameNorm) ||
        courseNameNorm.includes(categoryNorm)
      );
    });
  }, [nodes, selectedCourse, courses]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);
  const linkNodeId = (end: string | { id?: string }) =>
    typeof end === 'string' ? end : String(end?.id ?? '');
  const filteredLinks = useMemo(
    () => links.filter((l) => filteredNodeIds.has(linkNodeId(l.source as any)) && filteredNodeIds.has(linkNodeId(l.target as any))),
    [links, filteredNodeIds]
  );

  const stats = useMemo(
    () => ({
      total: filteredNodes.length,
      mastered: filteredNodes.filter((n) => n.status === 'mastered').length,
      learning: filteredNodes.filter((n) => n.status === 'learning').length,
      weak: filteredNodes.filter((n) => n.status === 'weak').length,
      notStarted: filteredNodes.filter((n) => n.status === 'not_started').length,
    }),
    [filteredNodes]
  );

  return (
    <div className="p-6 h-screen flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-2xl font-bold">Knowledge Map</h1>
          <p className="text-sm text-gray-500">Visualize your mastery across all concepts. Drag nodes to rearrange.</p>
        </div>
        <select
          value={selectedCourse}
          onChange={(e) => setSelectedCourse(e.target.value)}
          className="p-2 border rounded-lg"
        >
          {courses.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-4">
        <Card className="p-3 border-l-4 border-l-green-500">
          <p className="text-sm text-gray-500">Mastered</p>
          <p className="text-xl font-bold text-green-600">{stats.mastered}</p>
        </Card>
        <Card className="p-3 border-l-4 border-l-yellow-500">
          <p className="text-sm text-gray-500">Learning</p>
          <p className="text-xl font-bold text-yellow-600">{stats.learning}</p>
        </Card>
        <Card className="p-3 border-l-4 border-l-red-500">
          <p className="text-sm text-gray-500">Weak</p>
          <p className="text-xl font-bold text-red-600">{stats.weak}</p>
        </Card>
        <Card className="p-3 border-l-4 border-l-gray-300">
          <p className="text-sm text-gray-500">Not Started</p>
          <p className="text-xl font-bold text-gray-400">{stats.notStarted}</p>
        </Card>
      </div>

      <Card className="flex-1 min-h-0">
        {loading ? (
          <div className="h-full w-full grid place-items-center text-sm text-gray-500">Loading knowledge graph...</div>
        ) : (
          <KnowledgeGraph
            nodes={filteredNodes.map((n) => ({
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
      </Card>
    </div>
  );
}
