import os
from typing import Any, Optional

from dotenv import load_dotenv

try:
    from firebase_admin import credentials, firestore, get_app, initialize_app
except ModuleNotFoundError:  # Optional dependency for local/dev runs.
    credentials = None  # type: ignore[assignment]
    firestore = None  # type: ignore[assignment]
    get_app = None  # type: ignore[assignment]
    initialize_app = None  # type: ignore[assignment]

load_dotenv()

_client: Optional[Any] = None


def get_firestore_client() -> Any:
    global _client
    if _client is not None:
        return _client
    if firestore is None or credentials is None or get_app is None or initialize_app is None:
        raise RuntimeError("firebase_admin is not installed")

    service_account_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "").strip()
    try:
        get_app()
    except ValueError:
        if service_account_path:
            cred = credentials.Certificate(service_account_path)
            initialize_app(cred)
        else:
            initialize_app()

    _client = firestore.client()
    return _client
