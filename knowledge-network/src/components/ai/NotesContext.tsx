import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';

export interface ContextItem {
  text: string;
  concept_id?: string;
  score: number;
  index?: number;   // 1-based citation number assigned by backend
}

interface SourceGroup {
  conceptId: string;
  label: string;
  maxScore: number;
  chunks: ContextItem[];
}

interface NotesContextProps {
  activeNotes: ContextItem[];
  onNoteClick: (note: ContextItem) => void;
  highlightedSourceIndex?: number | null;
}

/** "smu-gen-ai-topic-2" → "Smu Gen Ai Topic 2" */
function slugToLabel(slug: string): string {
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Return up to maxWords words followed by "…" if truncated. */
function excerpt(text: string, maxWords = 80): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + '…';
}

const MAX_VISIBLE = 5;

export function NotesContext({ activeNotes, onNoteClick, highlightedSourceIndex }: NotesContextProps) {
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<number>>(new Set());
  const [expandedFullChunks, setExpandedFullChunks] = useState<Set<number>>(new Set()); // keyed by chunk.index
  const [showAll, setShowAll] = useState(false);
  const groupRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Reset expansion state when a new response arrives
  useEffect(() => {
    setExpandedGroupIds(new Set());
    setExpandedFullChunks(new Set());
    setShowAll(false);
  }, [activeNotes]);

  // Group chunks by concept_id, sort by maxScore desc, filter 0% groups
  const allGroups: SourceGroup[] = (() => {
    const map = new Map<string, ContextItem[]>();
    for (const note of activeNotes) {
      const key = note.concept_id || 'unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(note);
    }
    return Array.from(map.entries())
      .map(([conceptId, chunks]) => ({
        conceptId,
        label: slugToLabel(conceptId),
        maxScore: Math.max(...chunks.map(c => c.score)),
        chunks: [...chunks].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)),
      }))
      .sort((a, b) => b.maxScore - a.maxScore);
  })();

  const relevantGroups = allGroups.filter(g => g.maxScore > 0);
  const hiddenCount = allGroups.length - relevantGroups.length;
  const visibleGroups = showAll ? relevantGroups : relevantGroups.slice(0, MAX_VISIBLE);
  const hasMore = relevantGroups.length > MAX_VISIBLE;

  // Auto-expand and scroll to the group containing the highlighted citation
  useEffect(() => {
    if (highlightedSourceIndex == null) return;
    const gi = visibleGroups.findIndex(g =>
      g.chunks.some(c => c.index === highlightedSourceIndex)
    );
    if (gi === -1) return;
    setExpandedGroupIds(prev => {
      const next = new Set(prev);
      next.add(gi);
      return next;
    });
    setTimeout(() => {
      groupRefs.current[gi]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  }, [highlightedSourceIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleGroup = (gi: number) => {
    setExpandedGroupIds(prev => {
      const next = new Set(prev);
      if (next.has(gi)) next.delete(gi); else next.add(gi);
      return next;
    });
  };

  const toggleFullChunk = (chunkIndex: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFullChunks(prev => {
      const next = new Set(prev);
      if (next.has(chunkIndex)) next.delete(chunkIndex); else next.add(chunkIndex);
      return next;
    });
  };

  if (activeNotes.length === 0) {
    return (
      <div className="p-4">
        <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Sources</h2>
        <p className="text-sm text-muted-foreground">No sources retrieved yet. Ask a question to see relevant context.</p>
      </div>
    );
  }

  return (
<<<<<<< Updated upstream
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
=======
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Sources ({relevantGroups.length})
        </h2>
        {hasMore && (
          <button
            onClick={() => setShowAll(s => !s)}
            className="text-xs text-[#03b2e6] hover:underline"
          >
            {showAll ? 'Show fewer' : `Show all ${relevantGroups.length} ↓`}
          </button>
        )}
>>>>>>> Stashed changes
      </div>

      <div className="space-y-2">
        {visibleGroups.map((group, gi) => {
          const isExpanded = expandedGroupIds.has(gi);
          const isHighlighted = highlightedSourceIndex != null &&
            group.chunks.some(c => c.index === highlightedSourceIndex);

          return (
            <div
              key={group.conceptId}
              ref={el => { groupRefs.current[gi] = el; }}
              className={`rounded-lg border overflow-hidden transition-colors ${
                isHighlighted ? 'border-[#03b2e6]' : 'border-border'
              }`}
            >
              {/* Group header */}
              <button
                onClick={() => toggleGroup(gi)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                  isHighlighted ? 'bg-[#e0f4fb]' : 'hover:bg-accent'
                }`}
              >
                {isExpanded
                  ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                  : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />}
                <FileText className="w-3.5 h-3.5 flex-shrink-0 text-[#03b2e6]" />
                <span className="flex-1 text-xs font-medium truncate" title={group.label}>
                  {group.label}
                </span>
                {/* Citation index badges */}
                <span className="flex gap-0.5 flex-shrink-0 mr-1">
                  {group.chunks.filter(c => c.index != null).map(c => (
                    <span
                      key={c.index}
                      className={`inline-flex items-center justify-center w-3.5 h-3.5 text-[0.55em] font-bold rounded-full ${
                        c.index === highlightedSourceIndex
                          ? 'text-white bg-[#03b2e6]'
                          : 'text-[#03b2e6] bg-[#e0f4fb]'
                      }`}
                    >
                      {c.index}
                    </span>
                  ))}
                </span>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {Math.round(group.maxScore * 100)}%
                </span>
              </button>

              {/* Expanded: show each chunk as an excerpt */}
              {isExpanded && (
                <div className="border-t border-border divide-y divide-border">
                  {group.chunks.map((chunk, ci) => {
                    const isFullShown = expandedFullChunks.has(chunk.index ?? ci);
                    const isChunkHighlighted = chunk.index === highlightedSourceIndex;
                    const displayText = isFullShown ? chunk.text : excerpt(chunk.text);
                    const isTruncated = chunk.text.trim().split(/\s+/).length > 80;

                    return (
                      <div
                        key={ci}
                        className={`px-3 py-2 cursor-pointer transition-colors ${
                          isChunkHighlighted ? 'bg-[#e0f4fb]/70' : 'bg-accent/50 hover:bg-accent'
                        }`}
                        onClick={() => onNoteClick(chunk)}
                      >
                        {chunk.index != null && (
                          <span className="inline-flex items-center justify-center w-4 h-4 text-[0.6em] font-bold text-white bg-[#03b2e6] rounded-full mr-1 mb-0.5 align-middle">
                            {chunk.index}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                          {displayText}
                        </span>
                        {isTruncated && (
                          <button
                            className="block mt-1 text-[0.7rem] text-[#03b2e6] hover:underline"
                            onClick={(e) => toggleFullChunk(chunk.index ?? ci, e)}
                          >
                            {isFullShown ? 'Show less' : 'Show full source'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hiddenCount > 0 && (
        <p className="mt-3 text-xs text-muted-foreground text-center">
          {hiddenCount} source{hiddenCount > 1 ? 's' : ''} with 0% relevance hidden
        </p>
      )}
    </div>
  );
<<<<<<< Updated upstream
} 
=======
}
>>>>>>> Stashed changes
