import os
import pathlib
from datetime import datetime, timezone
from datetime import timedelta
from typing import Dict, List, Optional
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
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
)
from app.models.tutor_schemas import (
    EmbedContentRequest, EmbedContentResponse,
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
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$|^https://.*\.ngrok(-free)?\.app$|^https://.*\.ngrok\.io$",
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


def _set_comprehensive_ticket(student_id: str, ticket: str, expires_at: datetime, concepts: Optional[List[str]] = None) -> None:
    _comprehensive_quiz_tickets[student_id] = ticket
    _comprehensive_quiz_ticket_concepts[student_id] = list(dict.fromkeys([c for c in (concepts or []) if c]))
    if db is None:
        return
    try:
        db.collection("students").document(student_id).set(
            {
                "comprehensive_quiz_ticket": ticket,
                "comprehensive_quiz_ticket_expires_at": expires_at.isoformat(),
                "comprehensive_quiz_ticket_concepts": _comprehensive_quiz_ticket_concepts.get(student_id, []),
            },
            merge=True,
        )
    except Exception:
        pass


def _validate_and_consume_comprehensive_ticket(student_id: str, ticket: str) -> tuple[bool, List[str]]:
    if not ticket:
        return False, []
    in_memory = _comprehensive_quiz_tickets.get(student_id)
    if in_memory and in_memory == ticket:
        _comprehensive_quiz_tickets.pop(student_id, None)
        concepts = _comprehensive_quiz_ticket_concepts.pop(student_id, [])
        return True, concepts
    if db is None:
        return False, []
    try:
        doc_ref = db.collection("students").document(student_id)
        doc = doc_ref.get()
        if not doc.exists:
            return False, []
        data = doc.to_dict() or {}
        stored = str(data.get("comprehensive_quiz_ticket") or "")
        if stored != ticket:
            return False, []
        raw_exp = data.get("comprehensive_quiz_ticket_expires_at")
        if not isinstance(raw_exp, str) or not raw_exp.strip():
            return False, []
        exp = datetime.fromisoformat(raw_exp.replace("Z", "+00:00"))
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            return False, []
        concepts = data.get("comprehensive_quiz_ticket_concepts") or []
        if not isinstance(concepts, list):
            concepts = []
        doc_ref.set(
            {
                "comprehensive_quiz_ticket": None,
                "comprehensive_quiz_ticket_expires_at": None,
                "comprehensive_quiz_ticket_concepts": [],
            },
            merge=True,
        )
        _comprehensive_quiz_tickets.pop(student_id, None)
        _comprehensive_quiz_ticket_concepts.pop(student_id, None)
        return True, [str(c) for c in concepts if str(c).strip()]
    except Exception:
        return False, []


def _courses_collection(student_id: str):
    if db is None:
        return None
    return db.collection("users").document(student_id).collection("courses")

def _collect_material_context(student_id: str, course_id: Optional[str] = None, max_chars: int = 6000) -> str:
    """Best-effort retrieval of uploaded chunk text for quiz generation grounding."""
    if db is None:
        return ""
    try:
        col = db.collection(vector_search.collection_name)
        query = col.where("userId", "==", student_id)
        if course_id:
            query = query.where("course_id", "==", course_id)
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


def _normalize_lookup(value: str) -> str:
    return "".join(ch for ch in value.lower() if ch.isalnum())


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

def _apply_user_kg_update(
    student_id: str,
    concept: str,
    is_correct: bool,
    mistake_type: Optional[str] = None,
) -> Optional[dict]:
    try:
        user_kg_engine = _get_user_kg_engine(student_id)
        nodes = user_kg_engine.get_graph_data().get("nodes", [])
        concept_id = _resolve_user_concept_id(concept, nodes)
        if not concept_id:
            return None
        result = user_kg_engine.update_mastery(
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
            "concept_id": concept,
            "is_correct": is_correct,
            "mistake_type": mistake_type,
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


@app.get("/api/courses")
async def get_courses(student_id: str = Depends(get_student_id)):
    if db is None:
        return {"courses": []}
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


@app.post("/upload")
async def upload_files(
    files: List[UploadFile] = File(...),
    course_id: str = Form(""),
    course_name: str = Form(""),
    student_id: str = Depends(get_student_id),
):
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

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
                uploaded_files.append({"filename": safe_name, "chunks": 0, "status": "success"})
                successful_uploads += 1
                continue

            full_text = " ".join(text_chunks)

            # Store in Firestore if available (non-fatal)
            if db is not None:
                try:
                    if course_id and course_name:
                        courses_col = _courses_collection(student_id)
                        if courses_col is not None:
                            courses_col.document(course_id).set(
                                {
                                    "id": course_id,
                                    "name": course_name,
                                    "userId": student_id,
                                    "updated_at": datetime.now(timezone.utc),
                                },
                                merge=True,
                            )
                    topic_title = pathlib.Path(safe_name).stem
                    # Per-file concept_id so each topic is independently retrievable
                    concept_slug = topic_title.lower().replace(" ", "_").replace("-", "_")
                    batch = db.batch()
                    for i, chunk in enumerate(text_chunks):
                        doc_ref = db.collection(vector_search.collection_name).document()
                        batch.set(doc_ref, {
                            "text": chunk,
                            "source": safe_name,
                            "course_id": course_id or None,
                            "course_name": course_name or None,
                            "concept_id": concept_slug,
                            "userId": student_id,
                            "chunk_index": i,
                            "created_at": datetime.now(timezone.utc),
                        })
                    batch.commit()
                    # Write user_topics entry for sidebar
                    topic_ref = db.collection("user_topics").document()
                    topic_ref.set({
                        "userId": student_id,
                        "courseId": course_id or "uncategorized",
                        "courseName": course_name or "Uncategorized",
                        "conceptId": concept_slug,
                        "title": topic_title,
                        "chunkCount": len(text_chunks),
                        "createdAt": datetime.now(timezone.utc),
                    })
                except Exception as e:
                    print(f"Warning: Firestore storage failed for {safe_name}: {e}")

            # Build knowledge graph from the extracted text
            try:
                openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
                added = user_kg_engine.build_from_material(
                    full_text,
                    openai_client,
                    course_id=course_id or None,
                    course_name=course_name or None,
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

            uploaded_files.append({"filename": safe_name, "chunks": len(text_chunks), "status": "success"})
            successful_uploads += 1

        except Exception as e:
            import traceback
            traceback.print_exc()
            uploaded_files.append({"filename": safe_name, "chunks": 0, "status": "error", "error": str(e)})
        finally:
            if file_path.exists():
                file_path.unlink()

    if successful_uploads > 0:
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=COMPREHENSIVE_QUIZ_UNLOCK_MINUTES)
        ticket = uuid4().hex
        _set_comprehensive_unlock(student_id, expires_at)
        _set_comprehensive_ticket(student_id, ticket, expires_at, uploaded_concept_ids)
    else:
        ticket = None

    return {
        "message": f"Processed {len(uploaded_files)} files, extracted {kg_concepts_added} concepts",
        "files": uploaded_files,
        "kg_concepts_added": kg_concepts_added,
        "suggested_quiz_concept": suggested_quiz_concept,
        "comprehensive_quiz_ticket": ticket,
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
            ticket_ok, ticket_concepts = _validate_and_consume_comprehensive_ticket(
                student_id, str(request.upload_ticket or "")
            )
            unlock_until = _get_comprehensive_unlock(student_id)
            now = datetime.now(timezone.utc)
            unlock_ok = unlock_until is not None and unlock_until >= now
            if ticket_ok and ticket_concepts:
                concept_ids = list(dict.fromkeys([c for c in ticket_concepts if c]))
            else:
                sorted_nodes = sorted(
                    nodes,
                    key=lambda n: (
                        float(n.get("mastery", 0.0)),
                        str(n.get("id", "")),
                    ),
                )
                concept_ids = [str(n.get("id")) for n in sorted_nodes if str(n.get("id", "")).strip()]
            if not concept_ids:
                raise HTTPException(
                    status_code=400,
                    detail="No concepts available for comprehensive quiz generation.",
                )
            request.concept = "all-concepts"
            request.concepts = concept_ids
            request.num_questions = 20
            request.material_context = _collect_material_context(student_id)
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
            concept_for_update = str(
                action.get("concept")
                or question_payload.get("concept")
                or request.concept
            )
            kg_update = _apply_user_kg_update(
                student_id=student_id,
                concept=concept_for_update,
                is_correct=is_correct,
                mistake_type=mistake_type,
            )
            action["mistake_type"] = action.get("mistake_type", mistake_type or "none")
            if kg_update is not None:
                action["kg_update"] = kg_update
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
        _apply_user_kg_update(
            student_id=student_id,
            concept=request.question_id.split("checkpoint-", 1)[-1].rsplit("-", 1)[0] if "checkpoint-" in request.question_id else request.question_id,
            is_correct=response.is_correct,
            mistake_type=None if response.is_correct else "conceptual",
        )
        return response
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
    return user_kg_engine.get_graph_data()


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


@app.post("/api/tutor/checkpoint")
async def checkpoint_generate_endpoint(request: CheckpointRequest, student_id: str = Depends(get_student_id)):
    try:
        return tutor_service.generate_checkpoint(
            request.topic_id, request.session_messages, request.already_tested, student_id
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/tutor/checkpoint/submit", response_model=CheckpointSubmitResponse)
async def checkpoint_submit_endpoint(request: CheckpointSubmitRequest, student_id: str = Depends(get_student_id)):
    try:
        return tutor_service.submit_checkpoint(
            request.session_id, request.topic_id, request.concept_tested,
            request.question, request.options, request.student_answer,
            request.correct_answer, request.confidence_rating, request.was_skipped,
            student_id, request.topic_doc_id,
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
            topics.append({
                "id": d.id,
                "courseId": data.get("courseId", "uncategorized"),
                "courseName": data.get("courseName", "Uncategorized"),
                "conceptId": data.get("conceptId", ""),
                "title": data.get("title", d.id),
                "chunkCount": data.get("chunkCount", 0),
            })
        return {"topics": topics}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    concept_id = data.get("conceptId")
    if concept_id:
        try:
            chunks = db.collection("knowledge_chunks") \
                .where("userId", "==", student_id) \
                .where("concept_id", "==", concept_id).stream()
            batch = db.batch()
            for c in chunks:
                batch.delete(c.reference)
            batch.commit()
        except Exception as e:
            print(f"Warning: cascade delete failed for concept_id={concept_id}: {e}")
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
        member_profiles=member_profiles,
        created_by=student_id,
    )
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
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


# ── WebRTC Signaling (WebSocket) ──────────────────────────────────────────

import json as _json
from collections import defaultdict
from typing import Dict as _Dict

# session_id -> {student_id -> WebSocket}
_signaling_rooms: _Dict[str, _Dict[str, WebSocket]] = defaultdict(dict)


@app.websocket("/ws/peer/signal/{session_id}")
async def webrtc_signal(websocket: WebSocket, session_id: str):
    """
    WebSocket signaling server for WebRTC peer connections.

    Protocol:
      Client sends JSON messages:
        {"type": "join",          "student_id": "..."}
        {"type": "offer",         "target": "<student_id>", "sdp": {...}}
        {"type": "answer",        "target": "<student_id>", "sdp": {...}}
        {"type": "ice-candidate", "target": "<student_id>", "candidate": {...}}

      Server relays to target peer with sender info:
        {"type": "offer",         "from": "<sender_id>", "sdp": {...}}
        {"type": "answer",        "from": "<sender_id>", "sdp": {...}}
        {"type": "ice-candidate", "from": "<sender_id>", "candidate": {...}}
        {"type": "peer-joined",   "student_id": "<new_peer>", "peers": [...]}
        {"type": "peer-left",     "student_id": "<left_peer>"}
    """
    await websocket.accept()
    room = _signaling_rooms[session_id]
    student_id: str | None = None

    try:
        while True:
            raw = await websocket.receive_text()
            msg = _json.loads(raw)
            msg_type = msg.get("type")

            if msg_type == "join":
                student_id = msg.get("student_id", "")
                room[student_id] = websocket

                # Tell the new peer about existing peers
                existing_peers = [pid for pid in room if pid != student_id]
                await websocket.send_text(_json.dumps({
                    "type": "peer-joined",
                    "student_id": student_id,
                    "peers": existing_peers,
                }))

                # Notify all existing peers about the new peer
                for pid, ws in room.items():
                    if pid != student_id:
                        try:
                            await ws.send_text(_json.dumps({
                                "type": "peer-joined",
                                "student_id": student_id,
                                "peers": list(room.keys()),
                            }))
                        except Exception:
                            pass

            elif msg_type in ("offer", "answer", "ice-candidate"):
                target = msg.get("target")
                if target and target in room:
                    payload = {k: v for k, v in msg.items() if k != "target"}
                    payload["from"] = student_id
                    try:
                        await room[target].send_text(_json.dumps(payload))
                    except Exception:
                        pass

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        # Clean up
        if student_id and session_id in _signaling_rooms:
            _signaling_rooms[session_id].pop(student_id, None)

            # Notify remaining peers
            for pid, ws in _signaling_rooms[session_id].items():
                try:
                    import asyncio
                    asyncio.ensure_future(ws.send_text(_json.dumps({
                        "type": "peer-left",
                        "student_id": student_id,
                    })))
                except Exception:
                    pass

            # Clean up empty room
            if not _signaling_rooms[session_id]:
                del _signaling_rooms[session_id]
