// src/app/groups/page.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import Link from 'next/link';
import { apiFetch } from '@/services/api';
import { Loader2, Users } from 'lucide-react';

interface HubMember {
  student_id: string;
  name: string;
  tier: string;
  avg_mastery: number;
}

interface Hub {
  hub_id: string;
  members: HubMember[];
  complementarity_score: number;
  hub_avg_mastery: number;
  tier_distribution: Record<string, number>;
}

interface KGNode {
  id: string;
  title: string;
  mastery: number;
  status: string;
}

interface CourseOption {
  id: string;
  name: string;
}

export default function GroupsPage() {
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        // Load courses
        const courseData = await apiFetch<{ courses: CourseOption[] }>('/api/courses');
        setCourses(courseData.courses ?? []);

        // Load KG to build student concept profiles for hub matching
        const graphData = await apiFetch<{ nodes: KGNode[] }>('/api/kg/graph');
        const nodes = graphData.nodes ?? [];

        if (nodes.length === 0) {
          setLoading(false);
          return;
        }

        // Build a concept profile for the current student and generate simulated peers
        const conceptProfile: Record<string, number> = {};
        nodes.forEach(n => {
          conceptProfile[n.id] = n.mastery / 100;
        });

        // Create simulated peer students with varied profiles for hub matching demo
        const simulatedStudents = [
          { student_id: 'current-student', name: 'You', concept_profile: conceptProfile },
          ...generateSimulatedPeers(nodes, 7),
        ];

        // Call hub matching API
        const hubResult = await apiFetch<{ hubs: Hub[] }>('/api/adaptive/hubs/match', {
          method: 'POST',
          body: JSON.stringify({
            students: simulatedStudents,
            hub_size: 4,
          }),
        });

        setHubs(hubResult.hubs ?? []);
      } catch (err) {
        console.error('Failed to load groups:', err);
        setError('Could not load peer learning hubs. Make sure the backend is running.');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-600 mr-2" />
        <span className="text-gray-500">Matching peer learning hubs...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Peer Learning Hubs</h1>
        <Card className="p-6 bg-red-50 border-red-200 text-red-700 text-sm">{error}</Card>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-2">Peer Learning Hubs</h1>
      <p className="text-sm text-gray-500 mb-6">
        Balanced groups where each member&apos;s strengths complement others&apos; weaknesses.
      </p>

      {hubs.length === 0 ? (
        <Card className="p-8 text-center">
          <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 mb-2">No hubs available yet.</p>
          <p className="text-sm text-gray-400">Upload course materials and complete some assessments first.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {hubs.map((hub) => {
            const yourHub = hub.members.some(m => m.student_id === 'current-student');
            return (
              <Link key={hub.hub_id} href={`/groups/${hub.hub_id}`}>
                <Card className={`hover:shadow-lg transition-shadow ${yourHub ? 'ring-2 ring-emerald-400' : ''}`}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Hub {hub.hub_id.replace('hub_', '#')}
                      {yourHub && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Your Hub</span>}
                    </CardTitle>
                    <p className="text-sm text-gray-500">{hub.members.length} members</p>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Avg Mastery</span>
                        <span className="font-medium">{Math.round(hub.hub_avg_mastery * 100)}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-emerald-600 h-2 rounded-full"
                          style={{ width: `${hub.hub_avg_mastery * 100}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Complementarity</span>
                        <span className="font-medium">{(hub.complementarity_score * 100).toFixed(0)}%</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {Object.entries(hub.tier_distribution).map(([tier, count]) => (
                          <span key={tier} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                            {tier}: {count}
                          </span>
                        ))}
                      </div>
                      <div className="text-xs text-gray-400 mt-2">
                        {hub.members.map(m => m.name).join(', ')}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Generate simulated peers with inverted/varied mastery profiles. */
function generateSimulatedPeers(
  nodes: KGNode[],
  count: number
): { student_id: string; name: string; concept_profile: Record<string, number> }[] {
  const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace'];
  return names.slice(0, count).map((name, i) => {
    const profile: Record<string, number> = {};
    nodes.forEach((n, j) => {
      // Create diverse profiles: some inverse of current student, some random
      const base = n.mastery / 100;
      const variation = Math.sin(i * 1.5 + j * 0.7) * 0.4;
      profile[n.id] = Math.max(0, Math.min(1, (i % 2 === 0 ? 1 - base : base) + variation));
    });
    return { student_id: `peer-${name.toLowerCase()}`, name, concept_profile: profile };
  });
}
