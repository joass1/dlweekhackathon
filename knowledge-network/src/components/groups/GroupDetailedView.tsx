// src/components/groups/GroupDetailedView.tsx
import React, { useState } from 'react';
import { ConceptualGapAnalysis } from './ConceptualGapAnalysis';
import { GroupFeed } from './GroupFeed';
import { PeerSessionScheduler } from './PeerSessionScheduler';

interface GroupDetailViewProps {
  groupId: string;
}

export const GroupDetailView = ({ groupId }: GroupDetailViewProps) => {
  const [activeTab, setActiveTab] = useState('feed');

  return (
    <div className="p-6">
      {/* Header section */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Group: {groupId}</h1>
        <div className="flex gap-4 mb-4">
          <button
            onClick={() => setActiveTab('feed')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'feed' ? 'bg-purple-100 text-purple-700' : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            Group Feed
          </button>
          <button
            onClick={() => setActiveTab('analysis')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'analysis' ? 'bg-purple-100 text-purple-700' : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            Learning Analysis
          </button>
          <button
            onClick={() => setActiveTab('sessions')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'sessions' ? 'bg-purple-100 text-purple-700' : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            Peer Sessions
          </button>
        </div>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 gap-6">
        <div>
          {activeTab === 'feed' && <GroupFeed groupId={groupId} />}
          {activeTab === 'analysis' && <ConceptualGapAnalysis groupId={groupId} />}
          {activeTab === 'sessions' && <PeerSessionScheduler groupId={groupId} />}
        </div>
      </div>
    </div>
  );
};

export default GroupDetailView;
