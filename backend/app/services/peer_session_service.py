
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


def _humanize_key(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    normalized = raw.replace("-", " ").replace("_", " ")
    return " ".join(part.capitalize() for part in normalized.split())


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


def _status_from_mastery(mastery: float) -> str:
    if mastery >= 0.8:
        return "mastered"
    if mastery >= 0.5:
        return "learning"
    if mastery > 0:
        return "weak"
    return "not_started"


class PeerSessionService:
    """Manages peer learning sessions with AI-generated collaborative tasks."""

    def __init__(self, db, openai_client: Optional[OpenAI] = None):
        self.db = db
        self.openai = openai_client
        self.collection = "peer_sessions"
        self.knowledge_chunks_collection = os.getenv("FIREBASE_KNOWLEDGE_CHUNKS_COLLECTION", "knowledge_chunks")
        self.adaptive_engine = AdaptiveEngine()

    def _list_user_courses(self, user_id: str) -> List[Dict[str, str]]:
        if not self.db or not user_id:
            return []
        try:
            docs = (
                self.db.collection("users")
                .document(user_id)
                .collection("courses")
                .stream()
            )
            courses: List[Dict[str, str]] = []
            for doc in docs:
                row = doc.to_dict() or {}
                cid = str(row.get("id") or doc.id or "").strip()
                cname = str(row.get("name") or cid).strip()
                if cid:
                    courses.append({"id": cid, "name": cname})
            courses.sort(key=lambda c: c.get("name", "").lower())
            return courses
        except Exception:
            return []

    def _build_member_profiles_from_session(self, data: Dict[str, Any]) -> List[Dict[str, Any]]:
        by_id: Dict[str, Dict[str, Any]] = {}
        for raw in (data.get("member_profiles", []) or []):
            sid = str(raw.get("student_id", "")).strip()
            if not sid:
                continue
            by_id[sid] = {
                "student_id": sid,
                "name": str(raw.get("name", sid)),
                "concept_profile": dict(raw.get("concept_profile", {}) or {}),
            }
        for m in (data.get("members", []) or []):
            sid = str(m.get("student_id", "")).strip()
            if not sid:
                continue
            if sid not in by_id:
                by_id[sid] = {
                    "student_id": sid,
                    "name": str(m.get("name", sid)),
                    "concept_profile": {},
                }
            elif not by_id[sid].get("name"):
                by_id[sid]["name"] = str(m.get("name", sid))
        return list(by_id.values())

    @staticmethod
    def _assign_question_ids(questions: List[Dict[str, Any]], start_index: int) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for idx, q in enumerate(questions):
            row = dict(q)
            row["question_id"] = f"q_{start_index + idx}"
            out.append(row)
        return out

    def _resolve_session_seed(
        self,
        user_id: str,
        topic: str,
        concept_id: Optional[str],
        course_id: Optional[str],
        course_name: Optional[str],
    ) -> Dict[str, Any]:
        topic = str(topic or "").strip()
        concept_id = str(concept_id or "").strip() or None
        course_id = str(course_id or "").strip() or None
        course_name = str(course_name or "").strip() or None

        if not self.db or not user_id:
            return {
                "topic": topic or _humanize_key(concept_id or "") or "General Study",
                "concept_id": concept_id,
                "course_id": course_id,
                "course_name": course_name,
                "chunk_count": 0,
            }

        courses = self._list_user_courses(user_id)
        by_course_name = {str(c.get("name", "")).strip().lower(): c for c in courses if c.get("name")}
        if not course_id and course_name:
            matched = by_course_name.get(course_name.lower())
            if matched:
                course_id = matched.get("id")

        col = self.db.collection(self.knowledge_chunks_collection)
        try:
            max_scan_cfg = int(os.getenv("FIREBASE_MAX_CHUNKS_SCAN", "300"))
        except ValueError:
            max_scan_cfg = 300
        max_scan = max(50, max_scan_cfg)
        chunk_rows: List[Dict[str, Any]] = []
        try:
            docs = col.where("userId", "==", user_id).limit(max_scan).stream()
            for doc in docs:
                row = doc.to_dict() or {}
                text = str(row.get("text", "")).strip()
                if not text:
                    continue
                row["text"] = text
                chunk_rows.append(row)
        except Exception:
            chunk_rows = []

        if not chunk_rows:
            return {
                "topic": topic or _humanize_key(concept_id or "") or "General Study",
                "concept_id": concept_id,
                "course_id": course_id,
                "course_name": course_name,
                "chunk_count": 0,
            }

        course_counts: Dict[str, int] = {}
        for row in chunk_rows:
            cid = str(row.get("course_id") or "").strip()
            if cid:
                course_counts[cid] = course_counts.get(cid, 0) + 1

        if not course_id and course_counts:
            course_id = max(course_counts, key=course_counts.get)
        if course_id and not course_name:
            for c in courses:
                if c.get("id") == course_id:
                    course_name = str(c.get("name") or "").strip() or course_name
                    break
            if not course_name:
                for row in chunk_rows:
                    if str(row.get("course_id") or "").strip() == course_id:
                        maybe_name = str(row.get("course_name") or "").strip()
                        if maybe_name:
                            course_name = maybe_name
                            break

        scoped_rows = chunk_rows
        if course_id:
            scoped_rows = [row for row in chunk_rows if str(row.get("course_id") or "").strip() == course_id]

        concept_counts: Dict[str, int] = {}
        for row in scoped_rows:
            cid = _normalize_key(str(row.get("concept_id") or ""))
            if cid:
                concept_counts[cid] = concept_counts.get(cid, 0) + 1
        if not concept_id and concept_counts:
            concept_id = max(concept_counts, key=concept_counts.get)

        if not topic:
            if concept_id:
                topic = _humanize_key(concept_id)
            elif course_name:
                topic = course_name
            elif course_id:
                topic = _humanize_key(course_id)
            else:
                topic = "General Study"

        return {
            "topic": topic,
            "concept_id": concept_id,
            "course_id": course_id,
            "course_name": course_name,
            "chunk_count": len(scoped_rows) if course_id else len(chunk_rows),
        }

    def _fetch_concept_context(
        self,
        user_id: str,
        concept_id: Optional[str],
        topic: str,
        limit: int = 8,
        course_id: Optional[str] = None,
        course_name: Optional[str] = None,
    ) -> List[Dict[str, str]]:
        """Retrieve context chunks from Firestore, scoped by user, concept, and optional course."""
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

        course_id = str(course_id or "").strip() or None
        course_name = str(course_name or "").strip().lower() or None
        rows: List[Dict[str, str]] = []
        seen: set[str] = set()
        try:
            max_scan_cfg = int(os.getenv("FIREBASE_MAX_CHUNKS_SCAN", "300"))
        except ValueError:
            max_scan_cfg = 300
        max_scan = max(50, max_scan_cfg)

        scanned_rows: List[Dict[str, Any]] = []
        try:
            docs = col.where("userId", "==", user_id).limit(max_scan).stream()
            for doc in docs:
                row = doc.to_dict() or {}
                text = str(row.get("text", "")).strip()
                if not text:
                    continue
                row["text"] = text
                if course_id and str(row.get("course_id") or "").strip() != course_id:
                    continue
                if course_name:
                    row_course_name = str(row.get("course_name") or "").strip().lower()
                    if row_course_name and row_course_name != course_name:
                        continue
                scanned_rows.append(row)
        except Exception:
            scanned_rows = []

        # First pass: exact concept-id matches.
        for row in scanned_rows:
            cid = _normalize_key(str(row.get("concept_id") or ""))
            if cid not in concept_candidates:
                continue
            key = f"{cid}:{hash(row.get('text', ''))}"
            if key in seen:
                continue
            seen.add(key)
            rows.append(
                {
                    "text": str(row.get("text", "")),
                    "concept_id": str(row.get("concept_id", cid)),
                    "source": str(row.get("source", "")),
                }
            )
            if len(rows) >= limit:
                return rows

        # Second pass: topic overlap ranking.
        scored: List[tuple[float, Dict[str, str]]] = []
        for row in scanned_rows:
            text = str(row.get("text", ""))
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
        course_id: Optional[str] = None,
        course_name: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Generate one question per member, grounded by concept-tagged chunks."""
        context_chunks = self._fetch_concept_context(
            created_by,
            selected_concept_id,
            topic,
            limit=8,
            course_id=course_id,
            course_name=course_name,
        )
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
            f"Course id: {course_id or 'n/a'}\n"
            f"Course name: {course_name or 'n/a'}\n"
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

    @staticmethod
    def _compute_boss_damage(score: float, is_correct: bool, mistake_type: str) -> float:
        """
        Shared boss HP damage from one answer.
        Incorrect answers deal no damage.
        Correct answers deal reduced, score-proportional damage.
        """
        s = _clamp(float(score))
        if not is_correct:
            return 0.0
        # Max 20 HP at perfect score, linearly scaled by AI score.
        return round(s * 20.0, 2)

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
                "status": _status_from_mastery(state.mastery),
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
        course_id: Optional[str],
        course_name: Optional[str],
        member_profiles: List[Dict[str, Any]],
        created_by: str,
    ) -> Dict[str, Any]:
        """Create a new peer session with AI-generated questions."""
        if not self.db:
            return {"error": "Database unavailable"}

        seed = self._resolve_session_seed(
            user_id=created_by,
            topic=topic,
            concept_id=concept_id,
            course_id=course_id,
            course_name=course_name,
        )
        resolved_topic = str(seed.get("topic") or "").strip()
        resolved_concept_id = str(seed.get("concept_id") or "").strip() or None
        resolved_course_id = str(seed.get("course_id") or "").strip() or None
        resolved_course_name = str(seed.get("course_name") or "").strip() or None
        if int(seed.get("chunk_count", 0) or 0) <= 0:
            return {
                "error": (
                    "No uploaded material found in knowledge_chunks"
                    + (f" for course '{resolved_course_name or resolved_course_id}'" if (resolved_course_id or resolved_course_name) else "")
                    + ". Upload documents first."
                )
            }

        session_id = str(uuid4())[:12]
        normalized_profiles = self._build_member_profiles(member_profiles, created_by)
        questions = self._generate_round_robin_questions(
            member_profiles=normalized_profiles,
            topic=resolved_topic,
            selected_concept_id=resolved_concept_id,
            created_by=created_by,
            course_id=resolved_course_id,
            course_name=resolved_course_name,
        )
        if not questions:
            questions = self._fallback_questions(normalized_profiles, resolved_topic, resolved_concept_id, [])
        questions = self._assign_question_ids(questions, start_index=0)

        creator_name = created_by
        for m in normalized_profiles:
            if m["student_id"] == created_by:
                creator_name = m.get("name", created_by)
                break

        now = _utc_now()
        total_expected_answers = max(1, max(2, len(normalized_profiles)) * max(1, len(questions)))
        boss_health_max = float(max(80.0, min(500.0, total_expected_answers * 22.0)))
        session_doc = {
            "session_id": session_id,
            "hub_id": hub_id,
            "topic": resolved_topic,
            "selected_concept_id": resolved_concept_id,
            "course_id": resolved_course_id,
            "course_name": resolved_course_name,
            "boss_name": "Knowledge Warden",
            "boss_health_max": boss_health_max,
            "boss_health_current": boss_health_max,
            "boss_defeated": False,
            "status": "waiting",
            "created_by": created_by,
            "created_at": now.isoformat(),
            "members": [{"student_id": created_by, "name": creator_name, "joined_at": now.isoformat()}],
            "member_profiles": normalized_profiles,
            "expected_members": max(2, len(normalized_profiles)),
            "questions": questions,
            "current_question_index": 0,
            "round_index": 1,
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

        member_profiles = self._build_member_profiles_from_session(data)
        if not any(p.get("student_id") == student_id for p in member_profiles):
            member_profiles.append({"student_id": student_id, "name": name, "concept_profile": {}})
        updates["member_profiles"] = member_profiles

        if len(members) >= 2 and data.get("status") == "waiting":
            updates["status"] = "active"

        if not data.get("questions"):
            fresh_questions = self._fallback_questions(
                member_profiles,
                data.get("topic", "general topic"),
                data.get("selected_concept_id"),
                [],
            )
            updates["questions"] = self._assign_question_ids(fresh_questions, start_index=0)
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

        if "member_profiles" not in data:
            profiles = self._build_member_profiles_from_session(data)
            data["member_profiles"] = profiles
            ref.update({"member_profiles": profiles})

        if not data.get("questions"):
            member_profiles = self._build_member_profiles_from_session(data)
            if member_profiles:
                questions = self._assign_question_ids(
                    self._fallback_questions(
                        member_profiles,
                        data.get("topic", "general topic"),
                        data.get("selected_concept_id"),
                        [],
                    ),
                    start_index=0,
                )
                data["questions"] = questions
                data["current_question_index"] = 0
                ref.update({"questions": questions, "current_question_index": 0})

        # Backfill IDs for legacy sessions that may have duplicates.
        questions = data.get("questions", []) or []
        expected_ids = [f"q_{idx}" for idx in range(len(questions))]
        actual_ids = [str(q.get("question_id", "")) for q in questions]
        if actual_ids != expected_ids and questions:
            questions = self._assign_question_ids(questions, start_index=0)
            data["questions"] = questions
            current_idx = max(0, min(int(data.get("current_question_index", 0)), len(questions) - 1))
            data["current_question_index"] = current_idx
            ref.update({"questions": questions, "current_question_index": current_idx})

        # Backfill course metadata for legacy sessions.
        if "course_id" not in data or "course_name" not in data:
            seed = self._resolve_session_seed(
                user_id=str(data.get("created_by") or ""),
                topic=str(data.get("topic") or ""),
                concept_id=data.get("selected_concept_id"),
                course_id=data.get("course_id"),
                course_name=data.get("course_name"),
            )
            data["course_id"] = str(seed.get("course_id") or "").strip() or None
            data["course_name"] = str(seed.get("course_name") or "").strip() or None
            ref.update({"course_id": data["course_id"], "course_name": data["course_name"]})

        # Backfill boss state for legacy sessions.
        if "boss_health_max" not in data or "boss_health_current" not in data:
            members = data.get("members", []) or []
            total_expected_answers = max(1, max(2, len(members)) * max(1, len(data.get("questions", []) or [])))
            boss_health_max = float(max(80.0, min(500.0, total_expected_answers * 22.0)))
            boss_health_current = float(data.get("boss_health_current", boss_health_max) or boss_health_max)
            boss_defeated = boss_health_current <= 0
            data["boss_name"] = data.get("boss_name", "Knowledge Warden")
            data["boss_health_max"] = boss_health_max
            data["boss_health_current"] = min(boss_health_current, boss_health_max)
            data["boss_defeated"] = boss_defeated
            ref.update(
                {
                    "boss_name": data["boss_name"],
                    "boss_health_max": data["boss_health_max"],
                    "boss_health_current": data["boss_health_current"],
                    "boss_defeated": data["boss_defeated"],
                }
            )

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

        answers = data.get("answers", []) or []
        existing_answer = next(
            (
                a for a in answers
                if a.get("question_id") == question_id and a.get("submitted_by") == student_id
            ),
            None,
        )
        if existing_answer:
            return {
                "question_id": question_id,
                "submitted_by": student_id,
                "concept_id": str(existing_answer.get("concept_id", "")),
                "mistake_type": str(existing_answer.get("mistake_type", "normal")),
                "is_correct": bool(existing_answer.get("is_correct", False)),
                "score": float(existing_answer.get("score", 0.0)),
                "ai_feedback": str(existing_answer.get("ai_feedback", "")),
                "hint": str(existing_answer.get("hint", "")),
                "explanation": question.get("explanation", ""),
                "damage_dealt": float(existing_answer.get("damage_dealt", 0.0)),
                "boss_health_max": float(data.get("boss_health_max", 0.0) or 0.0),
                "boss_health_current": float(data.get("boss_health_current", 0.0) or 0.0),
                "boss_defeated": bool(data.get("boss_defeated", False)),
                "already_submitted": True,
                "updated_mastery": existing_answer.get("updated_mastery"),
                "mastery_status": existing_answer.get("mastery_status"),
            }

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

        eval_context = self._fetch_concept_context(
            student_id,
            concept_to_update,
            data.get("topic", concept_to_update),
            limit=5,
            course_id=data.get("course_id"),
            course_name=data.get("course_name"),
        )
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

        damage_dealt = self._compute_boss_damage(float(evaluation.get("score", 0.0)), is_correct, mistake_type)
        boss_health_max = float(data.get("boss_health_max", 0.0) or 0.0)
        if boss_health_max <= 0:
            total_expected_answers = max(1, max(2, len(members)) * max(1, len(data.get("questions", []) or [])))
            boss_health_max = float(max(80.0, min(500.0, total_expected_answers * 22.0)))
        boss_health_current = float(data.get("boss_health_current", boss_health_max) or boss_health_max)
        boss_health_current = round(max(0.0, boss_health_current - damage_dealt), 2)
        boss_defeated = boss_health_current <= 0.0

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
            "damage_dealt": damage_dealt,
            "updated_mastery": mastery_update.get("updated_mastery"),
            "mastery_status": mastery_update.get("mastery_status"),
            "submitted_at": _utc_now().isoformat(),
        }

        answers.append(answer_entry)
        ref.update(
            {
                "answers": answers,
                "boss_health_max": boss_health_max,
                "boss_health_current": boss_health_current,
                "boss_defeated": boss_defeated,
                "last_boss_event": {
                    "question_id": question_id,
                    "attacker": student_id,
                    "damage_dealt": damage_dealt,
                    "is_correct": is_correct,
                    "mistake_type": mistake_type,
                    "health_after": boss_health_current,
                    "timestamp": _utc_now().isoformat(),
                },
            }
        )

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
            "damage_dealt": damage_dealt,
            "boss_health_max": boss_health_max,
            "boss_health_current": boss_health_current,
            "boss_defeated": boss_defeated,
            "already_submitted": False,
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
        if next_idx < len(questions):
            ref.update({"current_question_index": next_idx, "status": "active"})
            return {
                "status": "active",
                "current_question_index": next_idx,
                "at_last_question": False,
                "boss_defeated": bool(data.get("boss_defeated", False)),
            }

        # End of current queue. If boss still alive, generate another round.
        if bool(data.get("boss_defeated", False)):
            ref.update({"current_question_index": current, "status": data.get("status", "active")})
            return {
                "status": data.get("status", "active"),
                "current_question_index": current,
                "at_last_question": True,
                "boss_defeated": True,
            }

        member_profiles = self._build_member_profiles_from_session(data)
        if not member_profiles:
            return {"error": "Cannot generate next round: no member profiles available"}

        created_by = str(data.get("created_by") or "")
        topic = str(data.get("topic") or "general topic")
        selected_concept_id = data.get("selected_concept_id")
        course_id = data.get("course_id")
        course_name = data.get("course_name")

        new_questions = self._generate_round_robin_questions(
            member_profiles=member_profiles,
            topic=topic,
            selected_concept_id=selected_concept_id,
            created_by=created_by,
            course_id=course_id,
            course_name=course_name,
        )
        if not new_questions:
            context_chunks = self._fetch_concept_context(
                created_by,
                selected_concept_id,
                topic,
                limit=8,
                course_id=course_id,
                course_name=course_name,
            )
            new_questions = self._fallback_questions(
                member_profiles,
                topic,
                selected_concept_id,
                context_chunks,
            )
        if not new_questions:
            return {"error": "Failed to generate next round of questions"}

        start_idx = len(questions)
        appended = self._assign_question_ids(new_questions, start_index=start_idx)
        questions.extend(appended)
        round_index = max(1, int(data.get("round_index", 1) or 1)) + 1
        ref.update(
            {
                "questions": questions,
                "current_question_index": next_idx,
                "status": "active",
                "member_profiles": member_profiles,
                "round_index": round_index,
            }
        )
        return {
            "status": "active",
            "current_question_index": next_idx,
            "at_last_question": False,
            "boss_defeated": False,
            "generated_new_round": True,
            "round_index": round_index,
        }

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
                        "course_id": data.get("course_id"),
                        "course_name": data.get("course_name"),
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
