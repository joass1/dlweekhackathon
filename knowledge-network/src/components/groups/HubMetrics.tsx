'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getSessionHistory, type SessionState } from '@/services/peer';
import { Card } from '@/components/ui/card';
import { GlowingEffect } from '@/components/ui/glowing-effect';

interface HubMetricsProps {
  groupId: string;
}

const metricCardClass = 'glow-card relative overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-br from-slate-900/70 via-slate-800/60 to-slate-900/70 backdrop-blur-md shadow-xl text-white';

export function HubMetrics({ groupId }: HubMetricsProps) {
  const { getIdToken } = useAuth();
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const token = await getIdToken();
        const history = await getSessionHistory(groupId, token);
        if (!cancelled) setSessions(history);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [groupId, getIdToken]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[1, 2, 3].map(i => (
          <Card key={i} className={`${metricCardClass} p-5`}>
            <div className="animate-pulse space-y-3">
              <div className="h-3 w-24 rounded bg-white/10" />
              <div className="h-8 w-16 rounded bg-white/15" />
              <div className="h-3 w-32 rounded bg-white/10" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  const totalSessions = sessions.length;
  const totalAnswers = sessions.reduce((sum, s) => sum + (s.answers?.length || 0), 0);
  const correctAnswers = sessions.reduce(
    (sum, s) => sum + (s.answers?.filter(a => a.is_correct).length || 0),
    0,
  );
  const avgScore = totalAnswers > 0
    ? sessions.reduce(
        (sum, s) => sum + (s.answers?.reduce((a, b) => a + b.score, 0) || 0),
        0,
      ) / totalAnswers
    : 0;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <MetricCard
        title="Sessions Completed"
        value={String(totalSessions)}
        description="Total collaborative sessions"
        accentClass="text-cyan-300"
      />
      <MetricCard
        title="Accuracy"
        value={totalAnswers > 0 ? `${Math.round((correctAnswers / totalAnswers) * 100)}%` : '-'}
        description={`${correctAnswers}/${totalAnswers} questions correct`}
        accentClass="text-emerald-300"
      />
      <MetricCard
        title="Avg Score"
        value={totalAnswers > 0 ? `${Math.round(avgScore * 100)}%` : '-'}
        description="Average AI evaluation score"
        accentClass="text-amber-300"
      />
    </div>
  );
}

function MetricCard({
  title,
  value,
  description,
  accentClass,
}: {
  title: string;
  value: string;
  description: string;
  accentClass: string;
}) {
  return (
    <Card className={`${metricCardClass} p-5`}>
      <GlowingEffect spread={180} glow={true} disabled={false} proximity={64} borderWidth={2} variant="cyan" />
      <h3 className="text-sm font-medium text-white/60">{title}</h3>
      <div className="mt-3">
        <span className={`text-3xl font-bold ${accentClass}`}>{value}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-white/55">{description}</p>
    </Card>
  );
}
