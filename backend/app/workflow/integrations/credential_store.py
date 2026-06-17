# =============================================================================
# workflow/integrations/credential_store.py — DB-backed credential store
#
# Provides the three functions that all integration adapters use to read and
# write user-supplied credentials (OAuth tokens, API keys) at runtime.
# Credentials are stored in the integration_credentials table as JSON blobs,
# one row per integration name. This replaces hardcoded .env tokens for the
# three managed integrations (gmail, slack, sheets).
#
# Each function opens its own DB session (does not share the request session)
# because it may be called from background threads (execution engine) where
# no request context exists.
#
# get_integration_credentials(integration) → dict | None
#   Returns the credential_data JSON dict for the given integration if a
#   "connected" row exists, or None if not found. Every integration adapter
#   calls this first and falls back to env-var values if it returns None.
#
# save_integration_credentials(integration, data)
#   Upserts: updates credential_data + status if the row exists, creates a
#   new row otherwise. Called by api/integrations.py after a successful
#   Google OAuth callback or Slack token validation.
#
# delete_integration_credentials(integration)
#   Deletes the row for the given integration. Called by
#   DELETE /api/integrations/{integration} to disconnect.
#
# Why open a new session per call?
#   The execution engine runs in a background thread with its own SessionLocal.
#   Sharing the request-scoped session across threads would cause SQLAlchemy
#   thread-safety errors. The overhead of opening/closing a session per
#   credential lookup is acceptable given how infrequently this runs.
# =============================================================================
import logging
from datetime import datetime, UTC

logger = logging.getLogger(__name__)


def get_integration_credentials(integration: str) -> dict | None:
    """Return stored credential_data for the given integration, or None if not connected."""
    from app.database import SessionLocal
    from app.workflow.db_models import IntegrationCredential

    db = SessionLocal()
    try:
        cred = (
            db.query(IntegrationCredential)
            .filter(
                IntegrationCredential.integration == integration,
                IntegrationCredential.status == "connected",
            )
            .first()
        )
        if cred is None:
            logger.debug("No stored credentials found for integration '%s'", integration)
        return cred.credential_data if cred else None
    except Exception as e:
        logger.error("Failed to retrieve credentials for '%s' from DB: %s", integration, e)
        return None
    finally:
        db.close()


def save_integration_credentials(integration: str, data: dict) -> None:
    """Upsert credentials for an integration."""
    from app.database import SessionLocal
    from app.workflow.db_models import IntegrationCredential

    db = SessionLocal()
    try:
        now = datetime.now(UTC)
        existing = (
            db.query(IntegrationCredential)
            .filter(IntegrationCredential.integration == integration)
            .first()
        )
        if existing:
            existing.credential_data = data
            existing.status = "connected"
            existing.updated_at = now
        else:
            db.add(IntegrationCredential(
                integration=integration,
                credential_data=data,
                status="connected",
                connected_at=now,
                updated_at=now,
            ))
        db.commit()
        logger.info("Credentials saved for integration '%s'", integration)
    except Exception as e:
        logger.error("Failed to save credentials for '%s': %s", integration, e)
        db.rollback()
        raise
    finally:
        db.close()


def delete_integration_credentials(integration: str) -> None:
    """Remove stored credentials for an integration."""
    from app.database import SessionLocal
    from app.workflow.db_models import IntegrationCredential

    db = SessionLocal()
    try:
        db.query(IntegrationCredential).filter(
            IntegrationCredential.integration == integration
        ).delete()
        db.commit()
        logger.info("Credentials deleted for integration '%s'", integration)
    except Exception as e:
        logger.error("Failed to delete credentials for '%s': %s", integration, e)
        db.rollback()
        raise
    finally:
        db.close()
