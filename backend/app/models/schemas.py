from pydantic import BaseModel
from typing import Optional, List

class Discussion(BaseModel):
    student: str
    topic: str
    discussion: str

class SearchQuery(BaseModel):
    query: str
    limit: Optional[int] = 5

class SearchResult(BaseModel):
    student: str
    topic: str
    discussion: str
    similarity: float