# app/main.py
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import iris
import os
from dotenv import load_dotenv
from app.services.vector_search import VectorSearch
from app.models.schemas import SearchQuery, SearchResult
from langchain.document_loaders import PyPDFLoader, TextLoader
from langchain.text_splitter import CharacterTextSplitter
from langchain.embeddings.openai import OpenAIEmbeddings

import tempfile
from openai import OpenAI
from typing import List, Optional

# Initialize FastAPI app
app = FastAPI(title="Knowledge Balance Network")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Your Next.js frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load environment variables
load_dotenv()

# Database connection setup
try:
    username = 'demo'
    password = 'demo'
    hostname = os.getenv('IRIS_HOSTNAME', 'localhost')
    port = '1972'
    namespace = 'USER'
    CONNECTION_STRING = f"{hostname}:{port}/{namespace}"
    
    print(f"Connecting to database: {CONNECTION_STRING}")
    conn = iris.connect(CONNECTION_STRING, username, password)
    cursor = conn.cursor()
    
    # Initialize vector search
    vector_search = VectorSearch(cursor)
    print("Successfully initialized vector search")
    
except Exception as e:
    print(f"Failed to initialize database connection: {str(e)}")
    raise

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
    Search for discussions using vector similarity
    """
    try:
        results = vector_search.search_discussions(query.query, query.limit)
        return results
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Error performing search: {str(e)}"
        )
    


# Create an uploads directory if it doesn't exist
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# main.py
import chromadb
from fastapi import FastAPI, UploadFile, File, HTTPException
from typing import List
import tempfile
from openai import OpenAI
import os
from dotenv import load_dotenv

app = FastAPI()
load_dotenv()

# Initialize ChromaDB client
chroma_client = chromadb.HttpClient(
    ssl=True,
    host='api.trychroma.com',
    tenant='b2074105-eda4-415d-91f0-ca7471f97857',
    database='treeraj',
    headers={
        'x-chroma-token': 'ck-2VCmSuQBRjJyTSfSrfvDqAu9wZuMR3fQutq3WCdgNyH6'
    }
)

# Create or get collection
collection = chroma_client.get_or_create_collection("knowledge_network")

@app.post("/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    uploaded_files = []
    
    for file in files:
        with tempfile.NamedTemporaryFile(delete=False, suffix=file.filename) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name
            
        try:
            # Process file and extract text
            text_chunks = process_file(tmp_path)  # Implement this based on file type
            
            # Add to ChromaDB
            collection.add(
                documents=text_chunks,
                ids=[f"{file.filename}-{i}" for i in range(len(text_chunks))],
                metadatas=[{"source": file.filename} for _ in text_chunks]
            )
            
            uploaded_files.append({
                "filename": file.filename,
                "chunks": len(text_chunks)
            })
            
        finally:
            os.unlink(tmp_path)
    
    return {
        "message": f"Successfully processed {len(uploaded_files)} files",
        "files": uploaded_files
    }

@app.post("/api/ai/chat")
async def chat(request: dict):
    query = request.get("query")
    
    # Query ChromaDB for relevant context
    results = collection.query(
        query_texts=[query],
        n_results=3
    )
    
    # Extract context from results
    context = results['documents'][0] if results['documents'] else []
    
    # Use Sonar for reasoning
    try:
        ai_response = await generate_ai_response(query, context)
        return {
            "answer": ai_response,
            "context": context
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

async def generate_ai_response(query: str, context: List[str]) -> str:
    client = OpenAI(
        api_key=os.getenv('SONAR_API_KEY'),
        base_url="https://api.perplexity.ai"
    )
    
    messages = [
        {
            "role": "system",
            "content": "You are a knowledgeable AI assistant helping students understand their course materials."
        },
        {
            "role": "user",
            "content": f"Context:\n{' '.join(context)}\n\nQuestion: {query}"
        }
    ]
    
    response = client.chat.completions.create(
        model="sonar-pro",
        messages=messages
    )
    
    return response.choices[0].message.content

# Cleanup on shutdown
@app.on_event("shutdown")
async def shutdown_event():
    """Clean up database connection when shutting down"""
    if 'conn' in globals() and conn:
        conn.close()
        print("Database connection closed")



# Add these to your existing imports

class AIAssistant:
    def __init__(self):
        self.client = OpenAI(
            api_key=os.getenv('SONAR_API_KEY'),
            base_url="https://api.perplexity.ai"
        )

    async def generate_response(self, query: str, context: List[str]) -> dict:
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a knowledgeable AI assistant helping students understand their course materials. "
                    "Use the provided context to answer questions accurately and comprehensively."
                )
            },
            {
                "role": "user",
                "content": f"Context:\n{' '.join(context)}\n\nQuestion: {query}"
            }
        ]

        try:
            response = self.client.chat.completions.create(
                model="sonar-pro",
                messages=messages
            )
            return {
                "answer": response.choices[0].message.content,
                "context": context
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

# Initialize AI assistant
ai_assistant = AIAssistant()

# Add this new endpoint to your existing FastAPI app
@app.post("/api/ai/chat")
async def chat(request: dict):
    query = request.get("query")
    
    # First, search IRIS Vector for relevant context
    try:
        # Use your existing vector search
        results = vector_search.search_discussions(query, limit=3)
        context = [result.discussion for result in results]  # Adjust field name based on your SearchResult model
        
        # Then, use Sonar for reasoning
        response = await ai_assistant.generate_response(query, context)
        
        return {
            "answer": response["answer"],
            "context": response["context"]
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error processing chat: {str(e)}"
        )

def process_file(file_path: str) -> List[str]:
    text_splitter = CharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200
    )
    
    if file_path.endswith('.pdf'):
        loader = PyPDFLoader(file_path)
    else:
        loader = TextLoader(file_path)
        
    documents = loader.load()
    return text_splitter.split_text(''.join([doc.page_content for doc in documents]))