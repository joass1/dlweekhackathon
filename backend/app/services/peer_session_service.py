
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
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from openai import OpenAI

from app.services.adaptive_engine import AdaptiveEngine, ConceptState

LEVEL_TO_BOSS_CHARACTER: Dict[int, str] = {
    1: "punk",
    2: "spacesuit",
    3: "swat",
    4: "suit",
}

BOSS_NAME_BY_CHARACTER: Dict[str, str] = {
    "punk": "Syllabus Rebel",
    "spacesuit": "Cosmic Professor",
    "swat": "Curriculum Enforcer",
    "suit": "Dean of Mastery",
}

BOSS_HEALTH_OVERRIDES: Dict[str, float] = {
    "suit": 120.0,
}

TEAM_HP_PER_LEVEL: Dict[int, float] = {
    1: 0.0,
    2: 160.0,
    3: 150.0,
    4: 140.0,
}

QUESTION_TIME_LIMIT_SEC_BY_LEVEL: Dict[int, int] = {
    3: 120,
    4: 120,
}

MIN_DEFENSE_SCORE = 0.7
MCQ_MAX_OPTIONS = 6
MCQ_MIN_OPTIONS = 2


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _to_float(value: Any, default: float) -> float:
    if value is None or isinstance(value, bool):
        return float(default)
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


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
    if mastery >= 0.85:
        return "mastered"
    if mastery >= 0.6:
        return "learning"
    if mastery > 0:
        return "weak"
    return "not_started"


def _normalize_level(value: Any, default: int = 1) -> int:
    try:
        level = int(value)
    except (TypeError, ValueError):
        return default
    if level < 1 or level > 4:
        return default
    return level


def _looks_like_student_id(value: Any) -> bool:
    text = str(value or "").strip()
    if not text:
        return True
    if " " in text:
        return False
    return bool(re.fullmatch(r"[A-Za-z0-9_-]{20,}", text))


def _name_from_email(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    if not text or "@" not in text:
        return None
    local = text.split("@", 1)[0].strip()
    if not local:
        return None
    friendly = local.replace(".", " ").replace("_", " ").replace("-", " ").strip()
    return friendly or local


def _contains_latex_markup(value: Any) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    return bool(
        re.search(
            r"\$[^$]+\$|\\\(|\\\[|\\frac|\\sqrt|\\sum|\\int|\\theta|\\alpha|\\beta|\\gamma",
            text,
            flags=re.IGNORECASE,
        )
    )


def _latexify_math_text(value: Any) -> str:
    text = str(value or "").strip()
    if not text or _contains_latex_markup(text):
        return text

    # If the whole value is a compact expression, wrap directly.
    if len(text) <= 96 and re.search(r"[=+\-*/^]|(?:\b(?:sin|cos|tan|log|ln|sqrt|pi)\b)", text, flags=re.IGNORECASE):
        return f"${text}$"

    # Otherwise wrap inline expression segments only.
    expr_re = re.compile(r"(?<!\$)([A-Za-z0-9\)\]]+\s*(?:[=+\-*/^]\s*[A-Za-z0-9\(\[]+){1,})")
    converted = expr_re.sub(lambda m: f"${m.group(1).strip()}$", text)
    return converted


def _is_placeholder_choice(value: Any) -> bool:
    text = str(value or "").strip()
    if not text:
        return True
    return bool(
        re.fullmatch(
            r"(?i)(?:option|choice)?\s*[\(\[]?\s*(?:[a-z]|[1-9])\s*[\)\].:\-]?",
            text,
        )
    )


def _strip_choice_label(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""

    # Handles "A) Foo", "(B) Bar", "1. Baz", and label-only forms like "A."
    punct = re.match(r"(?i)^\s*[\(\[]?([a-z]|[1-9])[\)\].:\-]\s*(.*)$", text)
    if punct:
        remainder = punct.group(2).strip()
        return remainder if remainder else punct.group(1).strip()

    # Handles "A Foo" while avoiding accidental stripping of words like "Apple".
    spaced = re.match(r"(?i)^\s*([a-z]|[1-9])\s+(.+)$", text)
    if spaced:
        return spaced.group(2).strip()

    return text


def _extract_choice_index(value: Any) -> Optional[int]:
    text = str(value or "").strip()
    if not text:
        return None
    match = re.match(r"(?i)^\s*(?:option|choice)?\s*([a-z]|[1-9])(?:\b|[\)\].:\-])", text)
    if not match:
        if re.fullmatch(r"(?i)[a-z]|[1-9]", text):
            match = re.match(r"(?i)^([a-z]|[1-9])$", text)
        else:
            return None
    token = match.group(1).upper()
    if token.isdigit():
        return int(token) - 1
    return ord(token) - ord("A")


def _boss_character_for_level(level: int) -> str:
    return LEVEL_TO_BOSS_CHARACTER.get(level, LEVEL_TO_BOSS_CHARACTER[1])


def _boss_name_for_character(character_id: str) -> str:
    return BOSS_NAME_BY_CHARACTER.get(character_id, "Knowledge Warden")


class PeerSessionService:
    """Manages peer learning sessions with AI-generated collaborative tasks."""

    def __init__(self, db, openai_client: Optional[OpenAI] = None):
        self.db = db
        self.openai = openai_client
        self.collection = "peer_sessions"
        self.knowledge_chunks_collection = os.getenv("FIREBASE_KNOWLEDGE_CHUNKS_COLLECTION", "knowledge_chunks")
        self.adaptive_engine = AdaptiveEngine()
        self._display_name_cache: Dict[str, str] = {}
        self._concept_id_cache: Dict[Tuple[str, str], str] = {}
        self._concept_presence_cache: Dict[Tuple[str, str], bool] = {}

    def _resolve_display_name(self, student_id: str) -> Optional[str]:
        sid = str(student_id or "").strip()
        if not sid:
            return None
        cached = self._display_name_cache.get(sid)
        if cached:
            return cached
        if not self.db:
            return None

        candidate_fields = ("displayName", "name", "username", "full_name", "fullName", "nickname")

        doc_sources = [
            ("users", sid),
            ("students", sid),
        ]
        for collection_name, doc_id in doc_sources:
            try:
                doc = self.db.collection(collection_name).document(doc_id).get()
                if not doc.exists:
                    continue
                row = doc.to_dict() or {}
            except Exception:
                continue

            for field in candidate_fields:
                val = str(row.get(field) or "").strip()
                if val and val != sid and not _looks_like_student_id(val):
                    self._display_name_cache[sid] = val
                    return val

            email_guess = _name_from_email(row.get("email"))
            if email_guess and not _looks_like_student_id(email_guess):
                self._display_name_cache[sid] = email_guess
                return email_guess

        return None

    def _clean_member_name(self, student_id: str, name: Any, fallback_label: str = "Teammate") -> str:
        sid = str(student_id or "").strip()
        raw = str(name or "").strip()
        if raw and raw != sid and not _looks_like_student_id(raw):
            return raw
        resolved = self._resolve_display_name(sid)
        if resolved and resolved != sid and not _looks_like_student_id(resolved):
            return resolved
        email_guess = _name_from_email(raw)
        if email_guess and not _looks_like_student_id(email_guess):
            return email_guess
        return fallback_label

    def _normalize_session_member_names(self, data: Dict[str, Any]) -> tuple[bool, Dict[str, str]]:
        changed = False
        name_by_id: Dict[str, str] = {}

        members = data.get("members", []) or []
        if isinstance(members, list):
            next_members: List[Dict[str, Any]] = []
            for idx, raw_member in enumerate(members, start=1):
                if not isinstance(raw_member, dict):
                    continue
                sid = str(raw_member.get("student_id") or "").strip()
                if not sid:
                    continue
                fallback_label = "Host" if sid == str(data.get("created_by") or "").strip() else f"Teammate {idx}"
                cleaned_name = self._clean_member_name(sid, raw_member.get("name"), fallback_label=fallback_label)
                next_member = dict(raw_member)
                if str(next_member.get("name") or "") != cleaned_name:
                    next_member["name"] = cleaned_name
                    changed = True
                name_by_id[sid] = cleaned_name
                next_members.append(next_member)
            if next_members != members:
                data["members"] = next_members
                changed = True

        member_profiles = data.get("member_profiles", []) or []
        if isinstance(member_profiles, list):
            next_profiles: List[Dict[str, Any]] = []
            for idx, raw_profile in enumerate(member_profiles, start=1):
                if not isinstance(raw_profile, dict):
                    continue
                sid = str(raw_profile.get("student_id") or "").strip()
                if not sid:
                    continue
                fallback_label = name_by_id.get(sid) or f"Teammate {idx}"
                cleaned_name = name_by_id.get(sid) or self._clean_member_name(sid, raw_profile.get("name"), fallback_label=fallback_label)
                if sid not in name_by_id:
                    name_by_id[sid] = cleaned_name
                next_profile = dict(raw_profile)
                if str(next_profile.get("name") or "") != cleaned_name:
                    next_profile["name"] = cleaned_name
                    changed = True
                next_profiles.append(next_profile)
            if next_profiles != member_profiles:
                data["member_profiles"] = next_profiles
                changed = True

        questions = data.get("questions", []) or []
        if isinstance(questions, list):
            next_questions: List[Dict[str, Any]] = []
            questions_changed = False
            for raw_q in questions:
                if not isinstance(raw_q, dict):
                    continue
                q = dict(raw_q)
                target_member = str(q.get("target_member") or "").strip()
                if target_member:
                    fallback_label = "Teammate"
                    cleaned_name = name_by_id.get(target_member) or self._clean_member_name(
                        target_member,
                        q.get("target_member_name"),
                        fallback_label=fallback_label,
                    )
                    if target_member not in name_by_id:
                        name_by_id[target_member] = cleaned_name
                    if str(q.get("target_member_name") or "") != cleaned_name:
                        q["target_member_name"] = cleaned_name
                        questions_changed = True
                next_questions.append(q)
            if questions_changed:
                data["questions"] = next_questions
                changed = True

        return changed, name_by_id

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

    @staticmethod
    def _normalize_mcq_options(raw_options: Any) -> Optional[List[str]]:
        if not isinstance(raw_options, list):
            return None

        cleaned: List[str] = []
        seen: set[str] = set()
        for raw in raw_options:
            option = _strip_choice_label(raw)
            if not option:
                continue
            key = option.casefold()
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(option)

        if len(cleaned) < MCQ_MIN_OPTIONS:
            return None

        meaningful = [opt for opt in cleaned if not _is_placeholder_choice(opt)]
        if len(meaningful) < MCQ_MIN_OPTIONS:
            return None
        if len(meaningful) != len(cleaned):
            cleaned = meaningful
            if len(cleaned) < MCQ_MIN_OPTIONS:
                return None

        return cleaned[:MCQ_MAX_OPTIONS]

    @staticmethod
    def _normalize_mcq_correct_answer(correct_answer: Any, options: List[str]) -> str:
        if not options:
            return str(correct_answer or "").strip()

        raw = str(correct_answer or "").strip()
        if not raw:
            return options[0]

        raw_fold = raw.casefold()
        for opt in options:
            if opt.casefold() == raw_fold:
                return opt

        stripped = _strip_choice_label(raw)
        if stripped:
            stripped_fold = stripped.casefold()
            for opt in options:
                if opt.casefold() == stripped_fold:
                    return opt

        idx = _extract_choice_index(raw)
        if idx is not None and 0 <= idx < len(options):
            return options[idx]

        if _is_placeholder_choice(raw):
            return options[0]

        return stripped or raw

    @staticmethod
    def _sanitize_existing_question(question: Dict[str, Any]) -> tuple[Dict[str, Any], bool]:
        row = dict(question or {})
        changed = False

        q_type = str(row.get("type") or "open").strip().lower()
        if q_type not in {"open", "code", "math", "mcq"}:
            q_type = "open"
            changed = True
        row["type"] = q_type

        concept_id = str(row.get("concept_id") or row.get("weak_concept") or "this concept").strip() or "this concept"
        explanation = str(row.get("explanation") or "").strip()

        stem = str(row.get("stem") or "").strip()
        if not stem:
            row["stem"] = f"Explain the core idea of {concept_id}."
            changed = True

        answer = str(row.get("correct_answer") or "").strip()
        if q_type == "mcq":
            options = PeerSessionService._normalize_mcq_options(row.get("options"))
            if not options:
                row["type"] = "open"
                row["options"] = None
                replacement = answer
                if not replacement or _is_placeholder_choice(replacement):
                    replacement = explanation or f"A complete, context-grounded answer about {concept_id}."
                if replacement != answer:
                    row["correct_answer"] = replacement
                changed = True
            else:
                if row.get("options") != options:
                    row["options"] = options
                    changed = True
                normalized_answer = PeerSessionService._normalize_mcq_correct_answer(answer, options)
                if normalized_answer != answer:
                    row["correct_answer"] = normalized_answer
                    changed = True
        else:
            if row.get("options") is not None:
                row["options"] = None
                changed = True
            if not answer:
                row["correct_answer"] = explanation or f"A complete, context-grounded answer about {concept_id}."
                changed = True

        if row.get("type") == "math":
            math_fields = ("stem", "correct_answer", "explanation")
            for field in math_fields:
                original = str(row.get(field) or "")
                converted = _latexify_math_text(original)
                if converted != original:
                    row[field] = converted
                    changed = True

        return row, changed

    @staticmethod
    def _topic_matches_for_progression(
        session_row: Dict[str, Any],
        topic: str,
        concept_id: Optional[str],
    ) -> bool:
        req_concept = _normalize_key(concept_id or "")
        req_topic = _normalize_key(topic or "")
        ses_concept = _normalize_key(str(session_row.get("selected_concept_id") or ""))
        ses_topic = _normalize_key(str(session_row.get("topic") or ""))

        if req_concept:
            if ses_concept == req_concept:
                return True
            if not ses_concept and req_topic and ses_topic == req_topic:
                return True
            return False

        return bool(req_topic) and ses_topic == req_topic

    @staticmethod
    def _is_victory_session(session_row: Dict[str, Any]) -> bool:
        outcome = str(session_row.get("battle_outcome") or "").strip().lower()
        if outcome == "victory":
            return True
        # Legacy fallback for sessions created before explicit battle_outcome.
        return bool(session_row.get("boss_defeated", False)) and not bool(session_row.get("party_defeated", False))

    @staticmethod
    def _context_concept_frequency(context_chunks: List[Dict[str, str]]) -> Dict[str, Tuple[str, int]]:
        freq: Dict[str, Tuple[str, int]] = {}
        for chunk in context_chunks or []:
            raw = str(chunk.get("concept_id") or "").strip()
            norm = _normalize_key(raw)
            if not norm:
                continue
            prev = freq.get(norm)
            if not prev:
                freq[norm] = (raw, 1)
            else:
                freq[norm] = (prev[0], prev[1] + 1)
        return freq

    def _student_has_concept_node(self, student_id: str, concept_id: str) -> bool:
        sid = str(student_id or "").strip()
        cid = str(concept_id or "").strip()
        if not sid or not cid:
            return False
        cache_key = (sid, cid)
        cached = self._concept_presence_cache.get(cache_key)
        if cached is not None:
            return cached
        if not self.db:
            self._concept_presence_cache[cache_key] = False
            return False

        exists = False
        try:
            if (
                self.db.collection("students")
                .document(sid)
                .collection("concept_states")
                .document(cid)
                .get()
                .exists
            ):
                exists = True
        except Exception:
            pass

        if not exists:
            try:
                exists = (
                    self.db.collection("knowledge_graphs")
                    .document(f"user_{sid}")
                    .collection("concepts")
                    .document(cid)
                    .get()
                    .exists
                )
            except Exception:
                exists = False

        self._concept_presence_cache[cache_key] = exists
        return exists

    def _resolve_existing_student_concept_id(self, student_id: str, concept_id: str) -> Optional[str]:
        candidate = str(concept_id or "").strip()
        if not candidate:
            return None
        resolved = self._resolve_student_concept_id(student_id, candidate)
        if not resolved or resolved == "general_topic":
            return None
        if self._student_has_concept_node(student_id, resolved):
            return resolved
        return None

    def _collect_focus_subconcept_nodes(self, student_id: str, focus_concept: str, topic: str) -> List[str]:
        sid = str(student_id or "").strip()
        focus_norm = _normalize_key(focus_concept)
        topic_norm = _normalize_key(topic)
        if not sid or not self.db or (not focus_norm and not topic_norm):
            return []

        concepts_ref = (
            self.db.collection("knowledge_graphs")
            .document(f"user_{sid}")
            .collection("concepts")
        )
        ranked: List[Tuple[float, str]] = []
        try:
            for doc in concepts_ref.stream():
                node = doc.to_dict() or {}
                node_id = str(doc.id or "").strip()
                node_norm = _normalize_key(node_id)
                if not node_norm:
                    continue
                if node_norm in {focus_norm, topic_norm}:
                    continue

                topic_ids = node.get("topic_ids") or node.get("topicIds") or []
                topic_norms = {_normalize_key(v) for v in (topic_ids if isinstance(topic_ids, list) else [])}
                if focus_norm not in topic_norms and topic_norm not in topic_norms:
                    continue

                if not self._student_has_concept_node(sid, node_id):
                    continue

                mastery = _to_float(node.get("mastery_score"), 0.5)
                ranked.append((mastery, node_id))
        except Exception:
            return []

        ranked.sort(key=lambda item: (item[0], item[1]))
        return [cid for _, cid in ranked]

    def _pick_member_question_concept(
        self,
        member_profile: Dict[str, Any],
        focus_concept: str,
        topic: str,
        context_chunks: List[Dict[str, str]],
    ) -> str:
        focus_norm = _normalize_key(focus_concept)
        topic_norm = _normalize_key(topic)
        context_freq = self._context_concept_frequency(context_chunks)

        # Prefer weakest concepts that are also present in current context chunks.
        profile = member_profile.get("concept_profile", {}) or {}
        weak_candidates: List[Tuple[str, str, float]] = []
        if isinstance(profile, dict):
            for raw_cid, raw_mastery in profile.items():
                cid = str(raw_cid or "").strip()
                norm = _normalize_key(cid)
                if not norm:
                    continue
                try:
                    mastery = float(raw_mastery)
                except (TypeError, ValueError):
                    mastery = 1.0
                weak_candidates.append((cid, norm, mastery))
        weak_candidates.sort(key=lambda item: item[2])

        for cid, norm, _ in weak_candidates:
            if norm == focus_norm:
                continue
            if norm in context_freq:
                return context_freq[norm][0] or cid

        # Next, pick a specific concept from context that isn't the broad session focus/topic.
        ordered_context = sorted(context_freq.items(), key=lambda item: (-item[1][1], item[0]))
        for norm, (raw, _) in ordered_context:
            if norm == focus_norm or norm == topic_norm:
                continue
            return raw or norm

        # Next, pick weakest non-focus concept from member profile.
        for cid, norm, _ in weak_candidates:
            if norm != focus_norm:
                return cid

        fallback = str(focus_concept or "").strip()
        if fallback:
            return fallback
        topic_fallback = _normalize_key(topic) or str(topic or "").strip()
        return topic_fallback or "general_topic"

    def _link_questions_to_creator_kg(
        self,
        questions: List[Dict[str, Any]],
        member_profiles: List[Dict[str, Any]],
        creator_id: str,
        focus_concept: str,
        topic: str,
        preferred_concept_by_member: Optional[Dict[str, str]] = None,
    ) -> Tuple[List[Dict[str, Any]], bool]:
        sid = str(creator_id or "").strip()
        if not sid:
            return questions, False

        preferred_concept_by_member = preferred_concept_by_member or {}
        by_member = {
            str(m.get("student_id") or "").strip(): m
            for m in member_profiles
            if str(m.get("student_id") or "").strip()
        }
        focus_norm = _normalize_key(focus_concept)
        topic_norm = _normalize_key(topic)
        specific_pool = self._collect_focus_subconcept_nodes(sid, focus_concept, topic)

        changed = False
        linked: List[Dict[str, Any]] = []
        for idx, raw_q in enumerate(questions or []):
            if not isinstance(raw_q, dict):
                continue
            q = dict(raw_q)
            target_member = str(q.get("target_member") or "").strip()
            member_profile = by_member.get(target_member, {})
            profile = member_profile.get("concept_profile", {}) or {}
            weak_profile_ids: List[str] = []
            if isinstance(profile, dict):
                weak_profile_ids = [
                    str(k or "").strip()
                    for k, _ in sorted(
                        profile.items(),
                        key=lambda item: _to_float(item[1], 1.0),
                    )
                ]

            candidate_order: List[str] = [
                str(preferred_concept_by_member.get(target_member) or "").strip(),
                str(q.get("concept_id") or "").strip(),
                str(q.get("weak_concept") or "").strip(),
                *[cid for cid in weak_profile_ids if cid],
                str(focus_concept or "").strip(),
                str(topic or "").strip(),
            ]

            resolved: Optional[str] = None
            for candidate in candidate_order:
                existing = self._resolve_existing_student_concept_id(sid, candidate)
                if existing:
                    resolved = existing
                    break

            if specific_pool and (not resolved or _normalize_key(resolved) in {focus_norm, topic_norm}):
                # Prefer an actually weak member concept if it intersects this session's sub-topic pool.
                weak_pool_match: Optional[str] = None
                pool_norms = {_normalize_key(cid): cid for cid in specific_pool}
                for raw_weak in weak_profile_ids:
                    existing = self._resolve_existing_student_concept_id(sid, raw_weak)
                    if not existing:
                        continue
                    hit = pool_norms.get(_normalize_key(existing))
                    if hit:
                        weak_pool_match = hit
                        break
                resolved = weak_pool_match or specific_pool[idx % len(specific_pool)]

            if not resolved:
                resolved = self._resolve_student_concept_id(sid, q.get("concept_id") or focus_concept or topic or "general_topic")

            if str(q.get("concept_id") or "").strip() != resolved:
                q["concept_id"] = resolved
                changed = True
            if str(q.get("weak_concept") or "").strip() != resolved:
                q["weak_concept"] = resolved
                changed = True

            linked.append(q)

        return linked, changed

    def _check_level_unlock(
        self,
        user_id: str,
        hub_id: str,
        topic: str,
        concept_id: Optional[str],
        target_level: int,
    ) -> Optional[str]:
        if target_level <= 1:
            return None
        if not self.db:
            return "Database unavailable"

        required_level = target_level - 1
        try:
            docs = self.db.collection(self.collection).where("hub_id", "==", hub_id).stream()
        except Exception:
            return "Could not verify level unlocks right now."

        for doc in docs:
            row = doc.to_dict() or {}
            if str(row.get("status") or "").strip().lower() != "completed":
                continue
            members = row.get("members", []) or []
            member_ids = {str(m.get("student_id") or "").strip() for m in members if isinstance(m, dict)}
            if user_id not in member_ids:
                continue
            if _normalize_level(row.get("level"), default=1) != required_level:
                continue
            if not self._topic_matches_for_progression(row, topic, concept_id):
                continue
            if self._is_victory_session(row):
                return None

        topic_label = concept_id or topic or "this topic"
        return (
            f"Unlock Level {target_level} first: defeat the Level {required_level} boss for "
            f"'{topic_label}' in this hub."
        )

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
            return self._fallback_questions(
                member_profiles,
                topic,
                selected_concept_id,
                context_chunks,
                created_by=created_by,
            )

        focus_concept = selected_concept_id or _normalize_key(topic) or topic

        def avg_mastery(p: Dict[str, Any]) -> float:
            vals = [float(v) for v in (p.get("concept_profile", {}) or {}).values()]
            return sum(vals) / len(vals) if vals else 0.0

        sorted_members = sorted(member_profiles, key=avg_mastery)
        preferred_concept_by_member: Dict[str, str] = {}
        members_desc: List[str] = []
        for m in sorted_members:
            profile = m.get("concept_profile", {}) or {}
            weakest = sorted(profile.items(), key=lambda x: x[1])[:3]
            weak_str = ", ".join(f"{c}:{float(v):.0%}" for c, v in weakest) if weakest else "no profile data"
            preferred_concept = self._pick_member_question_concept(m, focus_concept, topic, context_chunks)
            sid = str(m.get("student_id") or "")
            if sid:
                preferred_concept_by_member[sid] = preferred_concept
            members_desc.append(
                f"- {m['name']} (id={m['student_id']}), weakest=[{weak_str}], preferred_concept={preferred_concept}"
            )

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
            "\"concept_id\":\"<specific weak sub-concept id>\","
            "\"weak_concept\":\"<same specific sub-concept id>\","
            "\"type\":\"open|code|math|mcq\","
            "\"stem\":\"<question>\","
            "\"options\":[\"<full option text>\",\"<full option text>\",\"<full option text>\",\"<full option text>\"] or null,"
            "\"correct_answer\":\"<ground-truth answer>\","
            "\"explanation\":\"<why correct>\""
            "}\n"
            "Rules:\n"
            "- Set concept_id to a specific topic-level concept id, not a broad slide/week title.\n"
            "- Use each member's preferred_concept when provided.\n"
            "- Make each question answerable from provided context when available.\n"
            "- For mcq type, every option must be full answer text; never output placeholder options like A/B/C/D.\n"
            "- For mcq type, correct_answer must be the full answer text (not a letter label).\n"
            "- For math type, format formulas/equations using LaTeX delimiters: inline `$...$`, display `$$...$$`.\n"
            "- For math type, keep `correct_answer` and `explanation` in valid LaTeX where equations appear.\n"
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
            normalized_questions = self._normalize_questions(
                questions,
                member_profiles,
                topic,
                selected_concept_id,
                context_chunks=context_chunks,
                preferred_concept_by_member=preferred_concept_by_member,
            )
            linked_questions, _ = self._link_questions_to_creator_kg(
                questions=normalized_questions,
                member_profiles=member_profiles,
                creator_id=created_by,
                focus_concept=focus_concept,
                topic=topic,
                preferred_concept_by_member=preferred_concept_by_member,
            )
            return linked_questions
        except Exception as e:
            print(f"[PeerSessionService] AI question generation failed: {e}")
            return self._fallback_questions(
                member_profiles,
                topic,
                selected_concept_id,
                context_chunks,
                created_by=created_by,
            )

    def _normalize_questions(
        self,
        questions: Any,
        member_profiles: List[Dict[str, Any]],
        topic: str,
        selected_concept_id: Optional[str],
        context_chunks: Optional[List[Dict[str, str]]] = None,
        preferred_concept_by_member: Optional[Dict[str, str]] = None,
    ) -> List[Dict[str, Any]]:
        """Sanitize AI output and guarantee valid questions."""
        if not isinstance(questions, list) or not questions:
            return self._fallback_questions(member_profiles, topic, selected_concept_id, [])

        by_id = {str(m.get("student_id")): m for m in member_profiles if m.get("student_id")}
        focus_concept = selected_concept_id or _normalize_key(topic) or topic
        focus_norm = _normalize_key(focus_concept)
        topic_norm = _normalize_key(topic)
        context_chunks = context_chunks or []
        preferred_concept_by_member = preferred_concept_by_member or {}
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
            stem = str(q.get("stem") or "").strip()
            if not stem:
                continue

            preferred_concept = str(
                preferred_concept_by_member.get(target_member)
                or self._pick_member_question_concept(
                    by_id.get(target_member, {}),
                    focus_concept,
                    topic,
                    context_chunks,
                )
            ).strip()

            concept_id = str(q.get("concept_id") or focus_concept).strip() or focus_concept
            concept_norm = _normalize_key(concept_id)
            preferred_norm = _normalize_key(preferred_concept)
            if preferred_norm and preferred_norm not in {focus_norm, topic_norm} and concept_norm in {focus_norm, topic_norm}:
                concept_id = preferred_concept
                concept_norm = preferred_norm

            weak_concept = str(q.get("weak_concept") or concept_id).strip() or concept_id
            weak_norm = _normalize_key(weak_concept)
            if preferred_norm and preferred_norm not in {focus_norm, topic_norm} and weak_norm in {focus_norm, topic_norm}:
                weak_concept = preferred_concept
            explanation = str(q.get("explanation") or f"This question checks understanding of {concept_id}.")
            correct_answer = str(q.get("correct_answer") or "").strip()
            options = None

            if q_type == "mcq":
                options = self._normalize_mcq_options(q.get("options"))
                if not options:
                    q_type = "open"
                    options = None
                    if not correct_answer or _is_placeholder_choice(correct_answer):
                        correct_answer = explanation or f"A complete, context-grounded answer about {concept_id}."
                else:
                    correct_answer = self._normalize_mcq_correct_answer(correct_answer, options)
            else:
                options = None

            if not correct_answer:
                correct_answer = explanation or f"A complete, context-grounded answer about {concept_id}."
            if not correct_answer:
                continue

            if q_type == "math":
                stem = _latexify_math_text(stem)
                correct_answer = _latexify_math_text(correct_answer)
                explanation = _latexify_math_text(explanation)

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
                    "explanation": explanation,
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
        created_by: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Generate deterministic questions when AI output is unavailable."""
        focus = selected_concept_id or _normalize_key(topic) or topic
        anchor = ""
        if context_chunks:
            anchor = context_chunks[0].get("text", "")[:220].strip()

        questions: List[Dict[str, Any]] = []
        for i, m in enumerate(member_profiles):
            member_concept = self._pick_member_question_concept(m, focus, topic, context_chunks)
            stem = f"Explain the key ideas of '{member_concept}' and how they relate to '{topic}'."
            if anchor:
                stem += f" Use this course fact in your explanation: \"{anchor}\"."
            questions.append(
                {
                    "question_id": f"q_{i}",
                    "target_member": m["student_id"],
                    "target_member_name": m.get("name", m["student_id"]),
                    "concept_id": member_concept,
                    "weak_concept": member_concept,
                    "type": "open",
                    "stem": stem,
                    "options": None,
                    "correct_answer": f"A correct explanation grounded in the course material for {member_concept}.",
                    "explanation": f"This checks understanding of {member_concept}.",
                }
            )
        if created_by:
            linked_questions, _ = self._link_questions_to_creator_kg(
                questions=questions,
                member_profiles=member_profiles,
                creator_id=created_by,
                focus_concept=focus,
                topic=topic,
            )
            return linked_questions
        return questions

    def _retarget_questions_to_specific_concepts(
        self,
        questions: List[Dict[str, Any]],
        member_profiles: List[Dict[str, Any]],
        topic: str,
        selected_concept_id: Optional[str],
        context_chunks: List[Dict[str, str]],
        created_by: Optional[str] = None,
    ) -> Tuple[List[Dict[str, Any]], bool]:
        focus_concept = selected_concept_id or _normalize_key(topic) or topic
        focus_norm = _normalize_key(focus_concept)
        topic_norm = _normalize_key(topic)
        by_id = {str(m.get("student_id") or "").strip(): m for m in member_profiles if str(m.get("student_id") or "").strip()}

        changed = False
        retargeted: List[Dict[str, Any]] = []
        for raw_q in questions or []:
            if not isinstance(raw_q, dict):
                continue
            q = dict(raw_q)
            target_member = str(q.get("target_member") or "").strip()
            preferred = self._pick_member_question_concept(
                by_id.get(target_member, {}),
                focus_concept,
                topic,
                context_chunks,
            )
            preferred_norm = _normalize_key(preferred)
            if not preferred_norm:
                retargeted.append(q)
                continue

            concept_id = str(q.get("concept_id") or "").strip()
            weak_concept = str(q.get("weak_concept") or "").strip()
            concept_norm = _normalize_key(concept_id)
            weak_norm = _normalize_key(weak_concept)

            if preferred_norm not in {focus_norm, topic_norm}:
                if concept_norm in {"", focus_norm, topic_norm}:
                    q["concept_id"] = preferred
                    concept_id = preferred
                    concept_norm = preferred_norm
                    changed = True
                if weak_norm in {"", focus_norm, topic_norm}:
                    q["weak_concept"] = preferred
                    weak_concept = preferred
                    weak_norm = preferred_norm
                    changed = True

            if not concept_norm:
                q["concept_id"] = preferred or focus_concept
                changed = True
            if not weak_norm:
                q["weak_concept"] = str(q.get("concept_id") or preferred or focus_concept)
                changed = True

            retargeted.append(q)

        if created_by:
            linked, linked_changed = self._link_questions_to_creator_kg(
                questions=retargeted,
                member_profiles=member_profiles,
                creator_id=created_by,
                focus_concept=focus_concept,
                topic=topic,
            )
            return linked, (changed or linked_changed)

        return retargeted, changed

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
            " If question type is math, render equations in feedback/hint using LaTeX delimiters (`$...$` or `$$...$$`)."
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

    @staticmethod
    def _initial_party_health(level: int, total_expected_answers: int) -> float:
        if level < 2:
            return 0.0
        base = TEAM_HP_PER_LEVEL.get(level, TEAM_HP_PER_LEVEL[2])
        density_scale = max(0.85, min(1.35, float(total_expected_answers) / 8.0))
        return round(base * density_scale, 2)

    @staticmethod
    def _initial_boss_health(level: int, total_expected_answers: int, character_id: Optional[str] = None) -> float:
        normalized_level = _normalize_level(level, default=1)
        boss_character = str(character_id or _boss_character_for_level(normalized_level)).strip()
        override = BOSS_HEALTH_OVERRIDES.get(boss_character)
        if override is not None:
            return float(override)
        return float(max(80.0, min(500.0, total_expected_answers * 22.0)))

    @staticmethod
    def _question_time_limit_for_level(level: int) -> Optional[int]:
        return QUESTION_TIME_LIMIT_SEC_BY_LEVEL.get(level)

    @staticmethod
    def _is_weak_answer(score: float, is_correct: bool) -> bool:
        return (not is_correct) or float(score) < MIN_DEFENSE_SCORE

    @staticmethod
    def _compute_party_damage_from_answer(level: int, score: float, is_correct: bool, mistake_type: str) -> float:
        if level < 2:
            return 0.0
        s = _clamp(float(score))
        if not PeerSessionService._is_weak_answer(s, is_correct):
            return 0.0

        if is_correct:
            base = 8.0
        elif mistake_type == "careless":
            base = 13.0
        elif mistake_type == "conceptual":
            base = 19.0
        else:
            base = 16.0

        severity = max(0.0, MIN_DEFENSE_SCORE - s)
        level_mult = {2: 1.0, 3: 1.15, 4: 1.3}.get(level, 1.0)
        damage = (base + severity * 18.0) * level_mult
        return round(max(0.0, damage), 2)

    @staticmethod
    def _compute_party_damage_from_timeout(level: int) -> float:
        if level < 2:
            return 0.0
        return {2: 10.0, 3: 14.0, 4: 18.0}.get(level, 10.0)

    @staticmethod
    def _append_attack_log(log: List[Dict[str, Any]], event: Dict[str, Any], limit: int = 80) -> List[Dict[str, Any]]:
        merged = [*log, event]
        return merged[-limit:]

    def _apply_party_damage(
        self,
        data: Dict[str, Any],
        damage: float,
        reason: str,
        question_id: str,
        triggered_by: Optional[str],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        level = _normalize_level(data.get("level"), default=1)
        if level < 2 or damage <= 0:
            return {}

        members = data.get("members", []) or []
        total_expected_answers = max(1, max(2, len(members)) * max(1, len(data.get("questions", []) or [])))
        party_health_max = _to_float(data.get("party_health_max"), 0.0)
        if party_health_max <= 0:
            party_health_max = self._initial_party_health(level, total_expected_answers)

        party_health_current = _to_float(data.get("party_health_current"), party_health_max)
        party_health_current = round(max(0.0, party_health_current - float(damage)), 2)
        party_defeated = party_health_current <= 0.0
        boss_attack_count = int(data.get("boss_attack_count", 0) or 0) + 1
        now_iso = _utc_now().isoformat()
        battle_outcome = str(data.get("battle_outcome") or "pending")
        if party_defeated:
            battle_outcome = "defeat"

        event: Dict[str, Any] = {
            "event_id": f"atk_{uuid4().hex[:10]}",
            "reason": reason,
            "question_id": question_id,
            "triggered_by": triggered_by,
            "damage": round(float(damage), 2),
            "party_health_after": party_health_current,
            "timestamp": now_iso,
        }
        if metadata:
            event.update(metadata)

        current_log = list(data.get("boss_attack_log", []) or [])
        next_log = self._append_attack_log(current_log, event)

        updates: Dict[str, Any] = {
            "party_health_max": party_health_max,
            "party_health_current": party_health_current,
            "party_defeated": party_defeated,
            "boss_attack_count": boss_attack_count,
            "boss_attack_log": next_log,
            "battle_outcome": battle_outcome,
            "last_boss_event": event,
        }
        if party_defeated:
            updates["status"] = "completed"
            updates["ended_at"] = now_iso

        data.update(updates)
        return updates

    def _apply_timeout_penalties(
        self,
        data: Dict[str, Any],
        ref: Optional[Any] = None,
    ) -> Dict[str, Any]:
        level = _normalize_level(data.get("level"), default=1)
        time_limit_sec = self._question_time_limit_for_level(level)
        if not time_limit_sec:
            return {}
        if str(data.get("status", "")) != "active":
            return {}
        if bool(data.get("party_defeated", False)) or bool(data.get("boss_defeated", False)):
            return {}

        questions = data.get("questions", []) or []
        if not questions:
            return {}
        current_idx = max(0, min(int(data.get("current_question_index", 0) or 0), len(questions) - 1))
        current_question = questions[current_idx]
        current_qid = str(current_question.get("question_id") or "")
        if not current_qid:
            return {}

        started_at = _parse_dt(data.get("current_question_started_at"), _parse_dt(data.get("created_at"), _utc_now()))
        elapsed = (_utc_now() - started_at).total_seconds()
        if elapsed < float(time_limit_sec):
            return {}

        members = data.get("members", []) or []
        member_ids = [str(m.get("student_id") or "").strip() for m in members if str(m.get("student_id") or "").strip()]
        if not member_ids:
            return {}
        answers = data.get("answers", []) or []
        answered_ids = {
            str(a.get("submitted_by") or "")
            for a in answers
            if str(a.get("question_id") or "") == current_qid
        }
        unanswered_ids = [sid for sid in member_ids if sid not in answered_ids]
        if not unanswered_ids:
            return {}

        penalties = list(data.get("question_timeout_penalties", []) or [])
        already_penalized = {
            str(entry.get("student_id") or "")
            for entry in penalties
            if str(entry.get("question_id") or "") == current_qid
        }
        newly_penalized = [sid for sid in unanswered_ids if sid not in already_penalized]
        if not newly_penalized:
            return {}

        concept_to_update = str(
            current_question.get("concept_id")
            or current_question.get("weak_concept")
            or data.get("selected_concept_id")
            or data.get("topic")
            or "general_topic"
        ).strip() or "general_topic"

        now_iso = _utc_now().isoformat()
        timeout_damage_per_member = self._compute_party_damage_from_timeout(level)
        mastery_results: Dict[str, Dict[str, Any]] = {}
        for sid in newly_penalized:
            mastery_results[sid] = self._update_student_mastery(
                student_id=sid,
                concept_id=concept_to_update,
                is_correct=False,
                mistake_type="conceptual",
            )
            penalties.append(
                {
                    "question_id": current_qid,
                    "student_id": sid,
                    "damage_taken": timeout_damage_per_member,
                    "concept_id": str(mastery_results[sid].get("concept_id") or concept_to_update),
                    "mistake_type": "conceptual",
                    "reason": "timeout",
                    "mastery_delta": mastery_results[sid].get("mastery_delta"),
                    "updated_mastery": mastery_results[sid].get("updated_mastery"),
                    "mastery_status": mastery_results[sid].get("mastery_status"),
                    "applied_at": now_iso,
                }
            )

        updates: Dict[str, Any] = {
            "question_timeout_penalties": penalties,
            "question_time_limit_sec": time_limit_sec,
        }
        data.update(updates)

        total_timeout_damage = round(timeout_damage_per_member * len(newly_penalized), 2)
        party_damage_updates = self._apply_party_damage(
            data=data,
            damage=total_timeout_damage,
            reason="timeout",
            question_id=current_qid,
            triggered_by="boss",
            metadata={
                "timed_out_members": newly_penalized,
                "concept_id": concept_to_update,
                "per_member_damage": timeout_damage_per_member,
            },
        )
        updates.update(party_damage_updates)

        if ref is not None and updates:
            ref.update(updates)
        return updates

    def _resolve_student_concept_id(self, student_id: str, concept_id: str) -> str:
        raw = str(concept_id or "").strip()
        normalized = _normalize_key(raw)
        cache_key = (str(student_id or "").strip(), normalized)
        if normalized and cache_key in self._concept_id_cache:
            return self._concept_id_cache[cache_key]

        candidate_values = [
            raw,
            normalized,
            raw.replace(" ", "_"),
            raw.replace("-", "_"),
            _normalize_key(raw.replace("-", " ")),
        ]
        candidates: List[str] = []
        for value in candidate_values:
            candidate = str(value or "").strip()
            if candidate and candidate not in candidates:
                candidates.append(candidate)

        if not candidates:
            return "general_topic"

        if not self.db:
            resolved = normalized or candidates[0]
            if normalized:
                self._concept_id_cache[cache_key] = resolved
            return resolved

        states_ref = (
            self.db.collection("students")
            .document(student_id)
            .collection("concept_states")
        )
        for cid in candidates:
            try:
                if states_ref.document(cid).get().exists:
                    if normalized:
                        self._concept_id_cache[cache_key] = cid
                    return cid
            except Exception:
                continue

        concepts_ref = (
            self.db.collection("knowledge_graphs")
            .document(f"user_{student_id}")
            .collection("concepts")
        )
        for cid in candidates:
            try:
                if concepts_ref.document(cid).get().exists:
                    if normalized:
                        self._concept_id_cache[cache_key] = cid
                    return cid
            except Exception:
                continue

        if normalized:
            try:
                for node_doc in concepts_ref.stream():
                    node = node_doc.to_dict() or {}
                    node_id = str(node_doc.id or "").strip()
                    title = str(node.get("title") or "").strip()
                    if _normalize_key(node_id) == normalized or _normalize_key(title) == normalized:
                        self._concept_id_cache[cache_key] = node_id
                        return node_id
            except Exception:
                pass

        resolved = normalized or candidates[0]
        if normalized:
            self._concept_id_cache[cache_key] = resolved
        return resolved

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
                "decay_rate": state.decay_rate,
                "last_practice_at": _utc_now().isoformat(),
                "updated_at": _utc_now().isoformat(),
            },
            merge=True,
        )

    def _calibrate_mastery_update(
        self,
        *,
        prior_after_decay: float,
        raw_updated: float,
        is_correct: bool,
        mistake_type: str,
    ) -> float:
        normalized_mistake = str(mistake_type or "normal").strip().lower()
        base_weight = 0.24
        max_gain = 0.035
        max_drop = 0.045

        if normalized_mistake == "careless" and not is_correct:
            base_weight = 0.18
            max_drop = 0.02
        elif not is_correct:
            base_weight = 0.26

        target_mastery = prior_after_decay + (raw_updated - prior_after_decay) * base_weight
        delta = target_mastery - prior_after_decay
        delta = max(-max_drop, min(max_gain, delta))
        return _clamp(prior_after_decay + delta)

    def _update_student_mastery(
        self,
        student_id: str,
        concept_id: str,
        is_correct: bool,
        mistake_type: str,
    ) -> Dict[str, Any]:
        concept_id = self._resolve_student_concept_id(student_id, concept_id)
        state = self._load_student_concept_state(student_id, concept_id)
        bkt_result = self.adaptive_engine.update_bkt(
            state=state,
            is_correct=is_correct,
            interaction_time=_utc_now(),
            mistake_type=mistake_type,
            careless_penalty=0.02,
        )
        updated_state: ConceptState = bkt_result["state"]  # type: ignore[assignment]
        prior_after_decay = float(bkt_result.get("mastery_after_decay", state.mastery) or state.mastery)
        raw_updated = float(bkt_result.get("updated_mastery", updated_state.mastery) or updated_state.mastery)
        calibrated_mastery = self._calibrate_mastery_update(
            prior_after_decay=prior_after_decay,
            raw_updated=raw_updated,
            is_correct=is_correct,
            mistake_type=mistake_type,
        )
        calibrated_state = ConceptState(**updated_state.__dict__).normalized()
        calibrated_state.mastery = calibrated_mastery
        self._save_student_concept_state(student_id, calibrated_state)
        self._sync_user_kg_node(student_id, concept_id, calibrated_state, mistake_type, is_correct)
        return {
            "concept_id": concept_id,
            "prior_mastery": round(prior_after_decay, 6),
            "updated_mastery": round(calibrated_state.mastery, 6),
            "mastery_delta": round(calibrated_state.mastery - prior_after_decay, 6),
            "mastery_status": _status_from_mastery(calibrated_state.mastery),
            "mistake_type": mistake_type,
        }

    def create_session(
        self,
        hub_id: str,
        topic: str,
        concept_id: Optional[str],
        course_id: Optional[str],
        course_name: Optional[str],
        level: int,
        member_profiles: List[Dict[str, Any]],
        created_by: str,
    ) -> Dict[str, Any]:
        """Create a new peer session with AI-generated questions."""
        if not self.db:
            return {"error": "Database unavailable"}
        existing = self.get_active_session(hub_id)
        if existing:
            return {
                "error": (
                    "An active or waiting session already exists for this hub. "
                    "Please join or finish it before creating a new one."
                )
            }

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

        normalized_level = _normalize_level(level, default=1)
        unlock_error = self._check_level_unlock(
            user_id=created_by,
            hub_id=hub_id,
            topic=resolved_topic,
            concept_id=resolved_concept_id,
            target_level=normalized_level,
        )
        if unlock_error:
            return {"error": unlock_error}

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
            questions = self._fallback_questions(
                normalized_profiles,
                resolved_topic,
                resolved_concept_id,
                [],
                created_by=created_by,
            )
        questions = self._assign_question_ids(questions, start_index=0)

        creator_name = created_by
        for m in normalized_profiles:
            if m["student_id"] == created_by:
                creator_name = m.get("name", created_by)
                break
        creator_name = self._clean_member_name(created_by, creator_name, fallback_label="Host")

        now = _utc_now()
        total_expected_answers = max(1, max(2, len(normalized_profiles)) * max(1, len(questions)))
        boss_character_id = _boss_character_for_level(normalized_level)
        boss_health_max = self._initial_boss_health(normalized_level, total_expected_answers, boss_character_id)
        party_health_max = self._initial_party_health(normalized_level, total_expected_answers)
        question_time_limit_sec = self._question_time_limit_for_level(normalized_level)
        session_doc = {
            "session_id": session_id,
            "hub_id": hub_id,
            "topic": resolved_topic,
            "level": normalized_level,
            "boss_character_id": boss_character_id,
            "selected_concept_id": resolved_concept_id,
            "course_id": resolved_course_id,
            "course_name": resolved_course_name,
            "boss_name": _boss_name_for_character(boss_character_id),
            "boss_health_max": boss_health_max,
            "boss_health_current": boss_health_max,
            "boss_defeated": False,
            "party_health_max": party_health_max,
            "party_health_current": party_health_max,
            "party_defeated": False,
            "battle_outcome": "pending",
            "boss_attack_count": 0,
            "boss_attack_log": [],
            "status": "waiting",
            "created_by": created_by,
            "created_at": now.isoformat(),
            "current_question_started_at": now.isoformat(),
            "question_time_limit_sec": question_time_limit_sec,
            "question_timeout_penalties": [],
            "members": [{"student_id": created_by, "name": creator_name, "joined_at": now.isoformat()}],
            "member_profiles": normalized_profiles,
            "expected_members": max(2, len(normalized_profiles)),
            "questions": questions,
            "current_question_index": 0,
            "round_index": 1,
            "answers": [],
        }
        self._normalize_session_member_names(session_doc)

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
        if str(data.get("status") or "").strip().lower() == "completed":
            return {"error": "Session already completed"}
        members = data.get("members", []) or []
        if any(m.get("student_id") == student_id for m in members):
            return {"status": data.get("status", "waiting"), "already_joined": True}

        now = _utc_now()
        cleaned_name = self._clean_member_name(student_id, name)
        members.append({"student_id": student_id, "name": cleaned_name, "joined_at": now.isoformat()})
        updates: Dict[str, Any] = {"members": members}

        member_profiles = self._build_member_profiles_from_session(data)
        if not any(p.get("student_id") == student_id for p in member_profiles):
            member_profiles.append({"student_id": student_id, "name": cleaned_name, "concept_profile": {}})
        updates["member_profiles"] = member_profiles

        if len(members) >= 2 and data.get("status") == "waiting":
            updates["status"] = "active"
            updates["current_question_started_at"] = now.isoformat()

        if not data.get("questions"):
            fresh_questions = self._fallback_questions(
                member_profiles,
                data.get("topic", "general topic"),
                data.get("selected_concept_id"),
                [],
                created_by=str(data.get("created_by") or ""),
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

        names_changed, _ = self._normalize_session_member_names(data)
        if names_changed:
            updates: Dict[str, Any] = {}
            if "members" in data:
                updates["members"] = data.get("members", [])
            if "member_profiles" in data:
                updates["member_profiles"] = data.get("member_profiles", [])
            if "questions" in data:
                updates["questions"] = data.get("questions", [])
            if updates:
                ref.update(updates)

        if not data.get("questions"):
            member_profiles = self._build_member_profiles_from_session(data)
            if member_profiles:
                questions = self._assign_question_ids(
                    self._fallback_questions(
                        member_profiles,
                        data.get("topic", "general topic"),
                        data.get("selected_concept_id"),
                        [],
                        created_by=str(data.get("created_by") or ""),
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

        # Sanitize malformed MCQs from legacy sessions (e.g., options like ["A", "B", "C", "D"]).
        questions = data.get("questions", []) or []
        if questions:
            sanitized_questions: List[Dict[str, Any]] = []
            questions_changed = False
            for q in questions:
                if not isinstance(q, dict):
                    continue
                sanitized_q, changed = self._sanitize_existing_question(q)
                sanitized_questions.append(sanitized_q)
                if changed:
                    questions_changed = True
            if sanitized_questions and questions_changed:
                data["questions"] = sanitized_questions
                questions = sanitized_questions
                ref.update({"questions": sanitized_questions})

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

        # Retarget broad legacy question concepts to specific sub-topics when possible.
        questions = data.get("questions", []) or []
        if questions:
            topic_text = str(data.get("topic") or "")
            focus_concept = str(data.get("selected_concept_id") or _normalize_key(topic_text) or topic_text).strip()
            focus_norm = _normalize_key(focus_concept)
            topic_norm = _normalize_key(topic_text)
            needs_retarget = False
            creator_id = str(data.get("created_by") or "")
            for q in questions:
                if not isinstance(q, dict):
                    continue
                concept_id = str(q.get("concept_id") or "").strip()
                weak_concept = str(q.get("weak_concept") or "").strip()
                concept_norm = _normalize_key(concept_id)
                weak_norm = _normalize_key(weak_concept)
                concept_missing = bool(concept_id) and not self._student_has_concept_node(creator_id, concept_id)
                weak_missing = bool(weak_concept) and not self._student_has_concept_node(creator_id, weak_concept)
                if (
                    concept_norm in {"", focus_norm, topic_norm}
                    or weak_norm in {"", focus_norm, topic_norm}
                    or concept_missing
                    or weak_missing
                ):
                    needs_retarget = True
                    break

            if needs_retarget:
                member_profiles = self._build_member_profiles_from_session(data)
                context_chunks = self._fetch_concept_context(
                    user_id=str(data.get("created_by") or ""),
                    concept_id=data.get("selected_concept_id"),
                    topic=topic_text,
                    limit=8,
                    course_id=data.get("course_id"),
                    course_name=data.get("course_name"),
                )
                retargeted_questions, retargeted_changed = self._retarget_questions_to_specific_concepts(
                    questions=questions,
                    member_profiles=member_profiles,
                    topic=topic_text,
                    selected_concept_id=data.get("selected_concept_id"),
                    context_chunks=context_chunks,
                    created_by=creator_id,
                )
                if retargeted_changed:
                    data["questions"] = retargeted_questions
                    questions = retargeted_questions
                    ref.update({"questions": retargeted_questions})

        # Backfill boss state for legacy sessions.
        if "boss_health_max" not in data or "boss_health_current" not in data:
            members = data.get("members", []) or []
            total_expected_answers = max(1, max(2, len(members)) * max(1, len(data.get("questions", []) or [])))
            raw_level = _normalize_level(data.get("level", 1), default=1)
            raw_character = str(data.get("boss_character_id") or _boss_character_for_level(raw_level)).strip()
            boss_health_max = self._initial_boss_health(raw_level, total_expected_answers, raw_character)
            boss_health_current = _to_float(data.get("boss_health_current"), boss_health_max)
            boss_defeated = boss_health_current <= 0
            data["boss_name"] = str(data.get("boss_name") or _boss_name_for_character(raw_character))
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

        normalized_level = _normalize_level(data.get("level", 1), default=1)
        expected_boss_character = _boss_character_for_level(normalized_level)
        expected_boss_name = _boss_name_for_character(expected_boss_character)
        stored_boss_character = str(data.get("boss_character_id") or "").strip()
        stored_boss_name = str(data.get("boss_name") or "").strip()
        members = data.get("members", []) or []
        total_expected_answers = max(1, max(2, len(members)) * max(1, len(data.get("questions", []) or [])))
        expected_boss_health_max = self._initial_boss_health(
            normalized_level,
            total_expected_answers,
            expected_boss_character,
        )
        boss_health_max = _to_float(data.get("boss_health_max"), expected_boss_health_max)
        if expected_boss_character == "suit":
            boss_health_max = expected_boss_health_max
        boss_health_max = round(max(1.0, boss_health_max), 2)
        boss_health_current = _to_float(data.get("boss_health_current"), boss_health_max)
        boss_health_current = round(max(0.0, min(boss_health_current, boss_health_max)), 2)
        boss_defeated = bool(data.get("boss_defeated", boss_health_current <= 0.0))
        stored_outcome = str(data.get("battle_outcome") or "").strip().lower()
        if boss_health_current <= 0 or stored_outcome == "victory":
            boss_defeated = True
        if boss_defeated:
            boss_health_current = 0.0
        expected_party_health = self._initial_party_health(normalized_level, total_expected_answers)
        expected_time_limit = self._question_time_limit_for_level(normalized_level)
        current_started = data.get("current_question_started_at")
        if not current_started:
            current_started = _parse_dt(data.get("created_at"), _utc_now()).isoformat()

        party_health_max = _to_float(data.get("party_health_max"), expected_party_health)
        if normalized_level < 2:
            party_health_max = 0.0
        party_health_current = _to_float(data.get("party_health_current"), party_health_max)
        party_health_current = round(max(0.0, min(party_health_current, party_health_max if party_health_max > 0 else 0.0)), 2)
        party_defeated = bool(data.get("party_defeated", party_health_current <= 0.0 and party_health_max > 0))
        if party_health_max <= 0:
            party_defeated = False

        battle_outcome = str(data.get("battle_outcome") or "pending")
        if party_defeated:
            battle_outcome = "defeat"
        elif boss_defeated:
            battle_outcome = "victory"
        elif battle_outcome not in {"pending", "victory", "defeat"}:
            battle_outcome = "pending"

        question_timeout_penalties = list(data.get("question_timeout_penalties", []) or [])
        boss_attack_count = int(data.get("boss_attack_count", 0) or 0)
        boss_attack_log = list(data.get("boss_attack_log", []) or [])

        updates: Dict[str, Any] = {}
        if data.get("level") != normalized_level:
            updates["level"] = normalized_level
        if stored_boss_character != expected_boss_character:
            updates["boss_character_id"] = expected_boss_character
        if stored_boss_name != expected_boss_name:
            updates["boss_name"] = expected_boss_name
        if _to_float(data.get("boss_health_max"), -1.0) != boss_health_max:
            updates["boss_health_max"] = boss_health_max
        if _to_float(data.get("boss_health_current"), -1.0) != boss_health_current:
            updates["boss_health_current"] = boss_health_current
        if bool(data.get("boss_defeated", False)) != boss_defeated:
            updates["boss_defeated"] = boss_defeated
        if _to_float(data.get("party_health_max"), -1.0) != party_health_max:
            updates["party_health_max"] = party_health_max
        if _to_float(data.get("party_health_current"), -1.0) != party_health_current:
            updates["party_health_current"] = party_health_current
        if bool(data.get("party_defeated", False)) != party_defeated:
            updates["party_defeated"] = party_defeated
        if str(data.get("battle_outcome") or "") != battle_outcome:
            updates["battle_outcome"] = battle_outcome
        if int(data.get("boss_attack_count", -1) or -1) != boss_attack_count:
            updates["boss_attack_count"] = boss_attack_count
        if data.get("boss_attack_log") is None:
            updates["boss_attack_log"] = boss_attack_log
        if data.get("question_timeout_penalties") is None:
            updates["question_timeout_penalties"] = question_timeout_penalties
        if data.get("current_question_started_at") != current_started:
            updates["current_question_started_at"] = current_started
        if data.get("question_time_limit_sec", "__missing__") != expected_time_limit:
            updates["question_time_limit_sec"] = expected_time_limit

        if party_defeated and str(data.get("status", "")) != "completed":
            updates["status"] = "completed"
            updates["ended_at"] = _utc_now().isoformat()

        data.update(
            {
                "level": normalized_level,
                "boss_character_id": expected_boss_character,
                "boss_name": expected_boss_name,
                "boss_health_max": boss_health_max,
                "boss_health_current": boss_health_current,
                "boss_defeated": boss_defeated,
                "party_health_max": party_health_max,
                "party_health_current": party_health_current,
                "party_defeated": party_defeated,
                "battle_outcome": battle_outcome,
                "boss_attack_count": boss_attack_count,
                "boss_attack_log": boss_attack_log,
                "question_timeout_penalties": question_timeout_penalties,
                "current_question_started_at": current_started,
                "question_time_limit_sec": expected_time_limit,
            }
        )

        if updates:
            ref.update(updates)

        timeout_updates = self._apply_timeout_penalties(data, ref=ref)
        if timeout_updates:
            data.update(timeout_updates)

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
                data = doc.to_dict() or {}
                changed, _ = self._normalize_session_member_names(data)
                if changed:
                    updates: Dict[str, Any] = {}
                    if "members" in data:
                        updates["members"] = data.get("members", [])
                    if "member_profiles" in data:
                        updates["member_profiles"] = data.get("member_profiles", [])
                    if "questions" in data:
                        updates["questions"] = data.get("questions", [])
                    if updates:
                        self.db.collection(self.collection).document(doc.id).update(updates)
                return data
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

        timeout_updates = self._apply_timeout_penalties(data, ref=ref)
        if timeout_updates:
            data.update(timeout_updates)
        if str(data.get("status", "")) == "completed":
            if bool(data.get("party_defeated", False)):
                return {"error": "Session has ended. Your party was defeated."}
            return {"error": "Session has already ended."}

        question = next((q for q in (data.get("questions", []) or []) if q.get("question_id") == question_id), None)
        if not question:
            return {"error": "Question not found"}
        questions = data.get("questions", []) or []
        if not questions:
            return {"error": "No questions in this session"}
        current_idx = max(0, min(int(data.get("current_question_index", 0) or 0), len(questions) - 1))
        current_qid = str(questions[current_idx].get("question_id") or "")
        if current_qid and str(question_id) != current_qid:
            return {"error": "You can only answer the current question."}

        normalized_level = _normalize_level(data.get("level"), default=1)

        answers = data.get("answers", []) or []
        existing_answer = next(
            (
                a for a in answers
                if a.get("question_id") == question_id and a.get("submitted_by") == student_id
            ),
            None,
        )
        if existing_answer:
            existing_boss_health_max = _to_float(data.get("boss_health_max"), 0.0)
            existing_boss_health_current = _to_float(data.get("boss_health_current"), 0.0)
            existing_boss_defeated = bool(data.get("boss_defeated", existing_boss_health_current <= 0.0))
            existing_outcome = str(data.get("battle_outcome") or "").strip().lower()
            if existing_boss_health_current <= 0 or existing_outcome == "victory":
                existing_boss_defeated = True
            if existing_boss_defeated:
                existing_boss_health_current = 0.0
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
                "boss_health_max": existing_boss_health_max,
                "boss_health_current": existing_boss_health_current,
                "boss_defeated": existing_boss_defeated,
                "party_health_max": _to_float(data.get("party_health_max"), 0.0),
                "party_health_current": _to_float(data.get("party_health_current"), 0.0),
                "party_defeated": bool(data.get("party_defeated", False)),
                "battle_outcome": str(data.get("battle_outcome") or "pending"),
                "boss_attacked": bool(existing_answer.get("boss_attacked", False)),
                "party_damage_taken": float(existing_answer.get("party_damage_taken", 0.0) or 0.0),
                "attack_reason": existing_answer.get("attack_reason"),
                "boss_attack_count": int(data.get("boss_attack_count", 0) or 0),
                "already_submitted": True,
                "mastery_delta": existing_answer.get("mastery_delta"),
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
        resolved_concept_id = str(mastery_update.get("concept_id") or concept_to_update or "general_topic")

        score = float(evaluation.get("score", 0.0))
        damage_dealt = self._compute_boss_damage(score, is_correct, mistake_type)
        boss_health_max = _to_float(data.get("boss_health_max"), 0.0)
        if boss_health_max <= 0:
            total_expected_answers = max(1, max(2, len(members)) * max(1, len(data.get("questions", []) or [])))
            boss_character_id = str(
                data.get("boss_character_id") or _boss_character_for_level(normalized_level)
            ).strip()
            boss_health_max = self._initial_boss_health(
                normalized_level,
                total_expected_answers,
                boss_character_id,
            )
        boss_health_current = _to_float(data.get("boss_health_current"), boss_health_max)
        boss_health_current = round(max(0.0, boss_health_current - damage_dealt), 2)
        boss_defeated = boss_health_current <= 0.0
        if boss_defeated:
            boss_health_current = 0.0

        party_damage_taken = self._compute_party_damage_from_answer(
            level=normalized_level,
            score=score,
            is_correct=is_correct,
            mistake_type=mistake_type,
        )
        boss_attacked = party_damage_taken > 0
        attack_reason = "weak_answer" if boss_attacked else None
        party_updates: Dict[str, Any] = {}
        if boss_attacked:
            party_updates = self._apply_party_damage(
                data=data,
                damage=party_damage_taken,
                reason="weak_answer",
                question_id=question_id,
                triggered_by=student_id,
                metadata={
                    "score": round(score, 4),
                    "is_correct": is_correct,
                    "mistake_type": mistake_type,
                    "concept_id": resolved_concept_id,
                },
            )

        answer_entry = {
            "question_id": question_id,
            "submitted_by": student_id,
            "answer_text": answer_text,
            "concept_id": resolved_concept_id,
            "mistake_type": mistake_type,
            "is_correct": is_correct,
            "score": score,
            "ai_feedback": str(evaluation.get("feedback", "")),
            "hint": str(evaluation.get("hint", "")),
            "damage_dealt": damage_dealt,
            "boss_attacked": boss_attacked,
            "party_damage_taken": party_damage_taken,
            "attack_reason": attack_reason,
            "mastery_delta": mastery_update.get("mastery_delta"),
            "updated_mastery": mastery_update.get("updated_mastery"),
            "mastery_status": mastery_update.get("mastery_status"),
            "submitted_at": _utc_now().isoformat(),
        }

        answers.append(answer_entry)
        battle_outcome = str(data.get("battle_outcome") or "pending")
        if bool(data.get("party_defeated", False)):
            battle_outcome = "defeat"
        elif boss_defeated:
            battle_outcome = "victory"

        updates: Dict[str, Any] = {
            "answers": answers,
            "boss_health_max": boss_health_max,
            "boss_health_current": boss_health_current,
            "boss_defeated": boss_defeated,
            "battle_outcome": battle_outcome,
            "last_player_event": {
                "question_id": question_id,
                "attacker": student_id,
                "damage_dealt": damage_dealt,
                "is_correct": is_correct,
                "mistake_type": mistake_type,
                "health_after": boss_health_current,
                "timestamp": _utc_now().isoformat(),
            },
        }
        updates.update(party_updates)
        data.update(updates)
        ref.update(updates)

        return {
            "question_id": question_id,
            "submitted_by": student_id,
            "concept_id": resolved_concept_id,
            "mistake_type": mistake_type,
            "is_correct": is_correct,
            "score": score,
            "ai_feedback": str(evaluation.get("feedback", "")),
            "hint": str(evaluation.get("hint", "")),
            "explanation": question.get("explanation", ""),
            "damage_dealt": damage_dealt,
            "boss_health_max": boss_health_max,
            "boss_health_current": boss_health_current,
            "boss_defeated": boss_defeated,
            "party_health_max": _to_float(data.get("party_health_max"), 0.0),
            "party_health_current": _to_float(data.get("party_health_current"), 0.0),
            "party_defeated": bool(data.get("party_defeated", False)),
            "battle_outcome": str(data.get("battle_outcome") or battle_outcome),
            "boss_attacked": boss_attacked,
            "party_damage_taken": party_damage_taken,
            "attack_reason": attack_reason,
            "boss_attack_count": int(data.get("boss_attack_count", 0) or 0),
            "already_submitted": False,
            "mastery_delta": mastery_update.get("mastery_delta"),
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
        names_changed, name_by_id = self._normalize_session_member_names(data)
        if names_changed:
            updates: Dict[str, Any] = {}
            if "members" in data:
                updates["members"] = data.get("members", [])
            if "member_profiles" in data:
                updates["member_profiles"] = data.get("member_profiles", [])
            if "questions" in data:
                updates["questions"] = data.get("questions", [])
            if updates:
                ref.update(updates)

        timeout_updates = self._apply_timeout_penalties(data, ref=ref)
        if timeout_updates:
            data.update(timeout_updates)
        boss_health_max = _to_float(data.get("boss_health_max"), 0.0)
        boss_health_current = _to_float(data.get("boss_health_current"), boss_health_max)
        boss_defeated = bool(data.get("boss_defeated", boss_health_current <= 0.0))
        if boss_health_current <= 0.0 or str(data.get("battle_outcome") or "").strip().lower() == "victory":
            boss_defeated = True
        if boss_defeated:
            boss_health_current = 0.0
        boss_sync_updates: Dict[str, Any] = {}
        if _to_float(data.get("boss_health_current"), -1.0) != boss_health_current:
            boss_sync_updates["boss_health_current"] = boss_health_current
        if bool(data.get("boss_defeated", False)) != boss_defeated:
            boss_sync_updates["boss_defeated"] = boss_defeated
        if boss_sync_updates:
            ref.update(boss_sync_updates)
            data.update(boss_sync_updates)

        if str(data.get("status", "")) == "completed":
            return {
                "status": "completed",
                "current_question_index": int(data.get("current_question_index", 0) or 0),
                "at_last_question": boss_defeated,
                "boss_defeated": boss_defeated,
                "party_defeated": bool(data.get("party_defeated", False)),
            }
        if bool(data.get("party_defeated", False)):
            return {
                "status": "completed",
                "current_question_index": int(data.get("current_question_index", 0) or 0),
                "at_last_question": False,
                "boss_defeated": boss_defeated,
                "party_defeated": True,
            }

        questions = data.get("questions", []) or []
        members = data.get("members", []) or []
        answers = data.get("answers", []) or []
        if not questions:
            return {"error": "No questions in this session"}

        current = max(0, min(int(data.get("current_question_index", 0)), len(questions) - 1))
        current_qid = str(questions[current].get("question_id"))
        answered_ids = {str(a.get("submitted_by")) for a in answers if a.get("question_id") == current_qid}
        missing_ids = [str(m.get("student_id")) for m in members if str(m.get("student_id")) not in answered_ids]
        if missing_ids:
            missing_names: List[str] = []
            for idx, sid in enumerate(missing_ids, start=1):
                cleaned = name_by_id.get(sid) or self._clean_member_name(
                    sid,
                    sid,
                    fallback_label=f"Teammate {idx}",
                )
                missing_names.append(cleaned)
            return {
                "error": f"Waiting for answers from: {', '.join(missing_names)}",
                "missing_answers": missing_ids,
                "missing_answer_names": missing_names,
            }

        next_idx = current + 1
        if next_idx < len(questions):
            ref.update(
                {
                    "current_question_index": next_idx,
                    "status": "active",
                    "current_question_started_at": _utc_now().isoformat(),
                }
            )
            return {
                "status": "active",
                "current_question_index": next_idx,
                "at_last_question": False,
                "boss_defeated": boss_defeated,
            }

        # End of current queue. If boss still alive, generate another round.
        if boss_defeated:
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
                created_by=created_by,
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
                "current_question_started_at": _utc_now().isoformat(),
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

        data = doc.to_dict() or {}
        battle_outcome = str(data.get("battle_outcome") or "pending")
        if bool(data.get("party_defeated", False)):
            battle_outcome = "defeat"
        elif bool(data.get("boss_defeated", False)):
            battle_outcome = "victory"

        ref.update(
            {
                "status": "completed",
                "battle_outcome": battle_outcome,
                "ended_at": _utc_now().isoformat(),
            }
        )
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
                        "level": data.get("level"),
                        "boss_character_id": data.get("boss_character_id"),
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
