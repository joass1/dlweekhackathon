import React from 'react';

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

export function ChatWindow({ messages, isLoading }: ChatWindowProps) {
  return (
    <div className="p-4 space-y-4">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`p-4 rounded-lg ${
            message.role === 'assistant' 
              ? 'bg-blue-50 ml-4' 
              : 'bg-gray-50 mr-4'
          }`}
        >
          <p className="text-gray-800">{message.content}</p>
          {message.relatedNotes && message.role === 'assistant' && (
            <div className="mt-2 text-xs text-gray-500">
              Sources: {message.relatedNotes.map(note => note.text).join(', ')}
            </div>
          )}
        </div>
      ))}
      {isLoading && (
        <div className="p-4 bg-gray-50 rounded-lg animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
        </div>
      )}
    </div>
  );
} 