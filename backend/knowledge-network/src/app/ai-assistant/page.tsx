'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { ChatHistory, ChatInput, ChatWindow, NotesContext, SubjectsList } from '@/components/ai';
import { Subject } from '@/types';
import Split from 'react-split';

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
  const { data: session } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeNotes, setActiveNotes] = useState<ContextItem[]>([]);

  const handleSendMessage = async (content: string) => {
    setIsLoading(true);
    try {
      const userMessage: Message = {
        id: generateId(),
        content,
        role: 'user',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, userMessage]);

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: content,
          userId: session?.user?.id,
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const { answer, context } = await response.json();
      setActiveNotes(context);

      const assistantMessage: Message = {
        id: generateId(),
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
            placeholder="Ask anything about your notes..."
          />
        </div>
      </div>

      {/* Right sidebar */}
      <div className="border-l h-screen overflow-y-auto">
        <NotesContext 
          activeNotes={activeNotes}
          onNoteClick={(note) => {
            // Handle navigation to specific note
            console.log('Note clicked:', note);
          }}
        />
      </div>
    </Split>
  );
}
