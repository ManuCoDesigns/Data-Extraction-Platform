"""
Schema validation — checks a record's extracted_fields against the schema's
field definitions (required, type, enum). Supports base fields and
website-specific "extras" fields (marked with "extras": true in the schema).
"""
from typing import Any


def validate_record(
    fields: dict,
    schema_fields: list[dict],
    flexible: bool = False,
) -> tuple[bool, list[dict]]:
    """
    Returns (is_valid, errors).

    flexible=True (set when schema has flexible_validation=true):
      Only checks that required fields are present and non-empty.
      Skips all type and enum validation — useful for free-form JSON schemas
      such as WebTailBench where the content object has no fixed structure.
    """
    errors = []

    for field_def in schema_fields:
        name = field_def.get("name")
        if not name:
            continue
        if "fixed_value" in field_def:
            continue  # fixed fields are always valid

        value  = fields.get(name)
        # A value is "present" if it's not None, not empty string, and not empty dict/list
        missing = value is None or value == "" or value == {} or value == []
        is_extra = bool(field_def.get("extras"))

        # flexible mode: skip required check entirely — the task schema changes per task
        if field_def.get("required") and missing and not flexible:
            errors.append({
                "field": name,
                "error": "Required field is missing or empty",
                "is_extra": is_extra,
            })
            continue

            # In flexible mode: never flag anything — store whatever the extractor uploads
        if flexible:
            continue

        if missing:
            continue

        type_hint = field_def.get("type", "string")
        if not _type_matches(value, type_hint):
            errors.append({
                "field": name,
                "error": f"Expected type '{type_hint}', got '{type(value).__name__}' ({value!r})",
                "is_extra": is_extra,
            })

        if "enum" in field_def and value not in field_def["enum"]:
            errors.append({
                "field": name,
                "error": f"Value {value!r} not in allowed values {field_def['enum']}",
                "is_extra": is_extra,
            })

    return (len(errors) == 0, errors)


def get_extras_fields(schema_fields: list[dict]) -> list[str]:
    """Return list of field names that are marked as extras."""
    return [f["name"] for f in schema_fields if f.get("extras")]


def get_extras_source(schema_fields: list[dict]) -> str | None:
    """Return the extras_source label (e.g. 'atlas.gov.au') if any extras exist."""
    for f in schema_fields:
        if f.get("extras") and f.get("extras_source"):
            return f["extras_source"]
    return None


def _type_matches(value: Any, type_hint: str) -> bool:
    if type_hint in ("string", "text"):
        return isinstance(value, str)
    if type_hint in ("integer", "int"):
        return isinstance(value, int) and not isinstance(value, bool)
    if type_hint in ("float", "number"):
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if type_hint == "boolean":
        return isinstance(value, bool)
    if type_hint == "array":
        return isinstance(value, list)
    if type_hint == "object":
        return isinstance(value, dict)
    return True


def map_row_to_fields(row: dict, schema_fields: list[dict]) -> dict:
    """
    Maps a raw CSV/Excel row onto schema field names.
    JSON files bypass this and go directly to extracted_fields.
    """
    mapped = {}
    for field_def in schema_fields:
        name = field_def.get("name")
        if not name:
            continue
        if "fixed_value" in field_def:
            mapped[name] = field_def["fixed_value"]
            continue
        source_field = field_def.get("source_field", name)
        value = row.get(source_field, row.get(name))
        if value is not None and isinstance(value, str):
            value = value.strip()
            if value == "":
                value = None
        mapped[name] = _coerce(value, field_def.get("type", "string")) if value is not None else None
    return mapped


def _coerce(value: Any, type_hint: str) -> Any:
    try:
        if type_hint in ("integer", "int"):
            return int(float(str(value).replace(",", "")))
        if type_hint in ("float", "number"):
            return float(str(value).replace(",", ""))
        if type_hint == "boolean":
            if isinstance(value, bool):
                return value
            return str(value).strip().lower() in ("true", "yes", "1")
        return value
    except (ValueError, TypeError):
        return value
