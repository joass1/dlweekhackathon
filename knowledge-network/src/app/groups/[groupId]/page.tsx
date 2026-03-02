'use client';

import React, { useEffect, useState, use } from 'react';
import { useAuthedApi } from '@/hooks/useAuthedApi';
import { useStudentId } from '@/hooks/useStudentId';
import { HubMetrics } from '@/components/groups/HubMetrics';
import { PeerSessionScheduler } from '@/components/groups/PeerSessionScheduler';
import { ConceptualGapAnalysis } from '@/components/groups/ConceptualGapAnalysis';
import { GroupFeed } from '@/components/groups/GroupFeed';
import { Card } from '@/components/ui/card';
import { Users } from 'lucide-react';
import type { MemberProfile } from '@/services/peer';

interface PageProps {
  params: Promise<{
    groupId: string;
  }>;
}

interface KGNode {
  id: string;
  title: string;
  mastery: number;
  status: string;
  courseId?: string;
  course_id?: string;
}

export default function GroupDetailPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const groupId = resolvedParams.groupId;
  const { apiFetchWithAuth } = useAuthedApi();
  const studentId = useStudentId();

  const [memberProfiles, setMemberProfiles] = useState<MemberProfile[]>([]);
  const [concepts, setConcepts] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const loadHubData = async () => {
      try {
        // Load the current student's KG to build their concept profile
        const graphData = await apiFetchWithAuth<{ nodes: KGNode[] }>('/api/kg/graph');
        const nodes = graphData.nodes ?? [];

        if (!cancelled) {
          // Build concept list for topic selection
          setConcepts(nodes.map(n => ({ id: n.id, title: n.title || n.id, courseId: n.courseId || n.course_id })));

          // Build member profile for the current student
          const conceptProfile: Record<string, number> = {};
          nodes.forEach(n => {
            conceptProfile[n.id] = n.mastery / 100;
          });

          // For now, the current student is the only profile we have
          // In a full implementation, we'd load all hub members' profiles
          setMemberProfiles([
            { student_id: studentId, name: studentId, concept_profile: conceptProfile },
          ]);
        }
      } catch (err) {
        console.error('Failed to load hub data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadHubData();
    return () => { cancelled = true; };
  }, [apiFetchWithAuth, studentId]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Users className="w-6 h-6 text-[#03b2e6]" />
        <h1 className="text-2xl font-bold">Hub {groupId.replace('hub_', '#')}</h1>
      </div>

      {/* Hub Metrics */}
      <section className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold mb-4">Hub Performance</h2>
        <HubMetrics groupId={groupId} />
      </section>

      {/* Peer Session Launcher */}
      <section>
        <PeerSessionScheduler
          groupId={groupId}
          memberProfiles={memberProfiles}
          concepts={concepts}
        />
      </section>

      {/* Conceptual Gaps */}
      <section>
        <ConceptualGapAnalysis groupId={groupId} />
      </section>

      {/* Group Feed */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Activity Feed</h2>
        <GroupFeed groupId={groupId} />
      </section>
    </div>
  );
}
