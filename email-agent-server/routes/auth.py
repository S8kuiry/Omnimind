import asyncio
import httpx
import logging
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse

from config import settings
from lib.google_client import get_auth_url, exchange_code, get_gmail_credentials
from lib.gmail_labels import ensure_omnimind_labels
from models.session import create_session, delete_sessions_for_email, get_session
from models.user import find_user_by_email, upsert_user, clear_user_tokens, save_gmail_label_ids

logger = logging.getLogger("auth")

router = APIRouter(prefix="/auth", tags=["auth"])

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
    if not user or "oauth_token" not in user:
        return False
    oauth = user["oauth_token"]
    return bool(oauth.get("refresh_token") or oauth.get("access_token"))


async def _session_auth_payload(request: Request) -> dict:
    sid = request.cookies.get(SESSION_COOKIE_NAME)
    if not sid:
        return {"connected": False}
    session = await get_session(sid)
    if not session:
        return {"connected": False}
    email = session["email"]
    user = await find_user_by_email(email)
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
    return await _session_auth_payload(request)


@router.get("/google")
async def login_with_google(request: Request):
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
    if error:
        raise HTTPException(400, f"Google OAuth error: {error}")

    pending = _pending_oauth.pop(state, None)
    if not pending:
        raise HTTPException(400, "Invalid or expired OAuth state. Please try connecting again.")

    try:
        token_dict = exchange_code(code, pending.get("code_verifier"))
    except Exception as e:
        logger.error(f"Token exchange failed: {e}")
        raise HTTPException(400, f"Token exchange failed: {e}")

    try:
        profile = await _fetch_google_profile(token_dict["access_token"])
    except Exception as e:
        raise HTTPException(400, f"Could not fetch Google profile: {e}")

    email = profile.get("email")
    if not email:
        raise HTTPException(400, "Could not determine user email from Google")

    # 1. Persist user + tokens
    await upsert_user(email=email, token_dict=token_dict, profile=profile)

    # 2. Provision Gmail labels
    labels_ok = False
    try:
        creds = await get_gmail_credentials(email)
        label_map = ensure_omnimind_labels(creds)
        attention_id = label_map.get("OmniMind/Attention")
        processed_id = label_map.get("OmniMind/Processed")

        if attention_id and processed_id:
            await save_gmail_label_ids(email, attention_id, processed_id)
            labels_ok = True
            logger.info(f"Labels provisioned for {email}")
        else:
            logger.error(f"Incomplete label map for {email}")
    except Exception as e:
        logger.error(f"Label provision failed for {email}: {e}")
        # Don't crash login — user can still connect, pipeline just won't run

    # 3. Register Gmail Push watch + run bootstrap ingest
    # Both are fire-and-forget background tasks — don't block the redirect
    if labels_ok:
        user = await find_user_by_email(email)
        if user:
            # Gmail Push watch — so new mail hits us instantly via Pub/Sub
            asyncio.create_task(_register_watch_safe(user, creds))

            # Bootstrap ingest — process today's 20 emails immediately
            # User sees a populated dashboard without waiting for the 15-min cron
            asyncio.create_task(_bootstrap_safe(user))

    sid = await create_session(email)
    logger.info(f"User authenticated: {email}")

    redirect_url = (
        f"{settings.frontend_url}/dashboard/agents/email"
        f"?auth=success&email={email}"
    )
    return _redirect(redirect_url, sid=sid)


@router.get("/status")
async def auth_status(request: Request, email: str = Query(None)):
    if request.cookies.get(SESSION_COOKIE_NAME):
        return await _session_auth_payload(request)
    if not email:
        return {"connected": False}
    user = await find_user_by_email(email)
    if not _user_has_gmail_link(user):
        return {"connected": False}
    return {
        "connected": True,
        "email": user["email"],
        "last_sync": user.get("last_sync"),
    }


async def _resolve_revoke_email(request: Request, email: str | None) -> str:
    sid = request.cookies.get(SESSION_COOKIE_NAME)
    if sid:
        session = await get_session(sid)
        if session:
            return session["email"]
    if email:
        user = await find_user_by_email(email)
        if user and _user_has_gmail_link(user):
            return email
    raise HTTPException(status_code=401, detail="Not connected")


async def _revoke_google_token(refresh_token: str) -> None:
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                "https://oauth2.googleapis.com/revoke",
                params={"token": refresh_token},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
    except Exception as e:
        logger.error(f"Token revoke failed: {e}")


@router.post("/revoke")
async def revoke_access(request: Request, email: str = Query(None)):
    resolved_email = await _resolve_revoke_email(request, email)
    user = await find_user_by_email(resolved_email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    oauth = user.get("oauth_token", {})
    refresh_token = oauth.get("refresh_token")
    if refresh_token:
        await _revoke_google_token(refresh_token)

    await clear_user_tokens(resolved_email)
    await delete_sessions_for_email(resolved_email)

    response = JSONResponse(content={"message": f"Gmail access revoked for {resolved_email}"})
    _clear_session_cookie(response)
    return response


# ── Background task helpers ────────────────────────────────────────
# Wrapped in try/except so a watch or bootstrap failure never crashes the
# OAuth redirect or leaks an unhandled exception into the event loop.

async def _register_watch_safe(user: dict, creds) -> None:
    try:
        from services.gmail_watch import register_watch
        await register_watch(user, creds)
    except Exception as e:
        logger.error(f"[auth] gmail_watch failed for {user.get('email')}: {e}")


async def _bootstrap_safe(user: dict) -> None:
    try:
        from services.bootstrap_ingest import run_bootstrap_ingest
        await run_bootstrap_ingest(user)
    except Exception as e:
        logger.error(f"[auth] bootstrap_ingest failed for {user.get('email')}: {e}")


# ── Profile helper ─────────────────────────────────────────────────

async def _fetch_google_profile(access_token: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        return resp.json()