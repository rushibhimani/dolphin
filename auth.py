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

PBKDF2_ITERS = 300_000
ACCESS_TOKEN_EXPIRE_SECS = 12 * 3600

ROLES = ["admin", "manager", "staff", "operator"]
ROLE_WEIGHTS = {r: i for i, r in enumerate(ROLES)}  # admin=0 (highest)

# Page access levels:
#   0 = no access
#   1 = view only   (read-only, cannot add/edit/delete)
#   2 = modify      (can add and edit, cannot delete)
#   3 = full        (can add, edit, delete)

ALL_PAGES = [
    "dashboard", "today", "past-work", "tasks", "upcoming",
    "jobs", "orders", "quote", "quotations", "schedule",
    "capacity", "floorplan", "routings", "machines", "workers",
    "customers", "reports", "settings", "routing-stats", "users",
    "activity-log",
]

def _full(*pages):
    return {p: 3 for p in pages}

def _view(*pages):
    return {p: 1 for p in pages}

def _modify(*pages):
    return {p: 2 for p in pages}

# Role default page_levels
ROLE_PAGE_LEVELS = {
    "admin": {p: 3 for p in ALL_PAGES},
    "manager": {
        **_full("dashboard","today","past-work","tasks","upcoming",
                "jobs","orders","quote","quotations","schedule",
                "capacity","floorplan","routings","machines","workers",
                "customers","reports","settings","routing-stats","activity-log"),
        "users": 0,   # managers cannot manage users by default
    },
    "staff": {
        **_full("tasks"),
        **_view("dashboard","today","past-work","upcoming","jobs","orders",
                "schedule","capacity","floorplan","routings","machines",
                "workers","customers","reports"),
        "quote": 0, "quotations": 0, "users": 0, "settings": 0, "routing-stats": 0,
    },
    "operator": {
        **_full("today","tasks","past-work"),
        # operators see nothing else by default
        **{p: 0 for p in ALL_PAGES if p not in ("today","tasks","past-work")},
    },
}

PERMISSIONS = {
    "admin": {
        "page_levels": ROLE_PAGE_LEVELS["admin"],
        "pages": ALL_PAGES,                       # legacy compat
        "can_see_all_workers": True,
        "can_delete": True,
        "can_manage_users": True,
        "can_see_financials": True,
        "can_schedule": True,
        "can_edit_routings": True,
        "can_control_ops": True,
    },
    "manager": {
        "page_levels": ROLE_PAGE_LEVELS["manager"],
        "pages": [p for p,l in ROLE_PAGE_LEVELS["manager"].items() if l > 0],
        "can_see_all_workers": True,
        "can_delete": True,
        "can_manage_users": False,
        "can_see_financials": True,
        "can_schedule": True,
        "can_edit_routings": True,
        "can_control_ops": True,
    },
    "staff": {
        "page_levels": ROLE_PAGE_LEVELS["staff"],
        "pages": [p for p,l in ROLE_PAGE_LEVELS["staff"].items() if l > 0],
        "can_see_all_workers": True,
        "can_delete": False,
        "can_manage_users": False,
        "can_see_financials": False,
        "can_schedule": False,
        "can_edit_routings": False,
        "can_control_ops": False,
    },
    "operator": {
        "page_levels": ROLE_PAGE_LEVELS["operator"],
        "pages": [p for p,l in ROLE_PAGE_LEVELS["operator"].items() if l > 0],
        "can_see_all_workers": False,
        "can_delete": False,
        "can_manage_users": False,
        "can_see_financials": False,
        "can_schedule": False,
        "can_edit_routings": False,
        "can_control_ops": True,
    },
}

# ── Permission resolver ───────────────────────────────────────────────────────

def resolve_permissions(role: str, custom_permissions_json: str = None) -> dict:
    """
    Return effective permissions for a user.
    custom_permissions_json completely overrides role defaults when set.
    """
    base = PERMISSIONS.get(role, PERMISSIONS["operator"])
    if not custom_permissions_json:
        return base
    try:
        custom = json.loads(custom_permissions_json)
        merged = dict(base)
        merged.update(custom)
        # Re-derive legacy 'pages' list from page_levels if page_levels present
        if "page_levels" in custom:
            pl = merged["page_levels"]
            merged["pages"] = [p for p, l in pl.items() if l > 0]
            # Derive capability flags from page levels + explicit caps
            if "can_delete" not in custom:
                merged["can_delete"] = any(l >= 3 for l in pl.values())
            if "can_edit_routings" not in custom:
                merged["can_edit_routings"] = pl.get("routings", 0) >= 2
            if "can_manage_users" not in custom:
                merged["can_manage_users"] = pl.get("users", 0) >= 2
        return merged
    except Exception:
        return base


def _get_secret() -> str:
    env_secret = os.environ.get("DOLPHIN_SECRET")
    if env_secret and len(env_secret) >= 32:
        return env_secret
    key_file = os.path.join(os.path.dirname(__file__), "secret.key")
    if os.path.exists(key_file):
        with open(key_file) as f:
            s = f.read().strip()
            if len(s) >= 32:
                return s
    new_secret = secrets.token_hex(32)
    with open(key_file, "w") as f:
        f.write(new_secret)
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
        "jti": secrets.token_hex(8),
    }
    payload = _b64url_encode(json.dumps(claims).encode())
    sig_input = f"{header}.{payload}".encode()
    sig = _b64url_encode(hmac.new(secret.encode(), sig_input, hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


def verify_token(token: str) -> dict:
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
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ITERS)
    return f"{h.hex()}:{salt}"


def verify_password(password: str, stored: str) -> bool:
    try:
        h_stored, salt = stored.split(":")
        h_attempt = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ITERS)
        return hmac.compare_digest(h_stored, h_attempt.hex())
    except Exception:
        return False


def hash_pin(pin: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 100_000)
    return f"{h.hex()}:{salt}"


def verify_pin(pin: str, stored: str) -> bool:
    try:
        h_stored, salt = stored.split(":")
        h_attempt = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 100_000)
        return hmac.compare_digest(h_stored, h_attempt.hex())
    except Exception:
        return False


# ── FastAPI Dependency ────────────────────────────────────────────────────────

def get_current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth[7:]
    return verify_token(token)


def require_roles(*roles):
    def dependency(user: dict = Depends(get_current_user)):
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return dependency


require_admin   = require_roles("admin")
require_manager = require_roles("admin", "manager")
require_any     = require_roles("admin", "manager", "staff", "operator")


# ── Bootstrap ─────────────────────────────────────────────────────────────────

def ensure_admin_user(db):
    from sqlalchemy import text
    count = db.execute(text("SELECT COUNT(*) FROM users")).scalar()
    if count == 0:
        default_password = "admin123"
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
