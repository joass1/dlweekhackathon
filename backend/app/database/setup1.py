from app.database.firebase_client import get_firestore_client


def setup_database():
    """Initialize Firestore collections for learning analytics."""
    db = get_firestore_client()
    db.collection("learning_analytics_meta").document("schema").set(
        {
            "collection": "learning_analytics",
            "fields": [
                "user_id",
                "topic",
                "self_confidence",
                "ai_adjusted_confidence",
                "errors",
                "transition_difficulty",
                "learning_modality",
                "frustration",
                "topic_vector",
            ],
        },
        merge=True,
    )
    print("Firestore learning analytics schema metadata initialized")
    return db
