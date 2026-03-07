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
import { GlowingEffect } from '@/components/ui/glowing-effect';

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

const glassCardClass = 'rounded-2xl border border-white/15 bg-gradient-to-br from-slate-900/70 via-slate-800/60 to-slate-900/70 backdrop-blur-md shadow-xl';

export default function GroupsPage() {
  const studentId = useStudentId();
  const { apiFetchWithAuth } = useAuthedApi();
  const { user, getIdToken } = useAuth();
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Player';
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

        const students = [{ student_id: studentId, name: displayName, concept_profile: conceptProfile }];

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
      await joinSession(session.session_id, studentId, displayName, token);
      router.push(`/groups/${session.hub_id}/session?id=${session.session_id}`);
    } catch (err) {
      console.error('Failed to join session:', err);
      setJoiningId(null);
    }
  };

  const pageShell = (children: React.ReactNode) => (
    <div className="relative min-h-full overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/backgrounds/castleviews.jpg')" }}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 bg-slate-950/45" aria-hidden />
      <div className="pointer-events-none absolute -left-20 top-16 h-72 w-72 rounded-full bg-[#03b2e6]/18 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute right-[-5rem] top-[-5rem] h-96 w-96 rounded-full bg-amber-400/12 blur-3xl" aria-hidden />
      <div className="nav-safe-top relative z-10 p-6 text-white">
        {children}
      </div>
    </div>
  );

  if (loading) {
    return pageShell(
      <div className="flex items-center justify-center min-h-[400px]">
        <Image
          src="/logo-images/favicon.png"
          alt="Loading"
          width={28}
          height={28}
          className="animate-bounce mr-2"
          priority
        />
        <span className="text-white/60">Matching peer learning hubs...</span>
      </div>
    );
  }

  if (error) {
    return pageShell(
      <>
        <h1 className="text-2xl font-bold mb-6 text-white">Peer Learning Hubs</h1>
        <Card className={`${glassCardClass} p-6 border-red-300/30 bg-red-500/20 text-red-100 text-sm`}>{error}</Card>
      </>
    );
  }

  return pageShell(
    <>
      <Card className={`glow-card relative overflow-hidden ${glassCardClass} p-6 md:p-8 mb-8 text-white`}>
        <GlowingEffect spread={240} glow={true} disabled={false} proximity={84} borderWidth={2} variant="cyan" />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#4cc9f0]">
              <Users className="h-3.5 w-3.5" />
              Peer Learning Hubs
            </p>
            <div>
              <h1 className="text-3xl font-bold text-white md:text-4xl">Find the right study squad</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/70 md:text-base">
                Balanced groups where each member&apos;s strengths complement others&apos; weaknesses, with the same dark
                glass UI language used across the rest of Mentora.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:min-w-[320px]">
            <div className="rounded-2xl border border-white/12 bg-white/6 p-4 backdrop-blur-sm">
              <p className="text-xs uppercase tracking-[0.12em] text-white/50">Live Sessions</p>
              <p className="mt-2 text-2xl font-bold text-white">{activeSessions.length}</p>
              <p className="mt-1 text-xs text-white/55">Join one already in progress</p>
            </div>
            <div className="rounded-2xl border border-white/12 bg-white/6 p-4 backdrop-blur-sm">
              <p className="text-xs uppercase tracking-[0.12em] text-white/50">Matched Hubs</p>
              <p className="mt-2 text-2xl font-bold text-white">{hubs.length}</p>
              <p className="mt-1 text-xs text-white/55">Built from your current graph</p>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Active Sessions (browse & join any) ──────────────────────── */}
      {activeSessions.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2 text-white">
            <Play className="w-4 h-4 text-emerald-400" />
            Live Sessions
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeSessions.map((s) => {
              const alreadyIn = s.members.some(m => m.student_id === studentId);
              return (
                <Card key={s.session_id} className={`glow-card relative ${glassCardClass} border-emerald-400/30 overflow-hidden`}>
                  <GlowingEffect spread={200} glow={true} disabled={false} proximity={64} borderWidth={2} variant="cyan" />
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2 text-white">
                      <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      {s.topic}
                    </CardTitle>
                    <p className="text-xs text-white/60">
                      {s.status === 'waiting' ? 'Waiting for players...' : 'In progress'} &middot; {s.members.length}/{s.expected_members} joined &middot; {s.question_count} questions
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3">
                      <p className="text-xs font-medium text-white/60 mb-1">Participants:</p>
                      <div className="flex flex-wrap gap-1">
                        {s.members.map((m) => (
                          <span
                            key={m.student_id}
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              m.student_id === studentId
                                ? 'bg-[#03b2e6]/25 text-[#4cc9f0] font-medium'
                                : 'bg-white/10 text-white/80'
                            }`}
                          >
                            {m.name}{m.student_id === studentId ? ' (you)' : ''}
                          </span>
                        ))}
                        {s.members.length < s.expected_members && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40 border border-dashed border-white/20">
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
                        className="w-full bg-white/10 hover:bg-white/20 text-white border border-white/20"
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
        <div className="mb-5 rounded-2xl border border-[#03b2e6]/25 bg-[#03b2e6]/12 p-4 backdrop-blur-sm">
          <p className="text-sm text-white">
            Focused topic from Knowledge Map: <span className="font-semibold">{topicFromGraph}</span>
          </p>
        </div>
      )}

      {hubs.length === 0 ? (
        <Card className={`${glassCardClass} p-8 text-center`}>
          <Users className="w-10 h-10 text-white/30 mx-auto mb-3" />
          <p className="text-white/70 mb-2">No hubs available yet.</p>
          <p className="text-sm text-white/60">Upload course materials and complete some assessments first.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {hubs.map((hub) => {
            const yourHub = hub.members.some(m => m.student_id === studentId);
            return (
              <Link key={hub.hub_id} href={`/groups/${hub.hub_id}`}>
                <Card className={`glow-card relative ${glassCardClass} overflow-hidden transition-all hover:-translate-y-0.5 ${
                  yourHub ? 'border-[#03b2e6]/60 ring-1 ring-[#03b2e6]/40' : ''
                }`}>
                  <GlowingEffect spread={200} glow={true} disabled={false} proximity={64} borderWidth={2} variant="cyan" />
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <Users className="w-4 h-4" />
                      Hub {hub.hub_id.replace('hub_', '#')}
                      {yourHub && <span className="text-xs bg-[#03b2e6]/25 text-[#4cc9f0] px-2 py-0.5 rounded-full">Your Hub</span>}
                    </CardTitle>
                    <p className="text-sm text-white/60">{hub.members.length} members</p>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-white/60">Avg Mastery</span>
                        <span className="font-medium text-white">{Math.round(hub.hub_avg_mastery * 100)}%</span>
                      </div>
                      <div className="w-full bg-white/10 rounded-full h-2">
                        <div
                          className="bg-[#03b2e6] h-2 rounded-full"
                          style={{ width: `${hub.hub_avg_mastery * 100}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-white/60">Complementarity</span>
                        <span className="font-medium text-white">{(hub.complementarity_score * 100).toFixed(0)}%</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {Object.entries(hub.tier_distribution).map(([tier, count]) => (
                          <span key={tier} className="text-xs bg-white/10 text-white/70 px-2 py-0.5 rounded">
                            {tier}: {count}
                          </span>
                        ))}
                      </div>
                      <div className="text-xs text-white/50 mt-2">
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
    </>
  );
}
