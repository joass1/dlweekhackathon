import os
import pathlib
from datetime import datetime, timezone
from math import ceil
from typing import Dict, List

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import CharacterTextSplitter
from openai import OpenAI
from pydantic import BaseModel
from typing import Optional

# Firebase — optional, may not be installed or configured
try:
    from firebase_admin import credentials, firestore, initialize_app
    _firebase_available = True
except ImportError:
    _firebase_available = False
    print("Warning: firebase-admin not installed. Firestore features unavailable.")

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
from app.services.adaptive_engine import AdaptiveEngine, ConceptState
from app.services.knowledge_graph import kg_engine, seed_demo_data

os.environ["TOKENIZERS_PARALLELISM"] = "false"
load_dotenv()

data_dir = pathlib.Path("data")
data_dir.mkdir(exist_ok=True)

FIREBASE_SERVICE_ACCOUNT_PATH = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "").strip()
KNOWLEDGE_CHUNKS_COLLECTION = os.getenv("FIREBASE_KNOWLEDGE_CHUNKS_COLLECTION", "knowledge_chunks")
LEARNING_ANALYTICS_COLLECTION = os.getenv("FIREBASE_LEARNING_ANALYTICS_COLLECTION", "learning_analytics")
MAX_CHUNKS_SCAN = int(os.getenv("FIREBASE_MAX_CHUNKS_SCAN", "300"))


def _init_firestore():
    if not _firebase_available:
        return None
    if FIREBASE_SERVICE_ACCOUNT_PATH:
        cred = credentials.Certificate(FIREBASE_SERVICE_ACCOUNT_PATH)
        initialize_app(cred)
    else:
        initialize_app()
    return firestore.client()


try:
    db = _init_firestore()
except Exception as e:
    db = None
    print(f"Warning: Firestore unavailable ({e}). Upload will still build KG.")


app = FastAPI(title="LearnGraph AI API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

adaptive_engine = AdaptiveEngine()


def process_file(file_path: str) -> List[str]:
    text_splitter = CharacterTextSplitter(chunk_size=500, chunk_overlap=50)

    if file_path.endswith(".pdf"):
        loader = PyPDFLoader(file_path)
    else:
        loader = TextLoader(file_path)

    documents = loader.load()
    full_text = "".join([doc.page_content for doc in documents]).strip()
    if not full_text:
        return []
    return text_splitter.split_text(full_text)


def _token_overlap_score(query: str, text: str) -> float:
    q_tokens = {t for t in query.lower().split() if t}
    if not q_tokens:
        return 0.0
    text_l = text.lower()
    hits = sum(1 for token in q_tokens if token in text_l)
    return hits / len(q_tokens)


def _fetch_relevant_chunks(query: str, limit: int) -> List[Dict]:
    if db is None:
        raise HTTPException(status_code=500, detail="Firestore is not initialized.")

    docs = db.collection(KNOWLEDGE_CHUNKS_COLLECTION).limit(MAX_CHUNKS_SCAN).stream()
    scored: List[Dict] = []
    for doc in docs:
        row = doc.to_dict() or {}
        text = str(row.get("text", ""))
        if not text:
            continue
        score = _token_overlap_score(query, text)
        if score <= 0:
            continue
        scored.append(
            {
                "id": doc.id,
                "text": text,
                "source": str(row.get("source", "unknown")),
                "score": score,
            }
        )

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:limit]


def _to_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _group_learners(learners: List[Dict], group_size: int) -> List[List[Dict]]:
    if not learners:
        return []
    if group_size <= 1:
        return [[learner] for learner in learners]

    sorted_learners = sorted(learners, key=lambda x: _to_float(x.get("ai_adjusted_confidence"), 0.0), reverse=True)
    num_groups = max(1, ceil(len(sorted_learners) / group_size))
    groups: List[List[Dict]] = [[] for _ in range(num_groups)]

    idx = 0
    direction = 1
    for learner in sorted_learners:
        groups[idx].append(learner)
        idx += direction
        if idx >= num_groups:
            idx = num_groups - 1
            direction = -1
        elif idx < 0:
            idx = 0
            direction = 1

    return [g for g in groups if g]


@app.get("/")
async def root():
    return {"message": "LearnGraph AI API is running"}


@app.get("/test")
async def test_connection():
    if db is None:
        raise HTTPException(status_code=500, detail="Firestore is not initialized.")
    try:
        _ = list(db.collection(KNOWLEDGE_CHUNKS_COLLECTION).limit(1).stream())
        return {
            "status": "success",
            "database": "firebase_firestore",
            "knowledge_chunks_collection": KNOWLEDGE_CHUNKS_COLLECTION,
            "learning_analytics_collection": LEARNING_ANALYTICS_COLLECTION,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Firestore connection failed: {str(e)}")


@app.post("/search", response_model=List[SearchResult])
async def search_discussions(query: SearchQuery):
    try:
        limit = query.limit or 5
        results = _fetch_relevant_chunks(query.query, limit)
        return [
            {
                "student": "firebase_user",
                "topic": item["source"],
                "discussion": item["text"],
                "similarity": item["score"],
            }
            for item in results
        ]
    except HTTPException:
        raise
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
                        doc_ref = db.collection(KNOWLEDGE_CHUNKS_COLLECTION).document()
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

        context_rows = _fetch_relevant_chunks(query, limit=3)
        unique_context = [
            {
                "id": row["id"],
                "score": row["score"],
                "text": row["text"][:300] + "..." if len(row["text"]) > 300 else row["text"],
            }
            for row in context_rows
        ]

        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        context_text = " ".join([ctx["text"] for ctx in unique_context])
        messages = [
            {
                "role": "system",
                "content": "You are the LearnGraph AI Socratic Tutor. Guide with probing questions, not direct answers. Keep responses concise (max 150 words).",
            },
            {"role": "user", "content": f"Context:\n{context_text}\n\nQuestion: {query}"},
        ]

        response = client.chat.completions.create(model="gpt-3.5-turbo", messages=messages)
        return {"answer": response.choices[0].message.content, "context": unique_context}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing request: {str(e)}")


@app.get("/api/learning-groups")
async def get_learning_groups(group_size: int = 4):
    if db is None:
        raise HTTPException(status_code=500, detail="Firestore is not initialized.")
    try:
        rows = list(db.collection(LEARNING_ANALYTICS_COLLECTION).stream())
        learners: List[Dict] = []
        for row in rows:
            data = row.to_dict() or {}
            learners.append(
                {
                    "user_id": data.get("user_id", row.id),
                    "topic": data.get("topic", ""),
                    "self_confidence": data.get("self_confidence"),
                    "ai_adjusted_confidence": data.get("ai_adjusted_confidence"),
                    "errors": data.get("errors"),
                    "transition_difficulty": data.get("transition_difficulty"),
                    "learning_modality": data.get("learning_modality"),
                    "frustration": data.get("frustration"),
                }
            )

        groups = _group_learners(learners, max(2, group_size))
        return {
            "status": "success",
            "total_groups": len(groups),
            "group_size": group_size,
            "groups": groups,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating learning groups: {str(e)}")


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


# ── Knowledge Graph Engine ─────────────────────────────────────────────────────

seed_demo_data()


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


@app.post("/api/kg/add_concept")
async def add_concept(req: AddConceptRequest):
    try:
        node = kg_engine.add_concept(
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
async def kg_update_mastery(req: UpdateMasteryRequest):
    try:
        result = kg_engine.update_mastery(
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
async def get_prerequisites(concept_id: str):
    return {"concept_id": concept_id, "prerequisites": kg_engine.get_prerequisites(concept_id)}


@app.get("/api/kg/dependents/{concept_id}")
async def get_dependents(concept_id: str):
    return {"concept_id": concept_id, "dependents": kg_engine.get_dependents(concept_id)}


@app.get("/api/kg/chain/{concept_id}")
async def get_prerequisite_chain(concept_id: str):
    return {"concept_id": concept_id, "chain": kg_engine.get_prerequisite_chain(concept_id)}


@app.get("/api/kg/graph")
async def get_graph():
    return kg_engine.get_graph_data()


@app.post("/api/kg/build_from_material")
async def build_from_material(req: BuildFromMaterialRequest):
    try:
        openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        added = kg_engine.build_from_material(req.text, openai_client)
        return {"status": "ok", "added": len(added), "nodes": added}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to build from material: {str(e)}")


@app.post("/api/kg/diagnose_mistake")
async def diagnose_mistake(req: DiagnoseMistakeRequest):
    try:
        openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        result = kg_engine.diagnose_mistake(
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
async def render_graph():
    try:
        html = kg_engine.render_graph()
        return HTMLResponse(content=html)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to render graph: {str(e)}")
