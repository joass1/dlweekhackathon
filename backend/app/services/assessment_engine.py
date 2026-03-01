import json
import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

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


class AssessmentStateStore:
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

    def transaction(self) -> Tuple[Dict[str, Any], callable]:
        with self._lock:
            state = self._read()

            def commit(new_state: Dict[str, Any]) -> None:
                self._write(new_state)

            return state, commit


class AssessmentEngine:
    def __init__(self, state_path: Path):
        self.store = AssessmentStateStore(state_path)
        self.openai_key = os.getenv("OPENAI_API_KEY")
        self.kg_base_url = os.getenv("KG_API_BASE_URL", "").strip()
        self.client = OpenAI(api_key=self.openai_key) if self.openai_key else None

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
        if self.kg_base_url:
            try:
                import requests  # local import to avoid hard dependency at import time

                resp = requests.get(f"{self.kg_base_url.rstrip('/')}/api/kg/concepts/{concept}", timeout=6)
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

    def _validate_generated_questions(self, concept: str, raw_questions: List[Dict[str, Any]], num_questions: int) -> List[QuizQuestion]:
        validated: List[QuizQuestion] = []
        idx = 1
        for item in raw_questions:
            stem = str(item.get("stem", "")).strip()
            options = item.get("options", [])
            correct_answer = str(item.get("correct_answer", "")).strip()
            difficulty = str(item.get("difficulty", "medium")).strip().lower()
            explanation = str(item.get("explanation", "")).strip()
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
        return validated

    def _llm_generate_questions(self, concept: str, num_questions: int, kg_context: Dict[str, Any]) -> List[QuizQuestion]:
        if not self.client:
            return []

        prompt = {
            "task": "Generate multiple-choice quiz questions",
            "constraints": {
                "count": num_questions,
                "options_per_question": 4,
                "one_correct_answer_in_options": True,
                "include_explanation": True,
                "difficulty_values": ["easy", "medium", "hard"],
            },
            "concept": kg_context.get("concept", concept),
            "prerequisites": kg_context.get("prerequisites", []),
            "context_summary": kg_context.get("summary", ""),
            "output_format": {
                "questions": [
                    {
                        "stem": "string",
                        "options": ["string", "string", "string", "string"],
                        "correct_answer": "string",
                        "explanation": "string",
                        "difficulty": "easy|medium|hard",
                    }
                ]
            },
        }

        for _ in range(2):
            try:
                completion = self.client.chat.completions.create(
                    model="gpt-4o-mini",
                    temperature=0.4,
                    messages=[
                        {
                            "role": "system",
                            "content": "Return only valid JSON. No markdown. No prose.",
                        },
                        {"role": "user", "content": json.dumps(prompt)},
                    ],
                )
                content = completion.choices[0].message.content or "{}"
                parsed = _extract_json_object(content)
                questions = parsed.get("questions", [])
                validated = self._validate_generated_questions(concept, questions, num_questions)
                if len(validated) >= num_questions:
                    return validated
            except Exception:
                continue
        return []

    def _fallback_generate_questions(self, concept: str, num_questions: int) -> List[QuizQuestion]:
        bank = self._subject_bank(concept)
        result: List[QuizQuestion] = []
        for idx, item in enumerate(bank[:num_questions], start=1):
            result.append(
                QuizQuestion(
                    question_id=f"{concept}-q{idx}",
                    concept=concept,
                    stem=item["stem"],
                    options=item["options"],
                    correct_answer=item["correct_answer"],
                    explanation=item.get("explanation"),
                    difficulty=item.get("difficulty", "medium"),
                )
            )
        while len(result) < num_questions:
            idx = len(result) + 1
            seed = bank[(idx - 1) % len(bank)]
            result.append(
                QuizQuestion(
                    question_id=f"{concept}-q{idx}",
                    concept=concept,
                    stem=seed["stem"],
                    options=seed["options"],
                    correct_answer=seed["correct_answer"],
                    explanation=seed.get("explanation"),
                    difficulty=seed.get("difficulty", "medium"),
                )
            )
        return result

    def generate_quiz(self, request: QuizGenerateRequest) -> Dict[str, Any]:
        kg_context = self._fetch_kg_context(request.concept)
        questions = self._llm_generate_questions(request.concept, request.num_questions, kg_context)
        if not questions:
            questions = self._fallback_generate_questions(request.concept, request.num_questions)

        state, commit = self.store.transaction()
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
            "generation_source": "llm" if self.client else "fallback",
            "kg_context": {
                "concept": kg_context.get("concept", request.concept),
                "prerequisites": kg_context.get("prerequisites", []),
            },
        }

    def evaluate_answer(self, request: QuizSubmitRequest) -> EvaluateResponse:
        state, _ = self.store.transaction()
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
                    model="gpt-4o-mini",
                    temperature=0,
                    messages=[
                        {"role": "system", "content": "Classify learning mistake. Return ONLY valid JSON object."},
                        {"role": "user", "content": json.dumps(payload)},
                    ],
                )
                parsed = _extract_json_object(completion.choices[0].message.content or "{}")
                mistake_type = parsed.get("mistake_type", "conceptual")
                if mistake_type not in {"careless", "conceptual"}:
                    mistake_type = "conceptual"
                missing_concept = parsed.get("missing_concept")
                if mistake_type == "conceptual" and not missing_concept:
                    missing_concept = concept
                return MistakeClassification(
                    question_id=question["question_id"],
                    mistake_type=mistake_type,
                    missing_concept=missing_concept,
                    error_span=parsed.get("error_span") or selected_answer,
                    rationale=parsed.get("rationale") or "Ambiguous classification resolved by LLM.",
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
        if confidence_1_to_5 >= 4:
            return MistakeClassification(
                question_id=question["question_id"],
                mistake_type="careless",
                missing_concept=None,
                error_span=selected_answer,
                rationale="High-confidence incorrect answer suggests likely careless execution.",
            )
        if confidence_1_to_5 <= 2:
            return MistakeClassification(
                question_id=question["question_id"],
                mistake_type="conceptual",
                missing_concept=concept,
                error_span=selected_answer,
                rationale="Low-confidence incorrect answer suggests conceptual gap.",
            )
        llm_result = self._llm_classify_ambiguous(concept, question, selected_answer, confidence_1_to_5)
        if llm_result:
            return llm_result
        return MistakeClassification(
            question_id=question["question_id"],
            mistake_type="conceptual",
            missing_concept=concept,
            error_span=selected_answer,
            rationale="Ambiguous case defaulted to conceptual after LLM fallback failure.",
        )

    def classify_mistake(self, request: QuizSubmitRequest) -> ClassifyResponse:
        state, commit = self.store.transaction()
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
                if previous and previous.get("mistake_type") == "conceptual":
                    student_blind["resolved"] += 1
                student_history.append(
                    {
                        "question_id": answer.question_id,
                        "concept": request.concept,
                        "is_correct": True,
                        "confidence_1_to_5": answer.confidence_1_to_5,
                        "mistake_type": None,
                        "timestamp": _now_iso(),
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
            student_cls[answer.question_id] = classification.model_dump()
            classifications.append(classification)
            student_history.append(
                {
                    "question_id": answer.question_id,
                    "concept": request.concept,
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

        commit(state)
        return ClassifyResponse(
            classifications=classifications,
            blind_spot_found_count=student_blind["found"],
            blind_spot_resolved_count=student_blind["resolved"],
            integration_actions=integration_actions,
        )

    def get_self_awareness_score(self, student_id: str) -> SelfAwarenessResponse:
        state, _ = self.store.transaction()
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
        state, commit = self.store.transaction()
        cls_store = state.setdefault("classification_store", {})
        student_cls = cls_store.setdefault(student_id, {})
        existing = student_cls.get(question_id)
        if not existing:
            raise ValueError("No classification found for this question.")
        existing["mistake_type"] = "careless"
        existing["missing_concept"] = None
        existing["rationale"] = "User override: student marked this as rushed/careless."
        commit(state)
        return {"updated": True, "question_id": question_id}

    def generate_micro_checkpoint(self, student_id: str, concept: str, missing_concept: Optional[str]) -> MicroCheckpointResponse:
        target = missing_concept or concept
        question = QuizQuestion(
            question_id=f"checkpoint-{target}-{datetime.now(timezone.utc).strftime('%H%M%S')}",
            concept=concept,
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
        state, commit = self.store.transaction()
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
        state, commit = self.store.transaction()
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
        return MicroCheckpointSubmitResponse(
            question_id=question_id,
            is_correct=is_correct,
            next_action="resolved" if is_correct else "needs_intervention",
        )
