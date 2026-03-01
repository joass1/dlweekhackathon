from app.database.firebase_client import get_firestore_client


def setup_database():
    """Initialize Firestore collections for discussion data."""
    db = get_firestore_client()
    # Firestore collections are created on first write. Seed metadata doc.
    db.collection("student_discussions_meta").document("schema").set(
        {
            "collection": "knowledge_chunks",
            "fields": ["student", "source", "text", "chunk_index", "created_at"],
        },
        merge=True,
    )
    print("Firestore discussion schema metadata initialized")
    return db
