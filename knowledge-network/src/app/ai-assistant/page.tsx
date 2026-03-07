'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ChatInput, ChatWindow, MicroCheckpoint, NotesContext, SubjectsList } from '@/components/ai';
import type { CheckpointQuestion } from '@/components/ai';
import { ScopedTopic } from '@/components/ai/ChatInput';
import Split from 'react-split';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { apiFetch } from '@/services/api';
import { normalizeTopicRow, TopicOption, UserTopicApiRow } from '@/types/topics';

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  context?: ContextItem[];  // assistant messages only: sources cited in this response
}

interface ContextItem {
  text: string;
  concept_id: string;
  score: number;
  index?: number;
}

const SPEECH_THINKING_PHRASES = [
  "Wandering through the labyrinth of knowledge...",
  "Whispering to the neurons... they whisper back...",
  "Unraveling threads of understanding...",
  "Consulting ancient scrolls of wisdom...",
  "Chasing butterflies of insight...",
  "Stirring the cauldron of concepts...",
  "Dancing through prerequisite chains...",
  "Tickling the knowledge graph...",
  "Weaving moonlight into explanations...",
  "Rummaging through the attic of ideas...",
  "Connecting constellations of thought...",
  "Brewing a peculiar potion of clarity...",
  "Asking the oracle of understanding...",
  "Painting pictures with pure logic...",
  "Juggling theorems and epiphanies...",
  "Decoding the whispers of the syllabus...",
  "Somersaulting through concept space...",
  "Polishing diamonds of insight...",
  "Untangling the cosmic spaghetti of knowledge...",
  "Plucking strings on the harp of reason...",
  "Spelunking through caverns of curriculum...",
  "Folding origami cranes of explanation...",
  "Sipping tea with Socrates himself...",
];

const STUDY_MISSION_TIMER_KEY = 'mentora:studyMissionTimer';
const STUDY_MISSION_SESSION_KEY = 'mentora:studyMissionSession';

const SocraticBackground3D = dynamic(
  () => import('@/components/ai/SocraticBackground3D'),
  { ssr: false }
);

function generateId(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    if (typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }

    if (typeof globalThis.crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
      return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
    }
  }

  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function AIAssistantPage() {
  const initialSocraticPrompt =
    'Hello there! Drag a topic from the side into the chatbox and start chatting with me!';
  const router = useRouter();
  const { getIdToken, user } = useAuth();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeNotes, setActiveNotes] = useState<ContextItem[]>([]);
  const [scopedTopics, setScopedTopics] = useState<ScopedTopic[]>([]);
  const [availableTopics, setAvailableTopics] = useState<TopicOption[]>([]);
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [highlightedSourceIndex, setHighlightedSourceIndex] = useState<number | null>(null);
  const [missionTimerRemaining, setMissionTimerRemaining] = useState<number | null>(null);
  const [missionTimerCourse, setMissionTimerCourse] = useState<string>('all');
  const [chatError, setChatError] = useState<string | null>(null);
  const missionTimeoutHandledRef = useRef(false);

  // Rotating thinking phrase for the speech bubble
  const [thinkingPhrase, setThinkingPhrase] = useState(() =>
    SPEECH_THINKING_PHRASES[Math.floor(Math.random() * SPEECH_THINKING_PHRASES.length)]
  );

  useEffect(() => {
    if (!isLoading) return;
    const interval = setInterval(() => {
      setThinkingPhrase((prev) => {
        let next: string;
        do {
          next = SPEECH_THINKING_PHRASES[Math.floor(Math.random() * SPEECH_THINKING_PHRASES.length)];
        } while (next === prev && SPEECH_THINKING_PHRASES.length > 1);
        return next;
      });
    }, 2800);
    return () => clearInterval(interval);
  }, [isLoading]);

  // Micro-checkpoint state
  const sessionIdRef = useRef<string>(generateId());
  const messageCountRef = useRef(0);
  const lastCheckpointAtRef = useRef(-8); // start so first check fires at msg 3
  const checkpointedConceptsRef = useRef<string[]>([]);
  const [activeCheckpoint, setActiveCheckpoint] = useState<CheckpointQuestion | null>(null);
  const sourceKeyToIndexRef = useRef<Map<string, number>>(new Map());
  const nextSourceIndexRef = useRef(1);

  const assistantMessages = useMemo(
    () => messages.filter((m) => m.role === 'assistant'),
    [messages]
  );

  const selectedAssistantSpeech = useMemo(() => {
    const parts = [initialSocraticPrompt, ...assistantMessages.map((message) => message.content)];
    if (isLoading) parts.push(thinkingPhrase);
    return parts.join('\n%%SEP%%\n');
  }, [assistantMessages, initialSocraticPrompt, isLoading, thinkingPhrase]);
  const tutorEvidenceNote = useMemo(
    () => activeNotes.length > 0
      ? 'Tutor answers are grounded in the cited sources on the right. Click citation bubbles to inspect the exact supporting text.'
      : 'If a tutor response has no visible sources, treat it as tentative and verify it before relying on it for a graded task.',
    [activeNotes.length]
  );

  useEffect(() => {
    if (!user) {
      setAvailableTopics([]);
      setSelectedTopicIds([]);
      return;
    }

    let cancelled = false;
    const loadFilters = async () => {
      try {
        const token = await getIdToken();
        const topicData = await apiFetch<{ topics?: UserTopicApiRow[] }>('/api/user-topics', undefined, token);
        if (cancelled) return;

        const dedupedTopics = Object.values(
          (Array.isArray(topicData.topics) ? topicData.topics : [])
            .map(normalizeTopicRow)
            .filter((topic) => topic.id)
            .reduce<Record<string, TopicOption>>((acc, topic) => {
              acc[`${topic.courseId}::${topic.id}`] = topic;
              return acc;
            }, {})
        );
        setAvailableTopics(dedupedTopics);
      } catch {
        if (cancelled) return;
        setAvailableTopics([]);
      }
    };

    void loadFilters();
    return () => {
      cancelled = true;
    };
  }, [getIdToken, user]);

  useEffect(() => {
    if (availableTopics.length === 0) return;
    setSelectedTopicIds((prev) => prev.filter((topicId) => availableTopics.some((topic) => topic.id === topicId)));
  }, [availableTopics]);

  useEffect(() => {
    if (selectedTopicIds.length === 0) {
      setScopedTopics([]);
      return;
    }
    setScopedTopics((prev) => {
      const previousByConcept = new Map(prev.map((topic) => [topic.conceptId, topic]));
      const normalized: ScopedTopic[] = [];
      for (const conceptId of selectedTopicIds) {
        const mappedTopic = availableTopics.find((topic) => topic.id === conceptId);
        if (mappedTopic) {
          normalized.push({
            id: mappedTopic.docId || `topic-${mappedTopic.courseId}-${mappedTopic.id}`,
            title: mappedTopic.name,
            subjectName: mappedTopic.courseName,
            conceptId: mappedTopic.id,
          });
          continue;
        }
        const existing = previousByConcept.get(conceptId);
        if (existing) {
          normalized.push(existing);
          continue;
        }
        normalized.push({
          id: `manual-${conceptId}`,
          title: conceptId,
          subjectName: 'Selected Topic',
          conceptId,
        });
      }
      return normalized;
    });
  }, [availableTopics, selectedTopicIds]);

  useEffect(() => {
    const topic = (searchParams.get('topic') || '').trim();
    if (!topic) return;
    const conceptId = (searchParams.get('conceptId') || '').trim() || topic.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const subjectName = (searchParams.get('subject') || '').trim() || 'Knowledge Map';
    setScopedTopics((prev) =>
      prev.some((item) => item.conceptId === conceptId)
        ? prev
        : [...prev, { id: `kg-${conceptId}`, title: topic, subjectName, conceptId }]
    );
    setSelectedTopicIds((prev) => (prev.includes(conceptId) ? prev : [...prev, conceptId]));
  }, [searchParams]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncMissionTimer = () => {
      try {
        const raw = window.localStorage.getItem(STUDY_MISSION_TIMER_KEY);
        if (!raw) {
          setMissionTimerRemaining(null);
          return;
        }

        const parsed = JSON.parse(raw) as {
          active?: boolean;
          endAt?: number | null;
          selectedCourse?: string;
        };

        if (!parsed?.active || !parsed?.endAt) {
          setMissionTimerRemaining(null);
          missionTimeoutHandledRef.current = false;
          return;
        }

        const remaining = Math.max(0, Math.ceil((parsed.endAt - Date.now()) / 1000));
        setMissionTimerRemaining(remaining);
        setMissionTimerCourse(parsed.selectedCourse || 'all');
        if (remaining > 0) {
          missionTimeoutHandledRef.current = false;
        }

        if (remaining <= 0 && !missionTimeoutHandledRef.current) {
          missionTimeoutHandledRef.current = true;
          window.localStorage.removeItem(STUDY_MISSION_TIMER_KEY);
          window.localStorage.removeItem(STUDY_MISSION_SESSION_KEY);
          const destination = parsed.selectedCourse && parsed.selectedCourse !== 'all'
            ? `/assessment?courseId=${encodeURIComponent(parsed.selectedCourse)}`
            : '/assessment';
          router.replace(destination);
        }
      } catch {
        setMissionTimerRemaining(null);
      }
    };

    syncMissionTimer();
    const interval = setInterval(syncMissionTimer, 1000);
    return () => clearInterval(interval);
  }, [router]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleTopicDrop = (topic: ScopedTopic) =>
    setSelectedTopicIds((prev) => (prev.includes(topic.conceptId) ? prev : [...prev, topic.conceptId]));

  const handleTopicRemove = (id: string) => {
    setScopedTopics((prev) => {
      const target = prev.find((topic) => topic.id === id);
      if (target) {
        setSelectedTopicIds((ids) => ids.filter((conceptId) => conceptId !== target.conceptId));
      }
      return prev.filter((topic) => topic.id !== id);
    });
  };

  const normalizeSourceKey = (item: ContextItem) => {
    const concept = (item.concept_id || 'unknown').trim().toLowerCase();
    const text = item.text.trim().replace(/\s+/g, ' ').toLowerCase();
    return `${concept}::${text}`;
  };

  const assignStableSourceIndices = (items: ContextItem[]): ContextItem[] =>
    items.map((item) => {
      const key = normalizeSourceKey(item);
      const existing = sourceKeyToIndexRef.current.get(key);
      if (existing != null) {
        return { ...item, index: existing };
      }
      const idx = nextSourceIndexRef.current++;
      sourceKeyToIndexRef.current.set(key, idx);
      return { ...item, index: idx };
    });

  const remapAnswerCitations = (answer: string, localContext: ContextItem[], stableContext: ContextItem[]) => {
    const localToStable = new Map<number, number>();
    for (let i = 0; i < Math.min(localContext.length, stableContext.length); i += 1) {
      const localIdx = localContext[i].index;
      const stableIdx = stableContext[i].index;
      if (typeof localIdx === 'number' && typeof stableIdx === 'number') {
        localToStable.set(localIdx, stableIdx);
      }
    }
    return answer.replace(/\[(\d+)\]/g, (_, rawN: string) => {
      const n = Number(rawN);
      const mapped = localToStable.get(n);
      return `[${mapped ?? n}]`;
    });
  };

  const fetchCheckpoint = async (sessionMessages: { role: string; content: string }[]) => {
    if (!scopedTopics.length) return;
    const topicId = scopedTopics[0].conceptId;
    try {
      const token = await getIdToken();
      const res = await fetch('/api/ai/checkpoint', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          topic_id: topicId,
          topic_doc_id: scopedTopics[0].id,
          session_messages: sessionMessages,
          already_tested: checkpointedConceptsRef.current,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.question) return;
      setActiveCheckpoint({
        session_id: sessionIdRef.current,
        concept_tested: data.concept_tested ?? topicId,
        question: data.question,
        options: data.options ?? [],
        correct_answer: data.correct_answer ?? '',
        explanation: data.explanation ?? '',
      });
      checkpointedConceptsRef.current = [
        ...checkpointedConceptsRef.current,
        data.concept_tested ?? topicId,
      ];
    } catch (err) {
      console.error('Checkpoint fetch error:', err);
    }
  };

  const handleCheckpointSubmit = async (answer: string, confidence: number) => {
    if (!activeCheckpoint) return;
    try {
      const token = await getIdToken();
      const res = await fetch('/api/ai/checkpoint/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          session_id: activeCheckpoint.session_id,
          topic_id: scopedTopics[0]?.conceptId ?? '',
          topic_doc_id: scopedTopics[0]?.id ?? null,
          concept_tested: activeCheckpoint.concept_tested,
          question: activeCheckpoint.question,
          options: activeCheckpoint.options,
          student_answer: answer,
          correct_answer: activeCheckpoint.correct_answer,
          confidence_rating: confidence,
          was_skipped: false,
        }),
      });
      if (!res.ok) throw new Error(`Checkpoint submit failed with status ${res.status}`);
      const data = await res.json();
      return {
        is_correct: data?.is_correct ?? null,
        mastery_delta: typeof data?.mastery_delta === 'number' ? data.mastery_delta : null,
        updated_mastery: typeof data?.updated_mastery === 'number' ? data.updated_mastery : null,
        mastery_status: typeof data?.mastery_status === 'string' ? data.mastery_status : null,
        concept_id: typeof data?.concept_id === 'string' ? data.concept_id : null,
      };
    } catch (err) {
      console.error('Checkpoint submit error:', err);
      return;
    }
  };

  const handleCheckpointSkip = async () => {
    if (!activeCheckpoint) return;
    const snap = activeCheckpoint;
    try {
      const token = await getIdToken();
      const res = await fetch('/api/ai/checkpoint/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          session_id: snap.session_id,
          topic_id: scopedTopics[0]?.conceptId ?? '',
          topic_doc_id: scopedTopics[0]?.id ?? null,
          concept_tested: snap.concept_tested,
          question: snap.question,
          options: snap.options,
          student_answer: '',
          correct_answer: snap.correct_answer,
          confidence_rating: 1,
          was_skipped: true,
        }),
      });
      if (!res.ok) throw new Error(`Checkpoint skip failed with status ${res.status}`);
    } catch (err) {
      console.error('Checkpoint skip error:', err);
    } finally {
      setActiveCheckpoint(null);
    }
  };

  const handleSendMessage = async (content: string) => {
    setIsLoading(true);
    setHighlightedSourceIndex(null);
    setChatError(null);
    try {
      const userMessage: Message = {
        id: generateId(),
        content,
        role: 'user',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, userMessage]);

      const token = await getIdToken();
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          query: content,
          concept_ids: scopedTopics.map(t => t.conceptId),
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const { answer, context } = await response.json();
      const localContext: ContextItem[] = context ?? [];
      const stableContext = assignStableSourceIndices(localContext);
      const remappedAnswer = remapAnswerCitations(answer, localContext, stableContext);
      // Preserve prior sources and stable indices across the session.
      setActiveNotes(prev => {
        const merged = [...prev];
        const existing = new Set(prev.map(normalizeSourceKey));
        for (const item of stableContext) {
          const key = normalizeSourceKey(item);
          if (existing.has(key)) continue;
          existing.add(key);
          merged.push(item);
        }
        return merged;
      });

      const assistantMessage: Message = {
        id: generateId(),
        content: remappedAnswer,
        role: 'assistant',
        timestamp: new Date(),
        context: stableContext,  // store per-message with session-stable citation indices
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Micro-checkpoint trigger: fire after â‰¥3 msgs with 8-msg cooldown
      messageCountRef.current += 1;
      const mc = messageCountRef.current;
      if (
        mc >= 3 &&
        mc - lastCheckpointAtRef.current >= 8 &&
        scopedTopics.length > 0 &&
        !activeCheckpoint
      ) {
        lastCheckpointAtRef.current = mc;
        const sessionMsgs = [...messages, userMessage, assistantMessage].map(m => ({
          role: m.role,
          content: m.content,
        }));
        fetchCheckpoint(sessionMsgs);
      }
    } catch (error) {
      console.error('Error in chat:', error);
      setChatError(
        'The tutor service is unavailable right now. You can keep reviewing your sources and try again in a moment.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative h-screen overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/backgrounds/castleviews.jpg')" }}
        aria-hidden
      />

      <Split
        className="relative z-10 flex h-screen overflow-hidden bg-transparent"
        sizes={[21, 57, 22]}
        minSize={[180, 400, 160]}
        gutterSize={4}
      >
        {/* Left sidebar */}
        <div className="relative z-10 h-screen border-r border-white/20 bg-slate-900/52 backdrop-blur-sm">
          <div className="h-full overflow-y-auto pb-36">
            <SubjectsList
              onNoteSelect={(noteId) => {
                // Handle note selection
              }}
            />
          </div>

          <div className="pointer-events-none absolute bottom-4 left-4 right-4 z-20">
            <div className="pointer-events-auto rounded-2xl border border-slate-200/15 bg-slate-950/72 px-4 py-3 text-slate-100 shadow-lg backdrop-blur-md">
              <h2 className="font-semibold text-white">Socratic Tutor</h2>
              <p className="text-sm font-medium text-sky-100/90">
                I guide you with questions to help you discover answers yourself
              </p>
              {missionTimerRemaining !== null && (
                <button
                  type="button"
                  onClick={() => router.push('/study-mission')}
                  className="mt-3 rounded-full border border-cyan-400/30 bg-white/10 px-3 py-1 text-xs font-semibold text-cyan-100 transition-colors hover:bg-white/15"
                  title="Return to Study Mission"
                >
                  Study Mission: {formatTimer(missionTimerRemaining)}
                  {missionTimerCourse !== 'all' ? ` | ${missionTimerCourse}` : ''}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Main chat area */}
        <div className="relative h-screen flex flex-col overflow-hidden bg-transparent">
          <SocraticBackground3D
            speechText={selectedAssistantSpeech}
            isSpeaking={isLoading || Boolean(selectedAssistantSpeech)}
            typingText={isLoading ? thinkingPhrase : undefined}
            onCitationClick={(n, _sectionIdx) => {
              setHighlightedSourceIndex(n);
            }}
          />

          <div className="relative z-10 pointer-events-none flex-1" />
          <div className="relative z-10 px-4 pb-0 md:px-6">
            <div className="rounded-2xl border border-white/20 bg-slate-950/68 px-4 py-3 text-white shadow-lg backdrop-blur-md">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-cyan-300" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">Responsible AI Note</p>
                  <p className="mt-1 text-sm text-white/80">{tutorEvidenceNote}</p>
                </div>
              </div>
            </div>
            {chatError && (
              <div className="mt-3 rounded-2xl border border-red-300/30 bg-red-500/12 px-4 py-3 text-red-100 shadow-lg backdrop-blur-md">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-red-200" />
                  <p className="text-sm">{chatError}</p>
                </div>
              </div>
            )}
          </div>
          <div className="relative z-10 p-4 border-t border-slate-300/50 bg-white/78 backdrop-blur-sm">
            <ChatInput
              onSendMessage={handleSendMessage}
              isLoading={isLoading}
              placeholder="Ask the Socratic Tutor about any concept..."
              scopedTopics={scopedTopics}
              onTopicDrop={handleTopicDrop}
              onTopicRemove={handleTopicRemove}
            />
          </div>
        </div>

        {/* Right sidebar */}
        <div className="relative z-10 border-l border-white/20 bg-slate-900/58 h-screen backdrop-blur-sm flex flex-col">
          <div className="flex-1 overflow-y-auto">
            <NotesContext
              activeNotes={activeNotes}
              onNoteClick={(note) => {
                console.log('Note clicked:', note);
              }}
              highlightedSourceIndex={highlightedSourceIndex}
            />
          </div>
          <div className="border-t border-white/20 bg-slate-950/35 p-3">
            <h3 className="text-sm font-semibold text-white/90 mb-2">Your Messages</h3>
            <div className="max-h-[28vh] overflow-y-auto rounded-lg border border-white/20 bg-white/10">
              <ChatWindow
                messages={messages}
                isLoading={isLoading}
                showAssistantMessages={false}
              />
            </div>
          </div>
        </div>
      </Split>

      {/* Micro-checkpoint popup â€” fixed overlay, outside Split */}
      {activeCheckpoint && (
        <MicroCheckpoint
          checkpoint={activeCheckpoint}
          onSubmit={handleCheckpointSubmit}
          onSkip={handleCheckpointSkip}
          onClose={() => setActiveCheckpoint(null)}
        />
      )}
    </div>
  );
}
