import os
import pathlib
from datetime import datetime, timezone
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import CharacterTextSplitter
from openai import OpenAI
from pydantic import BaseModel

from app.database.firebase_client import get_firestore_client
from app.models.adaptive_schemas import (
    BKTUpdateRequest,
    BKTUpdateResponse,
    ConceptStatePayload,
    DecayRequest,
    DecayResponse,
    MasteryRequest,
    MasteryResponse,
    RPKTProbeRequest,
    RPKTProbeResponse,
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
from app.services.knowledge_graph import kg_engine, seed_demo_data
from app.services.vector_search import VectorSearch
from app.services.vector_search1 import VectorSearch1
from app.services.assessment_engine import AssessmentEngine
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

try:
    db = get_firestore_client()
except Exception as e:
    db = None
    print(f"Warning: Firestore unavailable ({e}). Upload will still build KG.")

vector_search = VectorSearch(db)
learning_groups_search = VectorSearch1(db)
assessment_engine = AssessmentEngine(data_dir / "assessment_state.json")

openai_api_key = os.getenv("OPENAI_API_KEY")
if not openai_api_key:
    print("WARNING: OPENAI_API_KEY not set — AI tutor endpoints will fail at runtime")
_openai_client = OpenAI(api_key=openai_api_key or "placeholder")
tutor_service = TutorService(db, _openai_client)

# Seed demo knowledge graph on startup
seed_demo_data()


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


@app.post("/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    uploaded_files = []
    kg_concepts_added = 0

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
                    batch = db.batch()
                    for i, chunk in enumerate(text_chunks):
                        doc_ref = db.collection(vector_search.collection_name).document()
                        batch.set(doc_ref, {
                            "text": chunk,
                            "source": safe_name,
                            "chunk_index": i,
                            "created_at": datetime.now(timezone.utc),
                        })
                    batch.commit()
                except Exception as e:
                    print(f"Warning: Firestore storage failed for {safe_name}: {e}")

            # Build knowledge graph from the extracted text
            try:
                openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
                added = kg_engine.build_from_material(full_text, openai_client)
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
async def chat(request: dict):
    try:
        query = request.get("query")
        if not query:
            raise HTTPException(status_code=400, detail="Query is required")

        hits = vector_search.search_discussions(query, 3)
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
async def generate_quiz(request: QuizGenerateRequest):
    return assessment_engine.generate_quiz(request)


@app.post("/api/assessment/evaluate", response_model=EvaluateResponse)
async def evaluate_answer(request: QuizSubmitRequest):
    try:
        return assessment_engine.evaluate_answer(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/assessment/classify", response_model=ClassifyResponse)
async def classify_mistake(request: QuizSubmitRequest):
    try:
        return assessment_engine.classify_mistake(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/assessment/self-awareness/{student_id}", response_model=SelfAwarenessResponse)
async def get_self_awareness_score(student_id: str):
    return assessment_engine.get_self_awareness_score(student_id)


@app.post("/api/assessment/override")
async def override_mistake_classification(request: OverrideRequest):
    try:
        return assessment_engine.override_classification(request.student_id, request.question_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/assessment/micro-checkpoint", response_model=MicroCheckpointResponse)
async def generate_micro_checkpoint(request: MicroCheckpointRequest):
    return assessment_engine.generate_micro_checkpoint(
        request.student_id,
        request.concept,
        request.missing_concept,
    )


@app.post("/api/assessment/micro-checkpoint/submit", response_model=MicroCheckpointSubmitResponse)
async def submit_micro_checkpoint(request: MicroCheckpointSubmitRequest):
    try:
        return assessment_engine.submit_micro_checkpoint(
            request.student_id,
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
