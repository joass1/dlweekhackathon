from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class ConceptStatePayload(BaseModel):
    concept_id: str
    mastery: float = Field(default=0.25, ge=0.0, le=1.0)
    p_learn: float = Field(default=0.15, ge=0.0, le=1.0)
    p_guess: float = Field(default=0.2, ge=0.0, le=1.0)
    p_slip: float = Field(default=0.1, ge=0.0, le=1.0)
    decay_rate: float = Field(default=0.02, ge=0.0)
    last_updated: Optional[datetime] = None
    attempts: int = Field(default=0, ge=0)
    correct: int = Field(default=0, ge=0)
    careless_count: int = Field(default=0, ge=0)


class BKTUpdateRequest(BaseModel):
    concept: ConceptStatePayload
    is_correct: bool
    student_id: Optional[str] = None
    interaction_time: Optional[datetime] = None
    mistake_type: Literal["normal", "careless", "conceptual"] = "normal"
    careless_penalty: float = Field(default=0.02, ge=0.0, le=0.2)


class BKTUpdateResponse(BaseModel):
    concept_id: str
    prior_mastery: float
    mastery_after_decay: float
    updated_mastery: float
    delta_mastery: float
    status: str
    elapsed_days: float
    mistake_type: str
    careless_penalty: float
    state: ConceptStatePayload


class MasteryRequest(BaseModel):
    concept: ConceptStatePayload
    as_of: Optional[datetime] = None
    include_decay_projection: bool = True


class MasteryResponse(BaseModel):
    concept_id: str
    mastery: float
    status: str
    elapsed_days: float


class DecayRequest(BaseModel):
    concept: ConceptStatePayload
    as_of: Optional[datetime] = None


class DecayResponse(BaseModel):
    concept: ConceptStatePayload
    elapsed_days: float


class RPKTProbeRequest(BaseModel):
    target_concept_id: str
    prerequisites: Dict[str, List[str]]
    diagnostic_scores: Dict[str, float]
    mastery_threshold: float = Field(default=0.7, ge=0.0, le=1.0)
    max_depth: int = Field(default=10, ge=1, le=64)


class RPKTProbeStep(BaseModel):
    concept_id: str
    depth: int
    score: float
    passed: bool


class RPKTProbeResponse(BaseModel):
    target_concept_id: str
    target_understood: bool
    knowledge_boundary: List[str]
    boundary_concept_id: Optional[str] = None
    boundary_path: List[str] = []
    boundary_candidates: List[Dict[str, object]] = []
    probe_sequence: List[RPKTProbeStep]
    mastery_threshold: float
    visited_count: int
