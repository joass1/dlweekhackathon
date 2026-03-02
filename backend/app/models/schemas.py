from pydantic import BaseModel, Field
from typing import Optional, List, Literal

class Discussion(BaseModel):
    student: str
    topic: str
    discussion: str

class SearchQuery(BaseModel):
    query: str
    limit: Optional[int] = 5

class SearchResult(BaseModel):
    student: str
    topic: str
    discussion: str
    similarity: float


class QuizGenerateRequest(BaseModel):
    student_id: str
    concept: str
    num_questions: int = Field(default=5, ge=1, le=20)
    concepts: Optional[List[str]] = None


class QuizQuestion(BaseModel):
    question_id: str
    concept: str
    stem: str
    options: List[str]
    correct_answer: str
    explanation: Optional[str] = None
    difficulty: Literal["easy", "medium", "hard"] = "medium"


class StudentAnswer(BaseModel):
    question_id: str
    selected_answer: str
    confidence_1_to_5: int = Field(ge=1, le=5)


class QuizSubmitRequest(BaseModel):
    student_id: str
    concept: str
    answers: List[StudentAnswer]


class EvaluatedAnswer(BaseModel):
    question_id: str
    is_correct: bool
    correct_answer: str


class EvaluateResponse(BaseModel):
    score: float
    per_question: List[EvaluatedAnswer]


class MistakeClassification(BaseModel):
    question_id: str
    mistake_type: Literal["careless", "conceptual"]
    missing_concept: Optional[str] = None
    error_span: Optional[str] = None
    rationale: str


class ClassifyResponse(BaseModel):
    classifications: List[MistakeClassification]
    blind_spot_found_count: int
    blind_spot_resolved_count: int
    integration_actions: List[dict] = []


class SelfAwarenessResponse(BaseModel):
    student_id: str
    score: float
    total_attempts: int
    calibration_gap: float


class OverrideRequest(BaseModel):
    student_id: str
    question_id: str
    override_to: Literal["careless"]


class MicroCheckpointRequest(BaseModel):
    student_id: str
    concept: str
    missing_concept: Optional[str] = None


class MicroCheckpointSubmitRequest(BaseModel):
    student_id: str
    question_id: str
    selected_answer: str
    confidence_1_to_5: int = Field(ge=1, le=5)


class MicroCheckpointResponse(BaseModel):
    question: QuizQuestion


class MicroCheckpointSubmitResponse(BaseModel):
    question_id: str
    is_correct: bool
    next_action: Literal["resolved", "needs_intervention"]
