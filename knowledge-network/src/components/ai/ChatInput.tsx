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

  return (
    <div className="flex flex-col gap-2">
      {/* Drop zone / pills */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`min-h-[44px] flex flex-wrap items-center gap-1 px-3 py-2 rounded-lg border-2 border-dashed transition-colors ${
          isDragOver
            ? 'border-emerald-400 bg-emerald-50'
            : scopedTopics.length > 0
              ? 'border-emerald-200 bg-gray-50'
              : 'border-gray-300'
        }`}
      >
        {scopedTopics.length === 0 ? (
          <span className="text-xs text-gray-400">Drag a topic from the sidebar to scope your question</span>
        ) : (
          scopedTopics.map(topic => (
            <span
              key={topic.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-800 text-xs rounded-full"
            >
              <span>{topic.subjectName} › {topic.title}</span>
              <button
                type="button"
                onClick={() => onTopicRemove(topic.id)}
                className="hover:text-emerald-600"
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
          className={isListening ? 'bg-red-100' : ''}
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
