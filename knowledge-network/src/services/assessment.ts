import { Assessment, AssessmentResult } from '@/types/assessment';
import { apiFetch } from '@/services/api';

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

export interface AssessmentHistoryQuestion {
  question_id: string;
  concept: string;
  stem: string;
  selected_answer: string;
  correct_answer: string;
  is_correct: boolean;
  confidence_1_to_5: number;
  mistake_type: string;
  missing_concept?: string | null;
  rationale: string;
}

export interface AssessmentHistoryRun {
  run_id: string;
  student_id: string;
  concept: string;
  submitted_at: string;
  score: number;
  correct_count: number;
  total_questions: number;
  blind_spot_found_count: number;
  blind_spot_resolved_count: number;
  questions: AssessmentHistoryQuestion[];
}

async function jsonFetch<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  return apiFetch<T>(path, init, token);
}

export async function generateQuiz(
  studentId: string,
  concept: string,
  numQuestions = 5,
  token?: string | null,
  uploadTicket?: string | null
): Promise<QuizQuestionClient[]> {
  const payload = {
    student_id: studentId,
    concept,
    num_questions: numQuestions,
    upload_ticket: uploadTicket || undefined,
  };
  const response = await jsonFetch<{ questions: QuizQuestionClient[] }>(
    '/api/assessment/generate-quiz',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token
  );
  return response.questions;
}

export async function evaluateAnswer(
  studentId: string,
  concept: string,
  answers: QuizAnswerClient[],
  token?: string | null
): Promise<EvaluateResult> {
  return jsonFetch<EvaluateResult>('/api/assessment/evaluate', {
    method: 'POST',
    body: JSON.stringify({
      student_id: studentId,
      concept,
      answers,
    }),
  }, token);
}

export async function classifyMistake(
  studentId: string,
  concept: string,
  answers: QuizAnswerClient[],
  token?: string | null
): Promise<ClassifyResult> {
  return jsonFetch<ClassifyResult>('/api/assessment/classify', {
    method: 'POST',
    body: JSON.stringify({
      student_id: studentId,
      concept,
      answers,
    }),
  }, token);
}

export async function getSelfAwarenessScore(studentId: string, token?: string | null): Promise<{
  student_id: string;
  score: number;
  total_attempts: number;
  calibration_gap: number;
}> {
  return jsonFetch(`/api/assessment/self-awareness/${studentId}`, undefined, token);
}

export async function getMicroCheckpoint(
  studentId: string,
  concept: string,
  missingConcept?: string,
  token?: string | null
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
    },
    token
  );
  return response.question;
}

export async function submitMicroCheckpoint(
  studentId: string,
  questionId: string,
  selectedAnswer: string,
  confidence = 3,
  token?: string | null
): Promise<{ question_id: string; is_correct: boolean; next_action: 'resolved' | 'needs_intervention' }> {
  return jsonFetch('/api/assessment/micro-checkpoint/submit', {
    method: 'POST',
    body: JSON.stringify({
      student_id: studentId,
      question_id: questionId,
      selected_answer: selectedAnswer,
      confidence_1_to_5: confidence,
    }),
  }, token);
}

export async function overrideClassification(
  studentId: string,
  questionId: string,
  token?: string | null
): Promise<{ updated: boolean; question_id: string }> {
  return jsonFetch('/api/assessment/override', {
    method: 'POST',
    body: JSON.stringify({
      student_id: studentId,
      question_id: questionId,
      override_to: 'careless',
    }),
  }, token);
}

export async function getAssessmentHistory(
  token?: string | null,
  concept?: string,
  limit = 20
): Promise<AssessmentHistoryRun[]> {
  const query = new URLSearchParams();
  if (concept) query.set('concept', concept);
  query.set('limit', String(limit));
  const suffix = query.toString();
  const response = await jsonFetch<{ runs: AssessmentHistoryRun[] }>(
    `/api/assessment/history${suffix ? `?${suffix}` : ''}`,
    undefined,
    token
  );
  return response.runs || [];
}

export async function getAssessmentRun(
  runId: string,
  token?: string | null
): Promise<AssessmentHistoryRun> {
  return jsonFetch<AssessmentHistoryRun>(
    `/api/assessment/history/${encodeURIComponent(runId)}`,
    undefined,
    token
  );
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
  const generatedId = `assessment-${Date.now()}`;
  return {
    id: generatedId,
    courseId: _courseId,
    title: 'Assessment',
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
