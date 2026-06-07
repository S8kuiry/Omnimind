# GET /auth/google
# GET /auth/callback
# GET /auth/me
# POST /auth/revoke

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse

from config import settings
from lib.google_client import get_auth_url, exchange_code
from models.session import create_session, delete_sessions_for_email, get_session
from models.user import find_user, upsert_user, clear_user_tokens

router = APIRouter(prefix="/auth", tags=["auth"])

# OAuth state + PKCE verifier (in production use Redis with TTL)
_pending_oauth: dict[str, dict] = {}

SESSION_COOKIE_NAME = "email_agent_sid"
SESSION_MAX_AGE = 60 * 60 * 24 * 365 * 10  # 10 years


def _is_local_frontend() -> bool:
    url = settings.frontend_url
    return url.startswith("http://localhost") or url.startswith("http://127.0.0.1")


def _cookie_kwargs() -> dict:
    local = _is_local_frontend()
    return {
        "httponly": True,
        "secure": not local,
        "samesite": "lax" if local else "none",
        "max_age": SESSION_MAX_AGE,
        "path": "/",
    }


def _redirect(url: str, *, sid: str | None = None) -> RedirectResponse:
    """302 See Other — standard for OAuth; avoids 307 method-preservation quirks."""
    response = RedirectResponse(url=url, status_code=302)
    if sid:
        _set_session_cookie(response, sid)
    return response


def _set_session_cookie(response, sid: str):
    response.set_cookie(key=SESSION_COOKIE_NAME, value=sid, **_cookie_kwargs())


def _clear_session_cookie(response):
    local = _is_local_frontend()
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        samesite="lax" if local else "none",
        secure=not local,
    )


async def get_current_email(request: Request) -> str:
    sid = request.cookies.get(SESSION_COOKIE_NAME)

    if not sid:
        raise HTTPException(status_code=401, detail="Not connected")

    session = await get_session(sid)

    if not session:
        raise HTTPException(status_code=401, detail="Session expired")

    return session["email"]


def _user_has_gmail_link(user: dict | None) -> bool:
    if not user:
        return False
    return bool(user.get("google_refresh_token") or user.get("google_access_token"))


async def _session_auth_payload(request: Request) -> dict:
    sid = request.cookies.get(SESSION_COOKIE_NAME)
    if not sid:
        return {"connected": False}

    session = await get_session(sid)
    if not session:
        return {"connected": False}

    email = session["email"]
    user = await find_user(email)
    if not _user_has_gmail_link(user):
        return {"connected": False, "email": email}

    return {
        "connected": True,
        "email": email,
        "name": user.get("name"),
        "picture": user.get("picture"),
        "last_sync": user.get("last_sync"),
    }


@router.get("/me")
async def auth_me(request: Request):
    """Return connection state from the session cookie (no re-auth if still valid)."""
    return await _session_auth_payload(request)


@router.get("/google")
async def login_with_google(request: Request):
    """Step 1 — redirect user to Google consent screen."""
    existing = await _session_auth_payload(request)
    if existing.get("connected"):
        return _redirect(f"{settings.frontend_url}/dashboard/agents/email")

    auth_url, state, code_verifier = get_auth_url()
    _pending_oauth[state] = {"code_verifier": code_verifier}
    return _redirect(auth_url)


@router.get("/callback")
async def google_callback(
    code: str = Query(...),
    state: str = Query(...),
    error: str = Query(None),
):
    """Step 2 — Google redirects here after consent."""
    if error:
        raise HTTPException(400, f"Google OAuth error: {error}")

    pending = _pending_oauth.pop(state, None)
    if not pending:
        raise HTTPException(400, "Invalid or expired OAuth state. Please try connecting again.")

    try:
        token_dict = exchange_code(code, pending.get("code_verifier"))
    except Exception as e:
        print(f"[Auth] Token exchange failed: {e}")
        raise HTTPException(400, f"Token exchange failed: {e}")

    # Fetch Google profile to get email + name
    try:
        profile = await _fetch_google_profile(token_dict["access_token"])
    except Exception as e:
        raise HTTPException(400, f"Could not fetch Google profile: {e}")

    email = profile.get("email")
    if not email:
        raise HTTPException(400, "Could not determine user email from Google")

    # Store/update user in MongoDB
    await upsert_user(email=email, token_dict=token_dict, profile=profile)
    sid = await create_session(email)

    print(f"[Auth] User authenticated: {email}")

    redirect_url = (
        f"{settings.frontend_url}/dashboard/agents/email"
        f"?auth=success&email={email}"
    )
    return _redirect(redirect_url, sid=sid)


@router.get("/status")
async def auth_status(request: Request, email: str = Query(None)):
    """Check Gmail connection — prefers session cookie, falls back to email query."""
    if request.cookies.get(SESSION_COOKIE_NAME):
        return await _session_auth_payload(request)

    if not email:
        return {"connected": False}

    user = await find_user(email)
    if not _user_has_gmail_link(user):
        return {"connected": False}
    return {
        "connected": True,
        "email": user["email"],
        "last_sync": user.get("last_sync"),
    }


async def _resolve_revoke_email(request: Request, email: str | None) -> str:
    """Session cookie first; optional email query for cross-origin clients."""
    sid = request.cookies.get(SESSION_COOKIE_NAME)
    if sid:
        session = await get_session(sid)
        if session:
            return session["email"]

    if email:
        user = await find_user(email)
        if user and _user_has_gmail_link(user):
            return email

    raise HTTPException(status_code=401, detail="Not connected")


async def _revoke_google_token(refresh_token: str) -> None:
    """Tell Google to invalidate the refresh token (best-effort)."""
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                "https://oauth2.googleapis.com/revoke",
                params={"token": refresh_token},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
    except Exception as e:
        print(f"[Auth] Google token revoke failed (continuing): {e}")


@router.post("/revoke")
async def revoke_access(request: Request, email: str = Query(None)):
    """Disconnect Gmail — revokes at Google, clears DB tokens, sessions, and cookie."""
    resolved_email = await _resolve_revoke_email(request, email)
    user = await find_user(resolved_email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    refresh_token = user.get("google_refresh_token")
    if refresh_token:
        await _revoke_google_token(refresh_token)

    await clear_user_tokens(resolved_email)
    await delete_sessions_for_email(resolved_email)

    response = JSONResponse(
        content={"message": f"Gmail access revoked for {resolved_email}"}
    )
    _clear_session_cookie(response)
    return response


# ── Helper ─────────────────────────────────────────────────────────

async def _fetch_google_profile(access_token: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        return resp.json()