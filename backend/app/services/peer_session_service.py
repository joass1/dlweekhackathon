
"""
Peer Learning Hub session management.

Handles session lifecycle, AI question generation, answer evaluation,
and per-student mastery updates.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from openai import OpenAI

from app.services.adaptive_engine import AdaptiveEngine, ConceptState


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9_]+", "_", str(value or "").strip().lower()).strip("_")


def _token_overlap_score(query: str, text: str) -> float:
    q_tokens = [t for t in _normalize_key(query).split("_") if t]
    if not q_tokens:
        return 0.0
    text_l = str(text or "").lower()
    hits = sum(1 for token in q_tokens if token in text_l)
    return hits / len(q_tokens)


def _parse_dt(value: Any, default: Optional[datetime] = None) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, str) and value.strip():
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                return dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except ValueError:
            pass
    return default or _utc_now()


class PeerSessionService:
    """Manages peer learning sessions with AI-generated collaborative tasks."""

    def __init__(self, db, openai_client: Optional[OpenAI] = None):
        self.db = db
        self.openai = openai_client
        self.collection = "peer_sessions"
        self.knowledge_chunks_collection = os.getenv("FIREBASE_KNOWLEDGE_CHUNKS_COLLECTION", "knowledge_chunks")
        self.adaptive_engine = AdaptiveEngine()

    def _fetch_concept_context(
        self,
        user_id: str,
        concept_id: Optional[str],
        topic: str,
        limit: int = 8,
    ) -> List[Dict[str, str]]:
        """Retrieve context chunks from Firestore, scoped by user and concept_id."""
        if not self.db or not user_id:
            return []

        col = self.db.collection(self.knowledge_chunks_collection)
        concept_candidates: List[str] = []
        if concept_id:
            concept_candidates.append(str(concept_id))
            norm = _normalize_key(concept_id)
            if norm and norm != concept_id:
                concept_candidates.append(norm)
        topic_norm = _normalize_key(topic)
        if topic_norm and topic_norm not in concept_candidates:
            concept_candidates.append(topic_norm)

        rows: List[Dict[str, str]] = []
        seen: set[str] = set()

        # First pass: exact concept id matches
        for cid in concept_candidates[:6]:
            try:
                docs = (
                    col.where("userId", "==", user_id)
                    .where("concept_id", "==", cid)
                    .limit(limit)
                    .stream()
                )
                for doc in docs:
                    row = doc.to_dict() or {}
                    text = str(row.get("text", "")).strip()
                    if not text:
                        continue
                    key = f"{cid}:{hash(text)}"
                    if key in seen:
                        continue
                    seen.add(key)
                    rows.append(
                        {
                            "text": text,
                            "concept_id": str(row.get("concept_id", cid)),
                            "source": str(row.get("source", "")),
                        }
                    )
                    if len(rows) >= limit:
                        return rows
            except Exception:
                continue

        # Fallback: user-scoped scan, rank by topic overlap.
        try:
            docs = col.where("userId", "==", user_id).limit(max(50, limit * 8)).stream()
            scored: List[tuple[float, Dict[str, str]]] = []
            for doc in docs:
                row = doc.to_dict() or {}
                text = str(row.get("text", "")).strip()
                if not text:
                    continue
                score = _token_overlap_score(topic, text)
                if score <= 0:
                    continue
                scored.append(
                    (
                        score,
                        {
                            "text": text,
                            "concept_id": str(row.get("concept_id", "unknown")),
                            "source": str(row.get("source", "")),
                        },
                    )
                )
            scored.sort(key=lambda x: x[0], reverse=True)
            for _, row in scored:
                key = f"{row.get('concept_id')}:{hash(row.get('text', ''))}"
                if key in seen:
                    continue
                seen.add(key)
                rows.append(row)
                if len(rows) >= limit:
                    break
        except Exception:
            pass

        return rows[:limit]

    @staticmethod
    def _format_context(chunks: List[Dict[str, str]], max_chars: int = 4000) -> str:
        if not chunks:
            return ""
        out: List[str] = []
        total = 0
        for idx, chunk in enumerate(chunks, start=1):
            text = str(chunk.get("text", "")).strip()
            concept_id = str(chunk.get("concept_id", "unknown"))
            source = str(chunk.get("source", "")).strip()
            if not text:
                continue
            snippet = f"[{idx}] concept_id={concept_id}" + (f", source={source}" if source else "") + f"\n{text}"
            remaining = max_chars - total
            if remaining <= 0:
                break
            snippet = snippet[:remaining]
            out.append(snippet)
            total += len(snippet)
        return "\n\n---\n\n".join(out)

    def _build_member_profiles(
        self,
        member_profiles: List[Dict[str, Any]],
        created_by: str,
    ) -> List[Dict[str, Any]]:
        """Normalize profiles and ensure creator is present."""
        by_id: Dict[str, Dict[str, Any]] = {}
        for raw in member_profiles or []:
            sid = str(raw.get("student_id", "")).strip()
            if not sid:
                continue
            by_id[sid] = {
                "student_id": sid,
                "name": str(raw.get("name", sid)),
                "concept_profile": dict(raw.get("concept_profile", {}) or {}),
            }
        if created_by not in by_id:
            by_id[created_by] = {
                "student_id": created_by,
                "name": created_by,
                "concept_profile": {},
            }
        return list(by_id.values())

    def _generate_round_robin_questions(
        self,
        member_profiles: List[Dict[str, Any]],
        topic: str,
        selected_concept_id: Optional[str],
        created_by: str,
    ) -> List[Dict[str, Any]]:
        """Generate one question per member, grounded by concept-tagged chunks."""
        context_chunks = self._fetch_concept_context(created_by, selected_concept_id, topic, limit=8)
        context_text = self._format_context(context_chunks)

        if not self.openai:
            return self._fallback_questions(member_profiles, topic, selected_concept_id, context_chunks)

        focus_concept = selected_concept_id or _normalize_key(topic) or topic

        def avg_mastery(p: Dict[str, Any]) -> float:
            vals = [float(v) for v in (p.get("concept_profile", {}) or {}).values()]
            return sum(vals) / len(vals) if vals else 0.0

        sorted_members = sorted(member_profiles, key=avg_mastery)
        members_desc: List[str] = []
        for m in sorted_members:
            profile = m.get("concept_profile", {}) or {}
            weakest = sorted(profile.items(), key=lambda x: x[1])[:3]
            weak_str = ", ".join(f"{c}:{float(v):.0%}" for c, v in weakest) if weakest else "no profile data"
            members_desc.append(f"- {m['name']} (id={m['student_id']}), weakest=[{weak_str}]")

        prompt = (
            "You are generating collaborative peer-learning questions.\n\n"
            f"Session topic: {topic}\n"
            f"Focus concept_id: {focus_concept}\n"
            f"Members (weakest first):\n{chr(10).join(members_desc)}\n\n"
            "Use the course context below when available. Keep questions faithful to it.\n"
            "If context is empty, generate high-quality domain-appropriate questions for the concept.\n\n"
            f"Course context:\n{context_text or '(no context found)'}\n\n"
            f"Generate exactly {len(sorted_members)} questions (one per member).\n"
            "Return ONLY JSON object: {\"questions\":[...]} with items:\n"
            "{"
            "\"question_id\":\"q_0\","
            "\"target_member\":\"<student_id>\","
            "\"target_member_name\":\"<name>\","
            "\"concept_id\":\"<focus concept id>\","
            "\"weak_concept\":\"<focus concept id>\","
            "\"type\":\"open|code|math|mcq\","
            "\"stem\":\"<question>\","
            "\"options\":[\"A\",\"B\",\"C\",\"D\"] or null,"
            "\"correct_answer\":\"<ground-truth answer>\","
            "\"explanation\":\"<why correct>\""
            "}\n"
            "Rules:\n"
            "- Keep concept_id aligned to the focus concept.\n"
            "- Make each question answerable from provided context when available.\n"
            "- No markdown, no prose outside JSON."
        )

        try:
            resp = self.openai.chat.completions.create(
                model="gpt-5.2",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                max_completion_tokens=1800,
            )
            raw = resp.choices[0].message.content or "{}"
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                questions = parsed.get("questions", [])
            else:
                questions = parsed
            return self._normalize_questions(questions, member_profiles, topic, selected_concept_id)
        except Exception as e:
            print(f"[PeerSessionService] AI question generation failed: {e}")
            return self._fallback_questions(member_profiles, topic, selected_concept_id, context_chunks)

    def _normalize_questions(
        self,
        questions: Any,
        member_profiles: List[Dict[str, Any]],
        topic: str,
        selected_concept_id: Optional[str],
    ) -> List[Dict[str, Any]]:
        """Sanitize AI output and guarantee valid questions."""
        if not isinstance(questions, list) or not questions:
            return self._fallback_questions(member_profiles, topic, selected_concept_id, [])

        by_id = {str(m.get("student_id")): m for m in member_profiles if m.get("student_id")}
        focus_concept = selected_concept_id or _normalize_key(topic) or topic
        normalized: List[Dict[str, Any]] = []

        for i, q in enumerate(questions):
            if not isinstance(q, dict):
                continue
            target_member = str(q.get("target_member") or "")
            if target_member not in by_id and member_profiles:
                target_member = str(member_profiles[min(i, len(member_profiles) - 1)].get("student_id", ""))
            if not target_member:
                continue

            member_name = by_id.get(target_member, {}).get("name", target_member)
            q_type = str(q.get("type") or "open").lower()
            if q_type not in {"open", "code", "math", "mcq"}:
                q_type = "open"
            options = q.get("options")
            if q_type != "mcq" or not isinstance(options, list):
                options = None

            stem = str(q.get("stem") or "").strip()
            correct_answer = str(q.get("correct_answer") or "").strip()
            if not stem or not correct_answer:
                continue

            concept_id = str(q.get("concept_id") or focus_concept).strip() or focus_concept
            weak_concept = str(q.get("weak_concept") or concept_id).strip() or concept_id

            normalized.append(
                {
                    "question_id": str(q.get("question_id") or f"q_{len(normalized)}"),
                    "target_member": target_member,
                    "target_member_name": str(q.get("target_member_name") or member_name),
                    "concept_id": concept_id,
                    "weak_concept": weak_concept,
                    "type": q_type,
                    "stem": stem,
                    "options": options,
                    "correct_answer": correct_answer,
                    "explanation": str(q.get("explanation") or f"This question checks understanding of {concept_id}."),
                }
            )

        if not normalized:
            return self._fallback_questions(member_profiles, topic, selected_concept_id, [])
        return normalized

    def _fallback_questions(
        self,
        member_profiles: List[Dict[str, Any]],
        topic: str,
        selected_concept_id: Optional[str],
        context_chunks: List[Dict[str, str]],
    ) -> List[Dict[str, Any]]:
        """Generate deterministic questions when AI output is unavailable."""
        focus = selected_concept_id or _normalize_key(topic) or topic
        anchor = ""
        if context_chunks:
            anchor = context_chunks[0].get("text", "")[:220].strip()

        questions: List[Dict[str, Any]] = []
        for i, m in enumerate(member_profiles):
            stem = f"Explain the key ideas of '{focus}' and how they relate to '{topic}'."
            if anchor:
                stem += f" Use this course fact in your explanation: \"{anchor}\"."
            questions.append(
                {
                    "question_id": f"q_{i}",
                    "target_member": m["student_id"],
                    "target_member_name": m.get("name", m["student_id"]),
                    "concept_id": focus,
                    "weak_concept": focus,
                    "type": "open",
                    "stem": stem,
                    "options": None,
                    "correct_answer": f"A correct explanation grounded in the course material for {focus}.",
                    "explanation": f"This checks understanding of {focus}.",
                }
            )
        return questions

    def _evaluate_answer(
        self,
        question: Dict[str, Any],
        answer_text: str,
        context_chunks: List[Dict[str, str]],
    ) -> Dict[str, Any]:
        """Evaluate answer quality and classify mistake type."""
        if not self.openai:
            return {
                "is_correct": True,
                "score": 0.7,
                "feedback": "Answer received. AI evaluation unavailable.",
                "hint": "",
                "mistake_type": "normal",
            }

        context_text = self._format_context(context_chunks, max_chars=2600)
        prompt = (
            "Evaluate this student answer.\n\n"
            f"Question: {question.get('stem', '')}\n"
            f"Expected answer: {question.get('correct_answer', '')}\n"
            f"Student answer: {answer_text}\n"
            f"Question type: {question.get('type', 'open')}\n"
            f"Concept: {question.get('concept_id') or question.get('weak_concept')}\n\n"
            f"Course context:\n{context_text or '(no context)'}\n\n"
            "Return ONLY JSON:\n"
            "{"
            "\"is_correct\": true|false,"
            "\"score\": 0.0 to 1.0,"
            "\"feedback\": \"short constructive feedback\","
            "\"hint\": \"hint if wrong else empty\","
            "\"mistake_type\": \"normal|careless|conceptual\""
            "}\n"
            "Use \"normal\" when correct. If wrong, choose careless only for obvious slip; otherwise conceptual."
        )

        try:
            resp = self.openai.chat.completions.create(
                model="gpt-5.2",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                max_completion_tokens=500,
            )
            raw = resp.choices[0].message.content or "{}"
            parsed = json.loads(raw)
        except Exception as e:
            print(f"[PeerSessionService] AI evaluation failed: {e}")
            parsed = {
                "is_correct": False,
                "score": 0.0,
                "feedback": "Could not evaluate answer. Please try again.",
                "hint": "",
                "mistake_type": "conceptual",
            }

        is_correct = bool(parsed.get("is_correct", False))
        score = _clamp(float(parsed.get("score", 0.0)))
        feedback = str(parsed.get("feedback", "")).strip() or "No feedback returned."
        hint = str(parsed.get("hint", "")).strip()
        mistake_type = str(parsed.get("mistake_type", "normal")).strip().lower()
        if mistake_type not in {"normal", "careless", "conceptual"}:
            mistake_type = "normal" if is_correct else "conceptual"
        if is_correct:
            mistake_type = "normal"

        return {
            "is_correct": is_correct,
            "score": score,
            "feedback": feedback,
            "hint": hint,
            "mistake_type": mistake_type,
        }

    def _load_student_concept_state(self, student_id: str, concept_id: str) -> ConceptState:
        default_state = ConceptState(concept_id=concept_id).normalized()
        if not self.db:
            return default_state

        doc = (
            self.db.collection("students")
            .document(student_id)
            .collection("concept_states")
            .document(concept_id)
            .get()
        )
        if not doc.exists:
            # Initialize from KG node mastery if available.
            try:
                kg_doc = (
                    self.db.collection("knowledge_graphs")
                    .document(f"user_{student_id}")
                    .collection("concepts")
                    .document(concept_id)
                    .get()
                )
                if kg_doc.exists:
                    node = kg_doc.to_dict() or {}
                    default_state.mastery = _clamp(float(node.get("mastery_score", default_state.mastery)))
                    default_state.attempts = int(node.get("attempt_count", default_state.attempts) or 0)
                    default_state.correct = int(node.get("correct_count", default_state.correct) or 0)
                    default_state.careless_count = int(node.get("careless_count", default_state.careless_count) or 0)
                    default_state.last_updated = _parse_dt(node.get("updated_at"), default_state.last_updated)
                    default_state.normalized()
            except Exception:
                pass
            return default_state

        data = doc.to_dict() or {}
        return ConceptState(
            concept_id=concept_id,
            mastery=float(data.get("mastery", default_state.mastery)),
            p_learn=float(data.get("p_learn", default_state.p_learn)),
            p_guess=float(data.get("p_guess", default_state.p_guess)),
            p_slip=float(data.get("p_slip", default_state.p_slip)),
            decay_rate=float(data.get("decay_rate", default_state.decay_rate)),
            last_updated=_parse_dt(data.get("last_updated"), default_state.last_updated),
            attempts=int(data.get("attempts", default_state.attempts) or 0),
            correct=int(data.get("correct", default_state.correct) or 0),
            careless_count=int(data.get("careless_count", default_state.careless_count) or 0),
        ).normalized()

    def _save_student_concept_state(self, student_id: str, state: ConceptState) -> None:
        if not self.db:
            return
        payload = {
            "concept_id": state.concept_id,
            "mastery": state.mastery,
            "p_learn": state.p_learn,
            "p_guess": state.p_guess,
            "p_slip": state.p_slip,
            "decay_rate": state.decay_rate,
            "last_updated": state.last_updated.isoformat(),
            "attempts": state.attempts,
            "correct": state.correct,
            "careless_count": state.careless_count,
        }
        (
            self.db.collection("students")
            .document(student_id)
            .collection("concept_states")
            .document(state.concept_id)
            .set(payload, merge=True)
        )

    def _sync_user_kg_node(
        self,
        student_id: str,
        concept_id: str,
        state: ConceptState,
        mistake_type: str,
        is_correct: bool,
    ) -> None:
        if not self.db:
            return
        concept_ref = (
            self.db.collection("knowledge_graphs")
            .document(f"user_{student_id}")
            .collection("concepts")
            .document(concept_id)
        )
        try:
            node = concept_ref.get().to_dict() or {}
        except Exception:
            node = {}
        title = str(node.get("title") or concept_id.replace("_", " ").title())
        concept_ref.set(
            {
                "title": title,
                "mastery_score": state.mastery,
                "status": "mastered" if state.mastery >= 0.8 else ("learning" if state.mastery >= 0.5 else "weak"),
                "attempt_count": state.attempts,
                "correct_count": state.correct,
                "careless_count": state.careless_count,
                "careless_badge": (mistake_type == "careless" and not is_correct),
                "updated_at": _utc_now().isoformat(),
            },
            merge=True,
        )

    def _update_student_mastery(
        self,
        student_id: str,
        concept_id: str,
        is_correct: bool,
        mistake_type: str,
    ) -> Dict[str, Any]:
        state = self._load_student_concept_state(student_id, concept_id)
        bkt_result = self.adaptive_engine.update_bkt(
            state=state,
            is_correct=is_correct,
            interaction_time=_utc_now(),
            mistake_type=mistake_type,
            careless_penalty=0.02,
        )
        updated_state: ConceptState = bkt_result["state"]  # type: ignore[assignment]
        self._save_student_concept_state(student_id, updated_state)
        self._sync_user_kg_node(student_id, concept_id, updated_state, mistake_type, is_correct)
        return {
            "concept_id": concept_id,
            "updated_mastery": round(updated_state.mastery, 6),
            "mastery_status": bkt_result.get("status", "learning"),
            "mistake_type": mistake_type,
        }

    def create_session(
        self,
        hub_id: str,
        topic: str,
        concept_id: Optional[str],
        member_profiles: List[Dict[str, Any]],
        created_by: str,
    ) -> Dict[str, Any]:
        """Create a new peer session with AI-generated questions."""
        if not self.db:
            return {"error": "Database unavailable"}

        session_id = str(uuid4())[:12]
        normalized_profiles = self._build_member_profiles(member_profiles, created_by)
        questions = self._generate_round_robin_questions(
            member_profiles=normalized_profiles,
            topic=topic,
            selected_concept_id=concept_id,
            created_by=created_by,
        )
        if not questions:
            questions = self._fallback_questions(normalized_profiles, topic, concept_id, [])

        creator_name = created_by
        for m in normalized_profiles:
            if m["student_id"] == created_by:
                creator_name = m.get("name", created_by)
                break

        now = _utc_now()
        session_doc = {
            "session_id": session_id,
            "hub_id": hub_id,
            "topic": topic,
            "selected_concept_id": concept_id,
            "status": "waiting",
            "created_by": created_by,
            "created_at": now.isoformat(),
            "members": [{"student_id": created_by, "name": creator_name, "joined_at": now.isoformat()}],
            "expected_members": max(2, len(normalized_profiles)),
            "questions": questions,
            "current_question_index": 0,
            "answers": [],
        }

        self.db.collection(self.collection).document(session_id).set(session_doc)
        return {"session_id": session_id, "status": "waiting"}

    def join_session(self, session_id: str, student_id: str, name: str) -> Dict[str, Any]:
        """Add a member to an existing session."""
        if not self.db:
            return {"error": "Database unavailable"}

        ref = self.db.collection(self.collection).document(session_id)
        doc = ref.get()
        if not doc.exists:
            return {"error": "Session not found"}

        data = doc.to_dict() or {}
        members = data.get("members", []) or []
        if any(m.get("student_id") == student_id for m in members):
            return {"status": data.get("status", "waiting"), "already_joined": True}

        now = _utc_now()
        members.append({"student_id": student_id, "name": name, "joined_at": now.isoformat()})
        updates: Dict[str, Any] = {"members": members}

        if len(members) >= 2 and data.get("status") == "waiting":
            updates["status"] = "active"

        if not data.get("questions"):
            member_profiles = [
                {"student_id": m.get("student_id"), "name": m.get("name", m.get("student_id")), "concept_profile": {}}
                for m in members
                if m.get("student_id")
            ]
            updates["questions"] = self._fallback_questions(
                member_profiles,
                data.get("topic", "general topic"),
                data.get("selected_concept_id"),
                [],
            )
            updates["current_question_index"] = 0

        ref.update(updates)
        return {"status": updates.get("status", data.get("status", "waiting")), "already_joined": False}

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get full session state."""
        if not self.db:
            return None

        ref = self.db.collection(self.collection).document(session_id)
        doc = ref.get()
        if not doc.exists:
            return None
        data = doc.to_dict() or {}

        if not data.get("questions"):
            members = data.get("members", []) or []
            member_profiles = [
                {"student_id": m.get("student_id"), "name": m.get("name", m.get("student_id")), "concept_profile": {}}
                for m in members
                if m.get("student_id")
            ]
            if member_profiles:
                questions = self._fallback_questions(
                    member_profiles,
                    data.get("topic", "general topic"),
                    data.get("selected_concept_id"),
                    [],
                )
                data["questions"] = questions
                data["current_question_index"] = 0
                ref.update({"questions": questions, "current_question_index": 0})

        return data

    def get_active_session(self, hub_id: str) -> Optional[Dict[str, Any]]:
        """Find an active or waiting session for a hub."""
        if not self.db:
            return None

        for status in ["active", "waiting"]:
            docs = (
                self.db.collection(self.collection)
                .where("hub_id", "==", hub_id)
                .where("status", "==", status)
                .limit(1)
                .stream()
            )
            for doc in docs:
                return doc.to_dict()
        return None

    def submit_answer(
        self,
        session_id: str,
        question_id: str,
        answer_text: str,
        student_id: str,
        concept_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Submit and evaluate an answer for the current question."""
        if not self.db:
            return {"error": "Database unavailable"}

        ref = self.db.collection(self.collection).document(session_id)
        doc = ref.get()
        if not doc.exists:
            return {"error": "Session not found"}

        data = doc.to_dict() or {}
        members = data.get("members", []) or []
        if not any(m.get("student_id") == student_id for m in members):
            return {"error": "You are not a member of this session"}

        question = next((q for q in (data.get("questions", []) or []) if q.get("question_id") == question_id), None)
        if not question:
            return {"error": "Question not found"}

        concept_to_update = str(
            concept_id
            or question.get("concept_id")
            or question.get("weak_concept")
            or data.get("selected_concept_id")
            or data.get("topic")
            or ""
        ).strip()
        if not concept_to_update:
            concept_to_update = "general_topic"

        eval_context = self._fetch_concept_context(student_id, concept_to_update, data.get("topic", concept_to_update), limit=5)
        evaluation = self._evaluate_answer(question, answer_text, eval_context)
        is_correct = bool(evaluation.get("is_correct", False))
        mistake_type = str(evaluation.get("mistake_type", "normal")).strip().lower()
        if mistake_type not in {"normal", "careless", "conceptual"}:
            mistake_type = "normal" if is_correct else "conceptual"
        if is_correct:
            mistake_type = "normal"

        mastery_update = self._update_student_mastery(
            student_id=student_id,
            concept_id=concept_to_update,
            is_correct=is_correct,
            mistake_type=mistake_type,
        )

        answer_entry = {
            "question_id": question_id,
            "submitted_by": student_id,
            "answer_text": answer_text,
            "concept_id": concept_to_update,
            "mistake_type": mistake_type,
            "is_correct": is_correct,
            "score": float(evaluation.get("score", 0.0)),
            "ai_feedback": str(evaluation.get("feedback", "")),
            "hint": str(evaluation.get("hint", "")),
            "updated_mastery": mastery_update.get("updated_mastery"),
            "mastery_status": mastery_update.get("mastery_status"),
            "submitted_at": _utc_now().isoformat(),
        }

        answers = data.get("answers", []) or []
        # One answer per user per question; update if re-submitted.
        replaced = False
        for idx, ans in enumerate(answers):
            if ans.get("question_id") == question_id and ans.get("submitted_by") == student_id:
                answers[idx] = answer_entry
                replaced = True
                break
        if not replaced:
            answers.append(answer_entry)
        ref.update({"answers": answers})

        return {
            "question_id": question_id,
            "submitted_by": student_id,
            "concept_id": concept_to_update,
            "mistake_type": mistake_type,
            "is_correct": is_correct,
            "score": float(evaluation.get("score", 0.0)),
            "ai_feedback": str(evaluation.get("feedback", "")),
            "hint": str(evaluation.get("hint", "")),
            "explanation": question.get("explanation", ""),
            "updated_mastery": mastery_update.get("updated_mastery"),
            "mastery_status": mastery_update.get("mastery_status"),
        }

    def advance_question(self, session_id: str) -> Dict[str, Any]:
        """Move to the next question only after all members answer current one."""
        if not self.db:
            return {"error": "Database unavailable"}

        ref = self.db.collection(self.collection).document(session_id)
        doc = ref.get()
        if not doc.exists:
            return {"error": "Session not found"}

        data = doc.to_dict() or {}
        questions = data.get("questions", []) or []
        members = data.get("members", []) or []
        answers = data.get("answers", []) or []
        if not questions:
            return {"error": "No questions in this session"}

        current = max(0, min(int(data.get("current_question_index", 0)), len(questions) - 1))
        current_qid = str(questions[current].get("question_id"))
        answered_ids = {str(a.get("submitted_by")) for a in answers if a.get("question_id") == current_qid}
        missing = [str(m.get("student_id")) for m in members if str(m.get("student_id")) not in answered_ids]
        if missing:
            return {"error": f"Waiting for answers from: {', '.join(missing)}", "missing_answers": missing}

        next_idx = current + 1
        if next_idx >= len(questions):
            # Do not auto-complete; session ends only via explicit End action.
            ref.update({"current_question_index": current, "status": data.get("status", "active")})
            return {
                "status": data.get("status", "active"),
                "current_question_index": current,
                "at_last_question": True,
            }

        ref.update({"current_question_index": next_idx, "status": "active"})
        return {"status": "active", "current_question_index": next_idx, "at_last_question": False}

    def end_session(self, session_id: str) -> Dict[str, Any]:
        """End a peer session."""
        if not self.db:
            return {"error": "Database unavailable"}

        ref = self.db.collection(self.collection).document(session_id)
        doc = ref.get()
        if not doc.exists:
            return {"error": "Session not found"}

        ref.update({"status": "completed", "ended_at": _utc_now().isoformat()})
        return {"status": "completed"}

    def get_all_active_sessions(self) -> List[Dict[str, Any]]:
        """Get all active or waiting sessions across all hubs."""
        if not self.db:
            return []

        sessions: List[Dict[str, Any]] = []
        for status in ["active", "waiting"]:
            docs = self.db.collection(self.collection).where("status", "==", status).stream()
            for doc in docs:
                data = doc.to_dict() or {}
                sessions.append(
                    {
                        "session_id": data.get("session_id"),
                        "hub_id": data.get("hub_id"),
                        "topic": data.get("topic"),
                        "status": data.get("status"),
                        "created_by": data.get("created_by"),
                        "created_at": data.get("created_at"),
                        "members": data.get("members", []),
                        "expected_members": data.get("expected_members", 0),
                        "question_count": len(data.get("questions", []) or []),
                    }
                )
        return sessions

    def get_hub_session_history(self, hub_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Get completed sessions for a hub."""
        if not self.db:
            return []

        docs = (
            self.db.collection(self.collection)
            .where("hub_id", "==", hub_id)
            .where("status", "==", "completed")
            .limit(limit)
            .stream()
        )
        return [doc.to_dict() for doc in docs]
