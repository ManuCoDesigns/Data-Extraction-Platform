"""
Web scraper service — fetches a URL and returns clean readable text.

For JS-heavy company websites (most Fortune 500 sites), the homepage
is a React/Vue SPA that returns empty HTML. This scraper handles that by:
  1. Extracting JSON-LD structured data (always present, always readable)
  2. Trying multiple sub-pages (press releases, newsrooms, about pages)
  3. Extracting meta tags (og:description, description)
  4. Combining all sources into usable text for Claude extraction

Does NOT handle:
  - Sites requiring login
  - Pages behind Cloudflare Bot Fight Mode
"""
import re
import json as _json
import httpx
from html.parser import HTMLParser


_SKIP_TAGS = {
    "script", "style", "head", "noscript", "svg", "iframe",
    "meta", "link", "nav", "footer", "header",
}
_BLOCK_TAGS = {
    "p", "br", "div", "li", "td", "th", "h1", "h2", "h3",
    "h4", "h5", "h6", "tr", "section", "article",
}

# Sub-pages to try when homepage has too little content
_FALLBACK_PATHS = [
    "/about", "/who-we-are", "/about-us", "/company",
    "/operations", "/our-operations", "/what-we-do",
    "/products", "/our-products",
    "/newsroom", "/news", "/press-releases", "/media",
    "/investor-relations", "/investors",
    "/sustainability",
    "/locations", "/global-locations",
    "/en/about", "/en/who-we-are",
]

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


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self._skip_depth = 0
        self.parts: list[str] = []
        self.json_ld_blocks: list[str] = []
        self.meta_tags: dict[str, str] = {}
        self._in_json_ld = False
        self._current_script_type = ""

    def handle_starttag(self, tag: str, attrs):
        t = tag.lower()
        attrs_dict = dict(attrs)

        # Capture JSON-LD blocks
        if t == "script":
            stype = attrs_dict.get("type", "")
            self._current_script_type = stype
            if stype == "application/ld+json":
                self._in_json_ld = True
            else:
                self._skip_depth += 1
            return

        # Capture meta tags
        if t == "meta":
            name = attrs_dict.get("name") or attrs_dict.get("property") or ""
            content = attrs_dict.get("content", "")
            if content and name.lower() in (
                "description", "og:description", "twitter:description",
                "og:title", "og:site_name", "keywords",
            ):
                self.meta_tags[name.lower()] = content
            return

        if t in _SKIP_TAGS:
            self._skip_depth += 1
        if t in _BLOCK_TAGS and self.parts and self.parts[-1] != "\n":
            self.parts.append("\n")

    def handle_endtag(self, tag: str):
        t = tag.lower()
        if t == "script":
            if self._in_json_ld:
                self._in_json_ld = False
            elif self._skip_depth:
                self._skip_depth -= 1
            self._current_script_type = ""
            return
        if t in _SKIP_TAGS and self._skip_depth:
            self._skip_depth -= 1
        if t in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str):
        if self._in_json_ld:
            # Collect JSON-LD for structured data extraction
            self.json_ld_blocks.append(data)
            return
        if self._skip_depth:
            return
        stripped = data.strip()
        if stripped:
            self.parts.append(stripped)
            self.parts.append(" ")

    def get_text(self) -> str:
        raw = "".join(self.parts)
        raw = re.sub(r" {2,}", " ", raw)
        raw = re.sub(r"\n{3,}", "\n\n", raw)
        return raw.strip()

    def get_json_ld_text(self) -> str:
        """Extract human-readable text from JSON-LD structured data."""
        parts = []
        for block in self.json_ld_blocks:
            block = block.strip()
            if not block:
                continue
            try:
                data = _json.loads(block)
                if isinstance(data, list):
                    for item in data:
                        parts.append(_flatten_json_ld(item))
                else:
                    parts.append(_flatten_json_ld(data))
            except Exception:
                pass
        return "\n".join(p for p in parts if p.strip())


def _flatten_json_ld(obj, depth=0) -> str:
    """Recursively extract readable strings from a JSON-LD object."""
    if depth > 5:
        return ""
    if isinstance(obj, str):
        return obj if len(obj) > 20 else ""
    if isinstance(obj, dict):
        parts = []
        readable_keys = {
            "name", "description", "headline", "text", "articleBody",
            "addressLocality", "addressCountry", "addressRegion",
            "telephone", "url", "email", "foundingDate", "numberOfEmployees",
            "legalName", "alternateName", "slogan", "award", "brand",
            "location", "place", "address", "contactPoint",
        }
        for k, v in obj.items():
            if k.startswith("@"):
                continue
            if k in readable_keys or k.lower() in readable_keys:
                t = _flatten_json_ld(v, depth + 1)
                if t:
                    parts.append(f"{k}: {t}")
            else:
                t = _flatten_json_ld(v, depth + 1)
                if t:
                    parts.append(t)
        return "\n".join(parts)
    if isinstance(obj, list):
        return "\n".join(_flatten_json_ld(i, depth + 1) for i in obj if i)
    if isinstance(obj, (int, float)):
        return str(obj)
    return ""


async def _fetch_one(client: httpx.AsyncClient, url: str, max_chars: int) -> tuple[str, str]:
    """Fetch one URL. Returns (main_text, json_ld_text)."""
    try:
        response = await client.get(url)
        if response.status_code >= 400:
            return "", ""
        content_type = response.headers.get("content-type", "").lower()
        if "pdf" in content_type:
            return "", ""
        parser = _TextExtractor()
        parser.feed(response.text)
        main = parser.get_text()[:max_chars]
        json_ld = parser.get_json_ld_text()
        meta = "\n".join(f"{k}: {v}" for k, v in parser.meta_tags.items())
        combined = "\n\n".join(p for p in [meta, json_ld, main] if p.strip())
        return combined, url
    except Exception:
        return "", ""


async def fetch_url_text(url: str, max_chars: int = 80_000) -> tuple[str, dict]:
    """
    Fetch a URL and return (readable_text, metadata).

    For JS-rendered sites where the homepage returns little text,
    automatically tries common sub-pages and extracts JSON-LD structured
    data so Claude still gets something useful to work with.
    """
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=httpx.Timeout(25.0, connect=10.0),
        headers=_BROWSER_HEADERS,
        verify=True,
    ) as client:

        # Try the main URL first
        base = url.rstrip("/")
        main_text, _ = await _fetch_one(client, base, max_chars // 3)

        all_parts = []
        if main_text.strip():
            all_parts.append(f"=== {base} ===\n{main_text}")

        # If we got very little text (JS-rendered), try sub-pages
        raw_text_len = len(re.sub(r'\s+', '', main_text))
        if raw_text_len < 500:
            for path in _FALLBACK_PATHS:
                try:
                    sub_text, sub_url = await _fetch_one(client, base + path, max_chars // 4)
                    sub_raw = len(re.sub(r'\s+', '', sub_text))
                    if sub_raw > 300:
                        all_parts.append(f"=== {base + path} ===\n{sub_text}")
                    if sum(len(p) for p in all_parts) > max_chars:
                        break
                except Exception:
                    continue

        combined = "\n\n".join(all_parts)

        if not combined.strip():
            raise ValueError(
                "The page returned no readable text. This website likely requires "
                "JavaScript to render its content. "
                "Try one of these alternatives:\n"
                "1. Find the company's annual report or sustainability PDF and upload it\n"
                "2. Copy the text from their website and paste it into a .txt file, then upload\n"
                "3. Use the company's press releases page URL instead (usually server-rendered)\n"
                "4. Try: " + base + "/newsroom OR " + base + "/press-releases OR " + base + "/annual-report"
            )

        truncated = len(combined) > max_chars
        return combined[:max_chars], {
            "url": url,
            "status_code": 200,
            "content_type": "text/html",
            "char_count": len(combined),
            "truncated": truncated,
        }


async def fetch_multiple_pages(
    base_url: str,
    page_param: str = "page",
    max_pages: int = 5,
    max_chars_per_page: int = 40_000,
) -> str:
    all_text_parts: list[str] = []
    page1_fingerprint: str | None = None

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=httpx.Timeout(25.0, connect=10.0),
        headers=_BROWSER_HEADERS,
        verify=True,
    ) as client:
        for page_num in range(1, max_pages + 1):
            if page_num == 1:
                url = base_url
            else:
                sep = "&" if "?" in base_url else "?"
                url = f"{base_url}{sep}{page_param}={page_num}"

            try:
                text, _ = await _fetch_one(client, url, max_chars_per_page)
                if not text:
                    break
            except Exception:
                break

            fingerprint = text[:500]
            if page_num == 1:
                page1_fingerprint = fingerprint
            elif fingerprint == page1_fingerprint:
                break

            all_text_parts.append(f"--- Page {page_num} ---\n{text}")

    return "\n\n".join(all_text_parts)
