from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

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
    key_points: List[str] = []
    must_mention: List[str] = []
    allowed_equivalents: List[str] = []
    common_misconceptions: List[str] = []
    grading_notes: Optional[str] = None


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
    damage_dealt: float = 0.0
    boss_attacked: bool = False
    party_damage_taken: float = 0.0
    attack_reason: Optional[Literal["weak_answer", "timeout"]] = None
    mastery_delta: Optional[float] = None
    updated_mastery: Optional[float] = None
    mastery_status: Optional[str] = None


# ── Requests ───────────────────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    hub_id: str
    topic: str = ""
    concept_id: Optional[str] = None
    course_id: Optional[str] = None
    course_name: Optional[str] = None
    level: int = Field(default=1, ge=1, le=4)
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
    level: Optional[int] = None
    boss_character_id: Optional[str] = None
    selected_concept_id: Optional[str] = None
    course_id: Optional[str] = None
    course_name: Optional[str] = None
    boss_name: Optional[str] = None
    boss_health_max: float = 0.0
    boss_health_current: float = 0.0
    boss_defeated: bool = False
    party_health_max: float = 0.0
    party_health_current: float = 0.0
    party_defeated: bool = False
    battle_outcome: Optional[Literal["pending", "victory", "defeat"]] = None
    boss_attack_count: int = 0
    current_question_started_at: Optional[datetime] = None
    question_time_limit_sec: Optional[int] = None
    question_timeout_penalties: List[Dict[str, Any]] = []
    boss_attack_log: List[Dict[str, Any]] = []
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
    damage_dealt: float = 0.0
    boss_health_max: float = 0.0
    boss_health_current: float = 0.0
    boss_defeated: bool = False
    party_health_max: float = 0.0
    party_health_current: float = 0.0
    party_defeated: bool = False
    battle_outcome: Optional[Literal["pending", "victory", "defeat"]] = None
    boss_attacked: bool = False
    party_damage_taken: float = 0.0
    attack_reason: Optional[Literal["weak_answer", "timeout"]] = None
    boss_attack_count: int = 0
    already_submitted: bool = False
    mastery_delta: Optional[float] = None
    updated_mastery: Optional[float] = None
    mastery_status: Optional[str] = None


class TwilioVideoTokenResponse(BaseModel):
    token: str
    room_name: str
    identity: str
    ttl_seconds: int
