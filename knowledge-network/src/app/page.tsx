'use client';

import React, { useEffect, useState } from 'react';
import { Card } from "@/components/ui/card";
import { BookOpen, AlertTriangle, Flame, Rocket, ArrowRight, Loader2 } from 'lucide-react';
import Link from 'next/link';
import KnowledgeGraph from '@/components/graphs/KnowledgeGraph';
import { apiFetch } from '@/services/api';

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

export default function Page() {
  const [nodes, setNodes] = useState<KGNode[]>([]);
  const [links, setLinks] = useState<KGLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadGraph() {
      try {
        const data = await apiFetch<{ nodes: KGNode[]; links: KGLink[] }>('/api/kg/graph');
        setNodes(
          (data.nodes ?? []).map((n: any) => ({
            id: String(n.id),
            title: String(n.title ?? n.id),
            mastery: Number(n.mastery ?? 0),
            status: (n.status ?? 'not_started') as KGNode['status'],
            category: String(n.category ?? 'General'),
            decayTimestamp: n.decayTimestamp ?? null,
          }))
        );
        setLinks(
          (data.links ?? []).map((l: any) => ({
            source: String(l.source),
            target: String(l.target),
            type: l.type === 'prerequisite' ? 'prerequisite' : 'related',
          }))
        );
      } catch {
        // Backend unavailable — show empty state
      } finally {
        setLoading(false);
      }
    }
    loadGraph();
  }, []);

  // Compute real stats from KG data
  const mastered = nodes.filter(n => n.status === 'mastered').length;
  const total = nodes.length;
  const masteryRate = total > 0 ? Math.round((mastered / total) * 100) : 0;

  const now = Date.now();
  const decaying = nodes.filter(n => {
    if (!n.decayTimestamp) return false;
    const ts = new Date(n.decayTimestamp).getTime();
    return ts < now && n.status !== 'mastered';
  }).length;
  // Also count weak concepts as "needing review"
  const needsReview = decaying || nodes.filter(n => n.status === 'weak').length;

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

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">LearnGraph AI Dashboard</h1>
        <p className="text-sm text-gray-500">Your adaptive learning companion</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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
                  <p className="text-2xl font-bold mt-1 text-red-600">{nodes.filter(n => n.status === 'weak').length}</p>
                  <p className="text-sm text-red-600">Deep gaps to fix</p>
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
