"""
DB-backed credential store for integrations.
Each integration (gmail, slack, sheets) stores its credentials as JSON in
the integration_credentials table. Adapters call get_integration_credentials()
before falling back to env-var values.
"""
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
