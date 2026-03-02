import json
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


def _build_credential():
    """
    Returns a firebase_admin credential in priority order:
      1. FIREBASE_SERVICE_ACCOUNT_JSON  — raw JSON string (best for cloud deployments)
      2. FIREBASE_SERVICE_ACCOUNT_PATH  — path to a local JSON file (local dev)

    Raises RuntimeError immediately if neither is configured, so the process
    fails fast instead of hanging on GCP metadata server (ADC).
    """
    json_str = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    if json_str:
        try:
            service_account_info = json.loads(json_str)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                "FIREBASE_SERVICE_ACCOUNT_JSON is set but is not valid JSON"
            ) from exc
        return credentials.Certificate(service_account_info)

    path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "").strip()
    if path:
        return credentials.Certificate(path)

    raise RuntimeError(
        "Firebase credentials not configured. "
        "Set FIREBASE_SERVICE_ACCOUNT_JSON (JSON string) or "
        "FIREBASE_SERVICE_ACCOUNT_PATH (file path)."
    )


def get_firestore_client() -> Any:
    global _client
    if _client is not None:
        return _client
    if firestore is None or credentials is None or get_app is None or initialize_app is None:
        raise RuntimeError("firebase_admin is not installed")

    try:
        get_app()
    except ValueError:
        initialize_app(_build_credential())

    _client = firestore.client()
    return _client
