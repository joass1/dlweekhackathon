import os
from typing import Optional

from dotenv import load_dotenv
from firebase_admin import credentials, firestore, get_app, initialize_app

load_dotenv()

_client: Optional[firestore.Client] = None


def get_firestore_client() -> firestore.Client:
    global _client
    if _client is not None:
        return _client

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
