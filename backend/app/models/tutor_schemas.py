from pydantic import BaseModel
from typing import List, Optional, Literal


class EmbedContentRequest(BaseModel):
    content: str
    concept_id: str
    source: Optional[str] = None
    userId: Optional[str] = None


class EmbedContentResponse(BaseModel):
    chunks_embedded: int
    concept_id: str


class RetrieveContextRequest(BaseModel):
    concept: str
    limit: Optional[int] = 4
    userId: Optional[str] = None


class KnowledgeNode(BaseModel):
    id: str
    title: str
    mastery: float
    status: str
    decayRate: Optional[float] = None


class ConceptGapModel(BaseModel):
    concept: str
    confidenceScore: float
    priority: str
    recommendedResources: Optional[List[str]] = []


class KnowledgeState(BaseModel):
    userId: str
    nodes: List[KnowledgeNode]
    gaps: List[ConceptGapModel]


class TutorChatRequest(BaseModel):
    query: str
    userId: Optional[str] = None
    knowledge_state: Optional[KnowledgeState] = None
    concept_ids: Optional[List[str]] = None


class RecommendationCandidate(BaseModel):
    concept_id: str
    title: str
    mastery: float
    status: str
    unlock_count: int
    prerequisite_count: int
    has_decay: bool = False
    rank_hint: int


class RecommendationAttentionSummary(BaseModel):
    weak_count: int = 0
    learning_count: int = 0


class RecommendationRequest(BaseModel):
    course_name: Optional[str] = None
    candidates: List[RecommendationCandidate]
    attention_summary: Optional[RecommendationAttentionSummary] = None


class RecommendationResponse(BaseModel):
    concept_id: str
    title: str
    summary: str
    reasons: List[str]
    confidence: Literal["high", "medium", "low"]
    disclaimer: str
    provider: str
    model: str


class CheckpointRequest(BaseModel):
    topic_id: str
    topic_doc_id: Optional[str] = None   # Firestore user_topics document ID
    session_messages: List[dict]
    already_tested: Optional[List[str]] = []


class CheckpointSubmitRequest(BaseModel):
    session_id: str
    topic_id: str
    topic_doc_id: Optional[str] = None   # Firestore user_topics document ID
    concept_tested: str
    question: str
    options: List[str]
    student_answer: str
    correct_answer: str
    confidence_rating: int  # 1–5
    was_skipped: bool = False


class CheckpointSubmitResponse(BaseModel):
    is_correct: Optional[bool]
    mastery_delta: float


class PrerequisiteChain(BaseModel):
    ordered_concepts: List[str]
    failed_concept: str


class InterventionRequest(BaseModel):
    mistake_type: str
    failed_concept: str
    original_question: str
    student_answer: Optional[str] = None
    prerequisite_chain: Optional[PrerequisiteChain] = None
    knowledge_state: Optional[KnowledgeState] = None


class InterventionResponse(BaseModel):
    intervention_type: str
    message: str
    scaffolded_questions: List[str]
    start_concept: str


class QuestionAttempt(BaseModel):
    concept: str
    is_correct: bool
    mistake_type: Optional[str] = None


class SessionData(BaseModel):
    userId: str
    session_start_iso: str
    attempts: List[QuestionAttempt]
    prior_mastery_avg: Optional[float] = None
    current_mastery_avg: Optional[float] = None


class SessionSummaryResponse(BaseModel):
    total_questions: int
    correct: int
    accuracy_pct: float
    concepts_practiced: List[str]
    careless_count: int
    conceptual_count: int
    biggest_win: str
    velocity_note: str
    duration_minutes: float
