import React, { useCallback, useEffect, useState } from 'react';
import { TextShimmer } from '@/components/ui/text-shimmer';
import { TutorMarkdown } from '@/components/ai/TutorMarkdown';

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
}

interface ChatWindowProps {
  messages: Message[];
  isLoading: boolean;
  showAssistantMessages?: boolean;
  onCitationClick?: (index: number) => void;
}

const THINKING_PHRASES = [
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
  "Herding cats of cognition...",
  "Juggling theorems and epiphanies...",
  "Decoding the whispers of the syllabus...",
  "Somersaulting through concept space...",
  "Polishing diamonds of insight...",
  "Untangling the cosmic spaghetti of knowledge...",
  "Plucking strings on the harp of reason...",
  "Feeding the hamsters that power comprehension...",
  "Spelunking through caverns of curriculum...",
  "Folding origami cranes of explanation...",
  "Sipping tea with Socrates himself...",
];

function ThinkingIndicator() {
  const [phraseIndex, setPhraseIndex] = useState(() =>
    Math.floor(Math.random() * THINKING_PHRASES.length)
  );
  const [fade, setFade] = useState(true);

  const cyclePhrase = useCallback(() => {
    setFade(false);
    setTimeout(() => {
      setPhraseIndex((prev) => {
        let next: number;
        do {
          next = Math.floor(Math.random() * THINKING_PHRASES.length);
        } while (next === prev && THINKING_PHRASES.length > 1);
        return next;
      });
      setFade(true);
    }, 300);
  }, []);

  useEffect(() => {
    const interval = setInterval(cyclePhrase, 2800);
    return () => clearInterval(interval);
  }, [cyclePhrase]);

  return (
    <div className="ml-4 flex items-center gap-3 rounded-lg bg-[#e0f4fb]/50 p-4">
      <div className="flex gap-1">
        <span className="h-2 w-2 animate-bounce rounded-full bg-[#03b2e6]" style={{ animationDelay: '0ms' }} />
        <span className="h-2 w-2 animate-bounce rounded-full bg-[#03b2e6]" style={{ animationDelay: '150ms' }} />
        <span className="h-2 w-2 animate-bounce rounded-full bg-[#03b2e6]" style={{ animationDelay: '300ms' }} />
      </div>
      <div className={`transition-opacity duration-300 ${fade ? 'opacity-100' : 'opacity-0'}`}>
        <TextShimmer
          duration={1.2}
          className="font-mono text-sm italic [--shimmer-base:#0ea5e9] [--shimmer-color:#e0f4fb]"
        >
          {THINKING_PHRASES[phraseIndex]}
        </TextShimmer>
      </div>
    </div>
  );
}

export function ChatWindow({
  messages,
  isLoading,
  showAssistantMessages = true,
  onCitationClick,
}: ChatWindowProps) {
  const visibleMessages = showAssistantMessages
    ? messages
    : messages.filter((message) => message.role !== 'assistant');

  return (
    <div className="space-y-4 p-4">
      {visibleMessages.map((message) => (
        <div
          key={message.id}
          className={`rounded-lg p-4 ${
            message.role === 'assistant'
              ? 'ml-4 bg-[#e0f4fb]/50'
              : 'ml-auto max-w-[85%] border border-white/70 bg-white/85 shadow-sm backdrop-blur-sm'
          }`}
        >
          {message.role === 'assistant' ? (
            <TutorMarkdown
              content={message.content}
              onCitationClick={onCitationClick}
              tone="light"
              compact
            />
          ) : (
            <div className="whitespace-pre-wrap text-foreground">
              {message.content}
            </div>
          )}
        </div>
      ))}
      {isLoading && showAssistantMessages && <ThinkingIndicator />}
    </div>
  );
}
