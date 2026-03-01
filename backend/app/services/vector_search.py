import os
from typing import Dict, List, Optional

from dotenv import load_dotenv

load_dotenv()


class VectorSearch:
    def __init__(self, db):
        self.db = db
        self.collection_name = os.getenv("FIREBASE_KNOWLEDGE_CHUNKS_COLLECTION", "knowledge_chunks")

    @staticmethod
    def _token_overlap_score(query: str, text: str) -> float:
        q_tokens = {t for t in query.lower().split() if t}
        if not q_tokens:
            return 0.0
        text_l = text.lower()
        hits = sum(1 for token in q_tokens if token in text_l)
        return hits / len(q_tokens)

    def search_discussions(self, query: str, limit: int = 5, user_id: Optional[str] = None) -> List[Dict]:
        if self.db is None:
            raise RuntimeError("Firestore is not initialized")

        max_scan = int(os.getenv("FIREBASE_MAX_CHUNKS_SCAN", "300"))
        query_ref = self.db.collection(self.collection_name)
        if user_id:
            query_ref = query_ref.where("userId", "==", user_id)
        docs = query_ref.limit(max_scan).stream()

        scored: List[Dict] = []
        for doc in docs:
            row = doc.to_dict() or {}
            text = str(row.get("text", ""))
            if not text:
                continue
            score = self._token_overlap_score(query, text)
            if score <= 0:
                continue

            scored.append(
                {
                    "student": str(row.get("student", "firebase_user")),
                    "topic": str(row.get("source", "uploaded_material")),
                    "discussion": text,
                    "similarity": float(score),
                }
            )

        scored.sort(key=lambda x: x["similarity"], reverse=True)
        return scored[: max(1, int(limit or 5))]
