# low-level Gmail API wrapper
import os

# Required for http://localhost OAuth in development
os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from google.auth.transport.requests import Request as GoogleRequest
from config import settings

# Scopes needed: read emails, send emails, manage drafts, manage labels
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
    flow = Flow.from_client_config(
        CLIENT_CONFIG,
        scopes=SCOPES,
        redirect_uri=settings.google_redirect_uri,
    )
    return flow


def get_auth_url() -> tuple[str, str, str | None]:
    """Returns (auth_url, state, code_verifier) for server-side OAuth state storage."""
    flow = get_oauth_flow()
    auth_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    code_verifier = getattr(flow, "code_verifier", None)
    return auth_url, state, code_verifier


def exchange_code(code: str, code_verifier: str | None) -> dict:
    """Exchange auth code for tokens using the PKCE verifier from the login step."""
    flow = get_oauth_flow()
    flow.fetch_token(code=code, code_verifier=code_verifier)
    creds = flow.credentials
    return _creds_to_dict(creds)


def refresh_token_if_needed(token_dict: dict) -> dict:
    """
    Takes stored token dict, refreshes if expired, returns updated dict.
    Call this before every Gmail API operation.
    """
    creds = Credentials(
        token=token_dict.get("access_token"),
        refresh_token=token_dict.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        scopes=SCOPES,
    )

    if creds.expired and creds.refresh_token:
        creds.refresh(GoogleRequest())
        print("[OAuth] Access token refreshed")

    return _creds_to_dict(creds)


async def get_valid_access_token(email: str) -> str:
    """Load user tokens, refresh if needed, persist updates, return access token."""
    from models.user import find_user, upsert_user

    user = await find_user(email)
    if not user or not user.get("google_access_token"):
        raise ValueError(f"No Gmail tokens stored for {email}")

    token_dict = {
        "access_token": user["google_access_token"],
        "refresh_token": user.get("google_refresh_token"),
        "expiry": user.get("token_expiry"),
    }
    refreshed = refresh_token_if_needed(token_dict)

    if refreshed.get("access_token") != token_dict.get("access_token"):
        await upsert_user(
            email=email,
            token_dict={
                "access_token": refreshed["access_token"],
                "refresh_token": refreshed.get("refresh_token"),
                "expires_in": refreshed.get("expires_in", 3600),
            },
            profile={"name": user.get("name"), "picture": user.get("picture")},
        )

    access_token = refreshed.get("access_token")
    if not access_token:
        raise ValueError(f"Could not obtain access token for {email}")
    return access_token


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
