'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getSessionHistory, type SessionState } from '@/services/peer';

interface HubMetricsProps {
  groupId: string;
}

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
      <div className="grid grid-cols-3 gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-accent rounded-lg p-4 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-24 mb-2" />
            <div className="h-8 bg-gray-200 rounded w-16" />
          </div>
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
    <div className="grid grid-cols-3 gap-4">
      <MetricCard
        title="Sessions Completed"
        value={String(totalSessions)}
        description="Total collaborative sessions"
      />
      <MetricCard
        title="Accuracy"
        value={totalAnswers > 0 ? `${Math.round((correctAnswers / totalAnswers) * 100)}%` : '-'}
        description={`${correctAnswers}/${totalAnswers} questions correct`}
      />
      <MetricCard
        title="Avg Score"
        value={totalAnswers > 0 ? `${Math.round(avgScore * 100)}%` : '-'}
        description="Average AI evaluation score"
      />
    </div>
  );
}

function MetricCard({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <div className="bg-accent rounded-lg p-4">
      <h3 className="text-sm text-muted-foreground">{title}</h3>
      <div className="mt-2">
        <span className="text-2xl font-bold">{value}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-2">{description}</p>
    </div>
  );
}
