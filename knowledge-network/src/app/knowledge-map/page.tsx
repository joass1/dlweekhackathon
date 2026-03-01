'use client';

import React, { useEffect, useMemo, useState } from 'react';
import KnowledgeGraph from '@/components/graphs/KnowledgeGraph';
import { Card } from '@/components/ui/card';

type GraphStatus = 'mastered' | 'learning' | 'weak' | 'not_started';

interface GraphNode {
  id: string;
  title: string;
  mastery: number;
  status: GraphStatus;
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
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [loading, setLoading] = useState(true);

  const courses = [
    { id: 'all', name: 'All Courses' },
    { id: 'physics', name: 'Physics 101' },
    { id: 'data-structures', name: 'Data Structures' },
  ];

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
    const map: Record<string, string> = {
      physics: 'Physics',
      'data-structures': 'Data Structures',
    };
    return nodes.filter((n) => n.category === map[selectedCourse]);
  }, [nodes, selectedCourse]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);
  const filteredLinks = useMemo(
    () => links.filter((l) => filteredNodeIds.has(l.source) && filteredNodeIds.has(l.target)),
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
