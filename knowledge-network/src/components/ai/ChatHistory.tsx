import React from 'react';

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  relatedNotes?: string[];
}

interface ChatHistoryProps {
  messages: Message[];
}

export function ChatHistory({ messages }: ChatHistoryProps) {
  return (
    <div className="h-full bg-gray-50 p-4 overflow-y-auto">
      <h2 className="text-lg font-semibold mb-4">Chat History</h2>
      <div className="space-y-2">
        {messages.map((message) => (
          <div
            key={message.id}
            className="p-2 rounded hover:bg-gray-100 cursor-pointer"
          >
            <p className="text-sm truncate">
              {message.role === 'user' ? '👤 You: ' : '🤖 AI: '}
              {message.content.substring(0, 50)}...
            </p>
            <span className="text-xs text-gray-500">
              {new Date(message.timestamp).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
} 