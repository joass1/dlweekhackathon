from app.database.firebase_client import get_firestore_client


def get_cursor():
    # Kept for backward compatibility with older callers.
    return get_firestore_client()


def get_global_connection():
    return get_firestore_client()
