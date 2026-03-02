import React from 'react';

interface ContextItem {
  text: string;
  id: string;
  score: number;
}

interface NotesContextProps {
  activeNotes: ContextItem[];
  onNoteClick: (note: ContextItem) => void;
}

function truncateText(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

function createUniqueKey(text: string, index: number): string {
  // Create a hash of the text to ensure uniqueness
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `note-${index}-${hash}`;
}

export function NotesContext({ activeNotes, onNoteClick }: NotesContextProps) {
  return (
    <div className="p-4 text-slate-100">
      <h2 className="text-lg font-semibold mb-4 text-white">Related Context</h2>
      <div className="space-y-4">
        {activeNotes.map((note, index) => (
          <div
            key={createUniqueKey(note.text, index)}
            className="p-3 rounded-lg border border-white/15 bg-white/10 hover:bg-white/15 cursor-pointer transition-colors"
            onClick={() => onNoteClick(note)}
          >
            <p className="text-sm text-slate-200">{note.text}</p>
            <p className="text-xs text-slate-300 mt-1">Relevance: {Math.round(note.score * 100)}%</p>
          </div>
        ))}
      </div>
    </div>
  );
} 
