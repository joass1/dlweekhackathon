// src/services/groups.ts
import { Course, GroupMember } from '@/types/group';

export async function getGroups(): Promise<Course[]> {
  // Replace with actual API call
  return [
    {
      id: "data-structures",
      name: "Data Structures",
      code: "CS201",
      progress: 75,
      members: [],
      conceptGaps: []
    },
    {
      id: "physics-101",
      name: "Physics 101",
      code: "PHY101",
      progress: 82,
      members: [],
      conceptGaps: []
    }
  ];
}

export async function getGroupDetails(groupId: string): Promise<Course | null> {
  // Replace with actual API call
  return {
    id: groupId,
    name: "Data Structures",
    code: "CS201",
    progress: 75,
    members: [
      {
        id: "1",
        name: "Alice Chen",
        strengths: ["Graph Algorithms", "Dynamic Programming"],
        needsHelp: ["Red-Black Trees"],
        availability: ["Mon 2-4pm", "Wed 3-5pm"]
      }
    ],
    conceptGaps: [
      {
        concept: "Binary Tree Balancing",
        confidenceScore: 65,
        recommendedResources: ["Video: AVL Trees", "Practice: Tree Rotations"],
        priority: "high"
      }
    ]
  };
}