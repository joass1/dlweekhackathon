import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';

interface ContextItem {
  text: string;
  id: string;
  score: number;
}

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  relatedNotes?: ContextItem[];
}

interface ChatWindowProps {
  messages: Message[];
  isLoading: boolean;
}

const THINKING_PHRASES = [
  "Pondering the depths of knowledge...",
  "Connecting the dots across concepts...",
  "Rummaging through course materials...",
  "Brewing up an explanation...",
  "Tracing prerequisite chains...",
  "Consulting the knowledge graph...",
  "Weaving together an answer...",
  "Meandering through neural pathways...",
  "Synthesizing insights...",
  "Untangling the concept web...",
  "Flipping through mental flashcards...",
  "Warming up the reasoning engine...",
  "Mapping out the explanation...",
  "Assembling the building blocks...",
  "Diving into the material...",
];

function ThinkingIndicator() {
  const [phraseIndex, setPhraseIndex] = useState(() =>
    Math.floor(Math.random() * THINKING_PHRASES.length)
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setPhraseIndex((prev) => {
        let next: number;
        do {
          next = Math.floor(Math.random() * THINKING_PHRASES.length);
        } while (next === prev && THINKING_PHRASES.length > 1);
        return next;
      });
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-4 bg-[#e0f4fb]/50 rounded-lg ml-4 flex items-center gap-3">
      <div className="flex gap-1">
        <span className="w-2 h-2 bg-[#03b2e6] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 bg-[#03b2e6] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 bg-[#03b2e6] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-sm text-[#03b2e6] italic transition-opacity duration-300">
        {THINKING_PHRASES[phraseIndex]}
      </span>
    </div>
  );
}

export function ChatWindow({ messages, isLoading }: ChatWindowProps) {
  return (
    <div className="p-4 space-y-4">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`p-4 rounded-lg ${
            message.role === 'assistant'
              ? 'bg-[#e0f4fb]/50 ml-4'
              : 'bg-accent mr-4'
          }`}
        >
          <div className="text-foreground prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-strong:text-foreground">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
          {message.relatedNotes && message.role === 'assistant' && (
            <div className="mt-2 text-xs text-muted-foreground">
              Sources: {message.relatedNotes.map(note => note.text).join(', ')}
            </div>
          )}
        </div>
      ))}
      {isLoading && <ThinkingIndicator />}
    </div>
  );
}
