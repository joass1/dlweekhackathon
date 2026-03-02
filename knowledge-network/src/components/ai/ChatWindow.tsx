import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';

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

/**
 * Replace [N] citation markers with %%CITE:N%% so they survive markdown parsing
 * as plain text without being interpreted as link syntax.
 */
function preprocessCitations(content: string): string {
  return content.replace(/\[(\d+)\]/g, '%%CITE:$1%%');
}

/**
 * Split a string on %%CITE:N%% markers and return interleaved React nodes —
 * plain text fragments and clickable <sup> badges.
 */
function expandCitations(
  text: string,
  onCitationClick?: (n: number) => void
): React.ReactNode[] {
  if (!text.includes('%%CITE:')) return [text];
  // Split with capturing group → odd indices are citation markers
  const parts = text.split(/(%%CITE:\d+%%)/);
  return parts.map((part, i) => {
    const m = part.match(/^%%CITE:(\d+)%%$/);
    if (m) {
      const n = Number(m[1]);
      return (
        <sup
          key={i}
          className="cursor-pointer inline-flex items-center justify-center w-4 h-4 text-[0.6em] font-bold text-white bg-[#03b2e6] hover:bg-[#0291be] rounded-full ml-0.5 mr-0.5 transition-colors select-none"
          onClick={() => onCitationClick?.(n)}
          title={`Jump to source ${n}`}
        >
          {n}
        </sup>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

/** Expand citation markers in string children; leave element children untouched. */
function processChildren(
  children: React.ReactNode,
  onCitationClick?: (n: number) => void
): React.ReactNode[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (typeof child === 'string') {
      return expandCitations(child, onCitationClick);
    }
    return [child];
  });
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

  // Custom markdown components that expand %%CITE:N%% inside text nodes
  const mdComponents = {
    p: ({ children }: { children?: React.ReactNode }) => (
      <p>{processChildren(children, onCitationClick)}</p>
    ),
    li: ({ children }: { children?: React.ReactNode }) => (
      <li>{processChildren(children, onCitationClick)}</li>
    ),
  };

  return (
    <div className="p-4 space-y-4">
      {visibleMessages.map((message) => (
        <div
          key={message.id}
          className={`p-4 rounded-lg ${
            message.role === 'assistant'
              ? 'bg-[#e0f4fb]/50 ml-4'
              : 'bg-white/85 border border-white/70 ml-auto max-w-[85%] shadow-sm backdrop-blur-sm'
          }`}
        >
          <div className="text-foreground prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-strong:text-foreground">
            <ReactMarkdown
              components={message.role === 'assistant' ? mdComponents : {}}
            >
              {message.role === 'assistant'
                ? preprocessCitations(message.content)
                : message.content}
            </ReactMarkdown>
          </div>
        </div>
      ))}
      {isLoading && showAssistantMessages && <ThinkingIndicator />}
    </div>
  );
}
