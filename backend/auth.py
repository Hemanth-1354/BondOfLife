"""Simple email‑based authentication and JWT utilities for BondOfLife.

- Users provide an email and receive a JWT (no password for MVP).
- The JWT payload contains the user email (`sub`) and role.
- Token expires after 2 hours.

Dependencies: ``pyjwt`` (added to requirements)."""

import os
import datetime
from typing import Optional

import jwt  # PyJWT

# Secret key – in production load from env var or secret manager
JWT_SECRET = os.getenv("JWT_SECRET", "bondoflife-secret-key")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 2

def create_token(email: str, role: str) -> str:
    """Create a signed JWT for *email* with the given *role*."""
    payload = {
        "sub": email,
        "role": role,
        "iat": datetime.datetime.utcnow(),
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_token(token: str) -> Optional[dict]:
    """Decode *token* and return the payload dict or ``None`` on failure."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None

def get_current_user(token: str) -> dict:
    """FastAPI dependency that returns user info or raises 401."""
    from fastapi import HTTPException, status
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return {"email": payload["sub"], "role": payload["role"]}

__all__ = ["create_token", "decode_token", "get_current_user"]
