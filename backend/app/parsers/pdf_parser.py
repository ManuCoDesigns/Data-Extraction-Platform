"""
PDF parser for the Xtrium extraction pipeline.
Uses pdfplumber with positional word extraction.
Detects column layout, applies page-header category tracking.
"""
import re
from typing import Any
import pdfplumber


class PDFParser:
    MIN_COMPANY_NAME_LEN = 2
    MAX_COMPANY_NAME_LEN = 80
    AD_LINE_RATIO_THRESHOLD = 0.4

    def parse(self, file_path: str) -> list[dict[str, Any]]:
        """Parse a PDF and return a list of raw record dicts."""
        records = []
        current_category = "Uncategorised"

        with pdfplumber.open(file_path) as pdf:
            for page_num, page in enumerate(pdf.pages, start=1):
                try:
                    page_records, current_category = self._parse_page(
                        page, page_num, current_category
                    )
                    records.extend(page_records)
                except Exception as e:
                    # Log and continue — don't let one bad page abort the job
                    records.append({
                        "_parse_error": str(e),
                        "_page": page_num,
                        "_raw_text": "",
                    })

        return records

    def _parse_page(self, page, page_num: int, carry_category: str):
        """Parse one page, returning (records, updated_category)."""
        words = page.extract_words(
            x_tolerance=3,
            y_tolerance=3,
            keep_blank_chars=False,
            use_text_flow=False,
            extra_attrs=["fontname", "size"],
        )
        if not words:
            return [], carry_category

        text = page.extract_text() or ""
        lines = [l.strip() for l in text.split("\n") if l.strip()]

        # Detect page header → category
        category = self._detect_category(lines, words) or carry_category

        # Skip full-page advertisement pages
        if self._is_ad_page(lines):
            return [], category

        # Build records from lines
        records = self._extract_records_from_lines(lines, category, page_num)
        return records, category

    def _detect_category(self, lines: list[str], words: list) -> str | None:
        """First bold/large line near the top of the page is the category."""
        # Try large-font words (approximate: font size > 11 on typical pages)
        top_words = [w for w in words if w.get("top", 999) < 80 and float(w.get("size", 0)) > 10]
        if top_words:
            candidate = " ".join(w["text"] for w in top_words[:6]).strip()
            if self._looks_like_category(candidate):
                return candidate.title()

        # Fall back to first line heuristic
        for line in lines[:3]:
            if self._looks_like_category(line):
                return line.title()
        return None

    def _looks_like_category(self, text: str) -> bool:
        if not text or len(text) < 4 or len(text) > 60:
            return False
        # Category: mostly alpha, no URL, no phone number
        if re.search(r"(http|www|\.com|@|\d{4,})", text, re.IGNORECASE):
            return False
        alpha_ratio = sum(1 for c in text if c.isalpha()) / len(text)
        return alpha_ratio > 0.6

    def _is_ad_page(self, lines: list[str]) -> bool:
        """Heuristic: page is a full-page ad if >40% of lines are marketing sentences."""
        if not lines:
            return False
        ad_signals = sum(
            1 for l in lines
            if re.search(
                r"(excellence|rely on|contact us|call us|award|proven|leader|trusted|solution|world.class)",
                l, re.IGNORECASE
            )
        )
        return ad_signals / max(len(lines), 1) > self.AD_LINE_RATIO_THRESHOLD

    def _extract_records_from_lines(self, lines: list[str], category: str, page_num: int) -> list[dict]:
        """
        Build one record per company from a list of text lines.
        Looks for a company-name line followed by address/contact lines.
        """
        records = []
        current: dict[str, Any] | None = None

        for line in lines:
            if self._looks_like_category(line) and len(line) < 60:
                continue  # skip category/header repeat lines

            if self._is_company_name(line):
                if current:
                    records.append(self._finalise(current, category))
                current = {
                    "company_name": line,
                    "_raw_lines": [line],
                    "_page": page_num,
                }
            elif current is not None:
                current["_raw_lines"].append(line)
                self._absorb_line(current, line)

        if current:
            records.append(self._finalise(current, category))

        return records

    def _is_company_name(self, line: str) -> bool:
        if not line or len(line) < self.MIN_COMPANY_NAME_LEN or len(line) > self.MAX_COMPANY_NAME_LEN:
            return False
        # Not a phone/fax line
        if re.match(r"^[\d\s\(\)\-\+]+$", line):
            return False
        # Not a URL or email
        if re.search(r"(http|www\.|\.com|\.au|@)", line, re.IGNORECASE):
            return False
        # Must start with a letter
        if not line[0].isalpha():
            return False
        # Reject lines that are obviously ad copy
        if re.search(
            r"\b(contact|call|email|visit|proven|trusted|excellence|award|solution|leading|specialising)\b",
            line, re.IGNORECASE
        ):
            return False
        # Company suffixes are strong signals
        if re.search(
            r"\b(pty|ltd|limited|inc|corp|group|services|mining|solutions|australia|international|holdings)\b",
            line, re.IGNORECASE
        ):
            return True
        # Reasonable fallback: capitalised first word, reasonable length
        return bool(re.match(r"^[A-Z]", line)) and 4 <= len(line) <= 60

    def _absorb_line(self, record: dict, line: str):
        """Parse a non-name line and slot it into the record."""
        line_lower = line.lower()

        if "address" not in record and self._looks_like_address(line):
            record["address"] = line
        elif re.match(r"^(tel|ph|phone|t|f|fax)[:\s]", line_lower):
            record["phone"] = re.sub(r"^[^:]+:\s*", "", line).strip()
        elif re.match(r"^(fax|f)[:\s]", line_lower):
            record["fax"] = re.sub(r"^[^:]+:\s*", "", line).strip()
        elif re.match(r".+@.+\..+", line):
            record["email"] = line.strip()
        elif re.match(r"(https?://|www\.)\S+", line, re.IGNORECASE):
            record["website"] = line.strip()
        elif "state" not in record:
            # Try to pick out state abbreviation
            m = re.search(r"\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b", line)
            if m:
                record["state"] = m.group(1)

    def _looks_like_address(self, line: str) -> bool:
        return bool(re.search(r"\b\d+\b.*(street|st|road|rd|avenue|ave|drive|dr|way|lane|ln|place|pl|highway|hwy)\b",
                               line, re.IGNORECASE))

    def _finalise(self, record: dict, category: str) -> dict:
        raw_text = "\n".join(record.get("_raw_lines", []))
        return {
            "company_name": record.get("company_name", ""),
            "address": record.get("address"),
            "phone": record.get("phone"),
            "fax": record.get("fax"),
            "email": record.get("email"),
            "website": record.get("website"),
            "state": record.get("state"),
            "category": category,
            "_page": record.get("_page"),
            "_raw_text": raw_text,
        }
