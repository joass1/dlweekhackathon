import os
import pathlib
from datetime import datetime, timezone
from typing import List, Optional

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
from app.services.knowledge_graph import KnowledgeGraphEngine, init_kg_engine, kg_engine, seed_demo_data
from app.services.vector_search import VectorSearch
from app.services.vector_search1 import VectorSearch1
from app.services.assessment_engine import AssessmentEngine, AssessmentStateStore
from app.services.tutor_service import TutorService
from app.models.tutor_schemas import (
    EmbedContentRequest, EmbedContentResponse,
    RetrieveContextRequest,
    TutorChatRequest,
    InterventionRequest, InterventionResponse,
    SessionData, SessionSummaryResponse,
)

os.environ["TOKENIZERS_PARALLELISM"] = "false"
load_dotenv()

data_dir = pathlib.Path("data")
data_dir.mkdir(exist_ok=True)

app = FastAPI(title="LearnGraph AI API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"],
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
_openai_client = OpenAI(api_key=openai_api_key or "placeholder")
tutor_service = TutorService(db, _openai_client)

# Seed demo knowledge graph only when store is empty.
if not kg_engine.get_graph_data().get("nodes"):
    seed_demo_data()


def _courses_collection(student_id: str):
    if db is None:
        return None
    return db.collection("users").document(student_id).collection("courses")


def _get_user_kg_engine(student_id: str) -> KnowledgeGraphEngine:
    if db is None or FirestoreKnowledgeGraphStore is None:
        return kg_engine

    user_store = FirestoreKnowledgeGraphStore(db, graph_id=f"user_{student_id}")
    user_engine = KnowledgeGraphEngine(firestore_store=user_store)
    user_engine.load_from_firestore()
    return user_engine


def process_file(file_path: str) -> List[str]:
    splitter = CharacterTextSplitter(chunk_size=500, chunk_overlap=50)
    loader = PyPDFLoader(file_path) if file_path.endswith(".pdf") else TextLoader(file_path)
    docs = loader.load()
    full_text = "".join(doc.page_content for doc in docs).strip()
    if not full_text:
        return []
    return splitter.split_text(full_text)


@app.get("/")
async def root():
    return {"message": "LearnGraph AI API is running"}


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
        return {"courses": DEFAULT_COURSES}
    try:
        courses_col = _courses_collection(student_id)
        if courses_col is None:
            return {"courses": DEFAULT_COURSES}

        docs = courses_col.stream()
        courses = sorted(
            [
                {"id": str((d.to_dict() or {}).get("id", d.id)), "name": str((d.to_dict() or {}).get("name", d.id))}
                for d in docs
            ],
            key=lambda x: x["name"].lower(),
        )
        if not courses:
            # Seed per-user defaults once for convenience.
            batch = db.batch()
            for c in DEFAULT_COURSES:
                batch.set(courses_col.document(c["id"]), {**c, "userId": student_id})
            batch.commit()
            courses = DEFAULT_COURSES
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
    user_kg_engine = _get_user_kg_engine(student_id)

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
                    concept_slug = (course_id or safe_name).lower().replace(" ", "-")
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
            except Exception as e:
                print(f"Warning: KG build failed for {safe_name}: {e}")

            uploaded_files.append({"filename": safe_name, "chunks": len(text_chunks), "status": "success"})

        except Exception as e:
            import traceback
            traceback.print_exc()
            uploaded_files.append({"filename": safe_name, "chunks": 0, "status": "error", "error": str(e)})
        finally:
            if file_path.exists():
                file_path.unlink()

    return {
        "message": f"Processed {len(uploaded_files)} files, extracted {kg_concepts_added} concepts",
        "files": uploaded_files,
        "kg_concepts_added": kg_concepts_added,
    }


@app.post("/api/ai/chat")
async def chat(request: dict, student_id: str = Depends(get_student_id)):
    try:
        query = request.get("query")
        if not query:
            raise HTTPException(status_code=400, detail="Query is required")

        hits = vector_search.search_discussions(query, 3, user_id=student_id)
        unique_context = []
        seen = set()
        for hit in hits:
            text = str(hit.get("discussion", ""))
            text_hash = hash(text)
            if text_hash in seen:
                continue
            seen.add(text_hash)
            unique_context.append(
                {
                    "id": str(len(unique_context) + 1),
                    "score": float(hit.get("similarity", 0.0)),
                    "text": text[:300] + "..." if len(text) > 300 else text,
                }
            )

        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        context_text = " ".join([ctx["text"] for ctx in unique_context])
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are the LearnGraph AI Socratic Tutor. Instead of giving direct answers, guide the student with probing questions. Keep responses concise (max 150 words).",
                },
                {"role": "user", "content": f"Context:\n{context_text}\n\nQuestion: {query}"},
            ],
        )

        return {"answer": response.choices[0].message.content, "context": unique_context}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing request: {str(e)}")


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
    request.student_id = student_id
    return assessment_engine.generate_quiz(request)


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
        return assessment_engine.classify_mistake(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/assessment/self-awareness/{student_id}", response_model=SelfAwarenessResponse)
async def get_self_awareness_score(student_id: str, _uid: str = Depends(get_student_id)):
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
        return assessment_engine.submit_micro_checkpoint(
            student_id,
            request.question_id,
            request.selected_answer,
            request.confidence_1_to_5,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


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

    # Assessment data from Firestore
    if db is not None and isinstance(assessment_store, FirestoreAssessmentStore):
        try:
            attempts = assessment_store.get_attempts(student_id)
            progress["total_attempts"] = len(attempts)
            progress["correct_attempts"] = sum(1 for a in attempts if a.get("is_correct"))
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
            # Last 10 attempts for recent activity
            progress["recent_attempts"] = attempts[-10:]

            blind_spots = assessment_store.get_blind_spots(student_id)
            progress["blind_spots"] = blind_spots
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
