from fastapi import APIRouter, HTTPException
from app.models.schemas import SearchQuery, SearchResult
from app.services.vector_search import search_discussions

router = APIRouter()

@router.post("/search", response_model=List[SearchResult])
async def search(query: SearchQuery):
    try:
        results = search_discussions(query.query, query.limit)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/topics")
async def get_topics():
    # Return unique topics
    pass