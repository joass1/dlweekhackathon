'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ChatInput, ChatWindow, NotesContext, SubjectsList } from '@/components/ai';
import { ScopedTopic } from '@/components/ai/ChatInput';
import Split from 'react-split';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
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
  const [mode, setMode] = useState<'socratic' | 'content_aware'>('socratic');
<<<<<<< Updated upstream
  const [selectedAssistantIndex, setSelectedAssistantIndex] = useState<number>(-1);

  const assistantMessages = useMemo(
    () => messages.filter((m) => m.role === 'assistant'),
    [messages]
  );

  useEffect(() => {
    if (assistantMessages.length === 0) {
      setSelectedAssistantIndex(-1);
      return;
    }
    setSelectedAssistantIndex(assistantMessages.length - 1);
  }, [assistantMessages.length]);

  const selectedAssistantSpeech = useMemo(() => {
    if (isLoading) return 'Thinking...';
    if (selectedAssistantIndex < 0 || selectedAssistantIndex >= assistantMessages.length) {
      return initialSocraticPrompt;
    }
    const cleaned = assistantMessages[selectedAssistantIndex].content
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1');
    return cleaned;
  }, [assistantMessages, initialSocraticPrompt, isLoading, selectedAssistantIndex]);

  const canGoPreviousReply = selectedAssistantIndex > 0;
  const canGoNextReply = selectedAssistantIndex >= 0 && selectedAssistantIndex < assistantMessages.length - 1;
=======
  const [highlightedSourceIndex, setHighlightedSourceIndex] = useState<number | null>(null);
>>>>>>> Stashed changes

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
          mode,
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const { answer, context } = await response.json();
      setActiveNotes(context ?? []);

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        content: answer,
        role: 'assistant',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);
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

<<<<<<< Updated upstream
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
=======
      {/* Main chat area */}
      <div className="h-screen flex flex-col">
        <div className="p-4 border-b bg-[#e0f4fb]">
          <h2 className="font-semibold text-foreground">Socratic Tutor</h2>
          <p className="text-sm text-[#03b2e6]">I guide you with questions to help you discover answers yourself</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          <ChatWindow
            messages={messages}
            isLoading={isLoading}
            onCitationClick={(n) => setHighlightedSourceIndex(n)}
>>>>>>> Stashed changes
          />
        </div>

        {/* Main chat area */}
        <div className="relative h-screen flex flex-col overflow-hidden bg-transparent">
          <SocraticBackground3D
            speechText={selectedAssistantSpeech}
            isSpeaking={isLoading || Boolean(selectedAssistantSpeech)}
            canGoPrevious={canGoPreviousReply}
            canGoNext={canGoNextReply}
            onGoPrevious={() =>
              setSelectedAssistantIndex((idx) => Math.max(0, idx - 1))
            }
            onGoNext={() =>
              setSelectedAssistantIndex((idx) => Math.min(assistantMessages.length - 1, idx + 1))
            }
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
              mode={mode}
              onModeToggle={() => setMode(m => m === 'socratic' ? 'content_aware' : 'socratic')}
            />
          </div>
        </div>

<<<<<<< Updated upstream
        {/* Right sidebar */}
        <div className="relative z-10 border-l border-white/20 bg-slate-900/58 h-screen backdrop-blur-sm flex flex-col">
          <div className="flex-1 overflow-y-auto">
            <NotesContext
              activeNotes={activeNotes}
              onNoteClick={(note) => {
                console.log('Note clicked:', note);
              }}
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
    </div>
=======
      {/* Right sidebar */}
      <div className="border-l h-screen overflow-y-auto">
        <NotesContext
          activeNotes={activeNotes}
          onNoteClick={(note) => console.log('Note clicked:', note)}
          highlightedSourceIndex={highlightedSourceIndex}
        />
      </div>
    </Split>
>>>>>>> Stashed changes
  );
}
