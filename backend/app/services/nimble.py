"""Nimble Extract: fetch a source's web page so field values can be looked for on it.

Set NIMBLE_API_KEY on the server. NIMBLE_API_URL (default https://sdk.nimbleway.com) and NIMBLE_EXTRACT_PATH
(default /v2/extract) can be changed without a code change if Nimble moves the endpoint.
"""
import ipaddress
import os
import time
from urllib.parse import urlparse

import httpx

_CACHE: dict = {}
TTL = 900


def configured() -> bool:
    return bool(os.getenv("NIMBLE_API_KEY"))


def _base() -> str:
    return os.getenv("NIMBLE_API_URL", "https://sdk.nimbleway.com").rstrip("/")


def _safe_url(url: str) -> str | None:
    u = (url or "").strip()
    if not u:
        return None
    if not u.lower().startswith(("http://", "https://")):
        u = "https://" + u
    p = urlparse(u)
    host = (p.hostname or "").lower()
    if not host or "." not in host or host in ("localhost",) or host.endswith((".local", ".internal")):
        return None
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local:
            return None
    except ValueError:
        pass
    return u


def extract(url: str, render: bool = False) -> dict:
    """Returns {ok, url, text, error, cached}. Never raises."""
    u = _safe_url(url)
    if not u:
        return {"ok": False, "url": url, "text": "", "error": "That is not a web address the check can open."}
    if not configured():
        return {"ok": False, "url": u, "text": "", "error": "Nimble is not set up. Add NIMBLE_API_KEY to the server settings."}
    key = (u, render)
    hit = _CACHE.get(key)
    if hit and time.time() - hit[0] < TTL:
        return {**hit[1], "cached": True}
    headers = {"Authorization": f"Bearer {os.getenv('NIMBLE_API_KEY')}", "Content-Type": "application/json"}
    body = {"url": u, "formats": ["markdown"], "render": render}
    try:
        with httpx.Client(timeout=60) as c:
            r = None
            for attempt in range(3):  # back off on rate limits (429) and retry a slow page once
                try:
                    r = c.post(_base() + os.getenv("NIMBLE_EXTRACT_PATH", "/v2/extract"), json=body, headers=headers)
                except httpx.TimeoutException:
                    if attempt == 1:
                        raise
                    continue
                if r.status_code != 429:
                    break
                try:
                    wait = float(r.json().get("retry_after") or r.headers.get("retry-after") or 1)
                except Exception:
                    wait = 1.0
                time.sleep(min(max(wait, 0.5), 10))
            if r is None or r.status_code == 429:
                return {"ok": False, "url": u, "text": "", "error": "Nimble is busy right now (rate limit). Try again in a minute."}
            if r.status_code in (401, 403):
                return {"ok": False, "url": u, "text": "", "error": "Nimble rejected the API key."}
            if r.status_code == 404:
                return {"ok": False, "url": u, "text": "", "error": "Nimble did not recognise the extract address. Check NIMBLE_EXTRACT_PATH."}
            if r.status_code >= 400:
                return {"ok": False, "url": u, "text": "", "error": f"Nimble answered with an error ({r.status_code})."}
            j = r.json()
            data = j.get("data") or {}
            task_id = (j.get("task") or {}).get("id") or j.get("task_id")
            if not data and task_id:  # async style answer: wait for the result
                for _ in range(20):
                    time.sleep(1.5)
                    rr = c.get(f"{_base()}/v2/tasks/{task_id}/results", headers=headers)
                    if rr.status_code == 200 and (rr.json().get("data") or {}):
                        j = rr.json()
                        data = j.get("data") or {}
                        break
            text = data.get("markdown") or data.get("text") or data.get("html") or ""
            status = str(j.get("status") or "success").lower()
    except httpx.TimeoutException:
        return {"ok": False, "url": u, "text": "", "error": "The page took too long to load. Try again, or tick Render page."}
    except httpx.HTTPError:
        return {"ok": False, "url": u, "text": "", "error": "Could not reach Nimble. Try again in a moment."}
    except ValueError:
        return {"ok": False, "url": u, "text": "", "error": "Nimble sent back something unreadable."}
    if not text or status in ("fatal", "error", "blocked", "rejected"):
        return {"ok": False, "url": u, "text": "", "error": "The page came back empty or blocked. Try again with page rendering on."}
    out = {"ok": True, "url": u, "text": text[:400_000], "error": None}
    _CACHE[key] = (time.time(), out)
    if len(_CACHE) > 200:
        _CACHE.pop(next(iter(_CACHE)))
    return out
