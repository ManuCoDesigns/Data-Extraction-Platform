"""
CSV parser for the Xtrium extraction pipeline.
Auto-detects header row, handles blank rows.
"""
from typing import Any
import pandas as pd


class CSVParser:
    def parse(self, file_path: str) -> list[dict[str, Any]]:
        # Try to detect header row in first 10 rows
        header_row = 0
        for i in range(10):
            try:
                df_test = pd.read_csv(file_path, header=i, nrows=3)
                if all(isinstance(c, str) and not c.startswith("Unnamed") for c in df_test.columns):
                    header_row = i
                    break
            except Exception:
                break

        df = pd.read_csv(file_path, header=header_row, dtype=str)
        df.dropna(how="all", inplace=True)
        df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]

        records = []
        for _, row in df.iterrows():
            record = {k: (v.strip() if isinstance(v, str) else None) for k, v in row.items() if pd.notna(v)}
            record["_raw_text"] = " | ".join(f"{k}: {v}" for k, v in record.items() if not k.startswith("_"))
            records.append(record)

        return records
