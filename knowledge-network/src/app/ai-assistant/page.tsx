'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ChatInput, ChatWindow, NotesContext, SubjectsList } from '@/components/ai';
import { ScopedTopic } from '@/components/ai/ChatInput';
import Split from 'react-split';
import { useSearchParams } from 'next/navigation';

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  relatedNotes?: ContextItem[];
}

interface ContextItem {
  text: string;
  id: string;
  score: number;
}

export default function AIAssistantPage() {
  const { getIdToken } = useAuth();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeNotes, setActiveNotes] = useState<ContextItem[]>([]);
  const [scopedTopics, setScopedTopics] = useState<ScopedTopic[]>([]);
  const [mode, setMode] = useState<'socratic' | 'content_aware'>('socratic');

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
        relatedNotes: context
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error in chat:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Split
      className="flex h-screen overflow-hidden bg-white"
      sizes={[20, 50, 30]}
      minSize={[200, 400, 250]}
      gutterSize={4}
    >
      {/* Left sidebar */}
      <div className="border-r h-screen overflow-y-auto">
        <SubjectsList
          onNoteSelect={(noteId) => {
            // Handle note selection
          }}
        />
      </div>

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
          />
        </div>
        <div className="p-4 border-t">
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

      {/* Right sidebar */}
      <div className="border-l h-screen overflow-y-auto">
        <NotesContext
          activeNotes={activeNotes}
          onNoteClick={(note) => {
            console.log('Note clicked:', note);
          }}
        />
      </div>
    </Split>
  );
}
