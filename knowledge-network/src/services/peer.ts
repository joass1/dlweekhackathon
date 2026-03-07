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
  concept_id: string;
  weak_concept: string;
  stem: string;
  type: 'open' | 'code' | 'math' | 'mcq';
  options?: string[] | null;
  correct_answer: string;
  explanation: string;
  key_points?: string[];
  must_mention?: string[];
  allowed_equivalents?: string[];
  common_misconceptions?: string[];
  grading_notes?: string | null;
}

export interface SubmittedAnswer {
  question_id: string;
  submitted_by: string;
  answer_text: string;
  concept_id: string;
  mistake_type: string;
  is_correct: boolean;
  score: number;
  ai_feedback: string;
  hint: string;
  damage_dealt?: number | null;
  boss_attacked?: boolean | null;
  party_damage_taken?: number | null;
  attack_reason?: 'weak_answer' | 'timeout' | null;
  mastery_delta?: number | null;
  updated_mastery?: number | null;
  mastery_status?: string | null;
}

export interface SessionState {
  session_id: string;
  hub_id: string;
  topic: string;
  level?: number | null;
  boss_character_id?: 'punk' | 'spacesuit' | 'swat' | 'suit' | null;
  selected_concept_id?: string | null;
  course_id?: string | null;
  course_name?: string | null;
  boss_name?: string | null;
  boss_health_max?: number;
  boss_health_current?: number;
  boss_defeated?: boolean;
  party_health_max?: number;
  party_health_current?: number;
  party_defeated?: boolean;
  battle_outcome?: 'pending' | 'victory' | 'defeat' | null;
  boss_attack_count?: number;
  current_question_started_at?: string | null;
  question_time_limit_sec?: number | null;
  question_timeout_penalties?: Array<Record<string, unknown>>;
  boss_attack_log?: Array<Record<string, unknown>>;
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
  submitted_by: string;
  concept_id: string;
  mistake_type: string;
  is_correct: boolean;
  score: number;
  ai_feedback: string;
  hint: string;
  explanation: string;
  damage_dealt?: number | null;
  boss_health_max?: number;
  boss_health_current?: number;
  boss_defeated?: boolean;
  party_health_max?: number;
  party_health_current?: number;
  party_defeated?: boolean;
  battle_outcome?: 'pending' | 'victory' | 'defeat' | null;
  boss_attacked?: boolean;
  party_damage_taken?: number;
  attack_reason?: 'weak_answer' | 'timeout' | null;
  boss_attack_count?: number;
  already_submitted?: boolean;
  mastery_delta?: number | null;
  updated_mastery?: number | null;
  mastery_status?: string | null;
}

export interface TwilioVideoTokenResponse {
  token: string;
  room_name: string;
  identity: string;
  ttl_seconds: number;
}

// ── API Functions ─────────────────────────────────────────────────────────

export async function createSession(
  hubId: string,
  topic: string,
  level: number,
  conceptId: string | null,
  courseId: string | null,
  courseName: string | null,
  memberProfiles: MemberProfile[],
  token?: string | null,
): Promise<CreateSessionResponse> {
  return apiFetch<CreateSessionResponse>('/api/peer/session', {
    method: 'POST',
    body: JSON.stringify({
      hub_id: hubId,
      topic,
      level,
      concept_id: conceptId,
      course_id: courseId,
      course_name: courseName,
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
  const ts = Date.now();
  return apiFetch<SessionState>(`/api/peer/session/${encodeURIComponent(sessionId)}?_ts=${ts}`, undefined, token);
}

export async function getActiveSession(
  hubId: string,
  token?: string | null,
): Promise<SessionState | null> {
  const ts = Date.now();
  const result = await apiFetch<{ session: SessionState | null }>(
    `/api/peer/session/active/${encodeURIComponent(hubId)}?_ts=${ts}`,
    undefined,
    token,
  );
  return result.session;
}

export async function submitAnswer(
  sessionId: string,
  questionId: string,
  answerText: string,
  conceptId: string | null,
  token?: string | null,
): Promise<SubmitAnswerResponse> {
  return apiFetch<SubmitAnswerResponse>('/api/peer/session/answer', {
    method: 'POST',
    body: JSON.stringify({
      session_id: sessionId,
      question_id: questionId,
      answer_text: answerText,
      concept_id: conceptId,
    }),
  }, token);
}

export async function advanceQuestion(
  sessionId: string,
  token?: string | null,
): Promise<{
  status: string;
  current_question_index: number;
  at_last_question?: boolean;
  boss_defeated?: boolean;
  generated_new_round?: boolean;
  round_index?: number;
}> {
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

export async function getPeerVideoToken(
  sessionId: string,
  token?: string | null,
): Promise<TwilioVideoTokenResponse> {
  return apiFetch<TwilioVideoTokenResponse>(
    `/api/peer/session/${encodeURIComponent(sessionId)}/video-token`,
    {
      method: 'POST',
    },
    token,
  );
}

export interface SessionSummary {
  session_id: string;
  hub_id: string;
  topic: string;
  level?: number | null;
  boss_character_id?: 'punk' | 'spacesuit' | 'swat' | 'suit' | null;
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
