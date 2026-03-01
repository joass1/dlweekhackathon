// src/types/group.ts
export interface GroupMember {
  id: string;
  name: string;
  strengths: string[];
  needsHelp: string[];
  availability: string[];
}

export interface ConceptGap {
  concept: string;
  confidenceScore: number;
  recommendedResources: string[];
  priority: 'high' | 'medium' | 'low';
}

// Added export here
export interface Course {
  id: string;
  name: string;
  code: string;
  progress: number;
  members: GroupMember[];
  conceptGaps: ConceptGap[];
}

export interface FeedItem {
  id: string;
  userId: string;
  userName: string;
  type: 'completion' | 'question' | 'resource' | 'session';
  content: string;
  timestamp: Date;
}