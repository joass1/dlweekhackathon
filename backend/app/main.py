# main.py
import os
os.environ["TOKENIZERS_PARALLELISM"] = "false"
import pathlib
import math
import json
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
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
from app.services.assessment_engine import AssessmentEngine
from app.models.schemas import (
    SearchQuery,
    SearchResult,
    QuizGenerateRequest,
    QuizQuestion,
    QuizSubmitRequest,
    EvaluateResponse,
    EvaluatedAnswer,
    MistakeClassification,
    ClassifyResponse,
    SelfAwarenessResponse,
    OverrideRequest,
    MicroCheckpointRequest,
    MicroCheckpointSubmitRequest,
    MicroCheckpointResponse,
    MicroCheckpointSubmitResponse,
)
from uuid import uuid4

# Create data directory if it doesn't exist
data_dir = pathlib.Path("data")
data_dir.mkdir(exist_ok=True)

# Initialize FastAPI app
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
assessment_engine = AssessmentEngine(data_dir / "assessment_state.json")

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
    """Process uploaded files and split into smaller chunks"""
    text_splitter = CharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=50
    )
    
    if file_path.endswith('.pdf'):
        loader = PyPDFLoader(file_path)
    else:
        loader = TextLoader(file_path)
        
    documents = loader.load()
    return text_splitter.split_text(''.join([doc.page_content for doc in documents]))

@app.get("/")
async def root():
    """Root endpoint to verify API is running"""
    return {"message": "LearnGraph AI API is running"}

@app.get("/test")
async def test_connection():
    """Test endpoint to verify database connection"""
    try:
        cursor.execute("SELECT 1")
        return {"status": "success", "message": "Database connection is working"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database connection failed: {str(e)}")

@app.post("/search", response_model=List[SearchResult])
async def search_discussions(query: SearchQuery):
    """
    Search for discussions using IRIS vector similarity
    """
    try:
        results = vector_search.search_discussions(query.query, query.limit)
        return results
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Error performing search: {str(e)}"
        )

@app.post("/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    """Handle file uploads and store in Qdrant"""
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")
        
    uploaded_files = []
    
    for file in files:
        # Save uploaded file to data directory
        file_path = data_dir / file.filename
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
            
        try:
            if not file_path.exists():
                raise HTTPException(
                    status_code=404,
                    detail=f"File not found: {file.filename}"
                )
                
            # Process file and extract text
            text_chunks = process_file(str(file_path))
            
            # Encode text chunks
            embeddings = encoder.encode(text_chunks)
            
            # Add to Qdrant with UUID ids
            points = models.Batch(
                ids=[str(uuid4()) for _ in range(len(text_chunks))],  # Generate UUIDs
                vectors=embeddings.tolist(),
                payloads=[{
                    "text": chunk,
                    "source": file.filename,
                    "chunk_index": i  # Optional: keep track of chunk order
                } for i, chunk in enumerate(text_chunks)]
            )
            
            qdrant_client.upsert(
                collection_name="knowledge_network",
                points=points
            )
            
            uploaded_files.append({
                "filename": file.filename,
                "chunks": len(text_chunks)
            })
            
        finally:
            # Clean up the temporary file
            if file_path.exists():
                file_path.unlink()
    
    return {
        "message": f"Successfully processed {len(uploaded_files)} files",
        "files": uploaded_files
    }

@app.post("/api/ai/chat")
async def chat(request: dict):
    try:
        query = request.get("query")
        if not query:
            raise HTTPException(status_code=400, detail="Query is required")
        
        # Query Qdrant for relevant context
        query_vector = encoder.encode(query).tolist()
        results = qdrant_client.search(
            collection_name="knowledge_network",
            query_vector=query_vector,
            limit=3
        )
        
        # Extract context and ensure uniqueness
        seen = set()
        unique_context = []
        for result in results:
            text = result.payload['text']
            text_hash = hash(text)
            if text_hash not in seen:
                seen.add(text_hash)
                truncated = text[:300] + "..." if len(text) > 300 else text
                unique_context.append({
                    'text': truncated,
                    'id': str(result.id),
                    'score': result.score
                })
        
        try:
            # Use OpenAI instead of Perplexity
            client = OpenAI(
                api_key=os.getenv('OPENAI_API_KEY')  # Use OpenAI key
                # Remove base_url to use OpenAI's API
            )
            
            context_text = ' '.join([ctx['text'] for ctx in unique_context])
            messages = [
                {
                    "role": "system",
                    "content": "You are the LearnGraph AI Socratic Tutor. Instead of giving direct answers, guide the student with probing questions that help them discover the answer themselves. Use their uploaded course context to reference specific concepts. Keep responses concise (max 150 words)."
                },
                {
                    "role": "user",
                    "content": f"Context:\n{context_text}\n\nQuestion: {query}"
                }
            ]
            
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",  # Use OpenAI model
                messages=messages
            )
            
            return {
                "answer": response.choices[0].message.content,
                "context": unique_context
            }
            
        except Exception as e:
            print(f"OpenAI API Error: {str(e)}")  # Updated error message
            raise HTTPException(
                status_code=500,
                detail=f"Error with OpenAI API: {str(e)}"
            )
            
    except Exception as e:
        print(f"Error in chat endpoint: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error processing request: {str(e)}"
        )

 # Add endpoint to FastAPI
# In main.py, update imports



# Add new endpoint for learning groups
@app.get("/api/learning-groups")
async def get_learning_groups(group_size: int = 4):
    """
    Get groups of learners with similar learning patterns
    """
    try:
        groups = learning_groups_search.cluster_similar_learners(group_size)
        return {
            "status": "success",
            "total_groups": len(groups),
            "group_size": group_size,
            "groups": groups
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error creating learning groups: {str(e)}"
        )


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

# Cleanup on shutdown
@app.on_event("shutdown")
async def shutdown_event():
    """Clean up database connection when shutting down"""
    if 'conn' in globals() and conn:
        conn.close()
        print("Database connection closed")
