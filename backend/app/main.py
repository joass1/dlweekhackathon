import json
import os
import pathlib
import json
import hmac
import hashlib
import base64
import time
import re
from datetime import datetime, timezone
from datetime import timedelta
from typing import Dict, Any, Dict, List, Optional
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import CharacterTextSplitter
from openai import OpenAI
from pydantic import BaseModel

from app.database.firebase_client import get_firestore_client
from app.middleware.auth import get_student_id
from app.models.adaptive_schemas import (
    BKTUpdateRequest,
    BKTUpdateResponse,
    ConceptStatePayload,
    DecayRequest,
    DecayResponse,
    MatchHubsRequest,
    MatchHubsResponse,
    MasteryRequest,
    MasteryResponse,
    RPKTProbeRequest,
    RPKTProbeResponse,
    StudyPlanRequest,
    StudyPlanResponse,
)
from app.models.schemas import SearchQuery, SearchResult
from app.models.schemas import (
    ClassifyResponse,
    EvaluateResponse,
    MicroCheckpointRequest,
    MicroCheckpointResponse,
    MicroCheckpointSubmitRequest,
    MicroCheckpointSubmitResponse,
    OverrideRequest,
    QuizGenerateRequest,
    QuizSubmitRequest,
    SelfAwarenessResponse,
)
from app.services.adaptive_engine import AdaptiveEngine, ConceptState
from app.services.knowledge_graph import KnowledgeGraphEngine, init_kg_engine, kg_engine
from app.services.vector_search import VectorSearch
from app.services.vector_search1 import VectorSearch1
from app.services.assessment_engine import AssessmentEngine, AssessmentStateStore
from app.services.tutor_service import TutorService
from app.services.peer_session_service import PeerSessionService
from app.models.peer_schemas import (
    CreateSessionRequest,
    CreateSessionResponse,
    JoinSessionRequest,
    SessionStateResponse,
    SubmitAnswerRequest,
    SubmitAnswerResponse,
    TwilioVideoTokenResponse,
)
from app.models.tutor_schemas import (
    EmbedContentRequest, EmbedContentResponse,
    RecommendationRequest, RecommendationResponse,
    RetrieveContextRequest,
    TutorChatRequest,
    CheckpointRequest, CheckpointSubmitRequest, CheckpointSubmitResponse,
    InterventionRequest, InterventionResponse,
    SessionData, SessionSummaryResponse,
)

os.environ["TOKENIZERS_PARALLELISM"] = "false"
BASE_DIR = pathlib.Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")

data_dir = pathlib.Path("data")
data_dir.mkdir(exist_ok=True)

app = FastAPI(title="Mentora API")
default_origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://192.168.0.100:3000",
]
extra_origins = [o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=[*default_origins, *extra_origins],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$|^https://.*\.ngrok(-free)?\.app$|^https://.*\.ngrok\.io$|^https://.*\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

adaptive_engine = AdaptiveEngine()
DEFAULT_COURSES = [
    {"id": "physics-101", "name": "Physics 101"},
    {"id": "data-structures", "name": "Data Structures"},
    {"id": "biology-intro", "name": "Introduction to Biology"},
]

try:
    db = get_firestore_client()
except Exception as e:
    db = None
    print(f"Warning: Firestore unavailable ({e}). Upload will still build KG.")

FirestoreAssessmentStore = None
FirestoreKnowledgeGraphStore = None
FirestoreConceptStateStore = None
if db is not None:
    try:
        from app.database.firestore_stores import (
            FirestoreAssessmentStore as _FirestoreAssessmentStore,
            FirestoreConceptStateStore as _FirestoreConceptStateStore,
            FirestoreKnowledgeGraphStore as _FirestoreKnowledgeGraphStore,
        )

        FirestoreAssessmentStore = _FirestoreAssessmentStore
        FirestoreKnowledgeGraphStore = _FirestoreKnowledgeGraphStore
        FirestoreConceptStateStore = _FirestoreConceptStateStore
    except Exception as e:
        print(f"Warning: Firestore stores unavailable ({e}). Falling back to local state stores.")
        db = None

vector_search = VectorSearch(db)
learning_groups_search = VectorSearch1(db)

if db is not None:
    assessment_store = FirestoreAssessmentStore(db)
    concept_state_store = FirestoreConceptStateStore(db)
    kg_store = FirestoreKnowledgeGraphStore(db)
else:
    assessment_store = AssessmentStateStore(data_dir / "assessment_state.json")
    concept_state_store = None
    kg_store = None

assessment_engine = AssessmentEngine(assessment_store)
kg_engine = init_kg_engine(kg_store)

openai_api_key = os.getenv("OPENAI_API_KEY")
if not openai_api_key:
    print("WARNING: OPENAI_API_KEY not set — AI tutor endpoints will fail at runtime")
_openai_client = OpenAI(api_key=openai_api_key) if openai_api_key else None
tutor_service = TutorService(db, _openai_client)
peer_session_service = PeerSessionService(db, _openai_client)
_comprehensive_quiz_unlocks: Dict[str, datetime] = {}
_comprehensive_quiz_tickets: Dict[str, str] = {}
_comprehensive_quiz_ticket_concepts: Dict[str, List[str]] = {}
_comprehensive_quiz_ticket_context: Dict[str, Dict[str, Optional[str]]] = {}
_local_concept_states: Dict[str, Dict[str, ConceptState]] = {}
COMPREHENSIVE_QUIZ_UNLOCK_MINUTES = 15


def _set_comprehensive_unlock(student_id: str, expires_at: datetime) -> None:
    _comprehensive_quiz_unlocks[student_id] = expires_at
    if db is None:
        return
    try:
        db.collection("students").document(student_id).set(
            {
                "comprehensive_quiz_unlock_until": expires_at.isoformat(),
            },
            merge=True,
        )
    except Exception:
        pass


def _get_comprehensive_unlock(student_id: str) -> Optional[datetime]:
    in_memory = _comprehensive_quiz_unlocks.get(student_id)
    if in_memory is not None:
        return in_memory
    if db is None:
        return None
    try:
        doc = db.collection("students").document(student_id).get()
        if not doc.exists:
            return None
        raw = (doc.to_dict() or {}).get("comprehensive_quiz_unlock_until")
        if not isinstance(raw, str) or not raw.strip():
            return None
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        _comprehensive_quiz_unlocks[student_id] = dt
        return dt
    except Exception:
        return None


def _consume_comprehensive_unlock(student_id: str) -> None:
    _comprehensive_quiz_unlocks.pop(student_id, None)
    if db is None:
        return
    try:
        db.collection("students").document(student_id).set(
            {
                "comprehensive_quiz_unlock_until": None,
            },
            merge=True,
        )
    except Exception:
        pass


def _set_comprehensive_ticket(
    student_id: str,
    ticket: str,
    expires_at: datetime,
    concepts: Optional[List[str]] = None,
    *,
    course_id: Optional[str] = None,
    topic_id: Optional[str] = None,
) -> None:
    _comprehensive_quiz_tickets[student_id] = ticket
    _comprehensive_quiz_ticket_concepts[student_id] = list(dict.fromkeys([c for c in (concepts or []) if c]))
    _comprehensive_quiz_ticket_context[student_id] = {
        "course_id": str(course_id or "").strip() or None,
        "topic_id": str(topic_id or "").strip() or None,
    }
    if db is None:
        return
    try:
        db.collection("students").document(student_id).set(
            {
                "comprehensive_quiz_ticket": ticket,
                "comprehensive_quiz_ticket_expires_at": expires_at.isoformat(),
                "comprehensive_quiz_ticket_concepts": _comprehensive_quiz_ticket_concepts.get(student_id, []),
                "comprehensive_quiz_ticket_context": _comprehensive_quiz_ticket_context.get(student_id, {}),
            },
            merge=True,
        )
    except Exception:
        pass


def _validate_and_consume_comprehensive_ticket(student_id: str, ticket: str) -> tuple[bool, Dict[str, Any]]:
    if not ticket:
        return False, {}
    in_memory = _comprehensive_quiz_tickets.get(student_id)
    if in_memory and in_memory == ticket:
        _comprehensive_quiz_tickets.pop(student_id, None)
        concepts = _comprehensive_quiz_ticket_concepts.pop(student_id, [])
        context = _comprehensive_quiz_ticket_context.pop(student_id, {})
        return True, {
            "concepts": concepts,
            "course_id": str(context.get("course_id") or "").strip() or None,
            "topic_id": str(context.get("topic_id") or "").strip() or None,
        }
    if db is None:
        return False, {}
    try:
        doc_ref = db.collection("students").document(student_id)
        doc = doc_ref.get()
        if not doc.exists:
            return False, {}
        data = doc.to_dict() or {}
        stored = str(data.get("comprehensive_quiz_ticket") or "")
        if stored != ticket:
            return False, {}
        raw_exp = data.get("comprehensive_quiz_ticket_expires_at")
        if not isinstance(raw_exp, str) or not raw_exp.strip():
            return False, {}
        exp = datetime.fromisoformat(raw_exp.replace("Z", "+00:00"))
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            return False, {}
        concepts = data.get("comprehensive_quiz_ticket_concepts") or []
        if not isinstance(concepts, list):
            concepts = []
        context = data.get("comprehensive_quiz_ticket_context") or {}
        if not isinstance(context, dict):
            context = {}
        doc_ref.set(
            {
                "comprehensive_quiz_ticket": None,
                "comprehensive_quiz_ticket_expires_at": None,
                "comprehensive_quiz_ticket_concepts": [],
                "comprehensive_quiz_ticket_context": {},
            },
            merge=True,
        )
        _comprehensive_quiz_tickets.pop(student_id, None)
        _comprehensive_quiz_ticket_concepts.pop(student_id, None)
        _comprehensive_quiz_ticket_context.pop(student_id, None)
        return True, {
            "concepts": [str(c) for c in concepts if str(c).strip()],
            "course_id": str(context.get("course_id") or "").strip() or None,
            "topic_id": str(context.get("topic_id") or "").strip() or None,
        }
    except Exception:
        return False, {}


def _courses_collection(student_id: str):
    if db is None:
        return None
    return db.collection("users").document(student_id).collection("courses")


def _slugify_identifier(value: str, fallback: str) -> str:
    token = "".join(ch.lower() if ch.isalnum() else "-" for ch in str(value or "").strip())
    token = re.sub(r"-{2,}", "-", token).strip("-")
    return token or fallback


def _normalize_topic_payload(topic_id: str, topic_name: str, fallback_name: str) -> tuple[str, str]:
    cleaned_name = str(topic_name or "").strip() or str(fallback_name or "").strip()
    cleaned_id = _slugify_identifier(topic_id or cleaned_name, "topic")
    if not cleaned_name:
        cleaned_name = cleaned_id.replace("-", " ").title()
    return cleaned_id, cleaned_name


def _user_topic_doc_id(student_id: str, course_id: str, topic_id: str) -> str:
    safe_student = _slugify_identifier(student_id, "user")
    safe_course = _slugify_identifier(course_id, "uncategorized")
    safe_topic = _slugify_identifier(topic_id, "topic")
    return f"{safe_student}__{safe_course}__{safe_topic}"


def _upsert_user_topic(
    *,
    student_id: str,
    course_id: str,
    course_name: str,
    topic_id: str,
    topic_name: str,
    chunk_delta: int,
) -> None:
    if db is None:
        return

    try:
        doc_id = _user_topic_doc_id(student_id, course_id, topic_id)
        ref = db.collection("user_topics").document(doc_id)
        existing = ref.get()
        existing_data = existing.to_dict() if existing.exists else {}
        prior_chunks = int(existing_data.get("chunkCount") or 0)
        payload = {
            "userId": student_id,
            "courseId": course_id or "uncategorized",
            "courseName": course_name or "Uncategorized",
            "topicId": topic_id,
            "topicName": topic_name,
            "conceptId": topic_id,  # backwards-compatible alias for tutor scoping
            "title": topic_name,
            "chunkCount": max(0, prior_chunks + max(0, int(chunk_delta or 0))),
            "updatedAt": datetime.now(timezone.utc),
        }
        if not existing.exists:
            payload["createdAt"] = datetime.now(timezone.utc)
        ref.set(payload, merge=True)
    except Exception as exc:
        print(f"Warning: failed to upsert user_topics for {student_id}: {exc}")

def _collect_material_context(
    student_id: str,
    course_id: Optional[str] = None,
    topic_id: Optional[str] = None,
    max_chars: int = 6000,
) -> str:
    """Best-effort retrieval of uploaded chunk text for quiz generation grounding."""
    if db is None:
        return ""
    try:
        col = db.collection(vector_search.collection_name)
        query = col.where("userId", "==", student_id)
        if course_id:
            query = query.where("course_id", "==", course_id)
        if topic_id:
            query = query.where("topic_id", "==", topic_id)
        try:
            docs = list(query.order_by("created_at", direction="DESCENDING").limit(30).stream())
        except Exception:
            docs = list(query.limit(30).stream())
        parts: List[str] = []
        total = 0
        for doc in docs:
            text = str((doc.to_dict() or {}).get("text") or "").strip()
            if not text:
                continue
            remaining = max_chars - total
            if remaining <= 0:
                break
            chunk = text[:remaining]
            parts.append(chunk)
            total += len(chunk)
        return "\n\n".join(parts)
    except Exception:
        return ""


def _get_user_kg_engine(student_id: str) -> KnowledgeGraphEngine:
    if db is None or FirestoreKnowledgeGraphStore is None:
        return kg_engine

    user_store = FirestoreKnowledgeGraphStore(db, graph_id=f"user_{student_id}")
    user_engine = KnowledgeGraphEngine(firestore_store=user_store)
    user_engine.load_from_firestore()
    return user_engine


def _clean_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if len(value) >= 2 and ((value[0] == value[-1] == '"') or (value[0] == value[-1] == "'")):
        value = value[1:-1].strip()
    return value


def _normalize_lookup(value: str) -> str:
    return "".join(ch for ch in value.lower() if ch.isalnum())


def _b64url_json(data: dict) -> str:
    raw = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_bytes(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _create_twilio_video_jwt_without_sdk(
    account_sid: str,
    api_key_sid: str,
    api_key_secret: str,
    identity: str,
    room_name: str,
    ttl_seconds: int,
) -> str:
    now = int(time.time())
    header = {"typ": "JWT", "alg": "HS256", "cty": "twilio-fpa;v=1"}
    payload = {
        "jti": f"{api_key_sid}-{now}",
        "iss": api_key_sid,
        "sub": account_sid,
        "exp": now + ttl_seconds,
        "nbf": now,
        "grants": {
            "identity": identity,
            "video": {"room": room_name},
        },
    }
    signing_input = f"{_b64url_json(header)}.{_b64url_json(payload)}"
    signature = hmac.new(
        api_key_secret.encode("utf-8"),
        signing_input.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"{signing_input}.{_b64url_bytes(signature)}"


def _resolve_user_concept_id(raw_concept: str, nodes: List[dict]) -> Optional[str]:
    if not raw_concept:
        return None

    exact = next((n for n in nodes if str(n.get("id", "")) == raw_concept), None)
    if exact:
        return str(exact.get("id"))

    lookup = _normalize_lookup(raw_concept)
    if not lookup:
        return None
    for node in nodes:
        node_id = str(node.get("id", ""))
        title = str(node.get("title", ""))
        if _normalize_lookup(node_id) == lookup or _normalize_lookup(title) == lookup:
            return node_id
    return None


def _get_existing_checkpoint_concepts(
    student_id: str,
    topic_id: str,
    limit: int = 12,
) -> List[Dict[str, str]]:
    try:
        user_kg_engine = _get_user_kg_engine(student_id)
        nodes = user_kg_engine.get_graph_data().get("nodes", [])
    except Exception:
        return []

    topic_lookup = _normalize_lookup(topic_id or "")
    exact_resolved = _resolve_user_concept_id(topic_id, nodes)
    matches: List[Dict[str, str]] = []
    seen: set[str] = set()

    def add_node(node: dict) -> None:
        node_id = str(node.get("id") or "").strip()
        title = str(node.get("title") or node_id).strip() or node_id
        if not node_id or node_id in seen:
            return
        seen.add(node_id)
        matches.append({"id": node_id, "title": title})

    if exact_resolved:
        exact_node = next((node for node in nodes if str(node.get("id") or "").strip() == exact_resolved), None)
        if exact_node:
            add_node(exact_node)

    for node in nodes:
        node_id = str(node.get("id") or "").strip()
        title = str(node.get("title") or "").strip()
        topic_ids = node.get("topicIds") or node.get("topic_ids") or []
        normalized_topic_ids = {_normalize_lookup(str(value)) for value in topic_ids if str(value).strip()}
        belongs_to_topic = False
        if topic_lookup:
            belongs_to_topic = (
                _normalize_lookup(node_id) == topic_lookup
                or _normalize_lookup(title) == topic_lookup
                or topic_lookup in normalized_topic_ids
            )
        if belongs_to_topic:
            add_node(node)
        if len(matches) >= limit:
            break

    return matches[:limit]


def _clamp_float(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _parse_state_datetime(value: Any, default: Optional[datetime] = None) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except ValueError:
            pass
    return default or datetime.now(timezone.utc)


def _seed_bkt_state_from_kg(student_id: str, concept_id: str) -> ConceptState:
    seeded = ConceptState(concept_id=concept_id).normalized()
    try:
        user_kg_engine = _get_user_kg_engine(student_id)
        node = next(
            (
                item
                for item in user_kg_engine.get_graph_data().get("nodes", [])
                if str(item.get("id", "")).strip() == concept_id
            ),
            None,
        )
        if not node:
            return seeded
        seeded.mastery = _clamp_float(float(node.get("mastery", 0.0) or 0.0) / 100.0)
        seeded.attempts = int(node.get("attemptCount", 0) or 0)
        seeded.correct = int(node.get("correctCount", 0) or 0)
        seeded.careless_count = int(node.get("carelessCount", 0) or 0)
        seeded.last_updated = _parse_state_datetime(
            node.get("lastPracticeAt") or node.get("updatedAt"),
            seeded.last_updated,
        )
        return seeded.normalized()
    except Exception:
        return seeded


def _load_student_concept_state(student_id: str, concept_id: str) -> ConceptState:
    seeded = _seed_bkt_state_from_kg(student_id, concept_id)
    if concept_state_store is not None:
        data = concept_state_store.get_state(student_id, concept_id)
        if data:
            return ConceptState(
                concept_id=concept_id,
                mastery=float(data.get("mastery", seeded.mastery)),
                p_learn=float(data.get("p_learn", seeded.p_learn)),
                p_guess=float(data.get("p_guess", seeded.p_guess)),
                p_slip=float(data.get("p_slip", seeded.p_slip)),
                decay_rate=float(data.get("decay_rate", seeded.decay_rate)),
                last_updated=_parse_state_datetime(data.get("last_updated"), seeded.last_updated),
                attempts=int(data.get("attempts", seeded.attempts) or 0),
                correct=int(data.get("correct", seeded.correct) or 0),
                careless_count=int(data.get("careless_count", seeded.careless_count) or 0),
            ).normalized()
        return seeded

    cached = _local_concept_states.setdefault(student_id, {}).get(concept_id)
    if cached is not None:
        return ConceptState(**cached.__dict__).normalized()
    _local_concept_states.setdefault(student_id, {})[concept_id] = ConceptState(**seeded.__dict__).normalized()
    return seeded


def _save_student_concept_state(student_id: str, state: ConceptState) -> None:
    normalized = ConceptState(**state.__dict__).normalized()
    if concept_state_store is not None:
        concept_state_store.save_state(
            student_id,
            normalized.concept_id,
            {
                "concept_id": normalized.concept_id,
                "mastery": normalized.mastery,
                "p_learn": normalized.p_learn,
                "p_guess": normalized.p_guess,
                "p_slip": normalized.p_slip,
                "decay_rate": normalized.decay_rate,
                "last_updated": normalized.last_updated,
                "attempts": normalized.attempts,
                "correct": normalized.correct,
                "careless_count": normalized.careless_count,
            },
        )
        return
    _local_concept_states.setdefault(student_id, {})[normalized.concept_id] = normalized


def _calibrate_bkt_state(
    *,
    bkt_result: Dict[str, Any],
    updated_state: ConceptState,
    is_correct: bool,
    mistake_type: Optional[str],
    confidence_1_to_5: Optional[int],
    update_origin: str,
) -> ConceptState:
    prior_after_decay = float(bkt_result.get("mastery_after_decay", updated_state.mastery) or updated_state.mastery)
    raw_updated = float(bkt_result.get("updated_mastery", updated_state.mastery) or updated_state.mastery)
    origin = (update_origin or "assessment").strip().lower()
    normalized_mistake = (mistake_type or "normal").strip().lower()

    base_weight = {
        "assessment": 0.42,
        "assessment_checkpoint": 0.3,
        "tutor_checkpoint": 0.22,
    }.get(origin, 0.5)
    max_gain = {
        "assessment": 0.08,
        "assessment_checkpoint": 0.05,
        "tutor_checkpoint": 0.03,
    }.get(origin, 0.12)
    max_drop = {
        "assessment": 0.09,
        "assessment_checkpoint": 0.06,
        "tutor_checkpoint": 0.04,
    }.get(origin, 0.1)

    if confidence_1_to_5 is None:
        confidence_weight = 1.0
    else:
        clamped_conf = max(1, min(5, int(confidence_1_to_5)))
        confidence_norm = (clamped_conf - 1) / 4.0
        if is_correct:
            confidence_weight = 0.75 + 0.25 * confidence_norm
        elif normalized_mistake == "careless":
            confidence_weight = 0.7 + 0.15 * confidence_norm
        else:
            confidence_weight = 0.8 + 0.2 * confidence_norm

    target_mastery = prior_after_decay + (raw_updated - prior_after_decay) * base_weight * confidence_weight
    delta = target_mastery - prior_after_decay
    delta = max(-max_drop, min(max_gain, delta))
    if not is_correct:
        # Wrong answers should never surface as mastery gains in product UX.
        # Careless misses are capped at neutral-to-small-negative; conceptual misses
        # can fall further, but never rise above the prior state.
        if normalized_mistake == "careless":
            delta = max(-min(max_drop, 0.015), min(0.0, delta))
        else:
            delta = min(0.0, delta)

    calibrated = ConceptState(**updated_state.__dict__).normalized()
    calibrated.mastery = _clamp_float(prior_after_decay + delta)
    return calibrated.normalized()

def _apply_user_kg_update(
    student_id: str,
    concept: str,
    is_correct: bool,
    mistake_type: Optional[str] = None,
    confidence_1_to_5: Optional[int] = None,
    missing_concept: Optional[str] = None,
    classification_rationale: Optional[str] = None,
    classification_source: Optional[str] = None,
    classification_model: Optional[str] = None,
    update_origin: str = "assessment",
) -> Optional[dict]:
    try:
        user_kg_engine = _get_user_kg_engine(student_id)
        nodes = user_kg_engine.get_graph_data().get("nodes", [])
        concept_id = _resolve_user_concept_id(concept, nodes)
        if not concept_id:
            return None
        current_state = _load_student_concept_state(student_id, concept_id)
        interaction_time = datetime.now(timezone.utc)
        bkt_result = adaptive_engine.update_bkt(
            state=current_state,
            is_correct=is_correct,
            interaction_time=interaction_time,
            mistake_type="careless" if (mistake_type or "").strip().lower() == "careless" else "normal",
            careless_penalty=0.02,
        )
        updated_state: ConceptState = bkt_result["state"]  # type: ignore[assignment]
        calibrated_state = _calibrate_bkt_state(
            bkt_result=bkt_result,
            updated_state=updated_state,
            is_correct=is_correct,
            mistake_type=mistake_type,
            confidence_1_to_5=confidence_1_to_5,
            update_origin=update_origin,
        )
        _save_student_concept_state(student_id, calibrated_state)
        result = user_kg_engine.sync_bkt_state(
            concept_id=concept_id,
            state=calibrated_state,
            is_correct=is_correct,
            mistake_type=mistake_type,
            missing_concept=missing_concept,
            classification_source=classification_source,
            classification_model=classification_model,
            classification_rationale=classification_rationale,
            classified_at=interaction_time.isoformat(),
        )
        prior_after_decay = float(bkt_result.get("mastery_after_decay", current_state.mastery) or current_state.mastery)
        return {
            "concept_id": concept_id,
            "is_correct": is_correct,
            "mistake_type": mistake_type,
            "confidence_1_to_5": confidence_1_to_5,
            "missing_concept": missing_concept,
            "classification_source": classification_source,
            "classification_model": classification_model,
            "mastery_algorithm": "bkt",
            "prior_mastery": round(prior_after_decay, 6),
            "updated_mastery": round(calibrated_state.mastery, 6),
            "delta_mastery": round(calibrated_state.mastery - prior_after_decay, 6),
            "status": "updated",
            "node": result.get("node"),
            "prerequisite_gaps": result.get("prerequisite_gaps"),
            "root_gap": result.get("root_gap"),
        }
    except Exception as e:
        return {
            "concept_id": concept,
            "is_correct": is_correct,
            "mistake_type": mistake_type,
            "confidence_1_to_5": confidence_1_to_5,
            "missing_concept": missing_concept,
            "classification_source": classification_source,
            "classification_model": classification_model,
            "mastery_algorithm": "bkt",
            "status": "failed",
            "error": str(e),
        }
def process_file(file_path: str) -> List[str]:
    splitter = CharacterTextSplitter(chunk_size=500, chunk_overlap=50)
    suffix = pathlib.Path(file_path).suffix.lower()
    if suffix == ".pdf":
        loader = PyPDFLoader(file_path)
    elif suffix in {".txt", ".md"}:
        loader = TextLoader(file_path)
    else:
        raise ValueError(f"Unsupported file type: {suffix or 'unknown'}. Supported types: .pdf, .txt, .md")
    docs = loader.load()
    full_text = "".join(doc.page_content for doc in docs).strip()
    if not full_text:
        return []
    return splitter.split_text(full_text)


@app.get("/")
async def root():
    return {"message": "Mentora API is running"}


@app.get("/test")
async def test_connection():
    if db is None:
        raise HTTPException(status_code=500, detail="Firestore is not initialized")
    try:
        list(db.collection(vector_search.collection_name).limit(1).stream())
        return {
            "status": "success",
            "database": "firebase_firestore",
            "knowledge_chunks_collection": vector_search.collection_name,
            "learning_analytics_collection": learning_groups_search.collection_name,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Firestore connection failed: {str(e)}")


@app.post("/search", response_model=List[SearchResult])
async def search_discussions(query: SearchQuery):
    try:
        return vector_search.search_discussions(query.query, query.limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error performing search: {str(e)}")


class CourseCreateRequest(BaseModel):
    name: str
    id: Optional[str] = None


class CourseUpdateRequest(BaseModel):
    name: str


class StudyMissionChunksRequest(BaseModel):
    course_id: Optional[str] = None
    topic_ids: Optional[List[str]] = None
    concept_ids: Optional[List[str]] = None
    limit: int = 80


class StudyMissionFlashcardsRequest(BaseModel):
    course_id: Optional[str] = None
    topic_ids: Optional[List[str]] = None
    concept_ids: Optional[List[str]] = None
    num_cards: int = 12
    chunk_limit: int = 120


@app.get("/api/courses")
async def get_courses(student_id: str = Depends(get_student_id)):
    if db is None:
        # Firestore unavailable: derive course list from the user's KG nodes.
        try:
            user_kg_engine = _get_user_kg_engine(student_id)
            nodes = user_kg_engine.get_graph_data().get("nodes", [])
            seen: Dict[str, str] = {}
            for node in nodes:
                course_id = str((node or {}).get("courseId") or "").strip()
                if not course_id or course_id in seen:
                    continue
                category = str((node or {}).get("category") or "").strip()
                name = category or course_id.replace("-", " ").replace("_", " ").title()
                seen[course_id] = name

            courses = sorted(
                [{"id": cid, "name": cname} for cid, cname in seen.items()],
                key=lambda x: x["name"].lower(),
            )
            if courses:
                return {"courses": courses}
        except Exception as e:
            print(f"Warning: failed to infer courses from local KG for {student_id}: {e}")

        return {"courses": DEFAULT_COURSES}
    try:
        courses_col = _courses_collection(student_id)
        if courses_col is None:
            return {"courses": []}

        docs = courses_col.stream()
        courses = sorted(
            [
                {"id": str((d.to_dict() or {}).get("id", d.id)), "name": str((d.to_dict() or {}).get("name", d.id))}
                for d in docs
            ],
            key=lambda x: x["name"].lower(),
        )
        return {"courses": courses}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load courses: {str(e)}")


@app.post("/api/courses")
async def create_course(request: CourseCreateRequest, student_id: str = Depends(get_student_id)):
    name = (request.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Course name is required")

    course_id = (request.id or name.lower()).strip()
    course_id = "".join(ch if ch.isalnum() else "-" for ch in course_id).strip("-")
    if not course_id:
        course_id = "course"

    if db is None:
        return {"course": {"id": course_id, "name": name}}

    try:
        courses_col = _courses_collection(student_id)
        if courses_col is None:
            return {"course": {"id": course_id, "name": name}}

        ref = courses_col.document(course_id)
        if ref.get().exists:
            data = ref.get().to_dict() or {}
            return {"course": {"id": course_id, "name": str(data.get("name", name))}}

        payload = {"id": course_id, "name": name, "userId": student_id, "created_at": datetime.now(timezone.utc)}
        ref.set(payload)
        return {"course": {"id": course_id, "name": name}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create course: {str(e)}")


@app.patch("/api/courses/{course_id}")
async def update_course(course_id: str, request: CourseUpdateRequest, student_id: str = Depends(get_student_id)):
    next_name = (request.name or "").strip()
    if not next_name:
        raise HTTPException(status_code=400, detail="Course name is required")

    normalized_course_id = _slugify_identifier(course_id, "course")
    if db is None:
        return {"course": {"id": normalized_course_id, "name": next_name}, "topic_rows_updated": 0, "chunks_updated": 0}

    try:
        courses_col = _courses_collection(student_id)
        if courses_col is None:
            raise HTTPException(status_code=503, detail="Courses collection unavailable")

        course_ref = courses_col.document(normalized_course_id)
        course_snap = course_ref.get()
        if course_snap.exists:
            existing = course_snap.to_dict() or {}
            if existing.get("userId") and existing.get("userId") != student_id:
                raise HTTPException(status_code=403, detail="Not authorized")

        now = datetime.now(timezone.utc)
        course_ref.set(
            {
                "id": normalized_course_id,
                "name": next_name,
                "userId": student_id,
                "updated_at": now,
            },
            merge=True,
        )

        topic_refs: List[Any] = []
        try:
            topics = (
                db.collection("user_topics")
                .where("userId", "==", student_id)
                .where("courseId", "==", normalized_course_id)
                .stream()
            )
            topic_refs = [topic_doc.reference for topic_doc in topics]
        except Exception as exc:
            print(f"Warning: failed to query user_topics for course rename user={student_id} course={normalized_course_id}: {exc}")

        if topic_refs:
            batch = db.batch()
            pending_writes = 0
            for topic_ref in topic_refs:
                batch.update(
                    topic_ref,
                    {
                        "courseName": next_name,
                        "updatedAt": now,
                    },
                )
                pending_writes += 1
                if pending_writes >= 400:
                    batch.commit()
                    batch = db.batch()
                    pending_writes = 0
            if pending_writes > 0:
                batch.commit()

        chunk_refs: List[Any] = []
        try:
            chunks = (
                db.collection(vector_search.collection_name)
                .where("userId", "==", student_id)
                .where("course_id", "==", normalized_course_id)
                .stream()
            )
            chunk_refs = [chunk_doc.reference for chunk_doc in chunks]
        except Exception as exc:
            print(
                f"Warning: failed to query knowledge chunks for course rename "
                f"user={student_id} course={normalized_course_id}: {exc}"
            )

        if chunk_refs:
            batch = db.batch()
            pending_writes = 0
            for chunk_ref in chunk_refs:
                batch.update(
                    chunk_ref,
                    {
                        "course_name": next_name,
                        "updated_at": now,
                    },
                )
                pending_writes += 1
                if pending_writes >= 400:
                    batch.commit()
                    batch = db.batch()
                    pending_writes = 0
            if pending_writes > 0:
                batch.commit()

        return {
            "course": {"id": normalized_course_id, "name": next_name},
            "topic_rows_updated": len(topic_refs),
            "chunks_updated": len(chunk_refs),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update course: {str(e)}")


@app.delete("/api/courses/{course_id}")
async def delete_course(course_id: str, student_id: str = Depends(get_student_id)):
    normalized_course_id = _slugify_identifier(course_id, "course")
    if db is None:
        return {"status": "deleted", "course_id": normalized_course_id}

    try:
        courses_col = _courses_collection(student_id)
        if courses_col is None:
            raise HTTPException(status_code=503, detail="Courses collection unavailable")

        course_ref = courses_col.document(normalized_course_id)
        snap = course_ref.get()
        if snap.exists:
            data = snap.to_dict() or {}
            if data.get("userId") and data.get("userId") != student_id:
                raise HTTPException(status_code=403, detail="Not authorized")
            course_ref.delete()

        # Delete all user_topics belonging to this course
        try:
            topic_docs = (
                db.collection("user_topics")
                .where("userId", "==", student_id)
                .where("courseId", "==", normalized_course_id)
                .stream()
            )
            batch = db.batch()
            pending = 0
            for topic_doc in topic_docs:
                batch.delete(topic_doc.reference)
                pending += 1
                if pending >= 400:
                    batch.commit()
                    batch = db.batch()
                    pending = 0
            if pending > 0:
                batch.commit()
        except Exception as exc:
            print(f"Warning: cascade delete of user_topics failed for course={normalized_course_id}: {exc}")

        # Remove KG nodes belonging to this course
        try:
            user_kg_engine = _get_user_kg_engine(student_id)
            removed = user_kg_engine.remove_nodes_by_course(normalized_course_id)
            print(f"Removed {removed} KG nodes for course={normalized_course_id}")
        except Exception as exc:
            print(f"Warning: KG node removal failed for course={normalized_course_id}: {exc}")

        return {"status": "deleted", "course_id": normalized_course_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete course: {str(e)}")


_STUDY_MISSION_FLASHCARD_STOPWORDS = {
    "about", "above", "after", "again", "against", "among", "and", "because", "before", "being",
    "between", "both", "could", "during", "each", "from", "have", "into", "just", "like", "many",
    "more", "most", "must", "other", "over", "some", "such", "that", "their", "there", "these",
    "they", "this", "those", "through", "under", "using", "very", "what", "when", "where", "which",
    "while", "with", "would", "your",
}


def _is_low_value_flashcard(front: str, back: str) -> bool:
    front_text = re.sub(r"\s+", " ", str(front or "")).strip().lower()
    back_text = re.sub(r"\s+", " ", str(back or "")).strip().lower()
    if not front_text or not back_text:
        return True

    answer_text = back_text
    if answer_text.startswith("correct answer:"):
        answer_text = answer_text[len("correct answer:"):].strip()
    if not answer_text or answer_text in {"not available", "n/a"}:
        return True
    if answer_text in front_text or front_text in answer_text:
        return True

    front_tokens = {
        token for token in re.findall(r"[a-z0-9]{3,}", front_text)
        if token not in _STUDY_MISSION_FLASHCARD_STOPWORDS
    }
    answer_tokens = {
        token for token in re.findall(r"[a-z0-9]{3,}", answer_text)
        if token not in _STUDY_MISSION_FLASHCARD_STOPWORDS
    }
    if front_tokens and answer_tokens:
        union = front_tokens | answer_tokens
        overlap = front_tokens & answer_tokens
        if (len(overlap) / max(1, len(union))) >= 0.72 and len(overlap) >= 5:
            return True
    return False


def _load_study_mission_chunks(
    student_id: str,
    course_id: Optional[str],
    topic_ids: Optional[List[str]],
    concept_ids: Optional[List[str]],
    limit: int,
) -> List[Dict[str, Any]]:
    if db is None:
        return []

    safe_limit = max(10, min(240, int(limit or 80)))
    stream_limit = min(900, max(safe_limit * 4, 160))
    docs = list(
        db.collection(vector_search.collection_name)
        .where("userId", "==", student_id)
        .limit(stream_limit)
        .stream()
    )

    selected_course = (course_id or "").strip()
    scoped_course_id = selected_course if selected_course and selected_course != "all" else None
    preferred_topics = [
        str(topic_id).strip()
        for topic_id in (topic_ids or [])
        if str(topic_id).strip() and str(topic_id).strip().lower() not in {"all", "__all__"}
    ]
    topic_filter = set(preferred_topics)
    preferred_concepts = [
        str(concept_id).strip()
        for concept_id in (concept_ids or [])
        if str(concept_id).strip()
    ]
    concept_filter = set(preferred_concepts)
    concept_rank = {concept_id: index for index, concept_id in enumerate(preferred_concepts)}

    def collect_chunks(apply_concept_filter: bool) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        for doc in docs:
            data = doc.to_dict() or {}
            text = str(data.get("text") or "").strip()
            if not text:
                continue

            chunk_course_id = str(data.get("course_id") or "").strip()
            chunk_concept_id = str(data.get("concept_id") or "").strip()
            chunk_topic_id = str(data.get("topic_id") or "").strip()
            if scoped_course_id and chunk_course_id != scoped_course_id:
                continue
            topic_match_id = chunk_topic_id or chunk_concept_id
            if topic_filter and topic_match_id not in topic_filter:
                continue
            if apply_concept_filter and concept_filter and chunk_concept_id not in concept_filter:
                continue

            chunk_index_raw = data.get("chunk_index", 0)
            chunk_index = int(chunk_index_raw) if isinstance(chunk_index_raw, (int, float)) else 0

            rows.append(
                {
                    "id": doc.id,
                    "text": text,
                    "source": str(data.get("source") or ""),
                    "course_id": chunk_course_id or None,
                    "course_name": str(data.get("course_name") or ""),
                    "topic_id": chunk_topic_id or topic_match_id or None,
                    "topic_name": str(data.get("topic_name") or ""),
                    "concept_id": chunk_concept_id,
                    "chunk_index": chunk_index,
                }
            )
        return rows

    chunks = collect_chunks(apply_concept_filter=True)
    if not chunks and concept_filter:
        chunks = collect_chunks(apply_concept_filter=False)

    if concept_filter:
        chunks.sort(
            key=lambda row: (
                concept_rank.get(str(row.get("concept_id") or ""), 10_000),
                int(row.get("chunk_index") or 0),
                str(row.get("id") or ""),
            )
        )
    else:
        chunks.sort(
            key=lambda row: (
                str(row.get("concept_id") or ""),
                int(row.get("chunk_index") or 0),
                str(row.get("id") or ""),
            )
        )

    return chunks[:safe_limit]


def _fallback_study_mission_flashcards(chunks: List[Dict[str, Any]], num_cards: int) -> List[Dict[str, Any]]:
    cards: List[Dict[str, Any]] = []
    seen = set()

    def _truncate(text: str, max_len: int) -> str:
        cleaned = re.sub(r"\s+", " ", (text or "")).strip()
        if len(cleaned) <= max_len:
            return cleaned
        return cleaned[: max_len - 3].rstrip() + "..."

    def _format_back(answer_text: str) -> str:
        payload = _truncate(answer_text, 203)
        return f"Correct answer: {payload}" if payload else "Correct answer: Not available"

    def _build_card_from_sentence(source_label: str, concept_id: str, sentence: str) -> Optional[Dict[str, Any]]:
        sentence = _truncate(sentence, 200)
        if not sentence:
            return None

        lowered = sentence.lower()
        definition_match = re.match(
            r'^"?([A-Za-z][A-Za-z0-9\s\-/()]{2,80}?)\s+(?:is|are|means|refers to|describes)\s+(.+)$',
            sentence,
            flags=re.IGNORECASE,
        )
        if definition_match:
            term = _truncate(definition_match.group(1).strip(' "'), 90)
            explanation = _truncate(definition_match.group(2).strip(' ".'), 180)
            return {
                "front": _truncate(f'In {source_label}, what does "{term}" mean?', 240),
                "back": _format_back(explanation),
                "tags": ["definition", "Fallback"],
                "concept_id": concept_id,
                "source": source_label,
            }

        if " because " in lowered:
            parts = re.split(r"\sbecause\s", sentence, maxsplit=1, flags=re.IGNORECASE)
            if len(parts) == 2:
                lhs = _truncate(parts[0].strip(' ".'), 130)
                rhs = _truncate(parts[1].strip(' ".'), 170)
                if lhs and rhs:
                    return {
                        "front": _truncate(f'In {source_label}, why does "{lhs}" occur?', 240),
                        "back": _format_back(rhs),
                        "tags": ["diagnostic", "Fallback"],
                        "concept_id": concept_id,
                        "source": source_label,
                    }

        if " therefore " in lowered or " thus " in lowered:
            parts = re.split(r"\s(?:therefore|thus)\s", sentence, maxsplit=1, flags=re.IGNORECASE)
            if len(parts) == 2:
                premise = _truncate(parts[0].strip(' ".'), 130)
                outcome = _truncate(parts[1].strip(' ".'), 170)
                if premise and outcome:
                    return {
                        "front": _truncate(f'In {source_label}, what follows from "{premise}"?', 240),
                        "back": _format_back(outcome),
                        "tags": ["diagnostic", "Fallback"],
                        "concept_id": concept_id,
                        "source": source_label,
                    }

        conditional_match = re.match(
            r'^\s*(if|when|unless|given)\s+(.+?),\s*(.+)$',
            sentence,
            flags=re.IGNORECASE,
        )
        if conditional_match:
            condition = _truncate(conditional_match.group(2).strip(' ".'), 130)
            result = _truncate(conditional_match.group(3).strip(' ".'), 170)
            if condition and result:
                stem = "Under what condition does this apply"
                if conditional_match.group(1).lower() == "unless":
                    stem = "What exception condition applies"
                return {
                    "front": _truncate(f"In {source_label}, {stem}: {result}?", 240),
                    "back": _format_back(condition),
                    "tags": ["application", "Fallback"],
                    "concept_id": concept_id,
                    "source": source_label,
                }

        if any(marker in lowered for marker in [" compared to ", " unlike ", " whereas ", " vs "]):
            return {
                "front": _truncate(f"In {source_label}, what distinction is being made here?", 240),
                "back": _format_back(sentence),
                "tags": ["comparison", "Fallback"],
                "concept_id": concept_id,
                "source": source_label,
            }

        if any(marker in lowered for marker in [" first ", " then ", " next ", " finally ", " step "]):
            return {
                "front": _truncate(f"In {source_label}, what process is this sentence describing?", 240),
                "back": "Correct answer: Identify the ordered steps stated in the source chunk.",
                "tags": ["procedure", "Fallback"],
                "concept_id": concept_id,
                "source": source_label,
            }

        return None

    for chunk in chunks:
        chunk_text = re.sub(r"\s+", " ", str(chunk.get("text") or "")).strip()
        if not chunk_text:
            continue

        source_label = str(chunk.get("source") or chunk.get("course_name") or "course material").strip() or "course material"
        concept_id = str(chunk.get("concept_id") or "course-material").strip() or "course-material"
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", chunk_text) if s.strip()]

        for sentence in sentences:
            if "_____" in sentence or len(sentence) < 45 or len(sentence) > 260:
                continue

            generated = _build_card_from_sentence(source_label, concept_id, sentence)
            if not generated:
                continue
            front = str(generated.get("front") or "").strip()
            back = str(generated.get("back") or "").strip()
            if not front or not back or _is_low_value_flashcard(front, back):
                continue

            dedupe_key = f"{front.lower()}|{back.lower()}"
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)

            cards.append(
                {
                    "id": f"fallback-{len(cards) + 1}",
                    "concept_id": str(generated.get("concept_id") or concept_id),
                    "front": front,
                    "back": back,
                    "tags": list(generated.get("tags") or ["Fallback"]),
                    "source": str(generated.get("source") or source_label),
                }
            )
            if len(cards) >= num_cards:
                break
        if len(cards) >= num_cards:
            break

    if not cards:
        for chunk in chunks[:num_cards]:
            source_label = str(chunk.get("source") or chunk.get("course_name") or "course material").strip() or "course material"
            concept_id = str(chunk.get("concept_id") or "course-material").strip() or "course-material"
            cards.append(
                {
                    "id": f"fallback-{len(cards) + 1}",
                    "concept_id": concept_id,
                    "front": _truncate(f"In {source_label}, what core concept should you revise next for assessment?", 240),
                    "back": "Correct answer: Review the highest-priority concept in this source chunk and summarize it in your own words.",
                    "tags": ["diagnostic", "Fallback"],
                    "source": source_label,
                }
            )

    if cards and len(cards) < num_cards:
        base_cards = list(cards)
        clone_index = 0
        while len(cards) < num_cards:
            src = dict(base_cards[clone_index % len(base_cards)])
            src["id"] = f"{src.get('id', 'fallback')}-repeat-{clone_index + 1}"
            cards.append(src)
            clone_index += 1

    return cards[:num_cards]


def _generate_study_mission_flashcards_with_ai(chunks: List[Dict[str, Any]], num_cards: int) -> List[Dict[str, Any]]:
    if not chunks:
        return []
    if _openai_client is None:
        return _fallback_study_mission_flashcards(chunks, num_cards)

    payload_chunks = []
    for index, chunk in enumerate(chunks[:160], start=1):
        chunk_text = re.sub(r"\s+", " ", str(chunk.get("text") or "")).strip()
        if not chunk_text:
            continue
        payload_chunks.append(
            {
                "index": index,
                "concept_id": str(chunk.get("concept_id") or ""),
                "source": str(chunk.get("source") or chunk.get("course_name") or "course material"),
                "text": chunk_text[:520],
            }
        )

    if not payload_chunks:
        return []

    system_prompt = (
        "You are an expert flashcard writer for spaced repetition and active recall.\n"
        "Create high-quality flashcards ONLY from the supplied chunks.\n"
        "Do NOT use outside knowledge. If a fact is not explicitly supported by the chunks, do not include it.\n"
        "\n"
        "OUTPUT FORMAT (STRICT):\n"
        "Return a single JSON object with exactly one top-level key: \"flashcards\".\n"
        "\"flashcards\" must be an array of objects. No other top-level keys.\n"
        "Each flashcard object must have EXACTLY these keys (no extras):\n"
        "- front (string)\n"
        "- back (string)\n"
        "- concept_id (string)\n"
        "- source (string)\n"
        "- tags (array of strings)\n"
        "\n"
        "CONTENT RULES:\n"
        "- Every flashcard must be grounded in one or more supplied chunks.\n"
        "- Assign concept_id and source from chunk metadata (never invent ids).\n"
        "- Each card must test exactly one concept.\n"
        "- Prioritize understanding, application, diagnosis, comparison, and decision-making.\n"
        "- Questions must be useful for exam prep or mastery improvement, not surface recall.\n"
        "- Avoid vague prompts; each question must be answerable precisely from the chunks.\n"
        "\n"
        "LOW-VALUE QUESTION BAN (DO NOT GENERATE):\n"
        "- No fill-in-the-blank/cloze cards.\n"
        "- No trivia-style cards focused on incidental names, places, dates, or anecdotes unless central to the concept.\n"
        "- No cards that only test copying a sentence fragment from text.\n"
        "- No cards with ambiguous expected answers.\n"
        "- If a chunk is too narrative/noisy to produce a meaningful study question, skip it.\n"
        "\n"
        "TEXT CONSTRAINTS:\n"
        "- front: <= 240 characters.\n"
        "- back: <= 220 characters.\n"
        "- back MUST start exactly with: \"Correct answer: \"\n"
        "- No markdown, no bullet lists, no code fences.\n"
        "\n"
        "QUALITY GUIDELINES:\n"
        "- Use diverse stems: define, compare, diagnose, predict, choose best next step, explain why.\n"
        "- Include a concise explanation in the back when space allows.\n"
        "- Include at least one tag from: ['definition','application','comparison','procedure','pitfall','diagnostic','example'].\n"
        "\n"
        "SAFETY / VALIDATION:\n"
        "- If chunks do not support a high-quality card for a concept_id, omit it.\n"
        "- It is better to return fewer cards than low-quality cards.\n"
        "- Do not include any text outside the JSON object.\n"
    )

    user_payload = {
        "target_cards": num_cards,
        "chunks": payload_chunks,
    }

    try:
        completion = _openai_client.chat.completions.create(
            model="gpt-5.2",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_payload)},
            ],
        )
        raw = (completion.choices[0].message.content or "{}").strip()
        try:
            parsed = json.loads(raw)
        except Exception:
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            parsed = json.loads(match.group(0)) if match else {}

        result_cards = parsed.get("flashcards") if isinstance(parsed, dict) else []
        normalized_cards: List[Dict[str, Any]] = []
        seen_prompts = set()

        for idx, row in enumerate(result_cards or []):
            if not isinstance(row, dict):
                continue
            front = re.sub(r"\s+", " ", str(row.get("front") or row.get("question") or "")).strip()
            back = re.sub(r"\s+", " ", str(row.get("back") or "")).strip()
            if not front:
                continue
            if not back:
                answer_text = re.sub(r"\s+", " ", str(row.get("answer") or "")).strip()
                back = f"Correct answer: {answer_text}" if answer_text else "Correct answer: Not available"
            if not back.lower().startswith("correct answer:"):
                back = f"Correct answer: {back}"
            if _is_low_value_flashcard(front, back):
                continue

            dedupe_key = f"{front.lower()}|{back.lower()}"
            if dedupe_key in seen_prompts:
                continue
            seen_prompts.add(dedupe_key)

            concept_id = str(row.get("concept_id") or "course-material").strip() or "course-material"
            source = str(row.get("source") or "course material").strip() or "course material"
            tags_raw = row.get("tags")
            tags = [str(tag).strip() for tag in (tags_raw if isinstance(tags_raw, list) else []) if str(tag).strip()]
            tags = tags[:4] if tags else ["AI", "Chunk"]

            normalized_cards.append(
                {
                    "id": f"ai-{idx + 1}",
                    "concept_id": concept_id,
                    "front": front,
                    "back": back,
                    "tags": tags,
                    "source": source,
                }
            )
            if len(normalized_cards) >= num_cards:
                break

        if len(normalized_cards) < num_cards:
            fallback_cards = _fallback_study_mission_flashcards(chunks, num_cards)
            existing_keys = {f"{c['front'].lower()}|{c['back'].lower()}" for c in normalized_cards}
            for card in fallback_cards:
                key = f"{str(card.get('front', '')).lower()}|{str(card.get('back', '')).lower()}"
                if key in existing_keys:
                    continue
                if _is_low_value_flashcard(str(card.get("front") or ""), str(card.get("back") or "")):
                    continue
                normalized_cards.append(card)
                existing_keys.add(key)
                if len(normalized_cards) >= num_cards:
                    break

        return normalized_cards[:num_cards]
    except Exception as e:
        print(f"Warning: AI flashcard generation failed ({e}). Falling back.")
        return _fallback_study_mission_flashcards(chunks, num_cards)


@app.post("/api/study-mission/chunks")
async def get_study_mission_chunks(request: StudyMissionChunksRequest, student_id: str = Depends(get_student_id)):
    try:
        chunks = _load_study_mission_chunks(
            student_id=student_id,
            course_id=request.course_id,
            topic_ids=request.topic_ids,
            concept_ids=request.concept_ids,
            limit=request.limit,
        )
        return {"chunks": chunks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load study chunks: {str(e)}")


@app.post("/api/study-mission/flashcards")
async def generate_study_mission_flashcards(
    request: StudyMissionFlashcardsRequest,
    student_id: str = Depends(get_student_id),
):
    try:
        safe_num_cards = max(1, min(70, int(request.num_cards or 12)))
        safe_chunk_limit = max(40, min(240, int(request.chunk_limit or 120)))
        chunks = _load_study_mission_chunks(
            student_id=student_id,
            course_id=request.course_id,
            topic_ids=request.topic_ids,
            concept_ids=request.concept_ids,
            limit=safe_chunk_limit,
        )
        if not chunks:
            return {"flashcards": []}
        flashcards = _generate_study_mission_flashcards_with_ai(chunks, safe_num_cards)
        return {"flashcards": flashcards}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate study mission flashcards: {str(e)}")


@app.post("/upload")
async def upload_files(
    files: List[UploadFile] = File(...),
    course_id: str = Form(""),
    course_name: str = Form(""),
    topic_id: str = Form(""),
    topic_name: str = Form(""),
    student_id: str = Depends(get_student_id),
):
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    resolved_course_name = str(course_name or "").strip()
    raw_course_id = str(course_id or "").strip() or resolved_course_name
    resolved_course_id = _slugify_identifier(raw_course_id, "course") if raw_course_id else ""
    has_explicit_topic = bool(str(topic_id or "").strip() or str(topic_name or "").strip())
    base_topic_id = ""
    base_topic_name = ""
    if has_explicit_topic:
        base_topic_id, base_topic_name = _normalize_topic_payload(
            str(topic_id or "").strip(),
            str(topic_name or "").strip(),
            "Topic",
        )

    uploaded_files = []
    kg_concepts_added = 0
    successful_uploads = 0
    uploaded_concept_ids: List[str] = []
    user_kg_engine = _get_user_kg_engine(student_id)
    suggested_quiz_concept: Optional[str] = None

    for file in files:
        safe_name = pathlib.Path(file.filename).name if file.filename else "upload.txt"
        file_path = data_dir / safe_name

        try:
            content = await file.read()
            if not content:
                uploaded_files.append({"filename": safe_name, "chunks": 0, "status": "error", "error": "Empty file"})
                continue

            with open(file_path, "wb") as buffer:
                buffer.write(content)

            text_chunks = process_file(str(file_path))
            if not text_chunks:
                uploaded_files.append(
                    {
                        "filename": safe_name,
                        "chunks": 0,
                        "status": "error",
                        "error": "No extractable text found in this file.",
                    }
                )
                continue

            full_text = " ".join(text_chunks)
            fallback_topic_name = pathlib.Path(safe_name).stem
            effective_topic_id, effective_topic_name = (
                (base_topic_id, base_topic_name)
                if has_explicit_topic
                else _normalize_topic_payload("", "", fallback_topic_name)
            )

            # Store in Firestore if available (non-fatal)
            if db is not None:
                try:
                    if resolved_course_id and resolved_course_name:
                        courses_col = _courses_collection(student_id)
                        if courses_col is not None:
                            courses_col.document(resolved_course_id).set(
                                {
                                    "id": resolved_course_id,
                                    "name": resolved_course_name,
                                    "userId": student_id,
                                    "updated_at": datetime.now(timezone.utc),
                                },
                                merge=True,
                            )
                    batch = db.batch()
                    for i, chunk in enumerate(text_chunks):
                        doc_ref = db.collection(vector_search.collection_name).document()
                        batch.set(doc_ref, {
                            "text": chunk,
                            "source": safe_name,
                            "course_id": resolved_course_id or None,
                            "course_name": resolved_course_name or None,
                            "topic_id": effective_topic_id,
                            "topic_name": effective_topic_name,
                            "concept_id": effective_topic_id,  # tutor compatibility alias
                            "userId": student_id,
                            "chunk_index": i,
                            "created_at": datetime.now(timezone.utc),
                        })
                    batch.commit()
                    _upsert_user_topic(
                        student_id=student_id,
                        course_id=resolved_course_id or "uncategorized",
                        course_name=resolved_course_name or "Uncategorized",
                        topic_id=effective_topic_id,
                        topic_name=effective_topic_name,
                        chunk_delta=len(text_chunks),
                    )
                except Exception as e:
                    print(f"Warning: Firestore storage failed for {safe_name}: {e}")

            # Build knowledge graph from the extracted text. This must succeed
            # before we auto-start a grounded comprehensive quiz.
            try:
                if not openai_api_key:
                    raise RuntimeError("OPENAI_API_KEY is not configured on the backend.")
                openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
                added = user_kg_engine.build_from_material(
                    full_text,
                    openai_client,
                    course_id=resolved_course_id or None,
                    course_name=resolved_course_name or None,
                    topic_id=effective_topic_id,
                )
                kg_concepts_added += len(added)
                for node in added:
                    cid = str((node or {}).get("id") or "").strip()
                    if cid:
                        uploaded_concept_ids.append(cid)
                if not suggested_quiz_concept and added:
                    first_id = added[0].get("id")
                    if isinstance(first_id, str) and first_id.strip():
                        suggested_quiz_concept = first_id.strip()
            except Exception as e:
                print(f"Warning: KG build failed for {safe_name}: {e}")
                uploaded_files.append(
                    {
                        "filename": safe_name,
                        "chunks": len(text_chunks),
                        "status": "error",
                        "error": f"Concept extraction failed: {e}",
                    }
                )
                continue

            if not added:
                uploaded_files.append(
                    {
                        "filename": safe_name,
                        "chunks": len(text_chunks),
                        "status": "error",
                        "error": "No quiz-ready concepts could be extracted from this file.",
                    }
                )
                continue

            uploaded_files.append({"filename": safe_name, "chunks": len(text_chunks), "status": "success"})
            successful_uploads += 1

        except Exception as e:
            import traceback
            traceback.print_exc()
            uploaded_files.append({"filename": safe_name, "chunks": 0, "status": "error", "error": str(e)})
        finally:
            if file_path.exists():
                file_path.unlink()

    if successful_uploads > 0 and uploaded_concept_ids:
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=COMPREHENSIVE_QUIZ_UNLOCK_MINUTES)
        ticket = uuid4().hex
        _set_comprehensive_unlock(student_id, expires_at)
        _set_comprehensive_ticket(
            student_id,
            ticket,
            expires_at,
            uploaded_concept_ids,
            course_id=resolved_course_id or None,
            topic_id=base_topic_id or None,
        )
    else:
        ticket = None
    quiz_ready = bool(ticket)
    quiz_error = None if quiz_ready else (
        "Mentora stored the file, but could not extract enough grounded concepts to generate a quiz from this upload."
    )

    return {
        "message": f"Processed {len(uploaded_files)} files, extracted {kg_concepts_added} concepts",
        "files": uploaded_files,
        "kg_concepts_added": kg_concepts_added,
        "suggested_quiz_concept": suggested_quiz_concept,
        "comprehensive_quiz_ticket": ticket,
        "uploaded_concept_ids": uploaded_concept_ids,
        "quiz_ready": quiz_ready,
        "quiz_error": quiz_error,
    }



@app.get("/api/learning-groups")
async def get_learning_groups(group_size: int = 4):
    try:
        groups = learning_groups_search.cluster_similar_learners(group_size)
        return {"status": "success", "total_groups": len(groups), "group_size": group_size, "groups": groups}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating learning groups: {str(e)}")


# ── Assessment Engine endpoints ─────────────────────────────────────────────────


@app.post("/api/assessment/generate-quiz")
async def generate_quiz(request: QuizGenerateRequest, student_id: str = Depends(get_student_id)):
    user_kg_engine = _get_user_kg_engine(student_id)
    nodes = user_kg_engine.get_graph_data().get("nodes", [])
    if not nodes:
        raise HTTPException(
            status_code=400,
            detail="No knowledge-map concepts found for this student. Upload study materials first.",
        )

    try:
        request.student_id = student_id
        request.num_questions = max(1, min(int(request.num_questions), 20))
        requested = (request.concept or "").strip().lower()
        all_aliases = {"all", "all-concepts", "all_concepts", "__all__", "comprehensive"}
        if requested in all_aliases:
            ticket_ok, ticket_payload = _validate_and_consume_comprehensive_ticket(
                student_id, str(request.upload_ticket or "")
            )
            if not ticket_ok:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "This comprehensive quiz session is no longer valid. "
                        "Re-upload your materials to generate a fresh quiz grounded in that upload."
                    ),
                )
            ticket_concepts = ticket_payload.get("concepts") or []
            concept_ids = list(dict.fromkeys([str(c).strip() for c in ticket_concepts if str(c).strip()]))
            if not concept_ids:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "The latest upload did not produce grounded concepts for quiz generation. "
                        "Please upload clearer text-based notes or a more content-rich file."
                    ),
                )
            request.concept = "all-concepts"
            request.concepts = concept_ids
            request.num_questions = 20
            request.material_context = _collect_material_context(
                student_id,
                course_id=str(ticket_payload.get("course_id") or "").strip() or None,
                topic_id=str(ticket_payload.get("topic_id") or "").strip() or None,
            )
            if not request.material_context.strip():
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Mentora could not recover grounded material excerpts for the latest upload. "
                        "Please re-upload the material and try again."
                    ),
                )
            # One-time unlock; next comprehensive run requires a fresh upload.
            _consume_comprehensive_unlock(student_id)
        else:
            concept_id = _resolve_user_concept_id(request.concept, nodes)
            if not concept_id:
                raise HTTPException(
                    status_code=404,
                    detail=f"Concept '{request.concept}' not found in your knowledge map.",
                )
            node = next((n for n in nodes if str(n.get("id", "")) == concept_id), None)
            node_course_id = str((node or {}).get("courseId") or "").strip() or None
            request.material_context = _collect_material_context(student_id, node_course_id)
            request.concept = concept_id
        return assessment_engine.generate_quiz(request)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Quiz generation error: {exc}") from exc


@app.post("/api/assessment/evaluate", response_model=EvaluateResponse)
async def evaluate_answer(request: QuizSubmitRequest, student_id: str = Depends(get_student_id)):
    try:
        request.student_id = student_id
        return assessment_engine.evaluate_answer(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/assessment/classify", response_model=ClassifyResponse)
async def classify_mistake(request: QuizSubmitRequest, student_id: str = Depends(get_student_id)):
    try:
        request.student_id = student_id
        result = assessment_engine.classify_mistake(request)
        state, _ = assessment_engine.store.transaction(student_id)
        student_quiz = state.get("quizzes", {}).get(student_id, {})

        # Keep user graph in sync with assessment outcomes.
        by_question = {c.question_id: c for c in result.classifications}
        existing_actions = list(result.integration_actions or [])
        by_question_action = {str(a.get("question_id", "")): dict(a) for a in existing_actions}

        enriched_actions = []
        for answer in request.answers:
            cls = by_question.get(answer.question_id)
            is_correct = cls is None
            mistake_type = None if is_correct else cls.mistake_type
            action = by_question_action.get(answer.question_id, {
                "question_id": answer.question_id,
                "mistake_type": mistake_type or "none",
            })
            question_payload = student_quiz.get(answer.question_id, {}) if isinstance(student_quiz, dict) else {}
            candidate_concepts = [
                str(action.get("concept") or "").strip(),
                str(question_payload.get("concept") or "").strip(),
                str(request.concept or "").strip(),
            ]
            # Preserve order, drop empty duplicates.
            ordered_candidates = []
            for c in candidate_concepts:
                if c and c not in ordered_candidates:
                    ordered_candidates.append(c)

            kg_update = None
            for candidate in ordered_candidates:
                attempt_update = _apply_user_kg_update(
                    student_id=student_id,
                    concept=candidate,
                    is_correct=is_correct,
                    mistake_type=mistake_type,
                    confidence_1_to_5=answer.confidence_1_to_5,
                    missing_concept=cls.missing_concept if cls is not None else None,
                    classification_rationale=cls.rationale if cls is not None else None,
                    classification_source=cls.classification_source if cls is not None else None,
                    classification_model=cls.classification_model if cls is not None else None,
                    update_origin="assessment",
                )
                if not attempt_update:
                    continue
                kg_update = attempt_update
                if str(attempt_update.get("status")) == "updated":
                    break
            action["mistake_type"] = action.get("mistake_type", mistake_type or "none")
            if kg_update is not None:
                action["kg_update"] = kg_update
            if ordered_candidates:
                action["kg_update_candidates"] = ordered_candidates
            enriched_actions.append(action)

        result.integration_actions = enriched_actions
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/assessment/self-awareness/{student_id}", response_model=SelfAwarenessResponse)
async def get_self_awareness_score(student_id: str, _uid: str = Depends(get_student_id)):
    if student_id != _uid:
        raise HTTPException(status_code=403, detail="Forbidden: cannot access another student's self-awareness score")
    return assessment_engine.get_self_awareness_score(student_id)


@app.post("/api/assessment/override")
async def override_mistake_classification(request: OverrideRequest, student_id: str = Depends(get_student_id)):
    try:
        return assessment_engine.override_classification(student_id, request.question_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/assessment/micro-checkpoint", response_model=MicroCheckpointResponse)
async def generate_micro_checkpoint(request: MicroCheckpointRequest, student_id: str = Depends(get_student_id)):
    return assessment_engine.generate_micro_checkpoint(
        student_id,
        request.concept,
        request.missing_concept,
    )


@app.post("/api/assessment/micro-checkpoint/submit", response_model=MicroCheckpointSubmitResponse)
async def submit_micro_checkpoint(request: MicroCheckpointSubmitRequest, student_id: str = Depends(get_student_id)):
    try:
        response = assessment_engine.submit_micro_checkpoint(
            student_id,
            request.question_id,
            request.selected_answer,
            request.confidence_1_to_5,
        )
        kg_update = _apply_user_kg_update(
            student_id=student_id,
            concept=request.question_id.split("checkpoint-", 1)[-1].rsplit("-", 1)[0] if "checkpoint-" in request.question_id else request.question_id,
            is_correct=response.is_correct,
            mistake_type=None if response.is_correct else "conceptual",
            confidence_1_to_5=request.confidence_1_to_5,
            update_origin="assessment_checkpoint",
        )
        if not kg_update or str(kg_update.get("status")) != "updated":
            return response
        return MicroCheckpointSubmitResponse(
            question_id=response.question_id,
            is_correct=response.is_correct,
            next_action=response.next_action,
            mastery_delta=float(kg_update.get("delta_mastery", 0.0)),
            updated_mastery=float(kg_update.get("updated_mastery", 0.0)),
            mastery_status=str((kg_update.get("node") or {}).get("status") or ""),
            concept_id=str(kg_update.get("concept_id") or ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/assessment/history")
async def get_assessment_history(
    concept: Optional[str] = None,
    limit: int = 20,
    student_id: str = Depends(get_student_id),
):
    try:
        runs = assessment_engine.get_assessment_history(student_id=student_id, concept=concept, limit=limit)
        return {"runs": runs}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load assessment history: {str(exc)}") from exc


@app.get("/api/assessment/history/{run_id}")
async def get_assessment_run(run_id: str, student_id: str = Depends(get_student_id)):
    try:
        runs = assessment_engine.get_assessment_history(student_id=student_id, limit=100)
        run = next((r for r in runs if r.get("run_id") == run_id), None)
        if not run:
            raise HTTPException(status_code=404, detail="Assessment run not found")
        return run
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load assessment run: {str(exc)}") from exc


# ── Adaptive Engine endpoints ──────────────────────────────────────────────────


def _payload_to_state(payload: ConceptStatePayload) -> ConceptState:
    return ConceptState(
        concept_id=payload.concept_id,
        mastery=payload.mastery,
        p_learn=payload.p_learn,
        p_guess=payload.p_guess,
        p_slip=payload.p_slip,
        decay_rate=payload.decay_rate,
        last_updated=payload.last_updated,
        attempts=payload.attempts,
        correct=payload.correct,
        careless_count=payload.careless_count,
    ).normalized()


def _state_to_payload(state: ConceptState) -> ConceptStatePayload:
    return ConceptStatePayload(
        concept_id=state.concept_id,
        mastery=state.mastery,
        p_learn=state.p_learn,
        p_guess=state.p_guess,
        p_slip=state.p_slip,
        decay_rate=state.decay_rate,
        last_updated=state.last_updated,
        attempts=state.attempts,
        correct=state.correct,
        careless_count=state.careless_count,
    )


@app.post("/api/adaptive/bkt/update", response_model=BKTUpdateResponse)
async def api_update_bkt(request: BKTUpdateRequest):
    try:
        state = _payload_to_state(request.concept)
        result = adaptive_engine.update_bkt(
            state=state,
            is_correct=request.is_correct,
            interaction_time=request.interaction_time,
            mistake_type=request.mistake_type,
            careless_penalty=request.careless_penalty,
        )
        return BKTUpdateResponse(
            concept_id=result["concept_id"],
            prior_mastery=result["prior_mastery"],
            mastery_after_decay=result["mastery_after_decay"],
            updated_mastery=result["updated_mastery"],
            delta_mastery=result["delta_mastery"],
            status=result["status"],
            elapsed_days=result["elapsed_days"],
            mistake_type=result["mistake_type"],
            careless_penalty=result["careless_penalty"],
            state=_state_to_payload(result["state"]),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BKT update failed: {str(e)}")


@app.post("/api/adaptive/bkt/mastery", response_model=MasteryResponse)
async def api_get_mastery(request: MasteryRequest):
    try:
        state = _payload_to_state(request.concept)
        result = adaptive_engine.get_mastery(
            state=state,
            as_of=request.as_of,
            include_decay_projection=request.include_decay_projection,
        )
        return MasteryResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Mastery read failed: {str(e)}")


@app.post("/api/adaptive/bkt/decay", response_model=DecayResponse)
async def api_apply_decay(request: DecayRequest):
    try:
        state = _payload_to_state(request.concept)
        updated_state, elapsed_days = adaptive_engine.apply_decay(state=state, as_of=request.as_of, mutate=True)
        return DecayResponse(concept=_state_to_payload(updated_state), elapsed_days=round(elapsed_days, 6))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Decay application failed: {str(e)}")


@app.post("/api/adaptive/rpkt/probe", response_model=RPKTProbeResponse)
async def api_run_rpkt_probe(request: RPKTProbeRequest):
    try:
        result = adaptive_engine.run_rpkt_probe(
            target_concept_id=request.target_concept_id,
            prerequisites=request.prerequisites,
            diagnostic_scores=request.diagnostic_scores,
            mastery_threshold=request.mastery_threshold,
            max_depth=request.max_depth,
        )
        return RPKTProbeResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RPKT probe failed: {str(e)}")


@app.post("/api/adaptive/planner/study-plan", response_model=StudyPlanResponse)
async def api_generate_study_plan(request: StudyPlanRequest):
    try:
        result = adaptive_engine.generate_study_plan(
            minutes=request.minutes,
            concepts=[c.model_dump() for c in request.concepts],
            prerequisites=request.prerequisites,
            as_of=request.as_of,
        )
        return StudyPlanResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Study plan generation failed: {str(e)}")


@app.post("/api/adaptive/hubs/match", response_model=MatchHubsResponse)
async def api_match_hubs(request: MatchHubsRequest):
    try:
        result = adaptive_engine.match_hubs(
            students=[s.model_dump() for s in request.students],
            hub_size=request.hub_size,
        )
        return MatchHubsResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Hub matching failed: {str(e)}")


# ── Knowledge Graph Engine endpoints ───────────────────────────────────────────


class AddConceptRequest(BaseModel):
    concept_id: str
    title: str
    category: str
    prerequisites: Optional[List[str]] = []
    initial_mastery: Optional[float] = 0.0


class UpdateMasteryRequest(BaseModel):
    concept_id: str
    is_correct: bool
    is_careless: Optional[bool] = False
    confidence_1_to_5: Optional[int] = None

class SetMasteryRequest(BaseModel):
    concept_id: str
    mastery_percent: float


class DiagnoseMistakeRequest(BaseModel):
    concept_id: str
    student_answer: str
    correct_answer: str
    confidence: int  # 1–5


class BuildFromMaterialRequest(BaseModel):
    text: str
    course_id: Optional[str] = None
    course_name: Optional[str] = None
    topic_id: Optional[str] = None


@app.post("/api/kg/add_concept")
async def add_concept(req: AddConceptRequest, student_id: str = Depends(get_student_id)):
    try:
        user_kg_engine = _get_user_kg_engine(student_id)
        node = user_kg_engine.add_concept(
            concept_id=req.concept_id,
            title=req.title,
            category=req.category,
            prerequisites=req.prerequisites or [],
            initial_mastery=req.initial_mastery or 0.0,
        )
        return {"status": "ok", "node": node}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/kg/update_mastery")
async def kg_update_mastery(req: UpdateMasteryRequest, student_id: str = Depends(get_student_id)):
    try:
        user_kg_engine = _get_user_kg_engine(student_id)
        result = user_kg_engine.update_mastery(
            concept_id=req.concept_id,
            is_correct=req.is_correct,
            is_careless=req.is_careless or False,
            confidence_1_to_5=req.confidence_1_to_5,
        )
        return {"status": "ok", **result}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/kg/set_mastery")
async def kg_set_mastery(req: SetMasteryRequest, student_id: str = Depends(get_student_id)):
    try:
        user_kg_engine = _get_user_kg_engine(student_id)
        mastery_percent = max(0.0, min(100.0, float(req.mastery_percent)))
        node = user_kg_engine.set_mastery(
            concept_id=req.concept_id,
            mastery_score=mastery_percent / 100.0,
        )
        return {"status": "ok", "node": node}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/kg/prerequisites/{concept_id}")
async def get_prerequisites(concept_id: str, student_id: str = Depends(get_student_id)):
    user_kg_engine = _get_user_kg_engine(student_id)
    return {"concept_id": concept_id, "prerequisites": user_kg_engine.get_prerequisites(concept_id)}


@app.get("/api/kg/concepts/{concept_id}")
async def get_concept(concept_id: str, student_id: str = Depends(get_student_id)):
    user_kg_engine = _get_user_kg_engine(student_id)
    nodes = {node["id"]: node for node in user_kg_engine.get_graph_data().get("nodes", [])}
    node = nodes.get(concept_id)
    if not node:
        raise HTTPException(status_code=404, detail=f"Concept '{concept_id}' not found")
    prereqs = user_kg_engine.get_prerequisites(concept_id)
    return {
        "concept": node.get("id", concept_id),
        "title": node.get("title"),
        "category": node.get("category"),
        "mastery": node.get("mastery"),
        "status": node.get("status"),
        "prerequisites": prereqs,
        "summary": f"{node.get('title', concept_id)} in {node.get('category', 'General')}",
    }


@app.get("/api/kg/dependents/{concept_id}")
async def get_dependents(concept_id: str, student_id: str = Depends(get_student_id)):
    user_kg_engine = _get_user_kg_engine(student_id)
    return {"concept_id": concept_id, "dependents": user_kg_engine.get_dependents(concept_id)}


@app.get("/api/kg/chain/{concept_id}")
async def get_prerequisite_chain(concept_id: str, student_id: str = Depends(get_student_id)):
    user_kg_engine = _get_user_kg_engine(student_id)
    return {"concept_id": concept_id, "chain": user_kg_engine.get_prerequisite_chain(concept_id)}


@app.get("/api/kg/graph")
async def get_graph(student_id: str = Depends(get_student_id)):
    user_kg_engine = _get_user_kg_engine(student_id)
    graph_data = user_kg_engine.get_graph_data()

    # Backward-compatibility: infer missing courseId from course names
    # so older nodes remain visible under the correct course.
    try:
        if db is not None:
            courses_col = _courses_collection(student_id)
            course_docs = list(courses_col.stream()) if courses_col is not None else []
            courses = [d.to_dict() or {} for d in course_docs]
            name_to_id = {
                "".join(ch for ch in str(c.get("name", "")).lower() if ch.isalnum()): str(c.get("id", ""))
                for c in courses
                if c.get("id") and c.get("name")
            }

            def _norm(text: str) -> str:
                return "".join(ch for ch in str(text).lower() if ch.isalnum())

            for node in graph_data.get("nodes", []):
                existing = str((node or {}).get("courseId") or "").strip()
                if existing:
                    continue
                category_key = _norm((node or {}).get("category", ""))
                if not category_key:
                    continue
                matched_id = name_to_id.get(category_key)
                if matched_id:
                    node["courseId"] = matched_id
    except Exception as exc:
        print(f"Warning: failed to infer node courseId values for {student_id}: {exc}")

    return graph_data


@app.post("/api/kg/build_from_material")
async def build_from_material(req: BuildFromMaterialRequest, student_id: str = Depends(get_student_id)):
    try:
        openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        user_kg_engine = _get_user_kg_engine(student_id)
        added = user_kg_engine.build_from_material(
            req.text,
            openai_client,
            course_id=req.course_id,
            course_name=req.course_name,
            topic_id=req.topic_id,
        )
        return {"status": "ok", "added": len(added), "nodes": added}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to build from material: {str(e)}")


@app.post("/api/kg/diagnose_mistake")
async def diagnose_mistake(req: DiagnoseMistakeRequest, student_id: str = Depends(get_student_id)):
    try:
        openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        user_kg_engine = _get_user_kg_engine(student_id)
        result = user_kg_engine.diagnose_mistake(
            concept_id=req.concept_id,
            student_answer=req.student_answer,
            correct_answer=req.correct_answer,
            confidence=req.confidence,
            openai_client=openai_client,
        )
        return {"status": "ok", **result}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Diagnosis failed: {str(e)}")


@app.get("/api/kg/render_graph", response_class=HTMLResponse)
async def render_graph(student_id: str = Depends(get_student_id)):
    try:
        user_kg_engine = _get_user_kg_engine(student_id)
        html = user_kg_engine.render_graph()
        return HTMLResponse(content=html)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to render graph: {str(e)}")


# ── Yichen: RAG + Socratic Tutor + Interventions ──────────────────────────────

@app.post("/api/tutor/embed", response_model=EmbedContentResponse)
async def embed_content_endpoint(request: EmbedContentRequest, student_id: str = Depends(get_student_id)):
    try:
        n = tutor_service.embed_content(request.content, request.concept_id, request.source, student_id)
        return EmbedContentResponse(chunks_embedded=n, concept_id=request.concept_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/tutor/context")
async def retrieve_context_endpoint(request: RetrieveContextRequest, student_id: str = Depends(get_student_id)):
    try:
        chunks = tutor_service.retrieve_context(request.concept, request.limit, student_id)
        return {"concept": request.concept, "chunks": chunks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/tutor/chat")
async def tutor_chat_endpoint(request: TutorChatRequest, student_id: str = Depends(get_student_id)):
    try:
        if not request.query:
            raise HTTPException(status_code=400, detail="Query is required")
        return tutor_service.tutor_chat(request.query, request.knowledge_state, student_id, request.concept_ids)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/tutor/recommend-next-action", response_model=RecommendationResponse)
async def recommend_next_action_endpoint(
    request: RecommendationRequest,
    student_id: str = Depends(get_student_id),
):
    try:
        if not request.candidates:
            raise HTTPException(status_code=400, detail="At least one candidate is required")
        if _openai_client is None:
            raise HTTPException(status_code=503, detail="OpenAI client is not configured")

        return tutor_service.recommend_next_action(
            course_name=request.course_name,
            candidates=[candidate.dict() for candidate in request.candidates],
            attention_summary=request.attention_summary.dict() if request.attention_summary else None,
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/tutor/checkpoint")
async def checkpoint_generate_endpoint(request: CheckpointRequest, student_id: str = Depends(get_student_id)):
    try:
        allowed_concepts = _get_existing_checkpoint_concepts(student_id, request.topic_id)
        if not allowed_concepts:
            raise HTTPException(status_code=404, detail="No existing knowledge graph nodes available for this topic")
        return tutor_service.generate_checkpoint(
            request.topic_id,
            request.session_messages,
            request.already_tested,
            student_id,
            allowed_concepts,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/tutor/checkpoint/submit", response_model=CheckpointSubmitResponse)
async def checkpoint_submit_endpoint(request: CheckpointSubmitRequest, student_id: str = Depends(get_student_id)):
    try:
        kg_update = None
        if not request.was_skipped:
            allowed_concepts = _get_existing_checkpoint_concepts(student_id, request.topic_id)
            allowed_ids = [str(row.get("id") or "").strip() for row in allowed_concepts if str(row.get("id") or "").strip()]
            title_lookup = {
                _normalize_lookup(str(row.get("title") or "")): str(row.get("id") or "").strip()
                for row in allowed_concepts
                if str(row.get("title") or "").strip() and str(row.get("id") or "").strip()
            }
            raw_concept_tested = str(request.concept_tested or "").strip()
            resolved_concept_tested = raw_concept_tested if raw_concept_tested in allowed_ids else title_lookup.get(
                _normalize_lookup(raw_concept_tested),
                "",
            )
            candidate_concepts = [resolved_concept_tested]
            ordered_candidates = []
            for candidate in candidate_concepts:
                if candidate and candidate not in ordered_candidates:
                    ordered_candidates.append(candidate)

            is_correct = tutor_service.checkpoint_answer_is_correct(
                request.options,
                request.student_answer,
                request.correct_answer,
            )
            for candidate in ordered_candidates:
                attempt_update = _apply_user_kg_update(
                    student_id=student_id,
                    concept=candidate,
                    is_correct=is_correct,
                    mistake_type=None if is_correct else "conceptual",
                    confidence_1_to_5=request.confidence_rating,
                    update_origin="tutor_checkpoint",
                )
                if not attempt_update:
                    continue
                kg_update = attempt_update
                if str(attempt_update.get("status")) == "updated":
                    break

        return tutor_service.submit_checkpoint(
            request.session_id, request.topic_id, request.concept_tested,
            request.question, request.options, request.student_answer,
            request.correct_answer, request.confidence_rating, request.was_skipped,
            student_id, request.topic_doc_id,
            mastery_delta_override=(
                float(kg_update.get("delta_mastery", 0.0))
                if kg_update and str(kg_update.get("status")) == "updated"
                else None
            ),
            updated_mastery_override=(
                float(kg_update.get("updated_mastery", 0.0))
                if kg_update and str(kg_update.get("status")) == "updated"
                else None
            ),
            mastery_status_override=(
                str((kg_update.get("node") or {}).get("status") or "")
                if kg_update and str(kg_update.get("status")) == "updated"
                else None
            ),
            concept_id_override=(
                str(kg_update.get("concept_id") or "")
                if kg_update and str(kg_update.get("status")) == "updated"
                else None
            ),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/tutor/intervene", response_model=InterventionResponse)
async def run_intervention_endpoint(request: InterventionRequest):
    try:
        return tutor_service.run_intervention(request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/tutor/session-summary", response_model=SessionSummaryResponse)
async def session_summary_endpoint(request: SessionData):
    try:
        return tutor_service.generate_session_summary(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/user-topics")
async def get_user_topics(student_id: str = Depends(get_student_id)):
    if db is None:
        return {"topics": []}
    try:
        docs = db.collection("user_topics").where("userId", "==", student_id).stream()
        topics = []
        for d in docs:
            data = d.to_dict() or {}
            normalized_topic_id = str(data.get("topicId") or data.get("conceptId") or "").strip()
            topics.append({
                "id": d.id,
                "courseId": data.get("courseId", "uncategorized"),
                "courseName": data.get("courseName", "Uncategorized"),
                "topicId": normalized_topic_id,
                "topicName": data.get("topicName", data.get("title", d.id)),
                "conceptId": normalized_topic_id,
                "title": data.get("title", data.get("topicName", d.id)),
                "chunkCount": data.get("chunkCount", 0),
            })
        return {"topics": topics}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class CreateUserTopicRequest(BaseModel):
    courseId: str
    courseName: str
    topicName: str


@app.post("/api/user-topics")
async def create_user_topic(request: CreateUserTopicRequest, student_id: str = Depends(get_student_id)):
    if db is None:
        raise HTTPException(status_code=503, detail="Firestore unavailable")

    topic_name = (request.topicName or "").strip()
    if not topic_name:
        raise HTTPException(status_code=400, detail="topicName is required")

    course_id = _slugify_identifier(request.courseId or "", "uncategorized")
    course_name = (request.courseName or "").strip() or course_id
    topic_id = _slugify_identifier(topic_name, "topic")

    now = datetime.now(timezone.utc)
    payload = {
        "userId": student_id,
        "courseId": course_id,
        "courseName": course_name,
        "topicId": topic_id,
        "topicName": topic_name,
        "title": topic_name,
        "chunkCount": 0,
        "createdAt": now,
    }
    ref = db.collection("user_topics").document()
    ref.set(payload)
    return {
        "topic": {
            "id": ref.id,
            "courseId": course_id,
            "courseName": course_name,
            "topicId": topic_id,
            "topicName": topic_name,
            "title": topic_name,
            "chunkCount": 0,
        }
    }


class UpdateUserTopicRequest(BaseModel):
    topic_name: str


@app.patch("/api/user-topics/{doc_id}")
async def update_user_topic(
    doc_id: str,
    payload: UpdateUserTopicRequest,
    student_id: str = Depends(get_student_id),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Firestore unavailable")

    next_topic_name = str(payload.topic_name or "").strip()
    if not next_topic_name:
        raise HTTPException(status_code=400, detail="topic_name is required")

    ref = db.collection("user_topics").document(doc_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Topic not found")

    data = snap.to_dict() or {}
    if data.get("userId") != student_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    topic_alias = str(data.get("topicId") or data.get("conceptId") or "").strip()
    previous_name = str(data.get("topicName") or data.get("title") or topic_alias).strip()
    now = datetime.now(timezone.utc)

    ref.set(
        {
            "topicName": next_topic_name,
            "title": next_topic_name,
            "updatedAt": now,
        },
        merge=True,
    )

    updated_chunk_refs = {}
    if topic_alias:
        for field_name in ("concept_id", "topic_id"):
            try:
                matches = (
                    db.collection(vector_search.collection_name)
                    .where("userId", "==", student_id)
                    .where(field_name, "==", topic_alias)
                    .stream()
                )
                for chunk_doc in matches:
                    updated_chunk_refs[chunk_doc.id] = chunk_doc.reference
            except Exception as exc:
                print(
                    f"Warning: failed to query knowledge chunks for topic rename "
                    f"user={student_id} topic={topic_alias} field={field_name}: {exc}"
                )

        if updated_chunk_refs:
            batch = db.batch()
            pending_writes = 0
            for chunk_ref in updated_chunk_refs.values():
                batch.update(
                    chunk_ref,
                    {
                        "topic_name": next_topic_name,
                        "updated_at": now,
                    },
                )
                pending_writes += 1
                if pending_writes >= 400:
                    batch.commit()
                    batch = db.batch()
                    pending_writes = 0
            if pending_writes > 0:
                batch.commit()

    return {
        "status": "updated",
        "doc_id": doc_id,
        "topic_id": topic_alias,
        "topic_name": next_topic_name,
        "previous_topic_name": previous_name,
        "chunks_updated": len(updated_chunk_refs),
    }


@app.delete("/api/user-topics/{doc_id}")
async def delete_user_topic(doc_id: str, student_id: str = Depends(get_student_id)):
    if db is None:
        raise HTTPException(status_code=503, detail="Firestore unavailable")
    ref = db.collection("user_topics").document(doc_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Topic not found")
    data = snap.to_dict() or {}
    if data.get("userId") != student_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    topic_alias = str(data.get("topicId") or data.get("conceptId") or "").strip()
    if topic_alias:
        try:
            chunks = (
                db.collection("knowledge_chunks")
                .where("userId", "==", student_id)
                .where("concept_id", "==", topic_alias)
                .stream()
            )
            batch = db.batch()
            for c in chunks:
                batch.delete(c.reference)
            batch.commit()
        except Exception as e:
            print(f"Warning: cascade delete failed for topic={topic_alias}: {e}")
    # Remove KG nodes belonging to this topic
    if topic_alias:
        try:
            user_kg_engine = _get_user_kg_engine(student_id)
            removed = user_kg_engine.remove_nodes_by_topic(topic_alias)
            print(f"Removed {removed} KG nodes for topic={topic_alias}")
        except Exception as e:
            print(f"Warning: KG node removal failed for topic={topic_alias}: {e}")
    ref.delete()
    return {"status": "deleted", "doc_id": doc_id}


# ── Student Progress endpoint ─────────────────────────────────────────────────


@app.get("/api/students/{student_id}/progress")
async def get_student_progress(student_id: str, current_user_id: str = Depends(get_student_id)):
    """Return aggregated student progress from Firebase assessment + KG data."""
    if student_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    progress: dict = {
        "student_id": student_id,
        "total_attempts": 0,
        "correct_attempts": 0,
        "accuracy": 0.0,
        "careless_count": 0,
        "conceptual_count": 0,
        "blind_spots": {"found": 0, "resolved": 0},
        "self_awareness": {"score": 0.0, "calibration_gap": 0.0, "total_attempts": 0},
        "concept_mastery": [],
        "recent_attempts": [],
    }

    # Assessment data from whichever store is active (Firestore or JSON fallback).
    try:
        state, _ = assessment_engine.store.transaction(student_id)
        attempts = state.get("attempt_history", {}).get(student_id, [])
        progress["total_attempts"] = len(attempts)
        progress["correct_attempts"] = sum(1 for a in attempts if a.get("is_correct") is True)
        progress["accuracy"] = (
            round(progress["correct_attempts"] / progress["total_attempts"], 3)
            if progress["total_attempts"] > 0
            else 0.0
        )
        progress["careless_count"] = sum(
            1 for a in attempts if a.get("mistake_type") == "careless"
        )
        progress["conceptual_count"] = sum(
            1 for a in attempts if a.get("mistake_type") == "conceptual"
        )
        progress["recent_attempts"] = attempts[-10:]
        progress["blind_spots"] = (
            state.get("blind_spot_counts", {}).get(student_id, {"found": 0, "resolved": 0})
        )
    except Exception as e:
        print(f"Warning: Could not load assessment progress for {student_id}: {e}")

    # Self-awareness score
    try:
        sa = assessment_engine.get_self_awareness_score(student_id)
        progress["self_awareness"] = {
            "score": sa.score,
            "calibration_gap": sa.calibration_gap,
            "total_attempts": sa.total_attempts,
        }
    except Exception:
        pass

    # BKT concept mastery from Firestore
    if concept_state_store is not None:
        try:
            states = concept_state_store.get_all_states(student_id)
            progress["concept_mastery"] = [
                {
                    "concept_id": cid,
                    "mastery": round(s.get("mastery", 0.0), 3),
                    "attempts": s.get("attempts", 0),
                    "correct": s.get("correct", 0),
                    "careless_count": s.get("careless_count", 0),
                    "last_updated": s.get("last_updated"),
                }
                for cid, s in states.items()
            ]
        except Exception as e:
            print(f"Warning: Could not load concept states for {student_id}: {e}")

    # KG-level graph stats
    user_kg_engine = _get_user_kg_engine(student_id)
    graph_data = user_kg_engine.get_graph_data()
    nodes = graph_data.get("nodes", [])
    progress["kg_stats"] = {
        "total_concepts": len(nodes),
        "mastered": sum(1 for n in nodes if n.get("status") == "mastered"),
        "learning": sum(1 for n in nodes if n.get("status") == "learning"),
        "weak": sum(1 for n in nodes if n.get("status") == "weak"),
        "not_started": sum(1 for n in nodes if n.get("status") == "not_started"),
    }

    return progress


# ── Peer Learning Hub Session Endpoints ────────────────────────────────────

@app.post("/api/peer/session")
async def create_peer_session(
    req: CreateSessionRequest,
    student_id: str = Depends(get_student_id),
):
    """Create a new peer session with AI-generated questions."""
    member_profiles = [m.model_dump() for m in req.member_profiles]
    result = peer_session_service.create_session(
        hub_id=req.hub_id,
        topic=req.topic,
        concept_id=req.concept_id,
        course_id=req.course_id,
        course_name=req.course_name,
        level=req.level,
        member_profiles=member_profiles,
        created_by=student_id,
    )
    if "error" in result:
        detail = str(result["error"])
        detail_l = detail.lower()
        status_code = 500
        if (
            detail_l.startswith("no uploaded material")
            or detail_l.startswith("unlock level")
            or detail_l.startswith("could not verify level unlocks")
            or detail_l.startswith("an active or waiting session already exists")
        ):
            status_code = 400
        raise HTTPException(status_code=status_code, detail=detail)
    return CreateSessionResponse(**result)


@app.post("/api/peer/session/join")
async def join_peer_session(
    req: JoinSessionRequest,
    student_id: str = Depends(get_student_id),
):
    """Join an existing peer session."""
    result = peer_session_service.join_session(
        session_id=req.session_id,
        student_id=student_id,
        name=req.name,
    )
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@app.get("/api/peer/session/{session_id}")
async def get_peer_session(
    session_id: str,
    student_id: str = Depends(get_student_id),
):
    """Get full session state (polled by frontend every 3s)."""
    session = peer_session_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionStateResponse(**session)


@app.get("/api/peer/session/active/{hub_id}")
async def get_active_peer_session(
    hub_id: str,
    student_id: str = Depends(get_student_id),
):
    """Find an active or waiting session for a hub."""
    session = peer_session_service.get_active_session(hub_id)
    if not session:
        return {"session": None}
    return {"session": SessionStateResponse(**session)}


@app.post("/api/peer/session/answer")
async def submit_peer_answer(
    req: SubmitAnswerRequest,
    student_id: str = Depends(get_student_id),
):
    """Submit and evaluate an answer for the current question."""
    result = peer_session_service.submit_answer(
        session_id=req.session_id,
        question_id=req.question_id,
        answer_text=req.answer_text,
        student_id=student_id,
        concept_id=req.concept_id,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return SubmitAnswerResponse(**result)


@app.post("/api/peer/session/{session_id}/advance")
async def advance_peer_question(
    session_id: str,
    student_id: str = Depends(get_student_id),
):
    """Advance to the next round-robin question."""
    result = peer_session_service.advance_question(session_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/api/peer/session/{session_id}/end")
async def end_peer_session(
    session_id: str,
    student_id: str = Depends(get_student_id),
):
    """End a peer session."""
    result = peer_session_service.end_session(session_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.get("/api/peer/sessions/all")
async def get_all_active_sessions(
    student_id: str = Depends(get_student_id),
):
    """Get all active/waiting sessions across all hubs (for testing/browsing)."""
    sessions = peer_session_service.get_all_active_sessions()
    return {"sessions": sessions}


@app.get("/api/peer/session/history/{hub_id}")
async def get_peer_session_history(
    hub_id: str,
    student_id: str = Depends(get_student_id),
    limit: int = 20,
):
    """Get completed session history for a hub (for metrics)."""
    runs = peer_session_service.get_hub_session_history(hub_id, limit)
    return {"sessions": runs}


@app.post("/api/peer/session/{session_id}/video-token")
async def create_peer_video_token(
    session_id: str,
    student_id: str = Depends(get_student_id),
):
    """Create a Twilio Video access token for a peer learning session."""
    session = peer_session_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    member_ids = {m.get("student_id") for m in session.get("members", [])}
    if student_id not in member_ids:
        raise HTTPException(status_code=403, detail="You are not a member of this session")

    account_sid = _clean_env("TWILIO_ACCOUNT_SID")
    api_key = _clean_env("TWILIO_API_KEY") or _clean_env("TWILIO_API_KEY_SID")
    api_secret = _clean_env("TWILIO_API_SECRET") or _clean_env("TWILIO_API_KEY_SECRET")
    if not account_sid or not api_key or not api_secret:
        raise HTTPException(
            status_code=500,
            detail=(
                "Twilio is not configured. Set TWILIO_ACCOUNT_SID + "
                "(TWILIO_API_KEY or TWILIO_API_KEY_SID) + "
                "(TWILIO_API_SECRET or TWILIO_API_KEY_SECRET)."
            ),
        )

    try:
        ttl_seconds = int(os.getenv("TWILIO_VIDEO_TOKEN_TTL_SECONDS", "3600"))
    except ValueError:
        ttl_seconds = 3600
    ttl_seconds = max(300, min(ttl_seconds, 24 * 60 * 60))
    room_name = f"peer-session-{session_id}"

    # Prefer Twilio SDK when available, but fall back to local JWT signing
    # so development can proceed even when pip/network access is unavailable.
    try:
        from twilio.jwt.access_token import AccessToken
        from twilio.jwt.access_token.grants import VideoGrant

        token = AccessToken(
            account_sid=account_sid,
            signing_key_sid=api_key,
            secret=api_secret,
            identity=student_id,
            ttl=ttl_seconds,
        )
        token.add_grant(VideoGrant(room=room_name))
        jwt_value = token.to_jwt()
        if isinstance(jwt_value, bytes):
            jwt_value = jwt_value.decode("utf-8")
    except Exception:
        try:
            jwt_value = _create_twilio_video_jwt_without_sdk(
                account_sid=account_sid,
                api_key_sid=api_key,
                api_key_secret=api_secret,
                identity=student_id,
                room_name=room_name,
                ttl_seconds=ttl_seconds,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to generate Twilio token: {e}")

    return TwilioVideoTokenResponse(
        token=jwt_value,
        room_name=room_name,
        identity=student_id,
        ttl_seconds=ttl_seconds,
    )
