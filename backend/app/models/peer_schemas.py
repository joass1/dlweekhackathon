from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


# ── Sub-models ─────────────────────────────────────────────────────────────

class MemberProfile(BaseModel):
    student_id: str
    name: str
    concept_profile: Dict[str, float] = {}


class SessionMember(BaseModel):
    student_id: str
    name: str
    joined_at: Optional[datetime] = None


class PeerQuestion(BaseModel):
    question_id: str
    target_member: str
    target_member_name: str = ""
    concept_id: str = ""
    weak_concept: str = ""
    stem: str
    type: Literal["open", "code", "math", "mcq"] = "open"
    options: Optional[List[str]] = None
    correct_answer: str
    explanation: str


class SubmittedAnswer(BaseModel):
    question_id: str
    submitted_by: str
    answer_text: str
    concept_id: str = ""
    mistake_type: str = "normal"
    is_correct: bool = False
    score: float = 0.0
    ai_feedback: str = ""
    hint: str = ""
    updated_mastery: Optional[float] = None
    mastery_status: Optional[str] = None


# ── Requests ───────────────────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    hub_id: str
    topic: str
    concept_id: Optional[str] = None
    member_profiles: List[MemberProfile]


class JoinSessionRequest(BaseModel):
    session_id: str
    student_id: str
    name: str


class SubmitAnswerRequest(BaseModel):
    session_id: str
    question_id: str
    answer_text: str
    concept_id: Optional[str] = None


# ── Responses ──────────────────────────────────────────────────────────────

class CreateSessionResponse(BaseModel):
    session_id: str
    status: str


class SessionStateResponse(BaseModel):
    session_id: str
    hub_id: str
    topic: str
    selected_concept_id: Optional[str] = None
    status: Literal["waiting", "active", "completed"]
    created_by: str
    created_at: Optional[datetime] = None
    members: List[SessionMember] = []
    expected_members: int = 0
    questions: List[PeerQuestion] = []
    current_question_index: int = 0
    answers: List[SubmittedAnswer] = []


class SubmitAnswerResponse(BaseModel):
    question_id: str
    submitted_by: str
    concept_id: str
    mistake_type: str
    is_correct: bool
    score: float
    ai_feedback: str
    hint: str = ""
    explanation: str = ""
    updated_mastery: Optional[float] = None
    mastery_status: Optional[str] = None


class TwilioVideoTokenResponse(BaseModel):
    token: str
    room_name: str
    identity: str
    ttl_seconds: int
