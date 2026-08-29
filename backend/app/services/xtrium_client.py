"""
xtrium_client.py — thin HTTP client for the Xtrium Catalog IQ integration.

Xtrium Catalog IQ is Radnyi's system: the master queue of links/items that
need to be researched and turned into structured records. This platform
(branded "Careerflow" in their docs) is the CLIENT — it pulls assigned work,
does extraction using its own pipeline (upload, review, double-approval),
then pushes the approved result back and checks for rework requests.

Auth: X-API-Key header, per their spec (section 2). The key lives in the
XTRIUM_CATALOG_API_KEY environment variable — never hardcoded, never logged.

All four endpoints from their spec (section 3) are wrapped here:
  - pull_batch()      POST /api/careerflow/batch/pull
  - submit_item()     POST /api/careerflow/batch/{item_id}/submit
  - report_failure()  POST /api/careerflow/batch/{item_id}/fail
  - get_item_status() GET  /api/careerflow/batch/{item_id}/status
"""
import httpx
from app.core.config import settings


class XtriumClientError(Exception):
    """Raised when the Xtrium Catalog IQ API returns an error or is unreachable."""
    pass


class XtriumClient:
    def __init__(self):
        self.base_url = (settings.XTRIUM_CATALOG_BASE_URL or "").rstrip("/")
        self.api_key = settings.XTRIUM_CATALOG_API_KEY

    def _headers(self) -> dict:
        if not self.api_key:
            raise XtriumClientError(
                "XTRIUM_CATALOG_API_KEY is not configured. Set it in the backend's "
                "environment variables once the key is available."
            )
        return {
            "X-API-Key": self.api_key,
            "Content-Type": "application/json",
        }

    def _check_configured(self):
        if not self.base_url:
            raise XtriumClientError(
                "XTRIUM_CATALOG_BASE_URL is not configured. Set it in the backend's "
                "environment variables (e.g. https://xtrium-catalog-iq.example.com)."
            )

    async def pull_batch(self, batch_size: int = 50) -> list[dict]:
        """
        POST /api/careerflow/batch/pull
        Pulls the highest-priority batch of links currently assigned to us.
        batch_size is capped at 50 by their API — we don't enforce that
        client-side, just pass through what's asked and let their API
        respond however it responds to an over-limit request.
        """
        self._check_configured()
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{self.base_url}/api/careerflow/batch/pull",
                headers=self._headers(),
                json={"batch_size": batch_size},
            )
        if r.status_code != 200:
            raise XtriumClientError(f"Pull failed: {r.status_code} — {r.text[:300]}")
        return r.json()

    async def submit_item(self, item_id: int | str, raw_payload: dict, notes: str = "") -> dict:
        """
        POST /api/careerflow/batch/{item_id}/submit
        Submits the extracted structured JSON for one catalog item.
        raw_payload is forwarded as-is — their system infers schema_type
        from its shape (confirmed by their response echoing schema_type
        back), so no transformation happens on our side beyond passing
        through exactly what our own ExtractedRecord.extracted_fields holds.
        """
        self._check_configured()
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{self.base_url}/api/careerflow/batch/{item_id}/submit",
                headers=self._headers(),
                json={"raw_payload": raw_payload, "notes": notes},
            )
        if r.status_code != 200:
            raise XtriumClientError(f"Submit failed for item {item_id}: {r.status_code} — {r.text[:300]}")
        return r.json()

    async def report_failure(self, item_id: int | str, failure_reason: str, notes: str = "") -> dict:
        """
        POST /api/careerflow/batch/{item_id}/fail
        Reports that a link could not be scraped (404, anti-bot, paywall, etc).
        """
        self._check_configured()
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{self.base_url}/api/careerflow/batch/{item_id}/fail",
                headers=self._headers(),
                json={"failure_reason": failure_reason, "notes": notes},
            )
        if r.status_code != 200:
            raise XtriumClientError(f"Fail-report failed for item {item_id}: {r.status_code} — {r.text[:300]}")
        return r.json()

    async def get_item_status(self, item_id: int | str) -> dict:
        """
        GET /api/careerflow/batch/{item_id}/status
        Checks whether an item was approved, rejected, or needs rework.
        A status of "Queued" with rework_notes present means it's been
        sent back for correction — same shape conceptually as our own
        Escalations feature. "Rejected" is a distinct, terminal state per
        their status lifecycle guide — no further action expected.
        """
        self._check_configured()
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(
                f"{self.base_url}/api/careerflow/batch/{item_id}/status",
                headers=self._headers(),
            )
        if r.status_code != 200:
            raise XtriumClientError(f"Status check failed for item {item_id}: {r.status_code} — {r.text[:300]}")
        return r.json()

    async def get_stats(self) -> dict:
        """
        GET /api/careerflow/stats
        Real-time aggregated metrics for everything currently assigned to
        us: total_assigned, assigned, in_progress, scraped_pending_review,
        ingested_approved, failed, rejected, queued_rework.
        """
        self._check_configured()
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(
                f"{self.base_url}/api/careerflow/stats",
                headers=self._headers(),
            )
        if r.status_code != 200:
            raise XtriumClientError(f"Stats fetch failed: {r.status_code} — {r.text[:300]}")
        return r.json()


xtrium_client = XtriumClient()
