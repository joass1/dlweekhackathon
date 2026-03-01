// src/components/groups/GroupDetailedView.tsx
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Video, Brain, MessageSquare } from 'lucide-react';
import { ConceptualGapAnalysis } from './ConceptualGapAnalysis';
import { GroupFeed } from './GroupFeed';
import { PeerSessionScheduler } from './PeerSessionScheduler';
import type { GroupMember, ConceptGap } from '@/types/group';

interface GroupDetailViewProps {
  groupId: string;
}

export const GroupDetailView = ({ groupId }: GroupDetailViewProps) => {
  const [activeTab, setActiveTab] = useState('feed');
  
  // Mock data - in real app, fetch this from an API
  const conceptGaps: ConceptGap[] = [
    {
      concept: "Binary Tree Balancing",
      confidenceScore: 65,
      recommendedResources: ["Video: AVL Trees", "Practice: Tree Rotations"],
      priority: "high"
    },
    {
      concept: "Red-Black Tree Properties",
      confidenceScore: 72,
      recommendedResources: ["Interactive Demo", "Quiz Set"],
      priority: "medium"
    }
  ];

  const members: GroupMember[] = [
    {
      id: "1",
      name: "Alice Chen",
      strengths: ["Graph Algorithms", "Dynamic Programming"],
      needsHelp: ["Red-Black Trees"],
      availability: ["Mon 2-4pm", "Wed 3-5pm"]
    },
    {
      id: "2",
      name: "Bob Smith",
      strengths: ["Tree Structures", "Sorting Algorithms"],
      needsHelp: ["Graph Traversal"],
      availability: ["Tue 1-3pm", "Thu 4-6pm"]
    }
  ];

  const feedItems = [
    {
      id: "1",
      userName: "Alice Chen",
      type: "completion",
      content: "Completed practice set on AVL Trees - Score: 85%",
      timestamp: new Date()
    },
    {
      id: "2",
      userName: "Bob Smith",
      type: "session",
      content: "Scheduled peer learning session with Alice - Topic: Graph Algorithms",
      timestamp: new Date()
    }
  ];

  return (
    <div className="p-6">
      {/* Header section */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Data Structures - Group A</h1>
        <div className="flex gap-4 mb-4">
          <button
            onClick={() => setActiveTab('feed')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'feed' ? 'bg-purple-100 text-purple-700' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Group Feed
          </button>
          <button
            onClick={() => setActiveTab('analysis')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'analysis' ? 'bg-purple-100 text-purple-700' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Learning Analysis
          </button>
          <button
            onClick={() => setActiveTab('sessions')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'sessions' ? 'bg-purple-100 text-purple-700' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Peer Sessions
          </button>
        </div>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-3 gap-6">
        {/* Left main content area */}
        <div className="col-span-2">
          {activeTab === 'feed' && (
            <div className="space-y-4">
              {feedItems.map((item) => (
                <Card key={item.id}>
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                        {item.userName.charAt(0)}
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between items-start">
                          <span className="font-medium">{item.userName}</span>
                          <span className="text-sm text-gray-500">
                            {item.timestamp.toLocaleDateString()}
                          </span>
                        </div>
                        <p className="mt-1 text-gray-600">{item.content}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {activeTab === 'analysis' && <ConceptualGapAnalysis groupId={groupId} />}
          {activeTab === 'sessions' && <PeerSessionScheduler groupId={groupId} />}
        </div>

        {/* Right sidebar */}
        <div className="col-span-1">
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Group Members</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {members.map((member) => (
                  <div key={member.id} className="border-b pb-4 last:border-b-0">
                    <div className="font-medium">{member.name}</div>
                    <div className="text-sm text-gray-600 mt-2">
                      <div>Strengths: {member.strengths.join(", ")}</div>
                      <div>Needs Help: {member.needsHelp.join(", ")}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Group Progress Card */}
          <Card>
            <CardHeader>
              <CardTitle>Group Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-2">
                    <span>Overall Progress</span>
                    <span>75%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-purple-600 h-2 rounded-full"
                      style={{ width: '75%' }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <span>Assessment Completion</span>
                    <span>4/5</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-purple-600 h-2 rounded-full"
                      style={{ width: '80%' }}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default GroupDetailView;