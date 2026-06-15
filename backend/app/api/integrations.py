"""
Integration management endpoints.

GET  /api/integrations/status              — connection status for gmail, slack, sheets
GET  /api/integrations/google/connect      — start Google OAuth (opens popup)
GET  /api/integrations/google/callback     — receive OAuth code, save tokens, close popup
POST /api/integrations/slack               — save a Slack bot token
DELETE /api/integrations/{integration}     — disconnect (delete stored credentials)
"""
import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database import get_db
from app.workflow.db_models import IntegrationCredential
from app.workflow.integrations.credential_store import (
    save_integration_credentials,
    delete_integration_credentials,
)

router = APIRouter()

MANAGED_INTEGRATIONS = ["gmail", "slack", "sheets"]

# ── Schemas ───────────────────────────────────────────────────────────────────

class IntegrationStatusItem(BaseModel):
    integration: str
    connected: bool
    connected_at: datetime | None = None


class SlackTokenRequest(BaseModel):
    bot_token: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _redirect_uri(s) -> str:
    return f"http://localhost:{s.backend_port}/api/integrations/google/callback"


GOOGLE_SCOPES = [
    "https://mail.google.com/",
    "https://www.googleapis.com/auth/spreadsheets",
]

# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/status", response_model=list[IntegrationStatusItem])
def get_status(db: Session = Depends(get_db)):
    """Return connection status for all three managed integrations."""
    results = []
    for name in MANAGED_INTEGRATIONS:
        cred = (
            db.query(IntegrationCredential)
            .filter(IntegrationCredential.integration == name)
            .first()
        )
        results.append(IntegrationStatusItem(
            integration=name,
            connected=cred is not None and cred.status == "connected",
            connected_at=cred.connected_at if cred else None,
        ))
    return results


@router.get("/google/connect")
def google_connect():
    """Redirect the browser to Google's OAuth consent screen."""
    s = get_settings()
    if not s.google_client_id or not s.google_client_secret:
        raise HTTPException(
            status_code=422,
            detail="GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in backend/.env",
        )

    # Allow HTTP in development
    os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")

    from google_auth_oauthlib.flow import Flow

    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": s.google_client_id,
                "client_secret": s.google_client_secret,
                "redirect_uris": [_redirect_uri(s)],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=GOOGLE_SCOPES,
    )
    flow.redirect_uri = _redirect_uri(s)

    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",   # force refresh_token to be returned every time
    )
    return RedirectResponse(url=auth_url)


@router.get("/google/callback", response_class=HTMLResponse)
def google_callback(code: str):
    """
    Receive the OAuth authorization code from Google, exchange it for tokens,
    save them for both gmail and sheets, then close the popup window.
    """
    s = get_settings()
    os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")

    from google_auth_oauthlib.flow import Flow

    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": s.google_client_id,
                "client_secret": s.google_client_secret,
                "redirect_uris": [_redirect_uri(s)],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=GOOGLE_SCOPES,
    )
    flow.redirect_uri = _redirect_uri(s)

    try:
        flow.fetch_token(code=code)
    except Exception as exc:
        return HTMLResponse(
            content=f"<p>OAuth failed: {exc}</p>",
            status_code=400,
        )

    creds = flow.credentials
    if not creds.refresh_token:
        return HTMLResponse(
            content=(
                "<p>Google did not return a refresh token. "
                "Revoke app access at <a href='https://myaccount.google.com/permissions'>myaccount.google.com/permissions</a> "
                "and try again.</p>"
            ),
            status_code=400,
        )

    credential_data = {
        "refresh_token": creds.refresh_token,
        "client_id": s.google_client_id,
        "client_secret": s.google_client_secret,
    }

    # Gmail and Sheets share the same OAuth token
    for integration in ("gmail", "sheets"):
        save_integration_credentials(integration, credential_data)

    frontend_url = s.cors_origins.split(",")[0].strip()

    # Close the popup and notify the parent window
    return HTMLResponse(content=f"""<!DOCTYPE html>
<html>
<head><title>Google Connected</title>
<style>
  body {{ font-family: system-ui, sans-serif; display: flex; align-items: center;
         justify-content: center; height: 100vh; margin: 0; background: #0d0d12; color: #e2e2e9; }}
  .box {{ text-align: center; }}
  .check {{ font-size: 48px; margin-bottom: 12px; }}
  h2 {{ margin: 0 0 6px; font-size: 18px; }}
  p {{ color: #6b7280; font-size: 13px; margin: 0; }}
</style>
</head>
<body>
<div class="box">
  <div class="check">✓</div>
  <h2>Google Connected!</h2>
  <p>Gmail and Sheets are now linked. This window will close…</p>
</div>
<script>
  if (window.opener) {{
    window.opener.postMessage(
      {{ type: 'integration_connected', integration: 'google' }},
      '{frontend_url}'
    );
    setTimeout(() => window.close(), 1200);
  }} else {{
    setTimeout(() => window.location.href = '{frontend_url}', 1500);
  }}
</script>
</body>
</html>""")


@router.post("/slack")
def save_slack_token(req: SlackTokenRequest):
    """Validate and save a Slack bot token."""
    token = req.bot_token.strip()
    if not token.startswith("xoxb-"):
        raise HTTPException(status_code=422, detail="Slack bot tokens must start with 'xoxb-'")

    try:
        from slack_sdk import WebClient
        resp = WebClient(token=token).auth_test()
        if not resp["ok"]:
            raise HTTPException(status_code=422, detail="Slack rejected the token")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Token validation failed: {exc}")

    save_integration_credentials("slack", {"bot_token": token})
    return {"integration": "slack", "connected": True}


@router.delete("/{integration}")
def disconnect_integration(integration: str):
    """Delete stored credentials for an integration (or 'google' to remove both gmail+sheets)."""
    if integration == "google":
        targets = ["gmail", "sheets"]
    elif integration in MANAGED_INTEGRATIONS:
        targets = [integration]
    else:
        raise HTTPException(status_code=404, detail=f"Unknown integration: {integration}")

    for name in targets:
        delete_integration_credentials(name)
    return {"disconnected": targets}
