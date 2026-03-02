"""
Peer Learning Hub session management.

Handles session lifecycle, WebRTC signaling,
AI task generation (round-robin), and answer evaluation.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from openai import OpenAI


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PeerSessionService:
    """Manages peer learning sessions with WebRTC video and AI-generated tasks."""

    def __init__(self, db, openai_client: Optional[OpenAI] = None):
        self.db = db
        self.openai = openai_client
        self.collection = "peer_sessions"

    # ── AI: Round-Robin Task Generation ───────────────────────────────────

    def _generate_round_robin_questions(
        self,
        member_profiles: List[Dict[str, Any]],
        topic: str,
    ) -> List[Dict[str, Any]]:
        """Use GPT-5.2 to generate one question per member targeting their weakness."""
        if not self.openai:
            return self._fallback_questions(member_profiles, topic)

        # Sort members by average mastery (weakest first for protégé effect)
        def avg_mastery(p: Dict) -> float:
            vals = list(p.get("concept_profile", {}).values())
            return sum(vals) / len(vals) if vals else 0.0

        sorted_members = sorted(member_profiles, key=avg_mastery)

        members_desc = []
        for m in sorted_members:
            profile = m.get("concept_profile", {})
            weakest = sorted(profile.items(), key=lambda x: x[1])[:3]
            weak_str = ", ".join(f"{c}: {v:.0%}" for c, v in weakest) if weakest else "no data"
            members_desc.append(
                f"- {m['name']} (id: {m['student_id']}): weakest concepts = [{weak_str}]"
            )

        prompt = f"""You are generating collaborative learning questions for a peer study group.

Group members and their mastery levels (ordered weakest first):
{chr(10).join(members_desc)}

Topic: {topic}

Generate exactly {len(sorted_members)} questions (one per member), each targeting that member's weakest area.
The first question targets the weakest member (they lead discussion — protégé effect).

For each question, determine the best format:
- "open" for conceptual/theoretical questions
- "code" for programming questions (include expected output)
- "math" for calculation questions
- "mcq" for factual recall (provide 4 options)

Return a JSON array (no markdown, no extra text):
[{{
  "question_id": "q_0",
  "target_member": "<student_id>",
  "target_member_name": "<name>",
  "weak_concept": "<concept they're weak in>",
  "type": "open|code|math|mcq",
  "stem": "<the question>",
  "options": ["A","B","C","D"] or null,
  "correct_answer": "<correct answer text>",
  "explanation": "<why this is correct>"
}}]"""

        try:
            resp = self.openai.chat.completions.create(
                model="gpt-5.2",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                max_completion_tokens=1500,
            )
            raw = resp.choices[0].message.content or "[]"
            parsed = json.loads(raw)
            # Handle both {questions: [...]} and [...] formats
            if isinstance(parsed, dict):
                questions = parsed.get("questions", [])
            else:
                questions = parsed
            return questions if isinstance(questions, list) else []
        except Exception as e:
            print(f"[PeerSessionService] AI question generation failed: {e}")
            return self._fallback_questions(member_profiles, topic)

    def _fallback_questions(
        self, member_profiles: List[Dict[str, Any]], topic: str
    ) -> List[Dict[str, Any]]:
        """Generate simple placeholder questions when AI is unavailable."""
        questions = []
        for i, m in enumerate(member_profiles):
            profile = m.get("concept_profile", {})
            weakest = min(profile.items(), key=lambda x: x[1])[0] if profile else topic
            questions.append({
                "question_id": f"q_{i}",
                "target_member": m["student_id"],
                "target_member_name": m.get("name", m["student_id"]),
                "weak_concept": weakest,
                "type": "open",
                "stem": f"Explain the key concepts of '{weakest}' in your own words. How does it relate to {topic}?",
                "options": None,
                "correct_answer": f"A thorough explanation of {weakest} and its relationship to {topic}.",
                "explanation": f"This question tests understanding of {weakest}.",
            })
        return questions

    # ── AI: Answer Evaluation ─────────────────────────────────────────────

    def _evaluate_answer(
        self,
        question: Dict[str, Any],
        answer_text: str,
    ) -> Dict[str, Any]:
        """Use GPT-5.2 to evaluate a submitted answer."""
        if not self.openai:
            return {
                "is_correct": True,
                "score": 0.7,
                "feedback": "Answer received. AI evaluation unavailable.",
                "hint": "",
            }

        prompt = f"""You are evaluating a student group's answer to a collaborative learning question.

Question: {question.get('stem', '')}
Expected answer: {question.get('correct_answer', '')}
Student's answer: {answer_text}
Question type: {question.get('type', 'open')}

Evaluate whether the answer is correct, partially correct, or incorrect.
For code questions, check logic not just syntax.
For math questions, check the final answer and method.
For open-ended questions, check conceptual accuracy and completeness.

Return JSON (no markdown):
{{
  "is_correct": true or false,
  "score": 0.0 to 1.0,
  "feedback": "<constructive feedback explaining what was right/wrong>",
  "hint": "<if incorrect, a hint without giving away the answer, else empty string>"
}}"""

        try:
            resp = self.openai.chat.completions.create(
                model="gpt-5.2",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                max_completion_tokens=400,
            )
            raw = resp.choices[0].message.content or "{}"
            return json.loads(raw)
        except Exception as e:
            print(f"[PeerSessionService] AI evaluation failed: {e}")
            return {
                "is_correct": False,
                "score": 0.0,
                "feedback": "Could not evaluate answer. Please try again.",
                "hint": "",
            }

    # ── Session CRUD ──────────────────────────────────────────────────────

    def create_session(
        self,
        hub_id: str,
        topic: str,
        member_profiles: List[Dict[str, Any]],
        created_by: str,
    ) -> Dict[str, Any]:
        """Create a new peer session with AI-generated questions."""
        session_id = str(uuid4())[:12]

        # Generate round-robin questions
        questions = self._generate_round_robin_questions(member_profiles, topic)

        # Find creator's name
        creator_name = created_by
        for m in member_profiles:
            if m["student_id"] == created_by:
                creator_name = m.get("name", created_by)
                break

        now = _utc_now()
        session_doc = {
            "session_id": session_id,
            "hub_id": hub_id,
            "topic": topic,
            "status": "waiting",
            "created_by": created_by,
            "created_at": now.isoformat(),
            "members": [
                {"student_id": created_by, "name": creator_name, "joined_at": now.isoformat()}
            ],
            "expected_members": len(member_profiles),
            "questions": questions,
            "current_question_index": 0,
            "answers": [],
        }

        if self.db:
            self.db.collection(self.collection).document(session_id).set(session_doc)

        return {
            "session_id": session_id,
            "status": "waiting",
        }

    def join_session(
        self, session_id: str, student_id: str, name: str
    ) -> Dict[str, Any]:
        """Add a member to an existing session."""
        if not self.db:
            return {"error": "Database unavailable"}

        ref = self.db.collection(self.collection).document(session_id)
        doc = ref.get()
        if not doc.exists:
            return {"error": "Session not found"}

        data = doc.to_dict()
        members = data.get("members", [])

        # Check if already joined
        if any(m["student_id"] == student_id for m in members):
            return {"status": data.get("status", "waiting"), "already_joined": True}

        now = _utc_now()
        members.append({
            "student_id": student_id,
            "name": name,
            "joined_at": now.isoformat(),
        })

        updates: Dict[str, Any] = {"members": members}

        # Auto-activate if enough members joined
        expected = data.get("expected_members", 4)
        if len(members) >= expected and data.get("status") == "waiting":
            updates["status"] = "active"

        ref.update(updates)
        return {"status": updates.get("status", data.get("status", "waiting")), "already_joined": False}

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get full session state."""
        if not self.db:
            return None

        doc = self.db.collection(self.collection).document(session_id).get()
        if not doc.exists:
            return None
        return doc.to_dict()

    def get_active_session(self, hub_id: str) -> Optional[Dict[str, Any]]:
        """Find an active or waiting session for a hub."""
        if not self.db:
            return None

        # Check for active sessions first
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
    ) -> Dict[str, Any]:
        """Submit and evaluate an answer for the current question."""
        if not self.db:
            return {"error": "Database unavailable"}

        ref = self.db.collection(self.collection).document(session_id)
        doc = ref.get()
        if not doc.exists:
            return {"error": "Session not found"}

        data = doc.to_dict()
        questions = data.get("questions", [])

        # Find the target question
        question = None
        for q in questions:
            if q.get("question_id") == question_id:
                question = q
                break

        if not question:
            return {"error": "Question not found"}

        # Evaluate with AI
        evaluation = self._evaluate_answer(question, answer_text)

        answer_entry = {
            "question_id": question_id,
            "submitted_by": student_id,
            "answer_text": answer_text,
            "is_correct": evaluation.get("is_correct", False),
            "score": evaluation.get("score", 0.0),
            "ai_feedback": evaluation.get("feedback", ""),
            "hint": evaluation.get("hint", ""),
        }

        answers = data.get("answers", [])
        answers.append(answer_entry)
        ref.update({"answers": answers})

        return {
            "question_id": question_id,
            "is_correct": evaluation.get("is_correct", False),
            "score": evaluation.get("score", 0.0),
            "ai_feedback": evaluation.get("feedback", ""),
            "hint": evaluation.get("hint", ""),
            "explanation": question.get("explanation", ""),
        }

    def advance_question(self, session_id: str) -> Dict[str, Any]:
        """Move to the next question in the round-robin."""
        if not self.db:
            return {"error": "Database unavailable"}

        ref = self.db.collection(self.collection).document(session_id)
        doc = ref.get()
        if not doc.exists:
            return {"error": "Session not found"}

        data = doc.to_dict()
        current = data.get("current_question_index", 0)
        total = len(data.get("questions", []))
        next_idx = current + 1

        if next_idx >= total:
            ref.update({"status": "completed", "current_question_index": next_idx})
            return {"status": "completed", "current_question_index": next_idx}

        ref.update({"current_question_index": next_idx})
        return {"status": "active", "current_question_index": next_idx}

    def end_session(self, session_id: str) -> Dict[str, Any]:
        """End a peer session."""
        if not self.db:
            return {"error": "Database unavailable"}

        ref = self.db.collection(self.collection).document(session_id)
        doc = ref.get()
        if not doc.exists:
            return {"error": "Session not found"}

        ref.update({"status": "completed"})
        return {"status": "completed"}

    def get_hub_session_history(self, hub_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Get completed sessions for a hub (for metrics)."""
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
