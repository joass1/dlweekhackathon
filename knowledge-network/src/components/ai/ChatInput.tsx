'use client';

import React, { useState, useRef } from 'react';
import { Mic, MicOff, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface ScopedTopic {
  id: string;
  title: string;
  subjectName: string;
  conceptId: string;
}

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  isLoading: boolean;
  placeholder?: string;
  scopedTopics: ScopedTopic[];
  onTopicDrop: (topic: ScopedTopic) => void;
  onTopicRemove: (id: string) => void;
}

export function ChatInput({ onSendMessage, isLoading, placeholder, scopedTopics, onTopicDrop, onTopicRemove }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const pillsRef = useRef<HTMLDivElement>(null);

  const startListening = () => {
    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();

      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;

      recognitionRef.current.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map(result => result[0].transcript)
          .join('');
        setMessage(transcript);
      };

      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        stopListening();
      };

      recognitionRef.current.start();
      setIsListening(true);
    } else {
      alert('Speech recognition is not supported in this browser.');
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !isLoading && scopedTopics.length > 0) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    try {
      const data: ScopedTopic = JSON.parse(e.dataTransfer.getData('application/json'));
      if (!scopedTopics.find(t => t.id === data.id)) {
        onTopicDrop(data);
      }
    } catch {
      // ignore invalid drag data
    }
  };

  // Redirect vertical mouse-wheel to horizontal scroll on the pills row
  const handlePillsWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (pillsRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      pillsRef.current.scrollLeft += e.deltaY;
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Drop zone / pills — single row, horizontal scroll */}
      <div
        ref={pillsRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onWheel={handlePillsWheel}
        style={{ scrollbarWidth: 'none' }}
        className={`h-[44px] flex flex-nowrap items-center gap-1 px-3 overflow-x-auto rounded-lg border-2 border-dashed transition-colors [&::-webkit-scrollbar]:hidden ${
          isDragOver
            ? 'border-[#03b2e6] bg-[#e0f4fb]'
            : scopedTopics.length > 0
              ? 'border-[#03b2e6]/30 bg-accent'
              : 'border-gray-300'
        }`}
      >
        {scopedTopics.length === 0 ? (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Drag a topic from the sidebar to scope your question
          </span>
        ) : (
          scopedTopics.map(topic => (
            <span
              key={topic.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#e0f4fb] text-foreground text-xs rounded-full flex-shrink-0"
            >
              <span className="whitespace-nowrap">{topic.subjectName} › {topic.title}</span>
              <button
                type="button"
                onClick={() => onTopicRemove(topic.id)}
                className="hover:text-[#03b2e6]"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        )}
      </div>

      {/* Message input row */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={placeholder || "Type your message..."}
          className="flex-1"
          disabled={isLoading}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={isListening ? stopListening : startListening}
          className={`border-2 ${
            isListening
              ? 'bg-red-100 border-red-300 text-red-700 hover:bg-red-200'
              : 'bg-white/90 border-slate-400 text-slate-800 hover:bg-white'
          }`}
          aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
          title={isListening ? 'Stop voice input' : 'Start voice input'}
        >
          {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>
        <Button type="submit" disabled={!message.trim() || isLoading || scopedTopics.length === 0}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
