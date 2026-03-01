from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict
import openai
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import Qdrant
from langchain_community.chat_models import ChatOpenAI
from langchain.text_splitter import RecursiveCharacterTextSplitter
import os
from dotenv import load_dotenv
from qdrant_client import QdrantClient

load_dotenv()
openai.api_key = os.getenv("OPENAI_API_KEY")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = QdrantClient(host="localhost", port=6333)
embeddings = OpenAIEmbeddings()
vector_store = Qdrant(
    client=client,
    collection_name="notes",
    embeddings=embeddings,
)

class Note(BaseModel):
    content: str
    metadata: Dict = {}

class Query(BaseModel):
    question: str

notes_db = []

@app.post("/upload")
async def upload_note(note: Note):
    try:
        # Split text into chunks
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200
        )
        chunks = text_splitter.split_text(note.content)
        
        # Add to vector store
        vector_store.add_texts(
            texts=chunks,
            metadatas=[note.metadata for _ in chunks]
        )
        
        notes_db.append(note)
        return {"message": "Note uploaded successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/query")
async def query_notes(query: Query):
    try:
        if not notes_db:
            raise HTTPException(status_code=404, detail="No notes found")
        
        # Search for relevant documents
        docs = vector_store.similarity_search(query.question, k=3)
        
        # Prepare context
        context = "\n\n".join([doc.page_content for doc in docs])
        
        # Generate response
        llm = ChatOpenAI(temperature=0.7)
        prompt = f"""Based on these notes, please answer the question.
        Only use information from the provided notes.

        Notes:
        {context}

        Question: {query.question}

        Answer:"""
        
        response = llm.predict(prompt)
        return {"response": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
