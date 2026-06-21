"""
Schema validation — checks a record's extracted_fields against the schema's
field definitions (required, type, enum). This is structural validation,
distinct from LLM content review: a record can be schema-valid but still
factually wrong, and vice versa, a record can fail schema validation even
though the content itself is fine (e.g. wrong type, missing required field).
"""
from typing import Any


def validate_record(fields: dict, schema_fields: list[dict]) -> tuple[bool, list[dict]]:
    """Returns (is_valid, errors) where errors is a list of {field, error}."""
    errors = []

    for field_def in schema_fields:
        name = field_def.get("name")
        if not name:
            continue
        if "fixed_value" in field_def:
            continue  # fixed fields are always valid by definition

        value = fields.get(name)
        is_missing = value is None or value == ""

        if field_def.get("required") and is_missing:
            errors.append({"field": name, "error": "Required field is missing"})
            continue

        if is_missing:
            continue  # optional and absent — fine

        type_hint = field_def.get("type", "string")
        if not _type_matches(value, type_hint):
            errors.append({
                "field": name,
                "error": f"Expected type '{type_hint}', got '{type(value).__name__}' ({value!r})",
            })

        if "enum" in field_def and value not in field_def["enum"]:
            errors.append({
                "field": name,
                "error": f"Value {value!r} is not in allowed values {field_def['enum']}",
            })

    return (len(errors) == 0, errors)


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
    return True  # unknown type hint — don't block on it


def map_row_to_fields(row: dict, schema_fields: list[dict]) -> dict:
    """
    Maps a raw uploaded row (CSV/Excel/JSON column names) onto schema field names,
    using each field's optional `source_field` to handle column name mismatches.
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
