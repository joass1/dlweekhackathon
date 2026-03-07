'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Video, Users, Loader2, Play, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useStudentId } from '@/hooks/useStudentId';
import { apiFetch } from '@/services/api';
import {
  getActiveSession,
  createSession,
  joinSession,
  type SessionState,
  type MemberProfile,
} from '@/services/peer';
import { GlowingEffect } from '@/components/ui/glowing-effect';

interface Props {
  groupId: string;
  memberProfiles?: MemberProfile[];
  concepts?: { id: string; title: string; courseId?: string }[];
}

const LEVEL_OPTIONS = [
  { value: 1, label: 'Level 1' },
  { value: 2, label: 'Level 2' },
  { value: 3, label: 'Level 3' },
  { value: 4, label: 'Level 4' },
] as const;
const panelClass =
  'glow-card relative overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-br from-slate-900/70 via-slate-800/60 to-slate-900/70 backdrop-blur-md shadow-xl text-white';
const fieldClass =
  'w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-400/25';

const UID_LIKE_RE = /^[a-z0-9_-]{20,}$/i;

function looksLikeUid(value: string): boolean {
  const text = String(value || '').trim();
  if (!text) return true;
  if (text.includes(' ')) return false;
  return UID_LIKE_RE.test(text);
}

function formatSessionMemberName(
  member: { student_id: string; name: string },
  currentStudentId: string,
  currentDisplayName: string,
): string {
  if (member.student_id === currentStudentId) return currentDisplayName;
  const raw = String(member.name || '').trim();
  if (!raw || raw === member.student_id || looksLikeUid(raw)) return 'Teammate';
  return raw;
}

function toFriendlyStartError(err: unknown): string {
  const raw = err instanceof Error ? err.message : 'Failed to create session.';
  const trimmed = raw.replace(/^API\s+\d+:\s*/i, '').trim();

  let detail = trimmed;
  try {
    const parsed = JSON.parse(trimmed) as { detail?: unknown };
    if (parsed && typeof parsed === 'object' && typeof parsed.detail === 'string') {
      detail = parsed.detail.trim();
    }
  } catch {
    // keep raw detail when body is not JSON
  }

  const unlockMatch = detail.match(/Unlock Level\s+(\d+)\s+first:\s*defeat the Level\s+(\d+)\s+boss for\s+'([^']+)'/i);
  if (unlockMatch) {
    const target = unlockMatch[1];
    const prerequisite = unlockMatch[2];
    const topic = unlockMatch[3];
    return `Level ${target} is locked. Defeat the Level ${prerequisite} boss for "${topic}" first.`;
  }

  if (/active or waiting session already exists/i.test(detail)) {
    return 'A session is already in progress for this hub. Join it or finish it before starting another one.';
  }
  if (/no uploaded material found/i.test(detail)) {
    return 'No uploaded material was found for this course yet. Upload your study files first.';
  }
  if (/could not verify level unlocks/i.test(detail)) {
    return 'Could not verify level unlocks right now. Please try again in a moment.';
  }

  return detail || 'Failed to create session.';
}

export function PeerSessionScheduler({ groupId, memberProfiles = [], concepts = [] }: Props) {
  const router = useRouter();
  const { getIdToken, user } = useAuth();
  const studentId = useStudentId();
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Player';

  const [activeSession, setActiveSession] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<number>(1);
  const [courses, setCourses] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const token = await getIdToken();
        const session = await getActiveSession(groupId, token);
        if (!cancelled) setActiveSession(session);
      } catch {
        // Ignore empty state errors here and let the create flow handle it.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [groupId, getIdToken]);

  useEffect(() => {
    let cancelled = false;
    const loadCourses = async () => {
      try {
        const token = await getIdToken();
        const result = await apiFetch<{ courses?: Array<{ id: string; name: string }> }>('/api/courses', undefined, token);
        if (cancelled) return;
        const list = Array.isArray(result.courses) ? result.courses : [];
        setCourses(list);
        if (!selectedCourse && list.length > 0) {
          setSelectedCourse(list[0].id);
        }
      } catch {
        if (!cancelled) setCourses([]);
      }
    };
    void loadCourses();
    return () => {
      cancelled = true;
    };
  }, [getIdToken, selectedCourse]);

  const filteredConcepts = selectedCourse
    ? concepts.filter((c) => !c.courseId || c.courseId === selectedCourse)
    : concepts;

  useEffect(() => {
    if (!selectedTopic || concepts.length === 0) return;
    const exists = filteredConcepts.some((c) => c.id === selectedTopic);
    if (!exists) setSelectedTopic('');
  }, [concepts.length, filteredConcepts, selectedTopic]);

  const handleStartSession = async () => {
    if (memberProfiles.length === 0) return;
    setStartError(null);
    setCreating(true);
    try {
      const token = await getIdToken();
      const selectedConcept = concepts.find((c) => c.id === selectedTopic);
      const conceptId = selectedConcept ? selectedConcept.id : null;
      const selectedCourseRow = courses.find((c) => c.id === selectedCourse);
      const topicLabel = selectedConcept
        ? (selectedConcept.title || selectedConcept.id)
        : (selectedTopic.trim() || selectedCourseRow?.name || '');
      const result = await createSession(
        groupId,
        topicLabel,
        selectedLevel,
        conceptId,
        selectedCourse || null,
        selectedCourseRow?.name || null,
        memberProfiles,
        token,
      );
      router.push(`/groups/${groupId}/session?id=${result.session_id}`);
    } catch (err) {
      setStartError(toFriendlyStartError(err));
      setCreating(false);
    }
  };

  const handleJoinSession = async () => {
    if (!activeSession) return;
    setJoining(true);
    try {
      const token = await getIdToken();
      await joinSession(activeSession.session_id, studentId, displayName, token);
      router.push(`/groups/${groupId}/session?id=${activeSession.session_id}`);
    } catch (err) {
      console.error('Failed to join session:', err);
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <Card className={`${panelClass} mb-6`}>
        <GlowingEffect spread={220} glow={true} disabled={false} proximity={72} borderWidth={2} variant="cyan" />
        <CardContent className="flex items-center justify-center gap-2 pt-6 text-white/65">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking for active sessions...
        </CardContent>
      </Card>
    );
  }

  if (activeSession && activeSession.status !== 'completed') {
    const isInSession = activeSession.members.some((m) => m.student_id === studentId);
    const memberNames = activeSession.members
      .map((m) => formatSessionMemberName(m, studentId, displayName))
      .join(', ');

    return (
      <Card className={`${panelClass} mb-6 ring-1 ring-[#03b2e6]/35`}>
        <GlowingEffect spread={240} glow={true} disabled={false} proximity={80} borderWidth={2} variant="cyan" />
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Video className="h-5 w-5 text-[#4cc9f0]" />
            {activeSession.status === 'waiting' ? 'Session Starting...' : 'Session In Progress'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-white/80">
            <p><span className="font-medium text-white">Topic:</span> {activeSession.topic}</p>
            {activeSession.level && (
              <p className="mt-1 text-white/55">
                <span className="font-medium text-white/75">Level:</span> {activeSession.level}
              </p>
            )}
            {(activeSession.course_name || activeSession.course_id) && (
              <p className="mt-1 text-white/55">
                <span className="font-medium text-white/75">Course:</span> {activeSession.course_name || activeSession.course_id}
              </p>
            )}
            <p className="mt-1 text-white/55">
              <Users className="mr-1 inline h-3 w-3" />
              {activeSession.members.length}/{activeSession.expected_members} members joined
              {memberNames && ` - ${memberNames}`}
            </p>
          </div>

          {isInSession ? (
            <Button
              onClick={() => router.push(`/groups/${groupId}/session?id=${activeSession.session_id}`)}
              className="bg-[#03b2e6] text-white hover:bg-[#029ad0]"
            >
              <Play className="mr-2 h-4 w-4" />
              Rejoin Session
            </Button>
          ) : (
            <Button
              onClick={handleJoinSession}
              disabled={joining}
              className="bg-[#03b2e6] text-white hover:bg-[#029ad0]"
            >
              {joining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
              Join Session
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`${panelClass} mb-6`}>
      <GlowingEffect spread={240} glow={true} disabled={false} proximity={80} borderWidth={2} variant="cyan" />
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white">
          <Video className="h-5 w-5 text-[#4cc9f0]" />
          Peer Learning Session
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3 rounded-2xl border border-cyan-300/15 bg-white/5 p-4">
          <Sparkles className="mt-0.5 h-4 w-4 text-[#4cc9f0]" />
          <p className="text-sm leading-6 text-white/70">
            Start a collaborative session with your hub. Mentora will generate round-robin questions that target the
            weak areas your group is best placed to help with.
          </p>
        </div>

        {courses.length > 0 && (
          <div>
            <label className="mb-2 block text-sm font-medium text-white/80">Select course:</label>
            <select
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
              className={fieldClass}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id} className="bg-slate-900 text-white">
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-2 block text-sm font-medium text-white/80">Select level:</label>
          <select
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(Number(e.target.value))}
            className={fieldClass}
          >
            {LEVEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} className="bg-slate-900 text-white">
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {filteredConcepts.length > 0 ? (
          <div>
            <label className="mb-2 block text-sm font-medium text-white/80">Select a topic to study together:</label>
            <select
              value={selectedTopic}
              onChange={(e) => setSelectedTopic(e.target.value)}
              className={fieldClass}
            >
              <option value="" className="bg-slate-900 text-white">Auto-pick from uploaded chunks</option>
              {filteredConcepts.map((c) => (
                <option key={c.id} value={c.id} className="bg-slate-900 text-white">
                  {c.title || c.id}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="mb-2 block text-sm font-medium text-white/80">Enter a topic to study together:</label>
            <input
              type="text"
              value={selectedTopic}
              onChange={(e) => setSelectedTopic(e.target.value)}
              placeholder="e.g. Sorting Algorithms, Neural Networks..."
              className={fieldClass}
            />
          </div>
        )}

        <Button
          onClick={handleStartSession}
          disabled={creating || memberProfiles.length === 0 || (!selectedTopic.trim() && !selectedCourse.trim())}
          className="bg-[#03b2e6] text-white hover:bg-[#029ad0]"
        >
          {creating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating Session...
            </>
          ) : (
            <>
              <Video className="mr-2 h-4 w-4" />
              Start Session
            </>
          )}
        </Button>

        {memberProfiles.length === 0 && (
          <p className="text-xs text-amber-300">
            Hub member data is needed to start a session. Make sure all members have uploaded materials and completed assessments.
          </p>
        )}
        {startError && (
          <p className="text-xs text-red-300">
            {startError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
