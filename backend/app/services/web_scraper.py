"""
Web scraper service — fetches a URL and returns clean readable text.

Uses httpx (already in requirements) for HTTP and Python's built-in
html.parser for tag stripping — no additional dependencies needed.

Handles:
  - Standard HTML pages (most government and industry directories)
  - Redirects and SSL
  - Basic bot-detection avoidance via realistic User-Agent + headers
  - Oversized pages (truncated to max_chars)
  - Character encoding detection

Does NOT handle:
  - JavaScript-heavy SPAs that render content client-side
  - Sites that require login or cookie sessions
  - Multi-page pagination (caller handles multiple calls)
  - PDFs served at URLs (raise ValueError so caller can advise user to download)
"""
import re
import httpx
from html.parser import HTMLParser


# Tags whose text content is never useful
_SKIP_TAGS = {
    "script", "style", "head", "noscript", "svg", "iframe",
    "meta", "link", "nav", "footer", "header",
}

# Tags that represent structural breaks (add a newline after)
_BLOCK_TAGS = {
    "p", "br", "div", "li", "td", "th", "h1", "h2", "h3",
    "h4", "h5", "h6", "tr", "section", "article",
}


class _TextExtractor(HTMLParser):
    """Strip HTML and return clean, readable text with reasonable whitespace."""

    def __init__(self):
        super().__init__()
        self._skip_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs):
        t = tag.lower()
        if t in _SKIP_TAGS:
            self._skip_depth += 1
        if t in _BLOCK_TAGS and self.parts and self.parts[-1] != "\n":
            self.parts.append("\n")

    def handle_endtag(self, tag: str):
        t = tag.lower()
        if t in _SKIP_TAGS and self._skip_depth:
            self._skip_depth -= 1
        if t in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str):
        if self._skip_depth:
            return
        stripped = data.strip()
        if stripped:
            self.parts.append(stripped)
            self.parts.append(" ")

    def get_text(self) -> str:
        raw = "".join(self.parts)
        # Collapse excessive whitespace while preserving paragraph breaks
        raw = re.sub(r" {2,}", " ", raw)
        raw = re.sub(r"\n{3,}", "\n\n", raw)
        return raw.strip()


_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
}


async def fetch_url_text(url: str, max_chars: int = 80_000) -> tuple[str, dict]:
    """
    Fetch a URL and return (readable_text, metadata).

    metadata keys:
      - url: final URL after redirects
      - status_code: HTTP status
      - content_type: response content-type header
      - char_count: length of extracted text before truncation
      - truncated: whether the text was truncated to max_chars

    Raises:
      ValueError  — if the URL is a PDF (caller should advise user to download)
      httpx.HTTPStatusError — on 4xx/5xx responses
      httpx.ConnectError    — if the host is unreachable
      httpx.TimeoutException — if the server takes too long
    """
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=httpx.Timeout(30.0, connect=10.0),
        headers=_BROWSER_HEADERS,
        verify=True,
    ) as client:
        response = await client.get(url)
        response.raise_for_status()

    content_type = response.headers.get("content-type", "").lower()
    final_url = str(response.url)

    if "pdf" in content_type or final_url.lower().endswith(".pdf"):
        raise ValueError(
            "This URL serves a PDF file. Download it manually and upload it "
            "directly using the Upload button — the AI extraction will handle it."
        )

    # Detect encoding from Content-Type or let httpx auto-detect
    html = response.text

    parser = _TextExtractor()
    parser.feed(html)
    text = parser.get_text()

    truncated = len(text) > max_chars
    return text[:max_chars], {
        "url": final_url,
        "status_code": response.status_code,
        "content_type": content_type,
        "char_count": len(text),
        "truncated": truncated,
    }


async def fetch_multiple_pages(
    base_url: str,
    page_param: str = "page",
    max_pages: int = 5,
    max_chars_per_page: int = 40_000,
) -> str:
    """
    Fetch up to max_pages pages of a paginated URL and combine the text.
    Uses common pagination patterns: ?page=N and ?start=N*100 style.
    Stops early if a page returns the same content as page 1 (end of pagination).
    """
    all_text_parts: list[str] = []
    page1_fingerprint: str | None = None

    for page_num in range(1, max_pages + 1):
        if page_num == 1:
            url = base_url
        else:
            sep = "&" if "?" in base_url else "?"
            url = f"{base_url}{sep}{page_param}={page_num}"

        try:
            text, _ = await fetch_url_text(url, max_chars=max_chars_per_page)
        except Exception:
            break

        # Detect duplicate page (past the end of pagination)
        fingerprint = text[:500]
        if page_num == 1:
            page1_fingerprint = fingerprint
        elif fingerprint == page1_fingerprint:
            break

        all_text_parts.append(f"--- Page {page_num} ---\n{text}")

    return "\n\n".join(all_text_parts)
