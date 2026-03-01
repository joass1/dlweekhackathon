// src/types/assessment.ts
import { ConceptGap } from './group';

export type AssessmentStatus = 'pending' | 'in_progress' | 'completed';

export interface Assessment {
  id: string;
  courseId: string;
  title: string;
  score: number;
  completedAt: Date;
  conceptGaps: ConceptGap[];
  status: AssessmentStatus;
  dueDate?: Date;
  type: 'weekly' | 'quiz' | 'final';
  questions?: AssessmentQuestion[];
}

export interface AssessmentQuestion {
  id: string;
  question: string;
  options?: string[];
  correctAnswer?: string;
  explanation?: string;
  conceptTested: string;
  difficulty: 'easy' | 'medium' | 'hard';
  studentAnswer?: string;
  isCorrect?: boolean;
}

export interface AssessmentResult {
  assessmentId: string;
  studentId: string;
  score: number;
  completedAt: Date;
  answers: {
    questionId: string;
    answer: string;
    isCorrect: boolean;
  }[];
  conceptGaps: ConceptGap[];
}