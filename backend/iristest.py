from app.database.firebase_client import get_firestore_client

if __name__ == "__main__":
    db = get_firestore_client()
    print("Connected to Firestore")
    # Smoke read
    docs = list(db.collection("knowledge_chunks").limit(1).stream())
    print(f"knowledge_chunks sample count: {len(docs)}")
