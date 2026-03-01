from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from math import exp
from statistics import mean
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

    def generate_study_plan(
        self,
        minutes: int,
        concepts: List[Dict[str, object]],
        prerequisites: Optional[Dict[str, List[str]]] = None,
        as_of: Optional[datetime] = None,
    ) -> Dict[str, object]:
        """
        Build a greedy study mission with score:
        gap_severity * prereq_depth * decay_risk * careless_frequency
        """
        if minutes <= 0:
            return {
                "minutes_requested": minutes,
                "minutes_allocated": 0,
                "remaining_minutes": max(0, minutes),
                "selected_concepts": [],
                "mission_briefing": "No time budget available.",
            }

        prerequisites = prerequisites or {}
        as_of_utc = _ensure_utc(as_of)

        def compute_depth(concept_id: str) -> int:
            memo: Dict[str, int] = {}

            def dfs(cid: str, seen: set[str]) -> int:
                if cid in memo:
                    return memo[cid]
                if cid in seen:
                    return 1
                seen.add(cid)
                parents = prerequisites.get(cid, [])
                if not parents:
                    memo[cid] = 1
                    seen.remove(cid)
                    return 1
                depth_val = 1 + max(dfs(p, seen) for p in parents)
                memo[cid] = depth_val
                seen.remove(cid)
                return depth_val

            return dfs(concept_id, set())

        scored_items: List[Dict[str, object]] = []
        for item in concepts:
            concept_id = str(item.get("concept_id", "")).strip()
            if not concept_id:
                continue

            mastery = _clamp(float(item.get("mastery", 0.0)))
            decay_rate = max(0.0, float(item.get("decay_rate", 0.02)))
            attempts = max(0, int(item.get("attempts", 0)))
            careless_count = max(0, int(item.get("careless_count", 0)))
            est_minutes = max(1, int(item.get("estimated_minutes", 10)))
            title = str(item.get("title", concept_id))

            last_updated_raw = item.get("last_updated")
            if isinstance(last_updated_raw, datetime):
                last_updated = _ensure_utc(last_updated_raw)
            elif isinstance(last_updated_raw, str) and last_updated_raw:
                parsed = datetime.fromisoformat(last_updated_raw.replace("Z", "+00:00"))
                last_updated = _ensure_utc(parsed)
            else:
                last_updated = as_of_utc

            elapsed_days = max(0.0, (as_of_utc - last_updated).total_seconds() / 86400.0)
            gap_severity = 1.0 - mastery

            prereq_depth = int(item.get("prereq_depth", 0) or 0)
            if prereq_depth <= 0:
                prereq_depth = compute_depth(concept_id)
            prereq_depth_factor = float(max(1, prereq_depth))

            decay_risk = 1.0 - exp(-decay_rate * elapsed_days)

            # Smoothed careless frequency in [0, 1], avoids hard-zero suppression.
            careless_frequency = (careless_count + 1.0) / (attempts + 1.0)
            careless_frequency = _clamp(careless_frequency)

            score = gap_severity * prereq_depth_factor * decay_risk * careless_frequency

            scored_items.append(
                {
                    "concept_id": concept_id,
                    "title": title,
                    "estimated_minutes": est_minutes,
                    "score": round(score, 6),
                    "factors": {
                        "gap_severity": round(gap_severity, 6),
                        "prereq_depth": prereq_depth,
                        "decay_risk": round(decay_risk, 6),
                        "careless_frequency": round(careless_frequency, 6),
                    },
                    "mastery": round(mastery, 6),
                }
            )

        # Greedy fill by score density, then absolute score.
        scored_items.sort(
            key=lambda x: (
                float(x["score"]) / max(1, int(x["estimated_minutes"])),
                float(x["score"]),
            ),
            reverse=True,
        )

        remaining = minutes
        selected: List[Dict[str, object]] = []
        for item in scored_items:
            duration = int(item["estimated_minutes"])
            if duration <= remaining:
                selected.append(item)
                remaining -= duration

        # If nothing fits exactly, pick the best single concept that exceeds budget least.
        if not selected and scored_items:
            fallback = min(scored_items, key=lambda x: int(x["estimated_minutes"]))
            selected.append(fallback)
            remaining = max(0, minutes - int(fallback["estimated_minutes"]))

        minutes_allocated = sum(int(x["estimated_minutes"]) for x in selected)
        prioritized = [x["title"] for x in selected[:3]]
        mission_briefing = (
            f"Study mission for {minutes} minutes: focus on "
            f"{', '.join(prioritized) if prioritized else 'no concepts'} "
            "based on gap severity, prerequisite depth, decay risk, and careless-frequency signals."
        )

        return {
            "minutes_requested": minutes,
            "minutes_allocated": minutes_allocated,
            "remaining_minutes": max(0, remaining),
            "selected_concepts": selected,
            "mission_briefing": mission_briefing,
        }

    def match_hubs(
        self,
        students: List[Dict[str, object]],
        hub_size: int = 4,
    ) -> Dict[str, object]:
        """
        Balanced 4-tier grouping with complementarity scoring.
        """
        if hub_size < 2:
            hub_size = 4

        def avg_mastery(profile: Dict[str, float]) -> float:
            vals = [float(v) for v in profile.values()] if profile else []
            return mean(vals) if vals else 0.0

        def classify_tier(avg: float) -> str:
            if avg >= 0.8:
                return "tier_1_expert"
            if avg >= 0.65:
                return "tier_2_strong"
            if avg >= 0.45:
                return "tier_3_developing"
            return "tier_4_foundational"

        def pair_complementarity(a: Dict[str, float], b: Dict[str, float]) -> float:
            concepts = set(a.keys()) | set(b.keys())
            if not concepts:
                return 0.0
            score = 0.0
            for concept in concepts:
                av = _clamp(float(a.get(concept, 0.0)))
                bv = _clamp(float(b.get(concept, 0.0)))
                diff = abs(av - bv)
                transfer_bonus = 1.0 if (max(av, bv) >= 0.7 and min(av, bv) <= 0.4) else 0.0
                score += diff + transfer_bonus
            return score / len(concepts)

        prepared: List[Dict[str, object]] = []
        for idx, student in enumerate(students):
            sid = str(student.get("student_id", f"student_{idx+1}"))
            name = str(student.get("name", sid))
            profile = student.get("concept_profile", {}) or {}
            profile = {str(k): _clamp(float(v)) for k, v in profile.items()}
            avg = avg_mastery(profile)
            tier = classify_tier(avg)
            prepared.append(
                {
                    "student_id": sid,
                    "name": name,
                    "concept_profile": profile,
                    "avg_mastery": round(avg, 6),
                    "tier": tier,
                }
            )

        if not prepared:
            return {"hub_size": hub_size, "hubs": [], "summary": {"total_students": 0, "total_hubs": 0}}

        # Balanced seeding via snake distribution on average mastery.
        sorted_students = sorted(prepared, key=lambda s: float(s["avg_mastery"]), reverse=True)
        hub_count = max(1, (len(sorted_students) + hub_size - 1) // hub_size)
        hubs: List[List[Dict[str, object]]] = [[] for _ in range(hub_count)]
        idx = 0
        direction = 1
        for student in sorted_students:
            hubs[idx].append(student)
            idx += direction
            if idx >= hub_count:
                idx = hub_count - 1
                direction = -1
            elif idx < 0:
                idx = 0
                direction = 1

        # Trim overflow to respect hub size by moving extras to next available hubs.
        overflow: List[Dict[str, object]] = []
        for i, hub in enumerate(hubs):
            if len(hub) > hub_size:
                overflow.extend(hub[hub_size:])
                hubs[i] = hub[:hub_size]
        for student in overflow:
            placed = False
            for hub in hubs:
                if len(hub) < hub_size:
                    hub.append(student)
                    placed = True
                    break
            if not placed:
                hubs.append([student])

        hub_payload: List[Dict[str, object]] = []
        for i, hub in enumerate(hubs):
            pair_scores: List[float] = []
            for a in range(len(hub)):
                for b in range(a + 1, len(hub)):
                    pair_scores.append(
                        pair_complementarity(
                            hub[a]["concept_profile"],  # type: ignore[index]
                            hub[b]["concept_profile"],  # type: ignore[index]
                        )
                    )
            complementarity = mean(pair_scores) if pair_scores else 0.0
            hub_avg = mean([float(s["avg_mastery"]) for s in hub]) if hub else 0.0
            tier_distribution: Dict[str, int] = {}
            for member in hub:
                tier = str(member["tier"])
                tier_distribution[tier] = tier_distribution.get(tier, 0) + 1

            hub_payload.append(
                {
                    "hub_id": f"hub_{i+1}",
                    "members": [
                        {
                            "student_id": m["student_id"],
                            "name": m["name"],
                            "tier": m["tier"],
                            "avg_mastery": m["avg_mastery"],
                        }
                        for m in hub
                    ],
                    "complementarity_score": round(complementarity, 6),
                    "hub_avg_mastery": round(hub_avg, 6),
                    "tier_distribution": tier_distribution,
                }
            )

        return {
            "hub_size": hub_size,
            "hubs": hub_payload,
            "summary": {
                "total_students": len(prepared),
                "total_hubs": len(hub_payload),
                "avg_hub_complementarity": round(mean([h["complementarity_score"] for h in hub_payload]), 6),
            },
        }
