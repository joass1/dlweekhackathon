import os
import pathlib
from datetime import datetime, timezone
from math import ceil
from typing import Dict, List

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from firebase_admin import credentials, firestore, initialize_app
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import CharacterTextSplitter
from openai import OpenAI

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

os.environ["TOKENIZERS_PARALLELISM"] = "false"
load_dotenv()

data_dir = pathlib.Path("data")
data_dir.mkdir(exist_ok=True)

FIREBASE_SERVICE_ACCOUNT_PATH = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "").strip()
KNOWLEDGE_CHUNKS_COLLECTION = os.getenv("FIREBASE_KNOWLEDGE_CHUNKS_COLLECTION", "knowledge_chunks")
LEARNING_ANALYTICS_COLLECTION = os.getenv("FIREBASE_LEARNING_ANALYTICS_COLLECTION", "learning_analytics")
MAX_CHUNKS_SCAN = int(os.getenv("FIREBASE_MAX_CHUNKS_SCAN", "300"))


def _init_firestore():
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
    print(f"Failed to initialize Firestore: {e}")


app = FastAPI(title="LearnGraph AI API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
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
    if db is None:
        raise HTTPException(status_code=500, detail="Firestore is not initialized.")
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    uploaded_files = []
    for file in files:
        file_path = data_dir / file.filename
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)

        try:
            if not file_path.exists():
                raise HTTPException(status_code=404, detail=f"File not found: {file.filename}")

            text_chunks = process_file(str(file_path))
            if not text_chunks:
                uploaded_files.append({"filename": file.filename, "chunks": 0})
                continue

            batch = db.batch()
            for i, chunk in enumerate(text_chunks):
                doc_ref = db.collection(KNOWLEDGE_CHUNKS_COLLECTION).document()
                batch.set(
                    doc_ref,
                    {
                        "text": chunk,
                        "source": file.filename,
                        "chunk_index": i,
                        "created_at": datetime.now(timezone.utc),
                    },
                )
            batch.commit()

            uploaded_files.append({"filename": file.filename, "chunks": len(text_chunks)})
        finally:
            if file_path.exists():
                file_path.unlink()

    return {"message": f"Successfully processed {len(uploaded_files)} files", "files": uploaded_files}


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
