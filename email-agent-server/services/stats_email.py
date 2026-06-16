"""HTML stats report + Gmail send helpers (shared by cron daily jobs and API routes)."""

import base64
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from googleapiclient.discovery import build

METRICS_ROLLUP_SUBJECT = "📊 Today's Email Agent Automation Metrics Rollup"
FINAL_DAILY_SUBJECT = "Daily Email Agent Summary"

# Substrings matched against subject/snippet to skip pipeline triage on self-sent stats mail.
OMNIMIND_NOTIFICATION_MARKERS = (
    "Daily Email Agent Summary",
    "Today's Email Agent Automation Metrics Rollup",
    "OmniMind Engine Summary",
)


def generate_metrics_html(email: str, stats: dict) -> str:
    """Email-client safe HTML dashboard report."""
    auto_replies = stats.get("auto_replies_total", 0)
    system_dropped = stats.get("system_dropped_total", 0)
    manual_attention = stats.get("manual_attention_historical_total", 0)
    inbox_cleaned = stats.get("inbox_cleaned_total", 0)
    total_processed = auto_replies + system_dropped + manual_attention

    automation_rate = (
        f"{((auto_replies + system_dropped) / total_processed) * 100:.1f}%"
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
                    <p style="margin: 0; font-size: 11px; color: rgba(255,255,255,0.3);">This report was automatically calculated and transmitted by your OmniMind instance.</p>
                </td>
            </tr>
        </table>
    </body>
    </html>
    """


def send_gmail_sync(
    creds,
    destination_email: str,
    html_body: str,
    subject: str = METRICS_ROLLUP_SUBJECT,
) -> None:
    """Send HTML email via Gmail API (blocking — call via asyncio.to_thread)."""
    service = build("gmail", "v1", credentials=creds)

    mime_msg = MIMEMultipart("alternative")
    mime_msg["to"] = destination_email
    mime_msg["from"] = "me"
    mime_msg["subject"] = subject
    mime_msg.attach(MIMEText(html_body, "html"))

    raw_string = base64.urlsafe_b64encode(mime_msg.as_bytes()).decode("utf-8")
    service.users().messages().send(userId="me", body={"raw": raw_string}).execute()
