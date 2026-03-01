from typing import List

from fastapi import APIRouter, HTTPException

from app.database.firebase_client import get_firestore_client
from app.models.schemas import SearchQuery, SearchResult
from app.services.vector_search import VectorSearch

router = APIRouter()

try:
    db = get_firestore_client()
except Exception:
    db = None

vector_search = VectorSearch(db)


@router.post("/search", response_model=List[SearchResult])
async def search(query: SearchQuery):
    try:
        results = vector_search.search_discussions(query.query, query.limit)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/topics")
async def get_topics():
    if db is None:
        raise HTTPException(status_code=500, detail="Firestore is not initialized")

    try:
        docs = db.collection(vector_search.collection_name).stream()
        topics = sorted(
            {
                str((doc.to_dict() or {}).get("source", "")).strip()
                for doc in docs
                if str((doc.to_dict() or {}).get("source", "")).strip()
            }
        )
        return {"topics": topics}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
