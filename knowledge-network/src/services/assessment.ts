import { Assessment, AssessmentResult } from '@/types/assessment';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8000';

function getCandidateBaseUrls(): string[] {
  const candidates = [
    API_BASE_URL,
    'http://127.0.0.1:8000',
    'http://localhost:8000',
    'http://127.0.0.1:8001',
    'http://localhost:8001',
  ];
  return [...new Set(candidates)];
}

type Difficulty = 'easy' | 'medium' | 'hard';

export interface QuizQuestionClient {
  question_id: string;
  concept: string;
  stem: string;
  options: string[];
  difficulty: Difficulty;
}

export interface QuizAnswerClient {
  question_id: string;
  selected_answer: string;
  confidence_1_to_5: number;
}

export interface EvaluateResult {
  score: number;
  per_question: {
    question_id: string;
    is_correct: boolean;
    correct_answer: string;
  }[];
}

export interface MistakeClassificationClient {
  question_id: string;
  mistake_type: 'careless' | 'conceptual';
  missing_concept?: string | null;
  error_span?: string | null;
  rationale: string;
}

export interface ClassifyResult {
  classifications: MistakeClassificationClient[];
  blind_spot_found_count: number;
  blind_spot_resolved_count: number;
  integration_actions?: {
    question_id: string;
    mistake_type: 'careless' | 'conceptual';
    rpkt_probe?: { concept?: string; missing_concept?: string | null };
    intervention?: { mistake_type?: 'careless' | 'conceptual'; concept?: string; missing_concept?: string | null };
  }[];
}

export interface MicroCheckpointQuestion {
  question_id: string;
  concept: string;
  stem: string;
  options: string[];
  correct_answer: string;
  explanation?: string | null;
  difficulty: Difficulty;
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrls = getCandidateBaseUrls();
  let lastNetworkError: unknown = null;

  for (const base of baseUrls) {
    try {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`API ${response.status}: ${detail}`);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      // Retry other base URLs only for network-level failures.
      if (error instanceof TypeError) {
        lastNetworkError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastNetworkError ?? new Error('Failed to reach API');
}

export async function generateQuiz(
  studentId: string,
  concept: string,
  numQuestions = 5
): Promise<QuizQuestionClient[]> {
  const payload = {
    student_id: studentId,
    concept,
    num_questions: numQuestions,
  };
  const response = await jsonFetch<{ questions: QuizQuestionClient[] }>(
    '/api/assessment/generate-quiz',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
  return response.questions;
}

export async function evaluateAnswer(
  studentId: string,
  concept: string,
  answers: QuizAnswerClient[]
): Promise<EvaluateResult> {
  return jsonFetch<EvaluateResult>('/api/assessment/evaluate', {
    method: 'POST',
    body: JSON.stringify({
      student_id: studentId,
      concept,
      answers,
    }),
  });
}

export async function classifyMistake(
  studentId: string,
  concept: string,
  answers: QuizAnswerClient[]
): Promise<ClassifyResult> {
  return jsonFetch<ClassifyResult>('/api/assessment/classify', {
    method: 'POST',
    body: JSON.stringify({
      student_id: studentId,
      concept,
      answers,
    }),
  });
}

export async function getSelfAwarenessScore(studentId: string): Promise<{
  student_id: string;
  score: number;
  total_attempts: number;
  calibration_gap: number;
}> {
  return jsonFetch(`/api/assessment/self-awareness/${studentId}`);
}

export async function getMicroCheckpoint(
  studentId: string,
  concept: string,
  missingConcept?: string
): Promise<MicroCheckpointQuestion> {
  const response = await jsonFetch<{ question: MicroCheckpointQuestion }>(
    '/api/assessment/micro-checkpoint',
    {
      method: 'POST',
      body: JSON.stringify({
        student_id: studentId,
        concept,
        missing_concept: missingConcept || null,
      }),
    }
  );
  return response.question;
}

export async function submitMicroCheckpoint(
  studentId: string,
  questionId: string,
  selectedAnswer: string,
  confidence = 3
): Promise<{ question_id: string; is_correct: boolean; next_action: 'resolved' | 'needs_intervention' }> {
  return jsonFetch('/api/assessment/micro-checkpoint/submit', {
    method: 'POST',
    body: JSON.stringify({
      student_id: studentId,
      question_id: questionId,
      selected_answer: selectedAnswer,
      confidence_1_to_5: confidence,
    }),
  });
}

export async function overrideClassification(
  studentId: string,
  questionId: string
): Promise<{ updated: boolean; question_id: string }> {
  return jsonFetch('/api/assessment/override', {
    method: 'POST',
    body: JSON.stringify({
      student_id: studentId,
      question_id: questionId,
      override_to: 'careless',
    }),
  });
}

// Kept for dashboard compatibility; replace with backend integration as needed.
export async function getAssessments(_userId: string): Promise<Assessment[]> {
  return [];
}

export async function getUpcomingAssessments(_userId: string): Promise<Assessment[]> {
  return [];
}

export async function submitAssessment(
  assessmentId: string,
  userId: string,
  _answers: { questionId: string; answer: string }[]
): Promise<AssessmentResult> {
  return {
    assessmentId,
    studentId: userId,
    score: 0,
    completedAt: new Date(),
    answers: [],
    conceptGaps: [],
  };
}

export async function getAssessmentDetails(_assessmentId: string): Promise<Assessment | null> {
  return null;
}

export async function generateAssessment(_courseId: string, _conceptsTested: string[]): Promise<Assessment> {
  return {
    id: 'generated',
    courseId: 'course',
    title: 'Generated Assessment',
    score: 0,
    completedAt: new Date(),
    conceptGaps: [],
    status: 'pending',
    type: 'quiz',
    questions: [],
  };
}

export async function getAssessmentResult(_assessmentId: string, _userId: string): Promise<AssessmentResult | null> {
  return null;
}
