// src/services/assessment.ts
import { Assessment, AssessmentResult, AssessmentQuestion } from '@/types/assessment';

export async function getAssessments(userId: string): Promise<Assessment[]> {
  // Replace with actual API call
  return [
    {
      id: "1",
      courseId: "cs201",
      title: "Data Structures Week 3",
      score: 85,
      completedAt: new Date(),
      status: 'completed',
      type: 'weekly',
      conceptGaps: [
        {
          concept: "Binary Tree Balancing",
          confidenceScore: 65,
          recommendedResources: ["Video: AVL Trees", "Practice: Tree Rotations"],
          priority: "high"
        }
      ],
      questions: [
        {
          id: "q1",
          question: "What is the time complexity of AVL tree insertion?",
          options: ["O(1)", "O(log n)", "O(n)", "O(n^2)"],
          correctAnswer: "O(log n)",
          conceptTested: "AVL Trees",
          difficulty: "medium"
        }
      ]
    }
  ];
}

export async function getUpcomingAssessments(userId: string): Promise<Assessment[]> {
  // Replace with actual API call
  return [
    {
      id: "2",
      courseId: "cs201",
      title: "Binary Trees Quiz",
      score: 0,
      completedAt: new Date(),
      status: 'pending',
      type: 'quiz',
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      conceptGaps: [],
      questions: []
    }
  ];
}

export async function submitAssessment(
  assessmentId: string, 
  userId: string, 
  answers: { questionId: string; answer: string }[]
): Promise<AssessmentResult> {
  // Replace with actual API call
  return {
    assessmentId,
    studentId: userId,
    score: 85,
    completedAt: new Date(),
    answers: [
      {
        questionId: "q1",
        answer: "O(log n)",
        isCorrect: true
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

export async function getAssessmentDetails(assessmentId: string): Promise<Assessment | null> {
  // Replace with actual API call
  return {
    id: assessmentId,
    courseId: "cs201",
    title: "Data Structures Week 3",
    score: 85,
    completedAt: new Date(),
    status: 'completed',
    type: 'weekly',
    conceptGaps: [
      {
        concept: "Binary Tree Balancing",
        confidenceScore: 65,
        recommendedResources: ["Video: AVL Trees", "Practice: Tree Rotations"],
        priority: "high"
      }
    ],
    questions: [
      {
        id: "q1",
        question: "What is the time complexity of AVL tree insertion?",
        options: ["O(1)", "O(log n)", "O(n)", "O(n^2)"],
        correctAnswer: "O(log n)",
        conceptTested: "AVL Trees",
        difficulty: "medium",
        explanation: "AVL trees maintain balance during insertion, requiring rebalancing operations that take logarithmic time."
      }
    ]
  };
}

export async function generateAssessment(courseId: string, conceptsTested: string[]): Promise<Assessment> {
  // Replace with actual API call - this would typically generate a new assessment based on concepts
  return {
    id: "new_assessment",
    courseId,
    title: "Generated Assessment",
    score: 0,
    completedAt: new Date(),
    status: 'pending',
    type: 'quiz',
    conceptGaps: [],
    questions: [
      {
        id: "gen_q1",
        question: "Sample generated question based on concepts",
        options: ["Option 1", "Option 2", "Option 3", "Option 4"],
        correctAnswer: "Option 2",
        conceptTested: conceptsTested[0],
        difficulty: "medium"
      }
    ]
  };
}

export async function getAssessmentResult(
  assessmentId: string, 
  userId: string
): Promise<AssessmentResult | null> {
  // Replace with actual API call
  return {
    assessmentId,
    studentId: userId,
    score: 85,
    completedAt: new Date(),
    answers: [
      {
        questionId: "q1",
        answer: "O(log n)",
        isCorrect: true
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