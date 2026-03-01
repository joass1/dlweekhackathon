'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthedApi } from '@/hooks/useAuthedApi';

interface GraphNode {
  id: string;
  title?: string;
  category?: string;
  mastery?: number;
  status?: string;
}

function getApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'http://127.0.0.1:8000';
  }
}

export default function AssessmentSelectionPage() {
  const router = useRouter();
  const { authedFetch } = useAuthedApi();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await authedFetch(`${getApiBase()}/api/kg/graph`);
        if (!res.ok) {
          throw new Error(`Failed to load graph (${res.status})`);
        }
        const data = await res.json();
        if (!cancelled) {
          setNodes(Array.isArray(data?.nodes) ? data.nodes : []);
        }
      } catch (e) {
        if (!cancelled) {
          setNodes([]);
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
  }, [authedFetch]);

  const concepts = useMemo(
    () =>
      nodes.map((n) => ({
        id: String(n.id),
        title: String(n.title || n.id).trim(),
        category: String(n.category || 'General'),
        masteryPct: Math.round(Math.max(0, Math.min(1, Number(n.mastery ?? 0))) * 100),
      })),
    [nodes]
  );

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold mb-4">LearnGraph Assessments</h1>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Assessments are generated from your uploaded materials and current knowledge map.
          </p>
        </div>

        {loading ? (
          <div className="bg-white border rounded-xl p-10 text-center text-gray-600">Loading concepts...</div>
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
            <p className="text-gray-600 mb-6">
              Upload course materials first. Your assessments will only appear after concepts exist in your knowledge map.
            </p>
            <Link
              href="/upload"
              className="inline-flex items-center px-5 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Upload Materials
            </Link>
          </div>
        ) : null}

        {!loading && !error && concepts.length > 0 ? (
          <div className="grid md:grid-cols-3 gap-6">
            {concepts.map((concept) => (
              <button
                key={concept.id}
                className="text-left bg-white rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow"
                onClick={() => router.push(`/assessment/${concept.id}/intro`)}
              >
                <div className="p-6">
                  <h2 className="text-xl font-semibold mb-2">{concept.title}</h2>
                  <p className="text-gray-600 mb-4">{concept.category}</p>
                  <div className="flex items-center justify-between text-sm text-gray-500">
                    <span>5 questions</span>
                    <span>{concept.masteryPct}% mastery</span>
                  </div>
                </div>
                <div className="bg-emerald-50 p-4 text-center">
                  <span className="text-emerald-600 font-medium">Begin Assessment</span>
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
