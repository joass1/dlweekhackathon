import React from 'react';
import { GroupFeed } from './GroupFeed';
import { ConceptualGapAnalysis } from './ConceptualGapAnalysis';
import { PeerSessionScheduler } from './PeerSessionScheduler';

interface GroupDetailViewProps {
  groupId: string;
}

export function GroupDetailView({ groupId }: GroupDetailViewProps) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Group Details: {groupId}</h1>
      
      <div className="grid gap-6">
        <section>
          <h2 className="text-xl font-semibold mb-4">Group Feed</h2>
          <GroupFeed groupId={groupId} />
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">Conceptual Gaps</h2>
          <ConceptualGapAnalysis groupId={groupId} />
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">Peer Sessions</h2>
          <PeerSessionScheduler groupId={groupId} />
        </section>
      </div>
    </div>
  );
}

export default GroupDetailView; 