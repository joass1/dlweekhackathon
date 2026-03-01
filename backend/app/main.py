import os
import pathlib

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import iris
import os
import tempfile
from dotenv import load_dotenv
from openai import OpenAI
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain.text_splitter import CharacterTextSplitter
from qdrant_client import QdrantClient
from qdrant_client.http import models
from sentence_transformers import SentenceTransformer
from app.services.vector_search import VectorSearch
from app.services.vector_search1 import VectorSearch1
from app.models.schemas import SearchQuery, SearchResult
from uuid import uuid4

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
        # Uses GOOGLE_APPLICATION_CREDENTIALS / ADC if available.
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

# Load environment variables
load_dotenv()

# IRIS Database connection setup
try:
    username = 'demo'
    password = 'demo'
    hostname = os.getenv('IRIS_HOSTNAME', 'localhost')
    port = '1972'
    namespace = 'USER'
    CONNECTION_STRING = f"{hostname}:{port}/{namespace}"
    
    print(f"Connecting to IRIS database: {CONNECTION_STRING}")
    conn = iris.connect(CONNECTION_STRING, username, password)
    cursor = conn.cursor()
    
    # Initialize vector search for IRIS
    vector_search = VectorSearch(cursor)
    learning_groups_search = VectorSearch1(cursor)  
    
    print("Successfully initialized IRIS vector search")
    
except Exception as e:
    print(f"Failed to initialize IRIS database connection: {str(e)}")
    raise

# Initialize Qdrant client (local)
qdrant_client = QdrantClient(path="./qdrant_db")
# Or for cloud: QdrantClient(host="localhost", port=6333)

# Initialize the encoder
encoder = SentenceTransformer('all-MiniLM-L6-v2')

# Create collection if it doesn't exist
try:
    qdrant_client.create_collection(
        collection_name="knowledge_network",
        vectors_config=models.VectorParams(
            size=encoder.get_sentence_embedding_dimension(),
            distance=models.Distance.COSINE
        )
    )
except Exception:
    pass  # Collection already exists

# In-memory stores for assessment flow (hackathon-friendly)
QUIZ_STORE: Dict[str, Dict[str, QuizQuestion]] = {}
ATTEMPT_HISTORY: Dict[str, List[Dict[str, Any]]] = {}
CLASSIFICATION_STORE: Dict[str, Dict[str, MistakeClassification]] = {}
BLIND_SPOT_COUNTS: Dict[str, Dict[str, int]] = {}

SUBJECT_QUESTION_BANK: Dict[str, List[Dict[str, Any]]] = {
    "newtons-laws": [
        {
            "stem": "What happens to acceleration if net force doubles while mass stays constant?",
            "options": ["Acceleration halves", "Acceleration doubles", "Acceleration is unchanged", "Cannot determine"],
            "correct_answer": "Acceleration doubles",
            "explanation": "By F = ma, a is directly proportional to net force when mass is fixed.",
            "difficulty": "easy",
        },
        {
            "stem": "A book rests on a table. Which pair is a Newton's 3rd law action-reaction pair?",
            "options": ["Book weight and table normal force", "Table pushes on book and book pushes on table", "Book weight and Earth pull", "Normal force and gravity are unrelated"],
            "correct_answer": "Table pushes on book and book pushes on table",
            "explanation": "Action-reaction forces act on different objects and are equal/opposite.",
            "difficulty": "medium",
        },
        {
            "stem": "Newton's 1st law is best described as:",
            "options": ["Force creates motion always", "Inertia: objects resist changes in motion", "Momentum is conserved in all cases", "Acceleration is constant"],
            "correct_answer": "Inertia: objects resist changes in motion",
            "explanation": "Without net external force, velocity remains constant.",
            "difficulty": "easy",
        },
        {
            "stem": "A 2 kg object experiences 10 N net force. Acceleration is:",
            "options": ["2 m/s^2", "5 m/s^2", "10 m/s^2", "20 m/s^2"],
            "correct_answer": "5 m/s^2",
            "explanation": "a = F/m = 10/2 = 5 m/s^2.",
            "difficulty": "easy",
        },
        {
            "stem": "Why does a passenger lurch forward when a car stops suddenly?",
            "options": ["Because forward force increases", "Because inertia keeps body moving", "Because gravity increases", "Because friction disappears"],
            "correct_answer": "Because inertia keeps body moving",
            "explanation": "Body tends to maintain its prior state of motion.",
            "difficulty": "medium",
        },
    ],
    "energy-work": [
        {
            "stem": "Work done by a constant force is:",
            "options": ["F + d", "F/d", "F d cos(theta)", "mgh only"],
            "correct_answer": "F d cos(theta)",
            "explanation": "Work is the dot product between force and displacement.",
            "difficulty": "easy",
        },
        {
            "stem": "The work-energy theorem states:",
            "options": ["Potential energy is conserved always", "Net work equals change in kinetic energy", "Power equals force times displacement", "Energy cannot be transferred"],
            "correct_answer": "Net work equals change in kinetic energy",
            "explanation": "W_net = Delta K.",
            "difficulty": "medium",
        },
        {
            "stem": "If friction does negative work, kinetic energy typically:",
            "options": ["Increases", "Stays constant", "Decreases", "Becomes potential energy only"],
            "correct_answer": "Decreases",
            "explanation": "Negative work removes mechanical energy from motion.",
            "difficulty": "easy",
        },
    ],
    "momentum": [
        {
            "stem": "Momentum is defined as:",
            "options": ["m/a", "ma", "mv", "v/m"],
            "correct_answer": "mv",
            "explanation": "Linear momentum equals mass times velocity.",
            "difficulty": "easy",
        },
        {
            "stem": "In an isolated system, total momentum:",
            "options": ["Always increases", "Is conserved", "Always decreases", "Depends on kinetic energy only"],
            "correct_answer": "Is conserved",
            "explanation": "No net external impulse implies conservation of momentum.",
            "difficulty": "easy",
        },
        {
            "stem": "A perfectly inelastic collision means objects:",
            "options": ["Bounce apart with same speed", "Stick together after collision", "Conserve kinetic energy", "Have zero momentum"],
            "correct_answer": "Stick together after collision",
            "explanation": "Momentum is conserved; kinetic energy is not.",
            "difficulty": "medium",
        },
    ],
}


def _build_default_bank(concept: str) -> List[Dict[str, Any]]:
    return [
        {
            "stem": f"Which statement best demonstrates understanding of {concept}?",
            "options": ["Definition recall only", "Applying concept correctly to a new scenario", "Memorizing formulas without context", "Avoiding conceptual reasoning"],
            "correct_answer": "Applying concept correctly to a new scenario",
            "explanation": f"Transfer to a new case is a stronger indicator of conceptual mastery for {concept}.",
            "difficulty": "medium",
        },
        {
            "stem": f"When solving a problem in {concept}, what is the best first step?",
            "options": ["Guess and check", "Identify knowns, unknowns, and governing principles", "Skip to calculator", "Use any familiar equation"],
            "correct_answer": "Identify knowns, unknowns, and governing principles",
            "explanation": "Structured setup reduces careless and conceptual errors.",
            "difficulty": "easy",
        },
        {
            "stem": f"If your answer in {concept} is surprising, what should you do?",
            "options": ["Submit anyway", "Check units, assumptions, and edge cases", "Change to a round number", "Ask a friend immediately"],
            "correct_answer": "Check units, assumptions, and edge cases",
            "explanation": "Sanity checks catch both careless and model mistakes.",
            "difficulty": "medium",
        },
    ]


def _get_bank(concept: str) -> List[Dict[str, Any]]:
    return SUBJECT_QUESTION_BANK.get(concept, _build_default_bank(concept))


def _make_question(concept: str, item: Dict[str, Any], idx: int) -> QuizQuestion:
    return QuizQuestion(
        question_id=f"{concept}-q{idx}",
        concept=concept,
        stem=item["stem"],
        options=item["options"],
        correct_answer=item["correct_answer"],
        explanation=item.get("explanation"),
        difficulty=item.get("difficulty", "medium"),
    )


def _confidence_to_probability(confidence_1_to_5: int) -> float:
    return (confidence_1_to_5 - 1) / 4.0


def _classify_wrong_answer(
    concept: str,
    question: QuizQuestion,
    selected_answer: str,
    confidence_1_to_5: int,
) -> MistakeClassification:
    if confidence_1_to_5 >= 4:
        return MistakeClassification(
            question_id=question.question_id,
            mistake_type="careless",
            missing_concept=None,
            error_span=selected_answer,
            rationale="High confidence with incorrect answer suggests a likely execution slip.",
        )
    if confidence_1_to_5 <= 2:
        return MistakeClassification(
            question_id=question.question_id,
            mistake_type="conceptual",
            missing_concept=concept,
            error_span=selected_answer,
            rationale="Low confidence and incorrect answer indicates a likely concept gap.",
        )

    # Mid-confidence fallback using lightweight LLM classification if available.
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return MistakeClassification(
            question_id=question.question_id,
            mistake_type="conceptual",
            missing_concept=concept,
            error_span=selected_answer,
            rationale="No LLM key available; defaulted ambiguous mistake to conceptual for safer intervention.",
        )

    try:
        llm_client = OpenAI(api_key=api_key)
        system_prompt = (
            "Classify student mistakes as careless or conceptual. "
            "Return JSON with keys: mistake_type, missing_concept, error_span, rationale."
        )
        user_prompt = {
            "concept": concept,
            "question": question.stem,
            "options": question.options,
            "correct_answer": question.correct_answer,
            "student_answer": selected_answer,
            "confidence_1_to_5": confidence_1_to_5,
        }
        completion = llm_client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_prompt)},
            ],
        )
        raw = completion.choices[0].message.content or "{}"
        parsed = json.loads(raw)
        mistake_type = parsed.get("mistake_type", "conceptual")
        if mistake_type not in {"careless", "conceptual"}:
            mistake_type = "conceptual"
        return MistakeClassification(
            question_id=question.question_id,
            mistake_type=mistake_type,
            missing_concept=parsed.get("missing_concept") or (concept if mistake_type == "conceptual" else None),
            error_span=parsed.get("error_span") or selected_answer,
            rationale=parsed.get("rationale") or "LLM classified this response.",
        )
    except Exception:
        return MistakeClassification(
            question_id=question.question_id,
            mistake_type="conceptual",
            missing_concept=concept,
            error_span=selected_answer,
            rationale="LLM classification failed; defaulted to conceptual.",
        )


def _record_attempt(
    student_id: str,
    question_id: str,
    concept: str,
    is_correct: bool,
    confidence_1_to_5: int,
    mistake_type: Optional[str],
) -> None:
    ATTEMPT_HISTORY.setdefault(student_id, []).append(
        {
            "question_id": question_id,
            "concept": concept,
            "is_correct": is_correct,
            "confidence_1_to_5": confidence_1_to_5,
            "mistake_type": mistake_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )

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
        raise HTTPException(
            status_code=500,
            detail=f"Error creating learning groups: {str(e)}"
        )

# Cleanup on shutdown
@app.on_event("shutdown")
async def shutdown_event():
    """Clean up database connection when shutting down"""
    if 'conn' in globals() and conn:
        conn.close()
        print("Database connection closed")