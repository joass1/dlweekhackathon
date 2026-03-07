import json
import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple, Union
from uuid import uuid4

from openai import OpenAI

from app.models.schemas import (
    ClassifyResponse,
    EvaluateResponse,
    EvaluatedAnswer,
    MistakeClassification,
    MicroCheckpointResponse,
    MicroCheckpointSubmitResponse,
    QuizGenerateRequest,
    QuizQuestion,
    QuizSubmitRequest,
    SelfAwarenessResponse,
)
from app.services.knowledge_graph import kg_engine


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _confidence_to_probability(confidence_1_to_5: int) -> float:
    return (confidence_1_to_5 - 1) / 4.0


def _extract_json_object(raw: str) -> Dict[str, Any]:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        raw = raw.replace("json\n", "", 1).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        raise


def _safe_error_span(selected_answer: str) -> str:
    # Keep a short, stable span for UI display and logs.
    text = (selected_answer or "").strip()
    if not text:
        return "(no answer)"
    return text[:160]


def _normalize_missing_concept(value: Any, fallback: str) -> Optional[str]:
    if value is None:
        return fallback
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or fallback
    return fallback


def _normalize_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


class AssessmentStateStore:
    """Legacy JSON-file-based store (fallback when Firestore is unavailable)."""

    def __init__(self, path: Path):
        self.path = path
        self._lock = Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._write(
                {
                    "quizzes": {},
                    "attempt_history": {},
                    "classification_store": {},
                    "blind_spot_counts": {},
                    "assessment_runs": {},
                }
            )

    def _read(self) -> Dict[str, Any]:
        with self.path.open("r", encoding="utf-8") as f:
            return json.load(f)

    def _write(self, state: Dict[str, Any]) -> None:
        tmp = self.path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
        tmp.replace(self.path)

    def transaction(self, student_id: str = "") -> Tuple[Dict[str, Any], callable]:
        with self._lock:
            state = self._read()

            def commit(new_state: Dict[str, Any]) -> None:
                self._write(new_state)

            return state, commit


class AssessmentEngine:
    def __init__(self, store: Union[AssessmentStateStore, "FirestoreAssessmentStore", Path]):
        if isinstance(store, Path):
            self.store = AssessmentStateStore(store)
        else:
            self.store = store
        self.openai_key = os.getenv("OPENAI_API_KEY")
        self.kg_base_url = os.getenv("KG_API_BASE_URL", "").strip()
        self.enable_llm_generation = os.getenv("ENABLE_LLM_QUIZ_GENERATION", "true").lower() == "true"
        # Disabled by design: generic fallback questions are not acceptable.
        self.allow_rule_based_quiz_fallback = False
        self.enable_remote_profile = os.getenv("ENABLE_REMOTE_PROFILE_LOOKUP", "false").lower() == "true"
        self.enable_legacy_global_kg_sync = os.getenv("ENABLE_LEGACY_GLOBAL_KG_SYNC", "false").lower() == "true"
        self.kg_timeout_s = float(os.getenv("KG_API_TIMEOUT_SECONDS", "2.0"))
        self.llm_timeout_s = float(os.getenv("LLM_TIMEOUT_SECONDS", "35.0"))
        # Disabled by design: force content-grounded LLM generation.
        self.fast_quiz_mode = False
        self.use_llm_for_comprehensive = True
        self.prefer_llm_mistake_classification = os.getenv(
            "PREFER_LLM_MISTAKE_CLASSIFICATION", "true"
        ).lower() == "true"
        self.skip_llm_classification_for_long_quiz = os.getenv(
            "SKIP_LLM_CLASSIFICATION_FOR_LONG_QUIZ", "false"
        ).lower() == "true"
        self.long_quiz_threshold = int(os.getenv("LONG_QUIZ_THRESHOLD", "20"))
        self.client = (
            OpenAI(api_key=self.openai_key, timeout=self.llm_timeout_s)
            if self.openai_key and self.enable_llm_generation
            else None
        )
        self._last_quiz_generation_error: Optional[str] = None

    def _assign_unique_question_ids(self, concept: str, questions: List[QuizQuestion]) -> List[QuizQuestion]:
        """Avoid question ID collisions across multiple quiz generations."""
        run_key = f"{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}-{uuid4().hex[:8]}"
        return [
            QuizQuestion(
                question_id=f"{concept}-{run_key}-q{i + 1}",
                concept=q.concept,
                stem=q.stem,
                options=q.options,
                correct_answer=q.correct_answer,
                explanation=q.explanation,
                difficulty=q.difficulty,
            )
            for i, q in enumerate(questions)
        ]

    def _generate_per_concept_question_counts(self, concepts: List[str], total_questions: int) -> Dict[str, int]:
        """Allocate quiz questions across concepts with at least one per concept when possible."""
        clean = [c for c in concepts if str(c).strip()]
        if not clean:
            return {}
        if total_questions <= 0:
            return {}

        # If concepts exceed budget, keep first N concepts.
        if len(clean) > total_questions:
            clean = clean[:total_questions]

        counts = {c: 1 for c in clean}
        remaining = total_questions - len(clean)
        idx = 0
        while remaining > 0:
            concept = clean[idx % len(clean)]
            counts[concept] += 1
            idx += 1
            remaining -= 1
        return counts

    def _resolve_kg_concept_id(self, concept: str) -> Optional[str]:
        if not concept:
            return None
        graph_data = kg_engine.get_graph_data()
        nodes = graph_data.get("nodes", [])
        exact = next((n for n in nodes if str(n.get("id")) == concept), None)
        if exact:
            return str(exact.get("id"))

        lookup = _normalize_key(concept)
        if not lookup:
            return None

        # Match against node IDs and human titles.
        for node in nodes:
            node_id = str(node.get("id", ""))
            title = str(node.get("title", ""))
            if _normalize_key(node_id) == lookup or _normalize_key(title) == lookup:
                return node_id
        return None

    def _sync_kg_mastery(
        self,
        concept: str,
        is_correct: bool,
        mistake_type: Optional[str],
        classification: Optional[MistakeClassification] = None,
    ) -> Optional[Dict[str, Any]]:
        if not self.enable_legacy_global_kg_sync:
            return None
        concept_id = self._resolve_kg_concept_id(concept)
        if not concept_id:
            return None
        try:
            result = kg_engine.update_mastery(
                concept_id=concept_id,
                is_correct=is_correct,
                is_careless=(mistake_type == "careless"),
                classification_source=classification.classification_source if classification else None,
                classification_model=classification.classification_model if classification else None,
                missing_concept=classification.missing_concept if classification else None,
                classification_rationale=classification.rationale if classification else None,
            )
            return {
                "concept_id": concept_id,
                "is_correct": is_correct,
                "mistake_type": mistake_type,
                "classification_source": classification.classification_source if classification else None,
                "classification_model": classification.classification_model if classification else None,
                "status": "updated",
                "node": result.get("node"),
            }
        except Exception as e:
            return {
                "concept_id": concept_id,
                "is_correct": is_correct,
                "mistake_type": mistake_type,
                "status": "failed",
                "error": str(e),
            }

    def _subject_bank(self, concept: str) -> List[Dict[str, Any]]:
        banks: Dict[str, List[Dict[str, Any]]] = {
            "newtons-laws": [
                {
                    "stem": "What happens to acceleration if net force doubles while mass stays constant?",
                    "options": ["Acceleration halves", "Acceleration doubles", "Acceleration is unchanged", "Cannot determine"],
                    "correct_answer": "Acceleration doubles",
                    "explanation": "By F = ma, acceleration scales with force when mass is constant.",
                    "difficulty": "easy",
                },
                {
                    "stem": "A passenger lurches forward when a car brakes because of:",
                    "options": ["Inertia", "Action-reaction imbalance", "Increased gravity", "Loss of momentum conservation"],
                    "correct_answer": "Inertia",
                    "explanation": "The body keeps its state of motion unless net force changes it.",
                    "difficulty": "medium",
                },
                {
                    "stem": "Which pair is a Newton's 3rd law action-reaction pair?",
                    "options": ["Weight and normal force on one object", "Table on book and book on table", "Friction and gravity", "Acceleration and force"],
                    "correct_answer": "Table on book and book on table",
                    "explanation": "Action-reaction forces are equal/opposite and act on different objects.",
                    "difficulty": "medium",
                },
            ],
            "energy-work": [
                {
                    "stem": "The work done by a constant force is:",
                    "options": ["F + d", "F/d", "F d cos(theta)", "mgh always"],
                    "correct_answer": "F d cos(theta)",
                    "explanation": "Work is a dot product between force and displacement.",
                    "difficulty": "easy",
                },
                {
                    "stem": "The work-energy theorem states:",
                    "options": ["Net work = change in kinetic energy", "Potential energy is always constant", "Power equals momentum/time", "Energy cannot transfer"],
                    "correct_answer": "Net work = change in kinetic energy",
                    "explanation": "W_net equals Delta K.",
                    "difficulty": "easy",
                },
            ],
            "momentum": [
                {
                    "stem": "Momentum is defined as:",
                    "options": ["mv", "ma", "m/a", "v/m"],
                    "correct_answer": "mv",
                    "explanation": "Linear momentum equals mass times velocity.",
                    "difficulty": "easy",
                },
                {
                    "stem": "In an isolated system, total momentum is:",
                    "options": ["Conserved", "Always increasing", "Always zero", "Equal to kinetic energy"],
                    "correct_answer": "Conserved",
                    "explanation": "No net external impulse implies momentum conservation.",
                    "difficulty": "easy",
                },
            ],
        }
        fallback = [
            {
                "stem": f"Which action best shows conceptual mastery of {concept}?",
                "options": ["Memorizing definitions", "Applying principles to a new case", "Guessing from options", "Using a single formula always"],
                "correct_answer": "Applying principles to a new case",
                "explanation": "Transfer to unseen situations signals conceptual understanding.",
                "difficulty": "medium",
            },
            {
                "stem": f"When solving {concept} problems, what should be checked first?",
                "options": ["Knowns/unknowns and assumptions", "Calculator settings", "Answer key pattern", "Longest equation"],
                "correct_answer": "Knowns/unknowns and assumptions",
                "explanation": "Structured setup reduces careless and conceptual mistakes.",
                "difficulty": "easy",
            },
            {
                "stem": f"A student gets a {concept} question wrong with high confidence. What is the most likely issue?",
                "options": [
                    "A careless slip or misread condition",
                    "No exposure to the topic at all",
                    "The question is impossible",
                    "Random guessing",
                ],
                "correct_answer": "A careless slip or misread condition",
                "explanation": "High confidence with an error often indicates execution mistakes.",
                "difficulty": "easy",
            },
            {
                "stem": f"Which answer pattern most strongly signals a conceptual gap in {concept}?",
                "options": [
                    "Applying one rule in every situation without checking assumptions",
                    "Explaining why method A and B are equivalent here",
                    "Testing edge cases before finalizing",
                    "Re-deriving key steps from first principles",
                ],
                "correct_answer": "Applying one rule in every situation without checking assumptions",
                "explanation": "Overgeneralizing a rule beyond its conditions is a classic conceptual mistake.",
                "difficulty": "hard",
            },
            {
                "stem": f"What is the best first move before answering a mixed-topic item that may involve {concept}?",
                "options": [
                    "Classify the problem type and constraints first",
                    "Choose the longest option",
                    "Use the method from the previous question",
                    "Answer quickly and revisit later",
                ],
                "correct_answer": "Classify the problem type and constraints first",
                "explanation": "Correct method selection depends on identifying the problem structure first.",
                "difficulty": "medium",
            },
            {
                "stem": f"Which practice strategy most improves transfer for {concept}?",
                "options": [
                    "Spaced retrieval across varied contexts",
                    "Reading notes repeatedly without testing",
                    "Repeating only one familiar example",
                    "Timing drills without feedback",
                ],
                "correct_answer": "Spaced retrieval across varied contexts",
                "explanation": "Variation plus retrieval improves durable understanding and application.",
                "difficulty": "medium",
            },
            {
                "stem": f"Which response best demonstrates robust understanding of {concept}?",
                "options": [
                    "Justifying each step when assumptions change",
                    "Memorizing the exact textbook wording",
                    "Finishing fastest regardless of rationale",
                    "Using elimination without reasoning",
                ],
                "correct_answer": "Justifying each step when assumptions change",
                "explanation": "Deep understanding is shown by adaptable reasoning under changing constraints.",
                "difficulty": "hard",
            },
        ]
        return banks.get(concept, fallback)

    def _fetch_kg_context(self, concept: str) -> Dict[str, Any]:
        # Optional integration with SAM's KG API if available.
        if self.kg_base_url and self.enable_remote_profile:
            try:
                import requests  # local import to avoid hard dependency at import time

                resp = requests.get(
                    f"{self.kg_base_url.rstrip('/')}/api/kg/concepts/{concept}",
                    timeout=self.kg_timeout_s,
                )
                if resp.ok:
                    data = resp.json()
                    return {
                        "concept": data.get("concept", concept),
                        "prerequisites": data.get("prerequisites", []),
                        "summary": data.get("summary", ""),
                    }
            except Exception:
                pass

        return {
            "concept": concept,
            "prerequisites": [],
            "summary": "",
        }

    def _normalize_prerequisites(self, raw: Any) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        if not isinstance(raw, list):
            return normalized
        for item in raw:
            if isinstance(item, str):
                normalized.append(
                    {
                        "concept_id": item,
                        "mastery": None,
                        "status": None,
                        "decay_risk": None,
                        "careless_badge": None,
                    }
                )
                continue
            if isinstance(item, dict):
                concept_id = item.get("concept_id") or item.get("concept") or item.get("id")
                if not concept_id:
                    continue
                normalized.append(
                    {
                        "concept_id": str(concept_id),
                        "mastery": item.get("mastery"),
                        "status": item.get("status"),
                        "decay_risk": item.get("decay_risk"),
                        "careless_badge": item.get("careless_badge"),
                    }
                )
        return normalized

    def _fetch_user_graph_context(self, student_id: str, concept: str, prerequisites: List[Dict[str, Any]]) -> Dict[str, Any]:
        # Best effort integration with teammate services; falls back gracefully.
        if not self.kg_base_url or not self.enable_remote_profile:
            return {
                "student_id": student_id,
                "target_concept": concept,
                "target_mastery": None,
                "prerequisites": prerequisites,
            }

        try:
            import requests  # local import to avoid import-time dependency

            base = self.kg_base_url.rstrip("/")
            candidate_urls = [
                f"{base}/api/kg/users/{student_id}/concepts/{concept}",
                f"{base}/api/adaptive/user/{student_id}/mastery?concept={concept}",
            ]
            for url in candidate_urls:
                try:
                    resp = requests.get(url, timeout=self.kg_timeout_s)
                    if not resp.ok:
                        continue
                    data = resp.json()
                    raw_prereqs = (
                        data.get("prerequisites")
                        or data.get("prereq_nodes")
                        or data.get("prerequisite_nodes")
                        or prerequisites
                    )
                    normalized_prereqs = self._normalize_prerequisites(raw_prereqs)
                    target_mastery = (
                        data.get("target_mastery")
                        or data.get("mastery")
                        or data.get("concept_mastery")
                    )
                    return {
                        "student_id": student_id,
                        "target_concept": concept,
                        "target_mastery": target_mastery,
                        "prerequisites": normalized_prereqs or prerequisites,
                    }
                except Exception:
                    continue
        except Exception:
            pass

        return {
            "student_id": student_id,
            "target_concept": concept,
            "target_mastery": None,
            "prerequisites": prerequisites,
        }

    def _estimate_local_mastery(
        self,
        attempts: List[Dict[str, Any]],
        concept: str,
    ) -> Dict[str, Any]:
        concept_attempts = [a for a in attempts if a.get("concept") == concept]
        if not concept_attempts:
            return {
                "mastery": None,
                "attempts": 0,
                "correct": 0,
                "careless_rate": 0.0,
                "conceptual_rate": 0.0,
                "decay_risk": 0.0,
            }

        total = len(concept_attempts)
        correct = sum(1 for a in concept_attempts if bool(a.get("is_correct")))
        # Smoothed mastery estimate from local historical interactions.
        mastery = (correct + 1) / (total + 2)

        wrong = [a for a in concept_attempts if not bool(a.get("is_correct"))]
        careless = sum(1 for a in wrong if a.get("mistake_type") == "careless")
        conceptual = sum(1 for a in wrong if a.get("mistake_type") == "conceptual")
        denom_wrong = max(1, len(wrong))
        careless_rate = careless / denom_wrong
        conceptual_rate = conceptual / denom_wrong

        latest_ts = None
        for a in concept_attempts:
            ts = a.get("timestamp")
            if not isinstance(ts, str):
                continue
            if latest_ts is None or ts > latest_ts:
                latest_ts = ts

        decay_risk = 0.0
        if latest_ts:
            try:
                last_dt = datetime.fromisoformat(latest_ts.replace("Z", "+00:00"))
                age_days = max(0.0, (datetime.now(timezone.utc) - last_dt).total_seconds() / 86400.0)
                # simple forgetting proxy in [0,1)
                decay_risk = 1.0 - math.exp(-0.12 * age_days)
            except Exception:
                decay_risk = 0.0

        return {
            "mastery": round(float(mastery), 4),
            "attempts": total,
            "correct": correct,
            "careless_rate": round(float(careless_rate), 4),
            "conceptual_rate": round(float(conceptual_rate), 4),
            "decay_risk": round(float(decay_risk), 4),
        }

    def _build_personalization_profile(
        self,
        state: Dict[str, Any],
        student_id: str,
        concept: str,
        user_graph_context: Dict[str, Any],
    ) -> Dict[str, Any]:
        attempts = state.get("attempt_history", {}).get(student_id, [])
        prerequisites = user_graph_context.get("prerequisites", [])

        target_local = self._estimate_local_mastery(attempts, concept)
        target_mastery_remote = user_graph_context.get("target_mastery")
        target_mastery = (
            float(target_mastery_remote)
            if isinstance(target_mastery_remote, (int, float))
            else target_local["mastery"]
        )

        prerequisite_profiles: List[Dict[str, Any]] = []
        for prereq in prerequisites:
            prereq_id = str(prereq.get("concept_id"))
            local = self._estimate_local_mastery(attempts, prereq_id)
            mastery_remote = prereq.get("mastery")
            mastery = float(mastery_remote) if isinstance(mastery_remote, (int, float)) else local["mastery"]
            entry = {
                "concept_id": prereq_id,
                "mastery": mastery,
                "decay_risk": prereq.get("decay_risk") if isinstance(prereq.get("decay_risk"), (int, float)) else local["decay_risk"],
                "careless_rate": local["careless_rate"],
                "conceptual_rate": local["conceptual_rate"],
            }
            prerequisite_profiles.append(entry)

        weak_candidates: List[Tuple[str, float]] = []
        for row in prerequisite_profiles:
            mastery = row["mastery"] if isinstance(row["mastery"], (int, float)) else 0.5
            decay = float(row["decay_risk"] or 0.0)
            conceptual_rate = float(row["conceptual_rate"] or 0.0)
            priority = (1.0 - mastery) + 0.7 * decay + 0.5 * conceptual_rate
            weak_candidates.append((row["concept_id"], priority))

        target_m = target_mastery if isinstance(target_mastery, (int, float)) else 0.5
        target_priority = (1.0 - target_m) + 0.7 * float(target_local["decay_risk"]) + 0.5 * float(target_local["conceptual_rate"])
        weak_candidates.append((concept, target_priority))
        weak_candidates.sort(key=lambda x: x[1], reverse=True)

        focus_concepts = [c for c, _ in weak_candidates[:4]]
        if concept not in focus_concepts:
            focus_concepts.insert(0, concept)

        return {
            "student_id": student_id,
            "target_concept": concept,
            "target_mastery": target_mastery,
            "target_decay_risk": target_local["decay_risk"],
            "target_careless_rate": target_local["careless_rate"],
            "target_conceptual_rate": target_local["conceptual_rate"],
            "prerequisites": prerequisite_profiles,
            "focus_concepts": focus_concepts,
            "attempt_count": len(attempts),
        }

    def _validate_generated_questions(self, concept: str, raw_questions: List[Dict[str, Any]], num_questions: int) -> List[QuizQuestion]:
        validated: List[QuizQuestion] = []
        idx = 1
        for item in raw_questions:
            stem = str(item.get("stem", "")).strip()
            options = item.get("options", [])
            correct_answer = str(item.get("correct_answer", "")).strip()
            difficulty = str(item.get("difficulty", "medium")).strip().lower()
            explanation = str(item.get("explanation", "")).strip()
            focus_concept = str(item.get("concept", concept)).strip() or concept
            if difficulty not in {"easy", "medium", "hard"}:
                difficulty = "medium"
            if not stem or not isinstance(options, list) or len(options) != 4:
                continue
            options_clean = [str(opt).strip() for opt in options]
            if len(set(options_clean)) != 4:
                continue
            if correct_answer not in options_clean:
                continue
            validated.append(
                QuizQuestion(
                    question_id=f"{concept}-q{idx}",
                    concept=focus_concept,
                    stem=stem,
                    options=options_clean,
                    correct_answer=correct_answer,
                    explanation=explanation or None,
                    difficulty=difficulty,  # type: ignore[arg-type]
                )
            )
            idx += 1
            if len(validated) >= num_questions:
                break
        return validated

    def _llm_generate_questions(
        self,
        concept: str,
        num_questions: int,
        kg_context: Dict[str, Any],
        personalization: Dict[str, Any],
        material_context: Optional[str] = None,
    ) -> List[QuizQuestion]:
        self._last_quiz_generation_error = None
        if not self.client:
            self._last_quiz_generation_error = "OpenAI client is unavailable."
            return []

        target_concept = kg_context.get("concept", concept)
        prerequisites = kg_context.get("prerequisites", [])
        context_summary = kg_context.get("summary", "")
        mastery = personalization.get("mastery", 0.5)

        # Build a natural-language system prompt for higher quality generation
        system_prompt = (
            "You are an expert educator creating personalized multiple-choice quiz questions.\n\n"
            "RULES:\n"
            "- Each question must have exactly 4 options with exactly ONE correct answer.\n"
            "- The correct_answer field must be the FULL TEXT of the correct option (not a letter).\n"
            "- Write clear, unambiguous question stems. Avoid trick questions.\n"
            "- Options should be plausible — wrong answers should reflect common misconceptions.\n"
            "- Explanations should be concise (1-2 sentences) and teach WHY the answer is correct.\n"
            "- Vary question styles: definitions, applications, comparisons, scenarios, cause-effect.\n"
            "- Each question must specify which concept it tests in the `concept` field.\n"
            "- Do NOT generate meta-learning/study-strategy questions.\n"
            "- Questions must test actual subject content from provided material/context.\n"
            "- Return ONLY valid JSON. No markdown fences. No extra text.\n"
        )

        # Build a structured user prompt with all context
        user_prompt_parts = [
            f"Generate {num_questions} multiple-choice question(s) about: **{target_concept}**\n",
        ]

        if context_summary:
            user_prompt_parts.append(f"Course context:\n{context_summary}\n")

        if material_context:
            user_prompt_parts.append(
                "Uploaded material excerpts (use these as primary factual source):\n"
                f"{material_context[:6000]}"
            )

        if prerequisites:
            user_prompt_parts.append(f"Prerequisite concepts: {', '.join(prerequisites)}")

        # Adaptive difficulty based on student mastery
        if mastery < 0.3:
            difficulty_guidance = (
                "The student is a beginner. Focus on foundational recall and definition questions. "
                "Use mostly 'easy' difficulty with at most one 'medium' question."
            )
        elif mastery < 0.6:
            difficulty_guidance = (
                "The student has moderate understanding. Mix 'easy' and 'medium' difficulty. "
                "Include application-based questions that connect prerequisites to the target concept."
            )
        else:
            difficulty_guidance = (
                "The student has strong foundations. Focus on 'medium' and 'hard' difficulty. "
                "Include synthesis questions, edge cases, and questions that require deeper reasoning."
            )

        user_prompt_parts.append(f"\nDifficulty guidance: {difficulty_guidance}")

        # Personalization from student profile
        weak_areas = personalization.get("weak_prerequisites", [])
        if weak_areas:
            user_prompt_parts.append(
                f"\nThe student is weak in these prerequisites: {', '.join(weak_areas)}. "
                "Include questions that reinforce these areas."
            )

        high_decay = personalization.get("high_decay_concepts", [])
        if high_decay:
            user_prompt_parts.append(
                f"These concepts are decaying: {', '.join(high_decay)}. Include review questions for them."
            )

        user_prompt_parts.append(
            f"\nAt least one question must directly test '{target_concept}'."
        )

        user_prompt_parts.append(
            '\nReturn JSON in this exact format:\n'
            '{"questions": [{"concept": "string", "stem": "string", '
            '"options": ["A", "B", "C", "D"], "correct_answer": "full text of correct option", '
            '"explanation": "string", "difficulty": "easy|medium|hard"}]}'
        )

        prompt = {
            "_system": system_prompt,
            "_user": "\n".join(user_prompt_parts),
            "constraints": {
                "count": num_questions,
            },
        }

        collected: List[QuizQuestion] = []
        seen_keys: set[Tuple[str, Tuple[str, ...]]] = set()

        for _ in range(4):
            remaining = num_questions - len(collected)
            if remaining <= 0:
                break
            prompt["constraints"]["count"] = remaining
            try:
                messages = [
                    {
                        "role": "system",
                        "content": prompt["_system"],
                    },
                    {"role": "user", "content": prompt["_user"].replace(
                        f"Generate {num_questions}", f"Generate {remaining}"
                    ) if remaining != num_questions else prompt["_user"]},
                ]
                try:
                    completion = self.client.chat.completions.create(
                        model="gpt-5.2",
                        response_format={"type": "json_object"},
                        messages=messages,
                    )
                except Exception as format_exc:
                    # Compatibility fallback for SDK/model variants.
                    self._last_quiz_generation_error = f"response_format mode failed: {format_exc}"
                    completion = self.client.chat.completions.create(
                        model="gpt-5.2",
                        messages=messages,
                    )
                # GPT-5.2 reasoning models may return content in output_text
                # or nested under choices. Handle both.
                content = None
                if hasattr(completion, 'output_text') and completion.output_text:
                    content = completion.output_text
                elif hasattr(completion, 'choices') and completion.choices:
                    msg = completion.choices[0].message
                    content = msg.content if msg else None
                content = content or "{}"
                parsed = _extract_json_object(content)
                questions = parsed.get("questions", [])
                validated = self._validate_generated_questions(concept, questions, remaining)
                for q in validated:
                    key = (q.stem.strip().lower(), tuple(opt.strip().lower() for opt in q.options))
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)
                    collected.append(q)
                    if len(collected) >= num_questions:
                        break
            except Exception as exc:
                self._last_quiz_generation_error = f"OpenAI request/parse failure: {exc}"
                continue

        if len(collected) == 0:
            raise ValueError(
                f"LLM generated 0/{num_questions} valid questions after 4 attempts. "
                f"Last error: {self._last_quiz_generation_error or 'unknown'}"
            )

        # Re-index IDs deterministically after multi-pass collection.
        return [
            QuizQuestion(
                question_id=f"{concept}-q{i + 1}",
                concept=q.concept,
                stem=q.stem,
                options=q.options,
                correct_answer=q.correct_answer,
                explanation=q.explanation,
                difficulty=q.difficulty,
            )
            for i, q in enumerate(collected[:num_questions])
        ]

    def _llm_generate_questions_multi_concept(
        self,
        concepts: List[str],
        num_questions: int,
        material_context: Optional[str] = None,
    ) -> List[QuizQuestion]:
        self._last_quiz_generation_error = None
        if self.fast_quiz_mode or not self.use_llm_for_comprehensive:
            self._last_quiz_generation_error = "Comprehensive LLM generation disabled."
            return []
        if not self.client:
            self._last_quiz_generation_error = "OpenAI client is unavailable."
            return []
        concept_list = [str(c).strip() for c in concepts if str(c).strip()]
        if not concept_list:
            return []
        allowed = set(concept_list)
        chosen = concept_list[: min(len(concept_list), num_questions)]
        concept_csv = ", ".join(chosen)
        system_prompt = (
            "You generate grounded multiple-choice quizzes from uploaded study material only. "
            "Return ONLY valid JSON with key 'questions'. "
            "Each question must include: concept, stem, options(4), correct_answer, explanation, difficulty. "
            "concept must be one of the provided concepts. "
            "Every question must be directly answerable from the uploaded excerpts. "
            "Do not invent facts, examples, or terminology not supported by the excerpts. "
            "Do not ask meta-learning, study-strategy, confidence, or test-taking questions. "
            "If the excerpts do not support a question, omit it rather than guessing."
        )
        user_prompt = (
            f"Generate exactly {num_questions} questions across these concepts: {concept_csv}. "
            "Distribute questions across concepts as evenly as possible. "
            "Use a mix of question formats: definition, scenario application, misconception diagnosis, compare/contrast, "
            "and edge-case reasoning. Do not repeat the same stem pattern. "
            "Do NOT ask meta-learning questions (e.g., study strategy, confidence-only prompts). "
            "Do NOT use generic placeholder questions. "
            "Each stem should reference the actual subject matter from the uploaded excerpts. "
            "Output JSON: {\"questions\": [{\"concept\":\"...\",\"stem\":\"...\",\"options\":[\"...\",\"...\",\"...\",\"...\"],"
            "\"correct_answer\":\"...\",\"explanation\":\"...\",\"difficulty\":\"easy|medium|hard\"}]}"
        )
        if material_context:
            user_prompt += (
                "\nUse these uploaded material excerpts as the ONLY source of truth. "
                "Every question should be answerable from this content, and the explanation should stay grounded in it.\n"
                f"{material_context[:4000]}"
            )
        else:
            self._last_quiz_generation_error = "No grounded material context was provided."
            return []
        try:
            completion = self.client.chat.completions.create(
                model="gpt-5.2",
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            )
            content = None
            if hasattr(completion, "output_text") and completion.output_text:
                content = completion.output_text
            elif hasattr(completion, "choices") and completion.choices:
                msg = completion.choices[0].message
                content = msg.content if msg else None
            parsed = _extract_json_object(content or "{}")
            raw_questions = parsed.get("questions", [])
            validated: List[QuizQuestion] = []
            idx = 1
            for item in raw_questions:
                stem = str(item.get("stem", "")).strip()
                options = item.get("options", [])
                correct_answer = str(item.get("correct_answer", "")).strip()
                difficulty = str(item.get("difficulty", "medium")).strip().lower()
                explanation = str(item.get("explanation", "")).strip()
                concept = str(item.get("concept", "")).strip()
                if concept not in allowed:
                    continue
                if difficulty not in {"easy", "medium", "hard"}:
                    difficulty = "medium"
                if not stem or not isinstance(options, list) or len(options) != 4:
                    continue
                options_clean = [str(opt).strip() for opt in options]
                if len(set(options_clean)) != 4:
                    continue
                if correct_answer not in options_clean:
                    continue
                validated.append(
                    QuizQuestion(
                        question_id=f"all-concepts-q{idx}",
                        concept=concept,
                        stem=stem,
                        options=options_clean,
                        correct_answer=correct_answer,
                        explanation=explanation or None,
                        difficulty=difficulty,  # type: ignore[arg-type]
                    )
                )
                idx += 1
                if len(validated) >= num_questions:
                    break
            return validated[:num_questions]
        except Exception as exc:
            self._last_quiz_generation_error = f"OpenAI multi-concept generation failed: {exc}"
            return []

    def _llm_generate_comprehensive_with_retries(
        self,
        concepts: List[str],
        num_questions: int,
        material_context: Optional[str] = None,
    ) -> List[QuizQuestion]:
        """Generate comprehensive quiz via smaller LLM batches to avoid request timeouts."""
        collected: List[QuizQuestion] = []
        seen: set[tuple[str, str]] = set()
        batch_size = min(8, max(3, num_questions))
        attempts = 0
        concept_cursor = 0

        while len(collected) < num_questions and attempts < 6:
            remaining = num_questions - len(collected)
            ask = min(batch_size, remaining)
            concept_window_size = min(len(concepts), max(3, ask))
            if concept_window_size <= 0:
                break
            start = concept_cursor % len(concepts)
            subset = concepts[start:start + concept_window_size]
            if len(subset) < concept_window_size:
                subset += concepts[: concept_window_size - len(subset)]
            concept_cursor = (concept_cursor + concept_window_size) % max(1, len(concepts))
            # Shrink context on later attempts to improve latency.
            if material_context:
                cap = 4000 if attempts < 2 else (2600 if attempts < 4 else 1800)
                batch_context = material_context[:cap]
            else:
                batch_context = None

            chunk = self._llm_generate_questions_multi_concept(
                concepts=subset,
                num_questions=ask,
                material_context=batch_context,
            )
            if not chunk:
                batch_size = max(3, batch_size - 2)
                attempts += 1
                continue

            for q in chunk:
                key = (str(q.concept).strip().lower(), str(q.stem).strip().lower())
                if key in seen:
                    continue
                seen.add(key)
                collected.append(q)
                if len(collected) >= num_questions:
                    break
            attempts += 1

        return collected[:num_questions]

    def _difficulty_for_mastery(self, mastery: Optional[float]) -> str:
        if mastery is None:
            return "medium"
        if mastery < 0.45:
            return "easy"
        if mastery < 0.75:
            return "medium"
        return "hard"

    def _fallback_generate_questions(
        self,
        concept: str,
        num_questions: int,
        personalization: Dict[str, Any],
    ) -> List[QuizQuestion]:
        focus_concepts = personalization.get("focus_concepts", [concept])
        result: List[QuizQuestion] = []
        for idx in range(1, num_questions + 1):
            focus = focus_concepts[(idx - 1) % max(1, len(focus_concepts))]
            bank = self._subject_bank(focus)
            # Stable per-concept offset prevents repetitive first-template questions.
            offset = sum(ord(ch) for ch in focus) % max(1, len(bank))
            item = bank[(offset + idx - 1) % len(bank)]
            mastery_lookup = None
            if focus == concept:
                mastery_lookup = personalization.get("target_mastery")
            else:
                for prereq in personalization.get("prerequisites", []):
                    if prereq.get("concept_id") == focus:
                        mastery_lookup = prereq.get("mastery")
                        break
            result.append(
                QuizQuestion(
                    question_id=f"{concept}-q{idx}",
                    concept=focus,
                    stem=item["stem"],
                    options=item["options"],
                    correct_answer=item["correct_answer"],
                    explanation=item.get("explanation"),
                    difficulty=self._difficulty_for_mastery(mastery_lookup),
                )
            )
        return result

    def generate_quiz(self, request: QuizGenerateRequest) -> Dict[str, Any]:
        request.num_questions = max(1, min(int(request.num_questions), 20))
        requested_concepts = [
            str(c).strip() for c in (request.concepts or []) if str(c).strip()
        ]
        is_comprehensive = bool(requested_concepts)

        if is_comprehensive:
            state, commit = self.store.transaction(request.student_id)
            per_concept_counts = self._generate_per_concept_question_counts(requested_concepts, request.num_questions)
            questions: List[QuizQuestion] = self._llm_generate_comprehensive_with_retries(
                list(per_concept_counts.keys()),
                request.num_questions,
                request.material_context,
            )
            generation_source = "llm"
            if not questions:
                raise ValueError(
                    "LLM comprehensive quiz generation failed or is unavailable. "
                    "Set OPENAI_API_KEY and ENABLE_LLM_QUIZ_GENERATION=true. "
                    f"Details: {self._last_quiz_generation_error or 'unknown'}"
                )

            questions = self._assign_unique_question_ids("all-concepts", questions[: request.num_questions])
            quizzes = state.setdefault("quizzes", {})
            quizzes[request.student_id] = {q.question_id: q.model_dump() for q in questions}
            commit(state)

            return {
                "questions": [
                    {
                        "question_id": q.question_id,
                        "concept": q.concept,
                        "stem": q.stem,
                        "options": q.options,
                        "difficulty": q.difficulty,
                    }
                    for q in questions
                ],
                "generation_source": generation_source,
                "kg_context": {
                    "concept": "all-concepts",
                    "prerequisites": [],
                },
                "personalization": {
                    "target_mastery": None,
                    "focus_concepts": list(per_concept_counts.keys()),
                    "target_decay_risk": None,
                    "target_careless_rate": None,
                    "target_conceptual_rate": None,
                },
            }

        kg_context = self._fetch_kg_context(request.concept)
        normalized_prereqs = self._normalize_prerequisites(kg_context.get("prerequisites", []))
        user_graph_context = self._fetch_user_graph_context(
            request.student_id,
            request.concept,
            normalized_prereqs,
        )

        state, commit = self.store.transaction(request.student_id)
        personalization = self._build_personalization_profile(
            state=state,
            student_id=request.student_id,
            concept=request.concept,
            user_graph_context=user_graph_context,
        )

        questions = self._llm_generate_questions(
            request.concept,
            request.num_questions,
            kg_context,
            personalization,
            request.material_context,
        )
        generation_source = "llm"
        if not questions:
            raise ValueError(
                "LLM quiz generation failed or is unavailable. "
                "Set OPENAI_API_KEY and ENABLE_LLM_QUIZ_GENERATION=true. "
                f"Details: {self._last_quiz_generation_error or 'unknown'}"
            )
        questions = self._assign_unique_question_ids(request.concept, questions)

        quizzes = state.setdefault("quizzes", {})
        quizzes[request.student_id] = {q.question_id: q.model_dump() for q in questions}
        commit(state)

        return {
            "questions": [
                {
                    "question_id": q.question_id,
                    "concept": q.concept,
                    "stem": q.stem,
                    "options": q.options,
                    "difficulty": q.difficulty,
                }
                for q in questions
            ],
            "generation_source": generation_source,
            "kg_context": {
                "concept": kg_context.get("concept", request.concept),
                "prerequisites": user_graph_context.get("prerequisites", []),
            },
            "personalization": {
                "target_mastery": personalization.get("target_mastery"),
                "focus_concepts": personalization.get("focus_concepts", []),
                "target_decay_risk": personalization.get("target_decay_risk"),
                "target_careless_rate": personalization.get("target_careless_rate"),
                "target_conceptual_rate": personalization.get("target_conceptual_rate"),
            },
        }

    def evaluate_answer(self, request: QuizSubmitRequest) -> EvaluateResponse:
        state, _ = self.store.transaction(request.student_id)
        student_quiz = state.get("quizzes", {}).get(request.student_id, {})
        if not student_quiz:
            raise ValueError("No active quiz found for this student.")

        per_question: List[EvaluatedAnswer] = []
        correct = 0
        for answer in request.answers:
            q_data = student_quiz.get(answer.question_id)
            if not q_data:
                raise ValueError(f"Unknown question_id: {answer.question_id}")
            is_correct = answer.selected_answer == q_data["correct_answer"]
            if is_correct:
                correct += 1
            per_question.append(
                EvaluatedAnswer(
                    question_id=answer.question_id,
                    is_correct=is_correct,
                    correct_answer=q_data["correct_answer"],
                )
            )
        score = round((correct / len(request.answers)) * 100, 2) if request.answers else 0.0
        return EvaluateResponse(score=score, per_question=per_question)

    def _llm_classify_ambiguous(
        self,
        concept: str,
        question: Dict[str, Any],
        selected_answer: str,
        confidence_1_to_5: int,
    ) -> Optional[MistakeClassification]:
        if not self.client:
            return None
        payload = {
            "concept": concept,
            "question": question.get("stem", ""),
            "options": question.get("options", []),
            "correct_answer": question.get("correct_answer", ""),
            "student_answer": selected_answer,
            "confidence_1_to_5": confidence_1_to_5,
            "output_schema": {
                "mistake_type": "careless|conceptual",
                "missing_concept": "string or null",
                "error_span": "string",
                "rationale": "string",
            },
        }
        for _ in range(2):
            try:
                completion = self.client.chat.completions.create(
                    model="gpt-5.2",
                    messages=[
                        {
                            "role": "system",
                            "content": (
                                "Classify student mistakes as careless or conceptual and return ONLY valid JSON. "
                                "Use confidence as a soft signal, not a hard rule. "
                                "If careless, missing_concept must be null. "
                                "If conceptual, provide the most specific missing concept."
                            ),
                        },
                        {"role": "user", "content": json.dumps(payload)},
                    ],
                    response_format={"type": "json_object"},
                )
                cls_content = None
                if hasattr(completion, 'output_text') and completion.output_text:
                    cls_content = completion.output_text
                elif hasattr(completion, 'choices') and completion.choices:
                    cls_msg = completion.choices[0].message
                    cls_content = cls_msg.content if cls_msg else None
                parsed = _extract_json_object(cls_content or "{}")
                mistake_type_raw = parsed.get("mistake_type", "conceptual")
                mistake_type = mistake_type_raw if mistake_type_raw in {"careless", "conceptual"} else "conceptual"
                missing_concept = _normalize_missing_concept(parsed.get("missing_concept"), concept)
                if mistake_type == "careless":
                    missing_concept = None
                rationale = parsed.get("rationale")
                if not isinstance(rationale, str) or not rationale.strip():
                    rationale = "Ambiguous classification resolved by LLM."
                error_span = parsed.get("error_span")
                if not isinstance(error_span, str) or not error_span.strip():
                    error_span = _safe_error_span(selected_answer)
                return MistakeClassification(
                    question_id=question["question_id"],
                    mistake_type=mistake_type,
                    missing_concept=missing_concept,
                    error_span=error_span.strip()[:160],
                    rationale=rationale.strip()[:300],
                    classification_source="openai",
                    classification_model="gpt-5.2",
                )
            except Exception:
                continue
        return None

    def _classify_wrong_answer(
        self,
        concept: str,
        question: Dict[str, Any],
        selected_answer: str,
        confidence_1_to_5: int,
        allow_llm: bool = True,
    ) -> MistakeClassification:
        tested_concept = str(question.get("concept") or concept)
        if allow_llm and not self.fast_quiz_mode:
            llm_result = self._llm_classify_ambiguous(tested_concept, question, selected_answer, confidence_1_to_5)
            if llm_result:
                return llm_result

        # Deterministic fallback when LLM classification is unavailable.
        if confidence_1_to_5 >= 4:
            return MistakeClassification(
                question_id=question["question_id"],
                mistake_type="careless",
                missing_concept=None,
                error_span=_safe_error_span(selected_answer),
                rationale="High-confidence incorrect answer suggests likely careless execution.",
                classification_source="fallback",
            )
        if confidence_1_to_5 <= 2:
            return MistakeClassification(
                question_id=question["question_id"],
                mistake_type="conceptual",
                missing_concept=tested_concept,
                error_span=_safe_error_span(selected_answer),
                rationale="Low-confidence incorrect answer suggests conceptual gap.",
                classification_source="fallback",
            )
        return MistakeClassification(
            question_id=question["question_id"],
            mistake_type="conceptual",
            missing_concept=tested_concept,
            error_span=_safe_error_span(selected_answer),
            rationale="Fallback classification after LLM was unavailable.",
            classification_source="fallback",
        )

    def classify_mistake(self, request: QuizSubmitRequest) -> ClassifyResponse:
        state, commit = self.store.transaction(request.student_id)
        quizzes = state.setdefault("quizzes", {})
        history = state.setdefault("attempt_history", {})
        cls_store = state.setdefault("classification_store", {})
        blind = state.setdefault("blind_spot_counts", {})
        runs_store = state.setdefault("assessment_runs", {})

        student_quiz = quizzes.get(request.student_id, {})
        if not student_quiz:
            raise ValueError("No active quiz found for this student.")

        student_cls = cls_store.setdefault(request.student_id, {})
        student_blind = blind.setdefault(request.student_id, {"found": 0, "resolved": 0})
        student_history = history.setdefault(request.student_id, [])

        classifications: List[MistakeClassification] = []
        integration_actions: List[Dict[str, Any]] = []
        review_items: List[Dict[str, Any]] = []
        per_question: List[EvaluatedAnswer] = []
        correct_count = 0

        for answer in request.answers:
            question = student_quiz.get(answer.question_id)
            if not question:
                raise ValueError(f"Unknown question_id: {answer.question_id}")
            is_correct = answer.selected_answer == question["correct_answer"]
            per_question.append(
                EvaluatedAnswer(
                    question_id=answer.question_id,
                    is_correct=is_correct,
                    correct_answer=question["correct_answer"],
                )
            )
            if is_correct:
                correct_count += 1
                previous = student_cls.get(answer.question_id)
                if (
                    previous
                    and previous.get("mistake_type") == "conceptual"
                    and not previous.get("resolved_by_correct", False)
                ):
                    student_blind["resolved"] += 1
                    previous["resolved_by_correct"] = True
                student_history.append(
                    {
                        "question_id": answer.question_id,
                        "concept": question.get("concept", request.concept),
                        "is_correct": True,
                        "confidence_1_to_5": answer.confidence_1_to_5,
                        "mistake_type": None,
                        "timestamp": _now_iso(),
                    }
                )
                kg_sync = self._sync_kg_mastery(
                    concept=question.get("concept", request.concept),
                    is_correct=True,
                    mistake_type=None,
                )
                if kg_sync:
                    integration_actions.append(
                        {
                            "question_id": answer.question_id,
                            "mistake_type": "none",
                            "concept": question.get("concept", request.concept),
                            "kg_update": kg_sync,
                        }
                    )
                review_items.append(
                    {
                        "question_id": answer.question_id,
                        "concept": question.get("concept", request.concept),
                        "stem": question.get("stem", ""),
                        "selected_answer": answer.selected_answer,
                        "correct_answer": question.get("correct_answer", ""),
                        "is_correct": True,
                        "confidence_1_to_5": answer.confidence_1_to_5,
                        "mistake_type": "none",
                        "rationale": "Correct",
                    }
                )
                continue

            allow_llm_classification = (
                self.prefer_llm_mistake_classification
                and not self.fast_quiz_mode
                and not (
                    self.skip_llm_classification_for_long_quiz
                    and len(request.answers) >= self.long_quiz_threshold
                )
            )

            classification = self._classify_wrong_answer(
                concept=request.concept,
                question=question,
                selected_answer=answer.selected_answer,
                confidence_1_to_5=answer.confidence_1_to_5,
                allow_llm=allow_llm_classification,
            )
            previous = student_cls.get(answer.question_id)
            if not previous and classification.mistake_type == "conceptual":
                student_blind["found"] += 1
            stored = classification.model_dump()
            stored["updated_at"] = _now_iso()
            stored["overridden_by_user"] = bool(previous and previous.get("overridden_by_user", False))
            stored["override_timestamp"] = previous.get("override_timestamp") if previous else None
            stored["resolved_by_correct"] = False
            student_cls[answer.question_id] = stored
            classifications.append(classification)
            student_history.append(
                {
                    "question_id": answer.question_id,
                    "concept": question.get("concept", request.concept),
                    "is_correct": False,
                    "confidence_1_to_5": answer.confidence_1_to_5,
                    "mistake_type": classification.mistake_type,
                    "classification_source": classification.classification_source,
                    "classification_model": classification.classification_model,
                    "timestamp": _now_iso(),
                }
            )
            integration_actions.append(
                {
                    "question_id": answer.question_id,
                    "mistake_type": classification.mistake_type,
                    "concept": question.get("concept", request.concept),
                    "classification_source": classification.classification_source,
                    "classification_model": classification.classification_model,
                    "rpkt_probe": {
                        "concept": question.get("concept", request.concept),
                        "missing_concept": classification.missing_concept,
                    },
                    "intervention": {
                        "mistake_type": classification.mistake_type,
                        "concept": question.get("concept", request.concept),
                        "missing_concept": classification.missing_concept,
                    },
                }
            )
            kg_sync = self._sync_kg_mastery(
                concept=question.get("concept", request.concept),
                is_correct=False,
                mistake_type=classification.mistake_type,
                classification=classification,
            )
            if kg_sync:
                integration_actions[-1]["kg_update"] = kg_sync
            review_items.append(
                {
                    "question_id": answer.question_id,
                    "concept": question.get("concept", request.concept),
                    "stem": question.get("stem", ""),
                    "selected_answer": answer.selected_answer,
                    "correct_answer": question.get("correct_answer", ""),
                    "is_correct": False,
                    "confidence_1_to_5": answer.confidence_1_to_5,
                    "mistake_type": classification.mistake_type,
                    "missing_concept": classification.missing_concept,
                    "rationale": classification.rationale,
                    "classification_source": classification.classification_source,
                    "classification_model": classification.classification_model,
                }
            )

        # Persist a full assessment run for "Past Assessments" UX.
        total = len(request.answers)
        run_entry = {
            "run_id": f"run-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}-{uuid4().hex[:6]}",
            "student_id": request.student_id,
            "concept": request.concept,
            "submitted_at": _now_iso(),
            "score": round((correct_count / total) * 100, 2) if total else 0.0,
            "correct_count": correct_count,
            "total_questions": total,
            "blind_spot_found_count": student_blind["found"],
            "blind_spot_resolved_count": student_blind["resolved"],
            "questions": review_items,
        }
        student_runs = runs_store.setdefault(request.student_id, [])
        student_runs.append(run_entry)
        # Keep bounded history size.
        if len(student_runs) > 100:
            del student_runs[:-100]

        commit(state)
        score = round((correct_count / len(request.answers)) * 100, 2) if request.answers else 0.0
        return ClassifyResponse(
            classifications=classifications,
            blind_spot_found_count=student_blind["found"],
            blind_spot_resolved_count=student_blind["resolved"],
            integration_actions=integration_actions,
            score=score,
            per_question=per_question,
        )

    @staticmethod
    def _derive_runs_from_quizzes(student_id: str, quizzes: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Reconstruct assessment runs from saved quiz questions.

        Question IDs follow the pattern ``{concept}-{timestamp}-{uuid}-q{n}``.
        Questions sharing the same prefix belong to the same run.
        """
        groups: Dict[str, List[Dict[str, Any]]] = {}
        for qid, q_data in quizzes.items():
            if not isinstance(q_data, dict):
                continue
            # Split off the trailing "-qN" to get the run prefix.
            parts = str(qid).rsplit("-q", 1)
            run_prefix = parts[0] if len(parts) == 2 and parts[1].isdigit() else qid
            groups.setdefault(run_prefix, []).append({**q_data, "question_id": qid})

        derived: List[Dict[str, Any]] = []
        for prefix, questions in groups.items():
            q_concept = str(questions[0].get("concept", "unknown"))
            # Extract timestamp from prefix: {concept}-{YYYYMMDD...}-{uuid}
            prefix_parts = prefix.rsplit("-", 1)  # split uuid
            ts_part = prefix_parts[0].rsplit("-", 1)[-1] if len(prefix_parts) >= 2 else ""
            submitted_at = ""
            if len(ts_part) >= 14:
                try:
                    submitted_at = datetime(
                        int(ts_part[0:4]), int(ts_part[4:6]), int(ts_part[6:8]),
                        int(ts_part[8:10]), int(ts_part[10:12]), int(ts_part[12:14]),
                        tzinfo=timezone.utc,
                    ).isoformat()
                except (ValueError, IndexError):
                    pass

            total = len(questions)
            derived.append({
                "run_id": f"quiz-{prefix}",
                "student_id": student_id,
                "concept": q_concept,
                "submitted_at": submitted_at,
                "score": 0.0,
                "correct_count": 0,
                "total_questions": total,
                "blind_spot_found_count": 0,
                "blind_spot_resolved_count": 0,
                "questions": [
                    {
                        "question_id": q.get("question_id", ""),
                        "concept": q.get("concept", q_concept),
                        "stem": q.get("stem", ""),
                        "selected_answer": "",
                        "correct_answer": q.get("correct_answer", ""),
                        "is_correct": False,
                        "confidence_1_to_5": 3,
                        "mistake_type": "none",
                        "rationale": "Recovered from quiz question data.",
                    }
                    for q in questions
                ],
            })
        return derived

    def get_assessment_history(self, student_id: str, concept: Optional[str] = None, limit: int = 20) -> List[Dict[str, Any]]:
        state, _ = self.store.transaction(student_id)
        runs = state.get("assessment_runs", {}).get(student_id, [])
        if not runs:
            # Backward-compatible fallback: derive coarse runs from historical attempts.
            attempts = state.get("attempt_history", {}).get(student_id, [])
            attempts_sorted = sorted(attempts, key=lambda a: str(a.get("timestamp", "")))
            derived: List[Dict[str, Any]] = []
            current: Optional[Dict[str, Any]] = None
            current_ts: Optional[datetime] = None

            def _parse_ts(value: Any) -> Optional[datetime]:
                raw = str(value or "")
                if not raw:
                    return None
                try:
                    ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                except Exception:
                    return None
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                return ts

            for a in attempts_sorted:
                a_ts_raw = str(a.get("timestamp", ""))
                a_ts = _parse_ts(a_ts_raw)
                if a_ts is None:
                    continue

                a_concept = str(a.get("concept") or "unknown")
                # Start a new run if concept changes or time gap exceeds 2 minutes.
                should_split = (
                    current is None
                    or current.get("concept") != a_concept
                    or current_ts is None
                    or (a_ts - current_ts).total_seconds() > 120
                )

                if should_split:
                    if current is not None:
                        total_q = int(current.get("total_questions", 0))
                        correct_q = int(current.get("correct_count", 0))
                        current["score"] = round((correct_q / total_q) * 100, 2) if total_q else 0.0
                        derived.append(current)
                    current = {
                        "run_id": f"derived-{a_ts.strftime('%Y%m%d%H%M%S%f')}-{uuid4().hex[:6]}",
                        "student_id": student_id,
                        "concept": a_concept,
                        "submitted_at": a_ts_raw,
                        "score": 0.0,
                        "correct_count": 0,
                        "total_questions": 0,
                        "blind_spot_found_count": 0,
                        "blind_spot_resolved_count": 0,
                        "questions": [],
                    }

                assert current is not None
                current["total_questions"] += 1
                if bool(a.get("is_correct")):
                    current["correct_count"] += 1
                current["questions"].append(
                    {
                        "question_id": str(a.get("question_id", "")),
                        "concept": a_concept,
                        "stem": "",
                        "selected_answer": "",
                        "correct_answer": "",
                        "is_correct": bool(a.get("is_correct")),
                        "confidence_1_to_5": int(a.get("confidence_1_to_5", 3)),
                        "mistake_type": a.get("mistake_type") or "none",
                        "rationale": "Recovered from historical attempt data.",
                    }
                )
                current_ts = a_ts

            if current is not None:
                total_q = int(current.get("total_questions", 0))
                correct_q = int(current.get("correct_count", 0))
                current["score"] = round((correct_q / total_q) * 100, 2) if total_q else 0.0
                derived.append(current)
            runs = derived

        if not runs:
            # Final fallback: reconstruct runs from saved quiz questions.
            quizzes = state.get("quizzes", {}).get(student_id, {})
            if quizzes:
                runs = self._derive_runs_from_quizzes(student_id, quizzes)

        if concept:
            concept_key = _normalize_key(concept)
            runs = [
                r for r in runs
                if str(r.get("concept", "")) == concept
                or _normalize_key(str(r.get("concept", ""))) == concept_key
            ]
        # Most recent first.
        runs_sorted = sorted(runs, key=lambda r: str(r.get("submitted_at", "")), reverse=True)
        return runs_sorted[: max(1, min(limit, 100))]

    def get_self_awareness_score(self, student_id: str) -> SelfAwarenessResponse:
        state, _ = self.store.transaction(student_id)
        attempts = state.get("attempt_history", {}).get(student_id, [])
        if not attempts:
            return SelfAwarenessResponse(
                student_id=student_id,
                score=0.0,
                total_attempts=0,
                calibration_gap=0.0,
            )
        squared = []
        for attempt in attempts:
            predicted = _confidence_to_probability(int(attempt["confidence_1_to_5"]))
            actual = 1.0 if bool(attempt["is_correct"]) else 0.0
            squared.append((predicted - actual) ** 2)
        mean_brier = sum(squared) / len(squared)
        self_awareness = max(0.0, min(1.0, 1.0 - mean_brier))
        return SelfAwarenessResponse(
            student_id=student_id,
            score=round(self_awareness, 4),
            total_attempts=len(attempts),
            calibration_gap=round(math.sqrt(mean_brier), 4),
        )

    def override_classification(self, student_id: str, question_id: str) -> Dict[str, Any]:
        state, commit = self.store.transaction(student_id)
        cls_store = state.setdefault("classification_store", {})
        blind = state.setdefault("blind_spot_counts", {})
        student_cls = cls_store.setdefault(student_id, {})
        student_blind = blind.setdefault(student_id, {"found": 0, "resolved": 0})
        existing = student_cls.get(question_id)
        if not existing:
            raise ValueError("No classification found for this question.")
        was_conceptual = existing.get("mistake_type") == "conceptual"
        existing["mistake_type"] = "careless"
        existing["missing_concept"] = None
        existing["rationale"] = "User override: student marked this as rushed/careless."
        existing["overridden_by_user"] = True
        existing["override_timestamp"] = _now_iso()
        if was_conceptual:
            student_blind["found"] = max(0, int(student_blind.get("found", 0)) - 1)
        commit(state)
        return {"updated": True, "question_id": question_id}

    def generate_micro_checkpoint(self, student_id: str, concept: str, missing_concept: Optional[str]) -> MicroCheckpointResponse:
        target = missing_concept or concept
        question = QuizQuestion(
            question_id=f"checkpoint-{target}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}-{uuid4().hex[:6]}",
            concept=target,
            stem=f"Quick checkpoint: which statement best confirms mastery of {target}?",
            options=[
                "I can explain the concept and apply it to a new problem.",
                "I only remember the definition word-for-word.",
                "I can identify a formula but not usage conditions.",
                "I need a worked solution before attempting anything.",
            ],
            correct_answer="I can explain the concept and apply it to a new problem.",
            explanation="Transfer + explanation is strongest mastery signal.",
            difficulty="easy",
        )
        state, commit = self.store.transaction(student_id)
        quizzes = state.setdefault("quizzes", {})
        quizzes.setdefault(student_id, {})[question.question_id] = question.model_dump()
        commit(state)
        return MicroCheckpointResponse(question=question)

    def submit_micro_checkpoint(
        self,
        student_id: str,
        question_id: str,
        selected_answer: str,
        confidence_1_to_5: int,
    ) -> MicroCheckpointSubmitResponse:
        state, commit = self.store.transaction(student_id)
        quizzes = state.setdefault("quizzes", {})
        history = state.setdefault("attempt_history", {})
        student_quiz = quizzes.get(student_id, {})
        question = student_quiz.get(question_id)
        if not question:
            raise ValueError("Checkpoint question not found.")
        is_correct = selected_answer == question["correct_answer"]
        history.setdefault(student_id, []).append(
            {
                "question_id": question_id,
                "concept": question["concept"],
                "is_correct": is_correct,
                "confidence_1_to_5": confidence_1_to_5,
                "mistake_type": None if is_correct else "conceptual",
                "timestamp": _now_iso(),
            }
        )
        commit(state)
        self._sync_kg_mastery(
            concept=question.get("concept", ""),
            is_correct=is_correct,
            mistake_type=None if is_correct else "conceptual",
        )
        return MicroCheckpointSubmitResponse(
            question_id=question_id,
            is_correct=is_correct,
            next_action="resolved" if is_correct else "needs_intervention",
        )
