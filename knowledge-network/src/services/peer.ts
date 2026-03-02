import { apiFetch } from './api';

// ── Types ─────────────────────────────────────────────────────────────────

export interface MemberProfile {
  student_id: string;
  name: string;
  concept_profile: Record<string, number>;
}

export interface SessionMember {
  student_id: string;
  name: string;
  joined_at?: string;
}

export interface PeerQuestion {
  question_id: string;
  target_member: string;
  target_member_name: string;
  weak_concept: string;
  stem: string;
  type: 'open' | 'code' | 'math' | 'mcq';
  options?: string[] | null;
  correct_answer: string;
  explanation: string;
}

export interface SubmittedAnswer {
  question_id: string;
  submitted_by: string;
  answer_text: string;
  is_correct: boolean;
  score: number;
  ai_feedback: string;
  hint: string;
}

export interface SessionState {
  session_id: string;
  hub_id: string;
  topic: string;
  status: 'waiting' | 'active' | 'completed';
  created_by: string;
  created_at?: string;
  members: SessionMember[];
  expected_members: number;
  questions: PeerQuestion[];
  current_question_index: number;
  answers: SubmittedAnswer[];
}

export interface CreateSessionResponse {
  session_id: string;
  status: string;
}

export interface SubmitAnswerResponse {
  question_id: string;
  is_correct: boolean;
  score: number;
  ai_feedback: string;
  hint: string;
  explanation: string;
}

// ── API Functions ─────────────────────────────────────────────────────────

export async function createSession(
  hubId: string,
  topic: string,
  memberProfiles: MemberProfile[],
  token?: string | null,
): Promise<CreateSessionResponse> {
  return apiFetch<CreateSessionResponse>('/api/peer/session', {
    method: 'POST',
    body: JSON.stringify({
      hub_id: hubId,
      topic,
      member_profiles: memberProfiles,
    }),
  }, token);
}

export async function joinSession(
  sessionId: string,
  studentId: string,
  name: string,
  token?: string | null,
): Promise<{ status: string; already_joined: boolean }> {
  return apiFetch('/api/peer/session/join', {
    method: 'POST',
    body: JSON.stringify({
      session_id: sessionId,
      student_id: studentId,
      name,
    }),
  }, token);
}

export async function getSession(
  sessionId: string,
  token?: string | null,
): Promise<SessionState> {
  return apiFetch<SessionState>(`/api/peer/session/${encodeURIComponent(sessionId)}`, undefined, token);
}

export async function getActiveSession(
  hubId: string,
  token?: string | null,
): Promise<SessionState | null> {
  const result = await apiFetch<{ session: SessionState | null }>(
    `/api/peer/session/active/${encodeURIComponent(hubId)}`,
    undefined,
    token,
  );
  return result.session;
}

export async function submitAnswer(
  sessionId: string,
  questionId: string,
  answerText: string,
  token?: string | null,
): Promise<SubmitAnswerResponse> {
  return apiFetch<SubmitAnswerResponse>('/api/peer/session/answer', {
    method: 'POST',
    body: JSON.stringify({
      session_id: sessionId,
      question_id: questionId,
      answer_text: answerText,
    }),
  }, token);
}

export async function advanceQuestion(
  sessionId: string,
  token?: string | null,
): Promise<{ status: string; current_question_index: number }> {
  return apiFetch(`/api/peer/session/${encodeURIComponent(sessionId)}/advance`, {
    method: 'POST',
  }, token);
}

export async function endSession(
  sessionId: string,
  token?: string | null,
): Promise<{ status: string }> {
  return apiFetch(`/api/peer/session/${encodeURIComponent(sessionId)}/end`, {
    method: 'POST',
  }, token);
}

export interface SessionSummary {
  session_id: string;
  hub_id: string;
  topic: string;
  status: 'waiting' | 'active' | 'completed';
  created_by: string;
  created_at?: string;
  members: SessionMember[];
  expected_members: number;
  question_count: number;
}

export async function getAllActiveSessions(
  token?: string | null,
): Promise<SessionSummary[]> {
  const result = await apiFetch<{ sessions: SessionSummary[] }>(
    '/api/peer/sessions/all',
    undefined,
    token,
  );
  return result.sessions || [];
}

export async function getSessionHistory(
  hubId: string,
  token?: string | null,
  limit = 20,
): Promise<SessionState[]> {
  const result = await apiFetch<{ sessions: SessionState[] }>(
    `/api/peer/session/history/${encodeURIComponent(hubId)}?limit=${limit}`,
    undefined,
    token,
  );
  return result.sessions || [];
}
