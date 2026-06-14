import logging
import base64
import asyncio
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from googleapiclient.discovery import build
from pydantic import BaseModel, EmailStr
from fastapi import APIRouter, HTTPException, Query, Depends

from models.user import find_user_by_email
from models.metrics_daily import get_today  # Assuming this fetches today's metrics dictionary
from lib.google_client import get_gmail_credentials

logger = logging.getLogger("routes.notifications")
router = APIRouter(prefix="/notifications", tags=["notifications"])

# ── Pydantic Request Model ──────────────────────────────────────────
class NotificationRequest(BaseModel):
    user_email: EmailStr

# ── Beautiful HTML Template Generator ────────────────────────────────
def generate_metrics_html(email: str, stats: dict) -> str:
    """Generates a clean, email-client safe HTML dashboard report with a live dashboard link."""
    auto_replies = stats.get("auto_replies_total", 0)
    system_dropped = stats.get("system_dropped_total", 0)
    manual_attention = stats.get("manual_attention_historical_total", 0)
    inbox_cleaned = stats.get("inbox_cleaned_total", 0)
    total_processed = auto_replies + system_dropped + manual_attention
    
    automation_rate = (
        f"{( (auto_replies + system_dropped) / total_processed ) * 100:.1f}%" 
        if total_processed > 0 else "100%"
    )

    return f"""
    <!DOCTYPE html>
    <html>
    <body style="margin: 0; padding: 0; background-color: #0b0a0d; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 20px auto; background-color: #010003; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; overflow: hidden;">
            <tr>
                <td style="padding: 32px 24px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.06);">
                    <h1 style="margin: 0; font-size: 20px; font-weight: 600; color: #e2d1d6; letter-spacing: -0.5px;">OmniMind Engine Summary</h1>
                    <p style="margin: 4px 0 0 0; font-size: 12px; color: rgba(255,255,255,0.45);">Daily operational metrics for {email}</p>
                </td>
            </tr>
            
            <tr>
                <td style="padding: 24px; text-align: center;">
                    <div style="background: rgba(210,140,160,0.06); border: 1px solid rgba(210,140,160,0.25); padding: 16px; border-radius: 12px;">
                        <span style="display: block; font-size: 11px; text-transform: uppercase; tracking: 1px; color: rgba(210,140,160,0.75);">Automation Success Rate</span>
                        <span style="font-size: 36px; font-weight: 700; color: #fff; display: block; margin-top: 4px;">{automation_rate}</span>
                    </div>
                </td>
            </tr>

            <tr>
                <td style="padding: 0 24px 12px 24px;">
                    <table width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                            <td width="48%" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 16px; border-radius: 12px; text-align: center;">
                                <span style="font-size: 20px; font-weight: bold; color: #fff; display: block;">{auto_replies}</span>
                                <span style="font-size: 11px; color: rgba(255,255,255,0.4); display: block; margin-top: 4px;">Auto-Replied Today</span>
                            </td>
                            <td width="4%"></td>
                            <td width="48%" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 16px; border-radius: 12px; text-align: center;">
                                <span style="font-size: 20px; font-weight: bold; color: #fff; display: block;">{system_dropped}</span>
                                <span style="font-size: 11px; color: rgba(255,255,255,0.4); display: block; margin-top: 4px;">System Dropped</span>
                            </td>
                        </tr>
                        <tr><td height="12" colspan="3"></td></tr>
                        <tr>
                            <td width="48%" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 16px; border-radius: 12px; text-align: center;">
                                <span style="font-size: 20px; font-weight: bold; color: #ffaa00; display: block;">{manual_attention}</span>
                                <span style="font-size: 11px; color: rgba(255,255,255,0.4); display: block; margin-top: 4px;">Attention Queue</span>
                            </td>
                            <td width="4%"></td>
                            <td width="48%" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 16px; border-radius: 12px; text-align: center;">
                                <span style="font-size: 20px; font-weight: bold; color: #fff; display: block;">{total_processed}</span>
                                <span style="font-size: 11px; color: rgba(255,255,255,0.4); display: block; margin-top: 4px;">Total Processed</span>
                            </td>
                        </tr>
                        <tr><td height="12" colspan="3"></td></tr>
                        <tr>
                            <td colspan="3" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 16px; border-radius: 12px; text-align: center;">
                                <span style="font-size: 20px; font-weight: bold; color: #d28ca0; display: block;">{inbox_cleaned}</span>
                                <span style="font-size: 11px; color: rgba(255,255,255,0.4); display: block; margin-top: 4px;">Inbox Cleaned Today</span>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>

            <tr>
                <td style="padding: 16px 24px 32px 24px; text-align: center;">
                    <a href="https://omnimind-woad.vercel.app/dashboard/agents/email" 
                       target="_blank" 
                       style="display: inline-block; background-color: #d28ca0; color: #010003; font-size: 12px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 8px; letter-spacing: -0.1px;">
                        Open Live Dashboard
                    </a>
                </td>
            </tr>

            <tr>
                <td style="padding: 24px; text-align: center; border-top: 1px solid rgba(255,255,255,0.06); background-color: rgba(255,255,255,0.01);">
                    <p style="margin: 0; font-size: 11px; color: rgba(255,255,255,0.3);">This report was automatically calculated and transmitted by your OmniMind local instance.</p>
                </td>
            </tr>
        </table>
    </body>
    </html>
    """

# ── Business Logic Runner ───────────────────────────────────────────
# PATCH — replace the existing send_gmail_sync function in routes/notifications.py
# Only this function changes. Everything else stays the same.

def send_gmail_sync(
    creds,
    destination_email: str,
    html_body: str,
    subject: str = "📊 Today's Email Agent Automation Metrics Rollup",  # default kept
):
    """Executes the synchronous Google client message sending network pipeline."""
    service = build('gmail', 'v1', credentials=creds)

    mime_msg = MIMEMultipart('alternative')
    mime_msg['to'] = destination_email
    mime_msg['from'] = 'me'
    mime_msg['subject'] = subject   # now accepts custom subject

    mime_msg.attach(MIMEText(html_body, 'html'))

    raw_string = base64.urlsafe_b64encode(mime_msg.as_bytes()).decode('utf-8')
    service.users().messages().send(userId='me', body={'raw': raw_string}).execute()

    

# ── API Endpoints ───────────────────────────────────────────────────
@router.get("/")
async def get_notifications(user_email: str = Query(...)):
    """Fetch recent alert activity logs for a user."""
    user = await find_user_by_email(user_email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "active", "user_email": user_email}


@router.post("/")
async def create_notification(payload: NotificationRequest):
    """
    Assembles today's automation performance numbers, wraps them into
    a customized dark HTML component container layout, and emails it
    directly back to the system operator's own inbox via Gmail.
    """
    email = payload.user_email
    
    # 1. Look up user configuration & fetch security tokens
    user = await find_user_by_email(email)
    if not user or "oauth_token" not in user:
        raise HTTPException(status_code=400, detail="User accounts or Gmail auth sync maps missing")
        
    try:
        # 2. Extract Gmail access credentials using auth context definitions
        creds = await get_gmail_credentials(email)
        
        # 3. Pull performance analytics state from DB engine
        stats_data = await get_today(email)
        if not stats_data:
            stats_data = {
                "auto_replies_total": 0,
                "system_dropped_total": 0,
                "manual_attention_historical_total": 0
            }
            
        # 4. Generate the dashboard design HTML markup string
        html_report = generate_metrics_html(email, stats_data)
        
        # 5. Delegate blocking third-party network IO execution tasks safely to systemic OS threads
        await asyncio.to_thread(send_gmail_sync, creds, email, html_report)
        
        logger.info(f"Successfully compiled and dispatched premium daily summary dispatch down to {email}")
        return {"status": "success", "message": f"Metrics report cleanly routed out to {email}"}
        
    except Exception as err:
        logger.error(f"Failed handling execution thread pipelines: {err}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Notification dispatch failure: {str(err)}")