from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from math import exp
from typing import Dict, List, Optional, Tuple


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_utc(ts: Optional[datetime]) -> datetime:
    if ts is None:
        return _utc_now()
    if ts.tzinfo is None:
        return ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _status_from_mastery(mastery: float) -> str:
    if mastery >= 0.8:
        return "mastered"
    if mastery >= 0.5:
        return "learning"
    if mastery > 0:
        return "weak"
    return "not_started"


@dataclass
class ConceptState:
    concept_id: str
    mastery: float = 0.25
    p_learn: float = 0.15
    p_guess: float = 0.2
    p_slip: float = 0.1
    decay_rate: float = 0.02
    last_updated: datetime = field(default_factory=_utc_now)
    attempts: int = 0
    correct: int = 0
    careless_count: int = 0

    def normalized(self) -> "ConceptState":
        self.mastery = _clamp(self.mastery)
        self.p_learn = _clamp(self.p_learn)
        self.p_guess = _clamp(self.p_guess)
        self.p_slip = _clamp(self.p_slip)
        self.decay_rate = max(0.0, self.decay_rate)
        self.last_updated = _ensure_utc(self.last_updated)
        return self

    @property
    def status(self) -> str:
        return _status_from_mastery(self.mastery)


class AdaptiveEngine:
    """Core adaptive algorithms: BKT, forgetting decay, and recursive prerequisite tracing."""

    def apply_decay(
        self,
        state: ConceptState,
        as_of: Optional[datetime] = None,
        mutate: bool = True,
    ) -> Tuple[ConceptState, float]:
        current = state if mutate else ConceptState(**state.__dict__)
        current.normalized()
        as_of_utc = _ensure_utc(as_of)

        delta_seconds = max(0.0, (as_of_utc - current.last_updated).total_seconds())
        delta_days = delta_seconds / 86400.0
        decayed_mastery = current.mastery * exp(-current.decay_rate * delta_days)
        current.mastery = _clamp(decayed_mastery)
        current.last_updated = as_of_utc
        return current, delta_days

    def get_mastery(
        self,
        state: ConceptState,
        as_of: Optional[datetime] = None,
        include_decay_projection: bool = True,
    ) -> Dict[str, float | str]:
        state.normalized()
        if include_decay_projection:
            projected, elapsed_days = self.apply_decay(state, as_of=as_of, mutate=False)
            mastery = projected.mastery
        else:
            mastery = state.mastery
            elapsed_days = 0.0

        return {
            "concept_id": state.concept_id,
            "mastery": round(mastery, 6),
            "status": _status_from_mastery(mastery),
            "elapsed_days": round(elapsed_days, 6),
        }

    def update_bkt(
        self,
        state: ConceptState,
        is_correct: bool,
        interaction_time: Optional[datetime] = None,
        mistake_type: str = "normal",
        careless_penalty: float = 0.02,
    ) -> Dict[str, object]:
        """Apply BKT update for a single concept interaction."""
        state.normalized()
        prior_mastery = state.mastery

        decayed_state, elapsed_days = self.apply_decay(state, as_of=interaction_time, mutate=True)
        prior_after_decay = decayed_state.mastery

        mt = (mistake_type or "normal").strip().lower()
        if not is_correct and mt == "careless":
            penalty = max(0.0, careless_penalty)
            posterior = prior_after_decay - penalty
            decayed_state.careless_count += 1
        else:
            if is_correct:
                numerator = prior_after_decay * (1.0 - decayed_state.p_slip)
                denominator = numerator + (1.0 - prior_after_decay) * decayed_state.p_guess
                posterior = numerator / denominator if denominator > 0 else prior_after_decay
            else:
                numerator = prior_after_decay * decayed_state.p_slip
                denominator = numerator + (1.0 - prior_after_decay) * (1.0 - decayed_state.p_guess)
                posterior = numerator / denominator if denominator > 0 else prior_after_decay

            posterior = posterior + (1.0 - posterior) * decayed_state.p_learn

        decayed_state.mastery = _clamp(posterior)
        decayed_state.attempts += 1
        if is_correct:
            decayed_state.correct += 1

        return {
            "concept_id": decayed_state.concept_id,
            "prior_mastery": round(prior_mastery, 6),
            "mastery_after_decay": round(prior_after_decay, 6),
            "updated_mastery": round(decayed_state.mastery, 6),
            "delta_mastery": round(decayed_state.mastery - prior_mastery, 6),
            "status": decayed_state.status,
            "elapsed_days": round(elapsed_days, 6),
            "mistake_type": mt,
            "careless_penalty": round(max(0.0, careless_penalty), 6),
            "state": decayed_state,
        }

    def run_rpkt_probe(
        self,
        target_concept_id: str,
        prerequisites: Dict[str, List[str]],
        diagnostic_scores: Dict[str, float],
        mastery_threshold: float = 0.7,
        max_depth: int = 10,
    ) -> Dict[str, object]:
        """
        Recursive Prerequisite Knowledge Tracing (RPKT).
        A concept is considered understood if its diagnostic score >= mastery_threshold.
        """
        threshold = _clamp(mastery_threshold)
        visited: set[str] = set()
        probe_sequence: List[Dict[str, object]] = []
        # Candidate boundary: failed concept where all direct prerequisites pass,
        # meaning this is the deepest unsupported concept in that branch.
        boundary_candidates: List[Dict[str, object]] = []

        def probe(concept_id: str, depth: int, path: List[str]) -> bool:
            if depth > max_depth:
                return True
            if concept_id in visited:
                return True

            visited.add(concept_id)
            score = _clamp(diagnostic_scores.get(concept_id, 0.0))
            passed = score >= threshold
            current_path = [*path, concept_id]
            probe_sequence.append(
                {
                    "concept_id": concept_id,
                    "depth": depth,
                    "score": round(score, 6),
                    "passed": passed,
                }
            )

            prereqs = prerequisites.get(concept_id, [])
            if passed:
                return True

            all_direct_prereqs_passed = True
            for prereq_id in prereqs:
                child_passed = probe(prereq_id, depth + 1, current_path)
                if not child_passed:
                    all_direct_prereqs_passed = False

            if all_direct_prereqs_passed:
                boundary_candidates.append(
                    {
                        "concept_id": concept_id,
                        "depth": depth,
                        "score": round(score, 6),
                        "path": current_path,
                    }
                )
            return False

        target_understood = probe(target_concept_id, depth=0, path=[])

        # Deterministic single-boundary selection:
        # 1) deepest from target, 2) lowest diagnostic score, 3) lexical concept_id.
        selected_boundary: Optional[Dict[str, object]] = None
        if boundary_candidates:
            selected_boundary = sorted(
                boundary_candidates,
                key=lambda c: (-int(c["depth"]), float(c["score"]), str(c["concept_id"])),
            )[0]
        boundary_concept_id = selected_boundary["concept_id"] if selected_boundary else None
        boundary_path = selected_boundary["path"] if selected_boundary else []

        return {
            "target_concept_id": target_concept_id,
            "target_understood": target_understood,
            "knowledge_boundary": [boundary_concept_id] if boundary_concept_id else [],
            "boundary_concept_id": boundary_concept_id,
            "boundary_path": boundary_path,
            "boundary_candidates": boundary_candidates,
            "probe_sequence": probe_sequence,
            "mastery_threshold": threshold,
            "visited_count": len(visited),
        }
