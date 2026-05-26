"""
Dolphin ERP — Authentication Module
HMAC-SHA256 JWT + PBKDF2-SHA256 password hashing (stdlib only, zero deps)
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

# ── Constants ─────────────────────────────────────────────────────────────────

# PBKDF2 iterations — NIST recommends ≥600k for SHA-256, we use 300k for speed
PBKDF2_ITERS = 300_000

# Token expiry: 12 hours (one shift)
ACCESS_TOKEN_EXPIRE_SECS = 12 * 3600

# Roles — ordered from highest to lowest privilege
ROLES = ["admin", "manager", "staff", "operator"]
ROLE_WEIGHTS = {r: i for i, r in enumerate(ROLES)}  # admin=0 (highest)

# Permissions per role
PERMISSIONS = {
    "admin": {
        "pages": ["dashboard","today","tasks","upcoming","jobs","orders","quote","quotations","schedule",
                  "capacity","floorplan","routings","machines","workers","customers",
                  "reports","settings","routing-stats","users"],
        "can_see_all_workers": True,
        "can_delete": True,
        "can_manage_users": True,
        "can_see_financials": True,
        "can_schedule": True,
        "can_edit_routings": True,
        "can_control_ops": True,   # start/pause/done on shop ops
    },
    "manager": {
        "pages": ["dashboard","today","tasks","upcoming","jobs","orders","quote","quotations","schedule",
                  "capacity","floorplan","routings","machines","workers","customers",
                  "reports","routing-stats","settings"],
        "can_see_all_workers": True,
        "can_delete": True,
        "can_manage_users": False,
        "can_see_financials": True,
        "can_schedule": True,
        "can_edit_routings": True,
        "can_control_ops": True,
    },
    "staff": {
        # Office staff: designers, admin, quality, etc.
        # Can see everything on the floor (read-only) + manage their own tasks
        "pages": ["today","tasks"],
        "can_see_all_workers": True,   # sees all workers' ops on Today's Work
        "can_delete": False,
        "can_manage_users": False,
        "can_see_financials": False,
        "can_schedule": False,
        "can_edit_routings": False,
        "can_control_ops": False,      # cannot start/pause/done shop ops
    },
    "operator": {
        # Shop floor machine operator: only sees their own ops + tasks
        "pages": ["today","tasks"],
        "can_see_all_workers": False,
        "can_delete": False,
        "can_manage_users": False,
        "can_see_financials": False,
        "can_schedule": False,
        "can_edit_routings": False,
        "can_control_ops": True,       # can start/pause/done their own ops
    },
}

# ── Permission resolver ───────────────────────────────────────────────────────

def resolve_permissions(role: str, custom_permissions_json: str = None) -> dict:
    """
    Return the effective permissions for a user.
    If custom_permissions_json is set, it completely overrides the role defaults.
    custom_permissions_json is a JSON string with the same structure as PERMISSIONS values.
    """
    base = PERMISSIONS.get(role, PERMISSIONS["operator"])
    if not custom_permissions_json:
        return base
    try:
        custom = json.loads(custom_permissions_json)
        # Merge: custom overrides base for any key present
        merged = dict(base)
        merged.update(custom)
        return merged
    except Exception:
        return base

def _get_secret() -> str:
    """Get JWT secret from env or auto-generate and persist to secret.key file."""
    env_secret = os.environ.get("DOLPHIN_SECRET")
    if env_secret and len(env_secret) >= 32:
        return env_secret
    key_file = os.path.join(os.path.dirname(__file__), "secret.key")
    if os.path.exists(key_file):
        with open(key_file) as f:
            s = f.read().strip()
            if len(s) >= 32:
                return s
    # Generate new secret and persist
    new_secret = secrets.token_hex(32)  # 64 char hex = 256 bits
    with open(key_file, "w") as f:
        f.write(new_secret)
    # Restrict permissions on unix
    try:
        os.chmod(key_file, 0o600)
    except Exception:
        pass
    return new_secret


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    pad = 4 - len(s) % 4
    if pad != 4:
        s += "=" * pad
    return base64.urlsafe_b64decode(s)


def create_token(user_id: int, username: str, role: str, worker_id: Optional[int] = None) -> str:
    """Create a signed JWT token."""
    secret = _get_secret()
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    exp = int(time.time()) + ACCESS_TOKEN_EXPIRE_SECS
    claims = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "worker_id": worker_id,
        "exp": exp,
        "iat": int(time.time()),
        "jti": secrets.token_hex(8),  # unique token ID (prevents replay if needed)
    }
    payload = _b64url_encode(json.dumps(claims).encode())
    sig_input = f"{header}.{payload}".encode()
    sig = _b64url_encode(hmac.new(secret.encode(), sig_input, hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


def verify_token(token: str) -> dict:
    """Verify token signature and expiry. Returns claims dict or raises HTTPException."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            raise ValueError("bad format")
        header, payload, sig = parts
        secret = _get_secret()
        sig_input = f"{header}.{payload}".encode()
        expected_sig = _b64url_encode(hmac.new(secret.encode(), sig_input, hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected_sig):
            raise ValueError("invalid signature")
        claims = json.loads(_b64url_decode(payload))
        if claims.get("exp", 0) < time.time():
            raise ValueError("token expired")
        return claims
    except ValueError as e:
        raise HTTPException(status_code=401, detail=f"Invalid or expired token: {e}")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


# ── Password Hashing ──────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    """Hash password with PBKDF2-SHA256. Returns 'hash:salt' string."""
    salt = secrets.token_hex(16)  # 32 char hex = 128-bit salt
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ITERS)
    return f"{h.hex()}:{salt}"


def verify_password(password: str, stored: str) -> bool:
    """Verify password against stored 'hash:salt'."""
    try:
        h_stored, salt = stored.split(":")
        h_attempt = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ITERS)
        return hmac.compare_digest(h_stored, h_attempt.hex())
    except Exception:
        return False


def hash_pin(pin: str) -> str:
    """Hash PIN (same algorithm, fewer iterations for speed on tablet)."""
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 100_000)
    return f"{h.hex()}:{salt}"


def verify_pin(pin: str, stored: str) -> bool:
    """Verify PIN against stored 'hash:salt'."""
    try:
        h_stored, salt = stored.split(":")
        h_attempt = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 100_000)
        return hmac.compare_digest(h_stored, h_attempt.hex())
    except Exception:
        return False


# ── FastAPI Dependency ────────────────────────────────────────────────────────

def get_current_user(request: Request) -> dict:
    """FastAPI dependency — extracts and verifies Bearer token from Authorization header."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth[7:]
    return verify_token(token)


def require_roles(*roles):
    """FastAPI dependency factory — requires user to have one of the given roles."""
    def dependency(user: dict = Depends(get_current_user)):
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return dependency


# Convenience role dependencies
require_admin   = require_roles("admin")
require_manager = require_roles("admin", "manager")
require_any     = require_roles("admin", "manager", "staff", "operator")


# ── Bootstrap ─────────────────────────────────────────────────────────────────

def ensure_admin_user(db):
    """Called on startup — create default admin user if no users exist."""
    from sqlalchemy import text
    count = db.execute(text("SELECT COUNT(*) FROM users")).scalar()
    if count == 0:
        default_password = "admin123"  # User MUST change this on first login
        db.execute(text("""
            INSERT INTO users (username, display_name, password_hash, role, is_active, created_at)
            VALUES (:u, :dn, :ph, :r, 1, :ca)
        """), {
            "u": "admin",
            "dn": "Administrator",
            "ph": hash_password(default_password),
            "r": "admin",
            "ca": datetime.utcnow().isoformat(),
        })
        db.commit()
        print("✓ Default admin user created (username: admin, password: admin123)")
        print("  ⚠  Change this password immediately after first login!")
