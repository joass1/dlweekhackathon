// src/app/groups/page.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import Link from 'next/link';
import Image from 'next/image';
import { useStudentId } from '@/hooks/useStudentId';
import { Users, Play, UserPlus } from 'lucide-react';
import { useAuthedApi } from '@/hooks/useAuthedApi';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getAllActiveSessions, joinSession, type SessionSummary } from '@/services/peer';
import { useAuth } from '@/contexts/AuthContext';

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

export default function GroupsPage() {
  const studentId = useStudentId();
  const { apiFetchWithAuth } = useAuthedApi();
  const { getIdToken } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [activeSessions, setActiveSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const topicFromGraph = (searchParams.get('topic') || '').trim();

  // Load hubs + all active sessions
  useEffect(() => {
    async function loadData() {
      try {
        const token = await getIdToken();

        // Load active sessions (runs in parallel with hubs)
        const sessionsPromise = getAllActiveSessions(token).catch(() => []);

        // Load KG to build current student's concept profile for hub matching
        const graphData = await apiFetchWithAuth<{ nodes: KGNode[] }>('/api/kg/graph');
        const nodes = graphData.nodes ?? [];

        if (nodes.length === 0) {
          const sessions = await sessionsPromise;
          setActiveSessions(sessions);
          setLoading(false);
          return;
        }

        // Build a concept profile for the current student.
        const conceptProfile: Record<string, number> = {};
        nodes.forEach(n => {
          conceptProfile[n.id] = n.mastery / 100;
        });

        const students = [{ student_id: studentId, name: studentId, concept_profile: conceptProfile }];

        // Call hub matching API
        const hubResult = await apiFetchWithAuth<{ hubs: Hub[] }>('/api/adaptive/hubs/match', {
          method: 'POST',
          body: JSON.stringify({
            students,
            hub_size: 4,
          }),
        });

        const sessions = await sessionsPromise;
        setHubs(hubResult.hubs ?? []);
        setActiveSessions(sessions);
      } catch (err) {
        console.error('Failed to load groups:', err);
        setError('Could not load peer learning hubs. Make sure the backend is running.');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [apiFetchWithAuth, studentId, getIdToken]);

  // Join a session and navigate to it
  const handleJoinSession = async (session: SessionSummary) => {
    setJoiningId(session.session_id);
    try {
      const token = await getIdToken();
      await joinSession(session.session_id, studentId, studentId, token);
      router.push(`/groups/${session.hub_id}/session?id=${session.session_id}`);
    } catch (err) {
      console.error('Failed to join session:', err);
      setJoiningId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Image
          src="/logo-images/favicon.png"
          alt="Loading"
          width={28}
          height={28}
          className="animate-bounce mr-2"
          priority
        />
        <span className="text-muted-foreground">Matching peer learning hubs...</span>
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
      <p className="text-sm text-muted-foreground mb-6">
        Balanced groups where each member&apos;s strengths complement others&apos; weaknesses.
      </p>

      {/* ── Active Sessions (browse & join any) ──────────────────────── */}
      {activeSessions.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Play className="w-4 h-4 text-green-600" />
            Live Sessions
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeSessions.map((s) => {
              const alreadyIn = s.members.some(m => m.student_id === studentId);
              return (
                <Card key={s.session_id} className="border-green-200 bg-green-50/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      {s.topic}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {s.status === 'waiting' ? 'Waiting for players...' : 'In progress'} &middot; {s.members.length}/{s.expected_members} joined &middot; {s.question_count} questions
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Participants:</p>
                      <div className="flex flex-wrap gap-1">
                        {s.members.map((m) => (
                          <span
                            key={m.student_id}
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              m.student_id === studentId
                                ? 'bg-[#e0f4fb] text-[#03b2e6] font-medium'
                                : 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {m.name}{m.student_id === studentId ? ' (you)' : ''}
                          </span>
                        ))}
                        {s.members.length < s.expected_members && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-50 text-gray-400 border border-dashed border-gray-300">
                            +{s.expected_members - s.members.length} open
                          </span>
                        )}
                      </div>
                    </div>
                    {alreadyIn ? (
                      <Button
                        size="sm"
                        className="w-full bg-[#03b2e6] hover:bg-[#029dd4] text-white"
                        onClick={() => router.push(`/groups/${s.hub_id}/session?id=${s.session_id}`)}
                      >
                        Rejoin Session
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={() => handleJoinSession(s)}
                        disabled={joiningId === s.session_id}
                      >
                        {joiningId === s.session_id ? (
                          <>Joining...</>
                        ) : (
                          <><UserPlus className="w-3 h-3 mr-1" /> Join Session</>
                        )}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {topicFromGraph && (
        <Card className="mb-5 p-4 bg-blue-50 border-blue-200">
          <p className="text-sm text-blue-800">
            Focused topic from Knowledge Map: <span className="font-semibold">{topicFromGraph}</span>
          </p>
        </Card>
      )}

      {hubs.length === 0 ? (
        <Card className="p-8 text-center">
          <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-muted-foreground mb-2">No hubs available yet.</p>
          <p className="text-sm text-muted-foreground">Upload course materials and complete some assessments first.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {hubs.map((hub) => {
            const yourHub = hub.members.some(m => m.student_id === studentId);
            return (
              <Link key={hub.hub_id} href={`/groups/${hub.hub_id}`}>
                <Card className={`hover:shadow-lg transition-shadow ${yourHub ? 'ring-2 ring-[#03b2e6]' : ''}`}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Hub {hub.hub_id.replace('hub_', '#')}
                      {yourHub && <span className="text-xs bg-[#e0f4fb] text-[#03b2e6] px-2 py-0.5 rounded-full">Your Hub</span>}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">{hub.members.length} members</p>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Avg Mastery</span>
                        <span className="font-medium">{Math.round(hub.hub_avg_mastery * 100)}%</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-[#03b2e6] h-2 rounded-full"
                          style={{ width: `${hub.hub_avg_mastery * 100}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Complementarity</span>
                        <span className="font-medium">{(hub.complementarity_score * 100).toFixed(0)}%</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {Object.entries(hub.tier_distribution).map(([tier, count]) => (
                          <span key={tier} className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">
                            {tier}: {count}
                          </span>
                        ))}
                      </div>
                      <div className="text-xs text-muted-foreground mt-2">
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
