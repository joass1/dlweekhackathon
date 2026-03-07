'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useAuthedApi } from '@/hooks/useAuthedApi';
import { useStudentId } from '@/hooks/useStudentId';
import { HubMetrics } from '@/components/groups/HubMetrics';
import { PeerSessionScheduler } from '@/components/groups/PeerSessionScheduler';
import { ConceptualGapAnalysis } from '@/components/groups/ConceptualGapAnalysis';
import { GroupFeed } from '@/components/groups/GroupFeed';
import { Card } from '@/components/ui/card';
import { ArrowLeft, BookOpen, Sparkles, Target, Users } from 'lucide-react';
import type { MemberProfile } from '@/services/peer';
import { useAuth } from '@/contexts/AuthContext';
import { GlowingEffect } from '@/components/ui/glowing-effect';

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

const panelClass = 'glow-card relative overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-br from-slate-900/70 via-slate-800/60 to-slate-900/70 backdrop-blur-md shadow-xl text-white';

function pageShell(children: React.ReactNode) {
  return (
    <div className="relative min-h-full overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/backgrounds/castleviews.jpg')" }}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 bg-slate-950/50" aria-hidden />
      <div className="pointer-events-none absolute -left-20 top-16 h-72 w-72 rounded-full bg-[#03b2e6]/18 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute right-[-5rem] top-[-5rem] h-96 w-96 rounded-full bg-amber-400/12 blur-3xl" aria-hidden />
      <div className="nav-safe-top relative z-10 px-6 pb-8 pt-6">
        <div className="mx-auto max-w-7xl space-y-6">{children}</div>
      </div>
    </div>
  );
}

export default function GroupDetailPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const groupId = resolvedParams.groupId;
  const { apiFetchWithAuth } = useAuthedApi();
  const studentId = useStudentId();
  const { user } = useAuth();
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Player';

  const [memberProfiles, setMemberProfiles] = useState<MemberProfile[]>([]);
  const [concepts, setConcepts] = useState<{ id: string; title: string; courseId?: string }[]>([]);
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
            { student_id: studentId, name: displayName, concept_profile: conceptProfile },
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
  }, [apiFetchWithAuth, studentId, displayName]);

  if (loading) {
    return pageShell(
      <Card className={`${panelClass} p-8`}>
        <GlowingEffect spread={220} glow={true} disabled={false} proximity={72} borderWidth={2} variant="cyan" />
        <div className="flex items-center gap-3 text-white/70">
          <Users className="h-5 w-5 text-[#4cc9f0] animate-pulse" />
          <span>Preparing your hub workspace...</span>
        </div>
      </Card>
    );
  }

  return pageShell(
    <>
      <Card className={`${panelClass} p-6 md:p-8`}>
        <GlowingEffect spread={260} glow={true} disabled={false} proximity={90} borderWidth={2} variant="cyan" />
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <Link
              href="/groups"
              className="inline-flex items-center gap-2 text-sm font-medium text-white/70 transition-colors hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to all hubs
            </Link>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#4cc9f0]">
              <Sparkles className="h-3.5 w-3.5" />
              Peer Learning Hub
            </p>
            <div className="flex items-center gap-3">
              <Users className="h-7 w-7 text-[#03b2e6]" />
              <h1 className="text-3xl font-bold text-white md:text-4xl">Hub {groupId.replace('hub_', '#')}</h1>
            </div>
            <p className="max-w-3xl text-sm leading-6 text-white/70 md:text-base">
              This hub brings your matched group into one shared workspace for live sessions, shared weak spots,
              and collaborative progress tracking.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:min-w-[320px]">
            <div className="rounded-2xl border border-white/12 bg-white/6 p-4 backdrop-blur-sm">
              <p className="text-xs uppercase tracking-[0.12em] text-white/50">Profiles Loaded</p>
              <p className="mt-2 text-2xl font-bold text-white">{memberProfiles.length}</p>
              <p className="mt-1 text-xs text-white/55">Ready for session matching</p>
            </div>
            <div className="rounded-2xl border border-white/12 bg-white/6 p-4 backdrop-blur-sm">
              <p className="text-xs uppercase tracking-[0.12em] text-white/50">Topics Ready</p>
              <p className="mt-2 text-2xl font-bold text-white">{concepts.length}</p>
              <p className="mt-1 text-xs text-white/55">Available from your uploaded material</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <PeerSessionScheduler
          groupId={groupId}
          memberProfiles={memberProfiles}
          concepts={concepts}
        />

        <Card className={`${panelClass} p-6`}>
          <GlowingEffect spread={220} glow={true} disabled={false} proximity={72} borderWidth={2} variant="cyan" />
          <div className="space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4cc9f0]">Hub Snapshot</p>
              <h2 className="mt-2 text-xl font-semibold text-white">What this space is for</h2>
            </div>
            <div className="space-y-4 text-sm text-white/70">
              <div className="flex items-start gap-3">
                <Target className="mt-0.5 h-4 w-4 text-amber-300" />
                <p>Start a targeted study session that focuses on weak areas instead of random revision.</p>
              </div>
              <div className="flex items-start gap-3">
                <BookOpen className="mt-0.5 h-4 w-4 text-emerald-300" />
                <p>Review group performance trends and see whether the team is getting sharper over time.</p>
              </div>
              <div className="flex items-start gap-3">
                <Users className="mt-0.5 h-4 w-4 text-cyan-300" />
                <p>
                  Use the hub as a shared practice room. It keeps the same core UI language as the rest of Mentora
                  so the experience feels continuous instead of switching into a different product.
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <section className="space-y-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4cc9f0]">Hub Intelligence</p>
          <h2 className="text-2xl font-semibold text-white">Performance and shared gaps</h2>
        </div>
        <HubMetrics groupId={groupId} />
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <ConceptualGapAnalysis groupId={groupId} />
        <GroupFeed groupId={groupId} />
      </div>
    </>
  );
}
