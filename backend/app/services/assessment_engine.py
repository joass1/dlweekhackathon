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
        self.allow_rule_based_quiz_fallback = os.getenv("ALLOW_RULE_BASED_QUIZ_FALLBACK", "false").lower() == "true"
        self.enable_remote_profile = os.getenv("ENABLE_REMOTE_PROFILE_LOOKUP", "true").lower() == "true"
        self.enable_legacy_global_kg_sync = os.getenv("ENABLE_LEGACY_GLOBAL_KG_SYNC", "false").lower() == "true"
        self.kg_timeout_s = float(os.getenv("KG_API_TIMEOUT_SECONDS", "2.0"))
        self.llm_timeout_s = float(os.getenv("LLM_TIMEOUT_SECONDS", "35.0"))
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

    def _sync_kg_mastery(self, concept: str, is_correct: bool, mistake_type: Optional[str]) -> Optional[Dict[str, Any]]:
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
            )
            return {
                "concept_id": concept_id,
                "is_correct": is_correct,
                "mistake_type": mistake_type,
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
            "- Return ONLY valid JSON. No markdown fences. No extra text.\n"
        )

        # Build a structured user prompt with all context
        user_prompt_parts = [
            f"Generate {num_questions} multiple-choice question(s) about: **{target_concept}**\n",
        ]

        if context_summary:
            user_prompt_parts.append(f"Course context:\n{context_summary}\n")

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
                        temperature=0.2,
                        response_format={"type": "json_object"},
                        messages=messages,
                    )
                except Exception as format_exc:
                    # Compatibility fallback for SDK/model variants.
                    self._last_quiz_generation_error = f"response_format mode failed: {format_exc}"
                    completion = self.client.chat.completions.create(
                        model="gpt-5.2",
                        temperature=0.2,
                        messages=messages,
                    )
                content = completion.choices[0].message.content or "{}"
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

        if len(collected) < num_questions:
            if not self._last_quiz_generation_error:
                self._last_quiz_generation_error = (
                    f"Generated only {len(collected)}/{num_questions} valid questions."
                )
            return []

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
            item = bank[(idx - 1) % len(bank)]
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
        )
        generation_source = "llm"
        if not questions:
            if not self.allow_rule_based_quiz_fallback:
                raise ValueError(
                    "LLM quiz generation failed or is unavailable. "
                    "Set OPENAI_API_KEY and ENABLE_LLM_QUIZ_GENERATION=true. "
                    f"Details: {self._last_quiz_generation_error or 'unknown'}"
                )
            questions = self._fallback_generate_questions(
                request.concept,
                request.num_questions,
                personalization,
            )
            generation_source = "fallback"
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
                    temperature=0,
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
                )
                parsed = _extract_json_object(completion.choices[0].message.content or "{}")
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
    ) -> MistakeClassification:
        tested_concept = str(question.get("concept") or concept)
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
            )
        if confidence_1_to_5 <= 2:
            return MistakeClassification(
                question_id=question["question_id"],
                mistake_type="conceptual",
                missing_concept=tested_concept,
                error_span=_safe_error_span(selected_answer),
                rationale="Low-confidence incorrect answer suggests conceptual gap.",
            )
        return MistakeClassification(
            question_id=question["question_id"],
            mistake_type="conceptual",
            missing_concept=tested_concept,
            error_span=_safe_error_span(selected_answer),
            rationale="Fallback classification after LLM was unavailable.",
        )

    def classify_mistake(self, request: QuizSubmitRequest) -> ClassifyResponse:
        state, commit = self.store.transaction(request.student_id)
        quizzes = state.setdefault("quizzes", {})
        history = state.setdefault("attempt_history", {})
        cls_store = state.setdefault("classification_store", {})
        blind = state.setdefault("blind_spot_counts", {})

        student_quiz = quizzes.get(request.student_id, {})
        if not student_quiz:
            raise ValueError("No active quiz found for this student.")

        student_cls = cls_store.setdefault(request.student_id, {})
        student_blind = blind.setdefault(request.student_id, {"found": 0, "resolved": 0})
        student_history = history.setdefault(request.student_id, [])

        classifications: List[MistakeClassification] = []
        integration_actions: List[Dict[str, Any]] = []

        for answer in request.answers:
            question = student_quiz.get(answer.question_id)
            if not question:
                raise ValueError(f"Unknown question_id: {answer.question_id}")
            is_correct = answer.selected_answer == question["correct_answer"]
            if is_correct:
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
                            "kg_update": kg_sync,
                        }
                    )
                continue

            classification = self._classify_wrong_answer(
                concept=request.concept,
                question=question,
                selected_answer=answer.selected_answer,
                confidence_1_to_5=answer.confidence_1_to_5,
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
                    "timestamp": _now_iso(),
                }
            )
            integration_actions.append(
                {
                    "question_id": answer.question_id,
                    "mistake_type": classification.mistake_type,
                    "rpkt_probe": {
                        "concept": request.concept,
                        "missing_concept": classification.missing_concept,
                    },
                    "intervention": {
                        "mistake_type": classification.mistake_type,
                        "concept": request.concept,
                        "missing_concept": classification.missing_concept,
                    },
                }
            )
            kg_sync = self._sync_kg_mastery(
                concept=question.get("concept", request.concept),
                is_correct=False,
                mistake_type=classification.mistake_type,
            )
            if kg_sync:
                integration_actions[-1]["kg_update"] = kg_sync

        commit(state)
        return ClassifyResponse(
            classifications=classifications,
            blind_spot_found_count=student_blind["found"],
            blind_spot_resolved_count=student_blind["resolved"],
            integration_actions=integration_actions,
        )

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
