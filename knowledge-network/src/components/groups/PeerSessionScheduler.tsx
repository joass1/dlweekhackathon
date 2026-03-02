'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Video, Users, Loader2, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useStudentId } from '@/hooks/useStudentId';
import {
  getActiveSession,
  createSession,
  joinSession,
  type SessionState,
  type MemberProfile,
} from '@/services/peer';

interface Props {
  groupId: string;
  memberProfiles?: MemberProfile[];
  concepts?: { id: string; title: string }[];
}

export function PeerSessionScheduler({ groupId, memberProfiles = [], concepts = [] }: Props) {
  const router = useRouter();
  const { getIdToken } = useAuth();
  const studentId = useStudentId();

  const [activeSession, setActiveSession] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState('');

  // Check for existing active session
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const token = await getIdToken();
        const session = await getActiveSession(groupId, token);
        if (!cancelled) setActiveSession(session);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    check();
    return () => { cancelled = true; };
  }, [groupId, getIdToken]);

  const handleStartSession = async () => {
    if (!selectedTopic || memberProfiles.length === 0) return;
    setCreating(true);
    try {
      const token = await getIdToken();
      const result = await createSession(groupId, selectedTopic, memberProfiles, token);
      router.push(`/groups/${groupId}/session?id=${result.session_id}`);
    } catch (err) {
      console.error('Failed to create session:', err);
      setCreating(false);
    }
  };

  const handleJoinSession = async () => {
    if (!activeSession) return;
    setJoining(true);
    try {
      const token = await getIdToken();
      await joinSession(activeSession.session_id, studentId, studentId, token);
      router.push(`/groups/${groupId}/session?id=${activeSession.session_id}`);
    } catch (err) {
      console.error('Failed to join session:', err);
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <Card className="mb-6">
        <CardContent className="pt-6 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Checking for active sessions...
        </CardContent>
      </Card>
    );
  }

  // Active or waiting session exists
  if (activeSession && activeSession.status !== 'completed') {
    const isInSession = activeSession.members.some(m => m.student_id === studentId);
    const memberNames = activeSession.members.map(m => m.name).join(', ');

    return (
      <Card className="mb-6 ring-2 ring-[#03b2e6]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Video className="w-5 h-5 text-[#03b2e6]" />
            {activeSession.status === 'waiting' ? 'Session Starting...' : 'Session In Progress'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm">
            <p><span className="font-medium">Topic:</span> {activeSession.topic}</p>
            <p className="text-muted-foreground mt-1">
              <Users className="w-3 h-3 inline mr-1" />
              {activeSession.members.length}/{activeSession.expected_members} members joined
              {memberNames && ` — ${memberNames}`}
            </p>
          </div>

          {isInSession ? (
            <Button
              onClick={() => router.push(`/groups/${groupId}/session?id=${activeSession.session_id}`)}
              className="bg-[#03b2e6] hover:bg-[#029ad0] text-white"
            >
              <Play className="w-4 h-4 mr-2" />
              Rejoin Session
            </Button>
          ) : (
            <Button
              onClick={handleJoinSession}
              disabled={joining}
              className="bg-[#03b2e6] hover:bg-[#029ad0] text-white"
            >
              {joining ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Users className="w-4 h-4 mr-2" />}
              Join Session
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  // No active session — show start form
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Video className="w-5 h-5" />
          Peer Learning Session
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Start a collaborative session with your hub. AI will generate round-robin questions targeting each member&apos;s weak areas.
        </p>

        {concepts.length > 0 ? (
          <div>
            <label className="text-sm font-medium block mb-2">Select a topic to study together:</label>
            <select
              value={selectedTopic}
              onChange={(e) => setSelectedTopic(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-[#03b2e6] focus:border-transparent"
            >
              <option value="">Choose a topic...</option>
              {concepts.map((c) => (
                <option key={c.id} value={c.title || c.id}>
                  {c.title || c.id}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="text-sm font-medium block mb-2">Enter a topic to study together:</label>
            <input
              type="text"
              value={selectedTopic}
              onChange={(e) => setSelectedTopic(e.target.value)}
              placeholder="e.g. Sorting Algorithms, Neural Networks..."
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-[#03b2e6] focus:border-transparent"
            />
          </div>
        )}

        <Button
          onClick={handleStartSession}
          disabled={!selectedTopic.trim() || creating || memberProfiles.length === 0}
          className="bg-[#03b2e6] hover:bg-[#029ad0] text-white"
        >
          {creating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creating Session...
            </>
          ) : (
            <>
              <Video className="w-4 h-4 mr-2" />
              Start Session
            </>
          )}
        </Button>

        {memberProfiles.length === 0 && (
          <p className="text-xs text-amber-600">
            Hub member data is needed to start a session. Make sure all members have uploaded materials and completed assessments.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
