"""
Firebase ID token verification for FastAPI endpoints.

Usage:
    from app.middleware.auth import get_current_user, get_student_id

    @app.post("/protected")
    async def protected_route(student_id: str = Depends(get_student_id)):
        ...
"""

from fastapi import Depends, HTTPException, Request
from firebase_admin import auth as firebase_auth


async def get_current_user(request: Request) -> dict:
    """Extract and verify the Firebase ID token from the Authorization header."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = auth_header[len("Bearer "):]
    try:
        decoded = firebase_auth.verify_id_token(token)
        return decoded
    except firebase_auth.ExpiredIdTokenError:
        raise HTTPException(status_code=401, detail="Token expired")
    except firebase_auth.InvalidIdTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception:
        raise HTTPException(status_code=401, detail="Token verification failed")


async def get_student_id(user: dict = Depends(get_current_user)) -> str:
    """Convenience dependency that extracts just the uid as student_id."""
    return user["uid"]
