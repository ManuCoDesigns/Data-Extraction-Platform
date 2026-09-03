"""
xtrium_client.py — thin HTTP client for the Xtrium Catalog IQ integration.

Xtrium Catalog IQ is Radnyi/Chetan's system: the master queue of links/items
that need to be researched and turned into structured records. This platform
(branded "Careerflow" in their docs) is the CLIENT — it pulls assigned work,
does extraction using its own pipeline (upload, review, double-approval),
then pushes the approved result back and checks for rework requests.

Auth: X-API-Key header, per their spec (section 2). The key lives in the
XTRIUM_CATALOG_API_KEY environment variable — never hardcoded, never logged.

All five endpoints from their spec are wrapped here:
  - pull_batch()      POST /api/careerflow/batch/pull
  - submit_item()     POST /api/careerflow/batch/{item_id}/submit
  - report_failure()  POST /api/careerflow/batch/{item_id}/fail
  - get_item_status() GET  /api/careerflow/batch/{item_id}/status
  - get_stats()       GET  /api/careerflow/stats

Retry behaviour: Xtrium's gateway runs an automated rate-limiting circuit
breaker that temporarily rejects a key after high-frequency or repeated
attempts (confirmed directly by their team). That cooldown needs real wait
time (minutes) to clear, so 403 is deliberately NOT retried here — instead,
calls retry automatically, with exponential backoff + jitter, only on 429
(standard rate limiting) and 5xx (their server having a bad moment), which
are genuinely transient. A 403 fails fast with a clear message instead.
"""
import asyncio
import random
import httpx
from app.core.config import settings


class XtriumClientError(Exception):
    """Raised when the Xtrium Catalog IQ API returns an error or is unreachable."""
    pass


# Retryable HTTP statuses: 429 (standard rate limit) and 5xx (their server
# having a bad moment) — both are genuinely transient and worth a short
# in-request wait. 403 is deliberately NOT retried here: Xtrium confirmed
# it's an automated circuit-breaker cooldown on their gateway, which needs
# real wait time (minutes) to clear — a few seconds of in-request backoff
# can never succeed against it, and only makes the request slow enough to
# risk being killed by an upstream proxy timeout before FastAPI can finish
# and attach its normal CORS headers (the exact bug this once caused).
RETRYABLE_STATUSES = {429, 500, 502, 503, 504}
MAX_RETRIES = 3
BASE_DELAY_SECONDS = 2.0


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

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        """
        Single choke point for every outbound call to Xtrium Catalog IQ.

        Two layers of resilience:
        1. Network-level failures (unreachable host, connection refused, DNS
           failure, TLS error, timeout) are caught and converted into a clean
           XtriumClientError with a specific, readable reason, instead of an
           uncaught httpx exception crashing the endpoint with a raw 500 that
           skips FastAPI's normal error handling (what previously showed up
           in the browser as a misleading CORS error).
        2. Retryable HTTP-level failures (429 rate limits, 5xx server
           errors) get up to MAX_RETRIES automatic retries with exponential backoff + random jitter, so a transient block on
           their end resolves itself without the caller needing to click
           anything again — and without hammering their gateway in a way
           that could re-trigger the same circuit breaker.
        """
        self._check_configured()
        url = f"{self.base_url}{path}"

        last_response: httpx.Response | None = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.request(method, url, **kwargs)
            except httpx.ConnectTimeout:
                raise XtriumClientError(
                    f"Connection to Xtrium Catalog IQ timed out ({url}). "
                    f"The host may be unreachable from this server, or a firewall is blocking the request."
                )
            except httpx.ConnectError as e:
                raise XtriumClientError(
                    f"Could not connect to Xtrium Catalog IQ at {url}: {str(e)[:200]}. "
                    f"Confirm XTRIUM_CATALOG_BASE_URL is correct and publicly reachable — "
                    f"a plain IP:port over HTTP is often internal-only, not a public endpoint."
                )
            except httpx.TimeoutException:
                raise XtriumClientError(f"Request to Xtrium Catalog IQ timed out ({url}).")
            except httpx.RequestError as e:
                raise XtriumClientError(f"Network error calling Xtrium Catalog IQ ({url}): {str(e)[:200]}")

            if resp.status_code not in RETRYABLE_STATUSES:
                return resp

            last_response = resp
            if attempt < MAX_RETRIES:
                delay = BASE_DELAY_SECONDS * (2 ** attempt) + random.uniform(0, 1)
                await asyncio.sleep(delay)

        # Every attempt hit a retryable status — return the last response
        # as-is; the calling method's own status check turns it into a
        # clean XtriumClientError with the real status code and body.
        return last_response

    async def pull_batch(
        self, batch_size: int = 50, status: str = "Queued",
        claim: bool = True, include_in_progress: bool = False,
    ) -> list[dict]:
        """
        POST /api/careerflow/batch/pull
        Pulls the highest-priority batch of links currently assigned to us.
        batch_size is capped at 50 by their API — we don't enforce that
        client-side, just pass through what's asked and let their API
        respond however it responds to an over-limit request.

        claim=True (their default, and ours) atomically transitions Queued
        items to In Progress — i.e. it's a REAL, non-idempotent action, not
        a read-only check. Pass claim=False for a genuinely safe query that
        doesn't consume anything. This was the source of an earlier stuck
        state: every pull, including diagnostic ones, was silently claiming
        real items because claim defaulted to true and nothing made that
        explicit.
        """
        r = await self._request(
            "POST", "/api/careerflow/batch/pull",
            headers=self._headers(),
            json={
                "batch_size": batch_size, "status": status,
                "claim": claim, "include_in_progress": include_in_progress,
            },
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
        r = await self._request(
            "POST", f"/api/careerflow/batch/{item_id}/submit",
            headers=self._headers(), json={"raw_payload": raw_payload, "notes": notes},
        )
        if r.status_code != 200:
            raise XtriumClientError(f"Submit failed for item {item_id}: {r.status_code} — {r.text[:300]}")
        return r.json()

    async def report_failure(self, item_id: int | str, failure_reason: str, notes: str = "") -> dict:
        """
        POST /api/careerflow/batch/{item_id}/fail
        Reports that a link could not be scraped (404, anti-bot, paywall, etc).
        """
        r = await self._request(
            "POST", f"/api/careerflow/batch/{item_id}/fail",
            headers=self._headers(), json={"failure_reason": failure_reason, "notes": notes},
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
        r = await self._request(
            "GET", f"/api/careerflow/batch/{item_id}/status", headers=self._headers(),
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
        r = await self._request("GET", "/api/careerflow/stats", headers=self._headers())
        if r.status_code != 200:
            raise XtriumClientError(f"Stats fetch failed: {r.status_code} — {r.text[:300]}")
        return r.json()


xtrium_client = XtriumClient()
