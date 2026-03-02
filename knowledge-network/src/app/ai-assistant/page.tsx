'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ChatInput, ChatWindow, MicroCheckpoint, NotesContext, SubjectsList } from '@/components/ai';
import type { CheckpointQuestion } from '@/components/ai';
import { ScopedTopic } from '@/components/ai/ChatInput';
import Split from 'react-split';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';

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

const SocraticBackground3D = dynamic(
  () => import('@/components/ai/SocraticBackground3D'),
  { ssr: false }
);

export default function AIAssistantPage() {
  const initialSocraticPrompt =
    'Hello there! Drag a topic from the side into the chatbox and start chatting with me!';
  const { getIdToken } = useAuth();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeNotes, setActiveNotes] = useState<ContextItem[]>([]);
  const [scopedTopics, setScopedTopics] = useState<ScopedTopic[]>([]);
  const [highlightedSourceIndex, setHighlightedSourceIndex] = useState<number | null>(null);

  // Micro-checkpoint state
  const sessionIdRef = useRef<string>(crypto.randomUUID());
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

  const cleanedAssistantMessages = useMemo(
    () =>
      assistantMessages.map((m) =>
        m.content
          .replace(/\*\*(.*?)\*\*/g, '$1')
          .replace(/\*(.*?)\*/g, '$1')
          .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
          .replace(/`([^`]+)`/g, '$1')
      ),
    [assistantMessages]
  );

  const selectedAssistantSpeech = useMemo(() => {
    const parts = [initialSocraticPrompt, ...cleanedAssistantMessages];
    if (isLoading) parts.push('Thinking...');
    return parts.join('\n%%SEP%%\n');
  }, [cleanedAssistantMessages, initialSocraticPrompt, isLoading]);

  useEffect(() => {
    const topic = (searchParams.get('topic') || '').trim();
    if (!topic) return;
    const conceptId = (searchParams.get('conceptId') || '').trim() || topic.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const subjectName = (searchParams.get('subject') || '').trim() || 'Knowledge Map';
    const id = `kg-${conceptId}`;

    setScopedTopics(prev =>
      prev.some(t => t.id === id)
        ? prev
        : [...prev, { id, title: topic, subjectName, conceptId }]
    );
  }, [searchParams]);

  const handleTopicDrop = (topic: ScopedTopic) =>
    setScopedTopics(prev => prev.find(t => t.id === topic.id) ? prev : [...prev, topic]);

  const handleTopicRemove = (id: string) =>
    setScopedTopics(prev => prev.filter(t => t.id !== id));

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
      return { is_correct: data?.is_correct ?? null };
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
    try {
      const userMessage: Message = {
        id: crypto.randomUUID(),
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
        id: crypto.randomUUID(),
        content: remappedAnswer,
        role: 'assistant',
        timestamp: new Date(),
        context: stableContext,  // store per-message with session-stable citation indices
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Micro-checkpoint trigger: fire after ≥3 msgs with 8-msg cooldown
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
        sizes={[20, 50, 30]}
        minSize={[200, 400, 250]}
        gutterSize={4}
      >
        {/* Left sidebar */}
        <div className="relative z-10 border-r border-white/20 bg-slate-900/52 h-screen overflow-y-auto backdrop-blur-sm">
          <SubjectsList
            onNoteSelect={(noteId) => {
              // Handle note selection
            }}
          />
        </div>

        {/* Main chat area */}
        <div className="relative h-screen flex flex-col overflow-hidden bg-transparent">
          <SocraticBackground3D
            speechText={selectedAssistantSpeech}
            isSpeaking={isLoading || Boolean(selectedAssistantSpeech)}
            onCitationClick={(n, _sectionIdx) => {
              setHighlightedSourceIndex(n);
            }}
          />

          <div className="relative z-10 p-4 border-b border-slate-300/50 bg-[#e0f4fb]/78 backdrop-blur-sm">
            <h2 className="font-semibold text-foreground">Socratic Tutor</h2>
            <p className="text-sm font-medium text-sky-900">I guide you with questions to help you discover answers yourself</p>
          </div>
          <div className="relative z-10 flex-1" />
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

      {/* Micro-checkpoint popup — fixed overlay, outside Split */}
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
