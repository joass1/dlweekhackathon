# main.py
import os
os.environ["TOKENIZERS_PARALLELISM"] = "false"
import pathlib

from fastapi import FastAPI, HTTPException, UploadFile, File
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

# Create data directory if it doesn't exist
data_dir = pathlib.Path("data")
data_dir.mkdir(exist_ok=True)

# Initialize FastAPI app
app = FastAPI(title="Knowledge Balance Network")
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
    return {"message": "Knowledge Balance Network API is running"}

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
                    "content": "You are a knowledgeable AI assistant. Provide concise answers (max 150 words) using the given context."
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

# Cleanup on shutdown
@app.on_event("shutdown")
async def shutdown_event():
    """Clean up database connection when shutting down"""
    if 'conn' in globals() and conn:
        conn.close()
        print("Database connection closed")