import os
import time
import logging
import asyncio

os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from google.auth.transport.requests import Request as GoogleRequest

from config import settings
from db.mongodb import get_db, is_db_connected

logger = logging.getLogger("google_client")

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]

CLIENT_CONFIG = {
    "web": {
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "redirect_uris": [settings.google_redirect_uri],
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
}


def get_oauth_flow() -> Flow:
    return Flow.from_client_config(CLIENT_CONFIG, scopes=SCOPES, redirect_uri=settings.google_redirect_uri)


def get_auth_url() -> tuple[str, str, str | None]:
    flow = get_oauth_flow()
    auth_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    code_verifier = getattr(flow, "code_verifier", None)
    return auth_url, state, code_verifier


def exchange_code(code: str, code_verifier: str | None) -> dict:
    flow = get_oauth_flow()
    flow.fetch_token(code=code, code_verifier=code_verifier)
    return _creds_to_dict(flow.credentials)


def _creds_to_dict(creds: Credentials) -> dict:
    expires_in = 3600
    if creds.expiry:
        from datetime import datetime, timezone
        expires_in = max(
            0,
            int((creds.expiry.replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)).total_seconds()),
        )
    return {
        "access_token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "scopes": list(creds.scopes or SCOPES),
        "expiry": creds.expiry.isoformat() if creds.expiry else None,
        "expires_in": expires_in,
    }


def _token_fields_from_user(user: dict) -> dict:
    if user.get("oauth_token"):
        oauth = user["oauth_token"]
        return {
            "access_token": oauth.get("access_token"),
            "refresh_token": oauth.get("refresh_token"),
            "expires_at": oauth.get("expires_at", 0),
        }
    return {
        "access_token": user.get("google_access_token"),
        "refresh_token": user.get("google_refresh_token"),
        "expires_at": user.get("token_expiry", 0),
    }


def _build_credentials(token_data: dict) -> Credentials:
    return Credentials(
        token=token_data.get("access_token"),
        refresh_token=token_data.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        scopes=SCOPES,
    )


async def _persist_refreshed_tokens(email: str, creds: Credentials, expires_at: float) -> None:
    if not is_db_connected():
        return
    db = get_db()
    update = {
        "oauth_token.access_token": creds.token,
        "oauth_token.expires_at": expires_at,
        "google_access_token": creds.token,
        "token_expiry": expires_at,
    }
    if creds.refresh_token:
        update["oauth_token.refresh_token"] = creds.refresh_token
        update["google_refresh_token"] = creds.refresh_token
    await db.email_agent_users.update_one({"email": email}, {"$set": update})


async def get_gmail_credentials(email: str) -> Credentials:
    """Return refreshed Credentials for Gmail API calls."""
    if not is_db_connected():
        raise ValueError("Database not connected — cannot load OAuth tokens")
    db = get_db()
    user = await db.email_agent_users.find_one({"email": email})
    if not user:
        raise ValueError(f"No user found for email: {email}")

    token_data = _token_fields_from_user(user)
    if not token_data.get("access_token"):
        raise ValueError(f"No OAuth tokens stored for {email}")

    creds = _build_credentials(token_data)
    expires_at = token_data.get("expires_at") or 0

    if creds.expired or expires_at < time.time() + 60:
        if not creds.refresh_token:
            raise ValueError(f"OAuth token expired for {email} and no refresh token present")
        logger.info(f"Refreshing Gmail token for {email}")
        await asyncio.to_thread(creds.refresh, GoogleRequest())
        new_expires = time.time() + 3500
        await _persist_refreshed_tokens(email, creds, new_expires)

    return creds


async def get_valid_access_token(email: str) -> str:
    """Return a valid access token string (for httpx Gmail REST calls)."""
    creds = await get_gmail_credentials(email)
    if not creds.token:
        raise ValueError(f"Could not obtain access token for {email}")
    return creds.token
