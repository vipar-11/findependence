"""
Runtime Bank Statement Format & Schema Discovery Parser.

Supports:
- Excel workbooks: `.xlsx` (openpyxl) and `.xls` (xlrd)
- Spreadsheets: `.csv`, `.tsv`, semicolon or pipe delimited files
- Automatic header row detection (skips bank metadata/account summary rows at top)
- Runtime discovery of Date, Narration/Description, Debit/Withdrawal, Credit/Deposit,
  Amount + Dr/Cr indicator, and Running Balance columns.
"""

from __future__ import annotations

import csv
from datetime import date, datetime, timedelta
import io
import re
from typing import Any

import openpyxl
import xlrd


# Header keyword cues for runtime column discovery
DATE_HEADER_CUES = (
    "txn date",
    "transaction date",
    "value date",
    "value dt",
    "tran date",
    "posting date",
    "entry date",
    "date",
    "dt",
)
DESC_HEADER_CUES = (
    "narration",
    "transaction details",
    "particulars",
    "description",
    "remarks",
    "details",
    "merchant",
    "payee",
    "memo",
    "summary",
)
DEBIT_HEADER_CUES = (
    "withdrawal amt",
    "withdrawal amount",
    "withdrawal (dr)",
    "withdrawal",
    "debit amount",
    "debit amt",
    "dr amount",
    "dr amt",
    "debit (dr)",
    "debit",
    "paid out",
    "outflow",
    "spend",
    "dr.",
    "dr",
)
CREDIT_HEADER_CUES = (
    "deposit amt",
    "deposit amount",
    "deposit (cr)",
    "deposit",
    "credit amount",
    "credit amt",
    "cr amount",
    "cr amt",
    "credit (cr)",
    "credit",
    "paid in",
    "inflow",
    "cr.",
    "cr",
)
AMOUNT_HEADER_CUES = (
    "transaction amount",
    "txn amount",
    "amount (inr)",
    "amount (rs)",
    "amount",
    "amt",
    "value",
)
DRCR_HEADER_CUES = (
    "dr/cr",
    "cr/dr",
    "debit/credit",
    "txn type",
    "transaction type",
    "type",
    "d/c",
    "indicator",
)
BALANCE_HEADER_CUES = (
    "closing balance",
    "running balance",
    "available balance",
    "balance (inr)",
    "balance",
    "bal",
)

# Common date formats found in Indian bank statements
DATE_FORMATS = (
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%d/%m/%y",
    "%d-%m-%y",
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%d %b %Y",
    "%d-%b-%Y",
    "%d %b %y",
    "%d-%b-%y",
    "%d %B %Y",
    "%d-%B-%Y",
    "%m/%d/%Y",
    "%m-%d-%Y",
    "%d.%m.%Y",
    "%d.%m.%y",
)


def extract_raw_rows_from_file(file_bytes: bytes, filename: str) -> list[list[Any]]:
    """Read raw 2D grid of cell values from .xlsx, .xls, .csv, or .tsv bytes."""
    lower_name = (filename or "statement.csv").lower().strip()

    if lower_name.endswith(".xlsx"):
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        # Pick the sheet with the most non-empty rows
        best_rows: list[list[Any]] = []
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            rows = [list(r) for r in ws.iter_rows(values_only=True)]
            non_empty = [r for r in rows if any(c is not None and str(c).strip() != "" for c in r)]
            if len(non_empty) > len(best_rows):
                best_rows = non_empty
        return best_rows

    if lower_name.endswith(".xls"):
        book = xlrd.open_workbook(file_contents=file_bytes)
        best_rows = []
        for idx in range(book.nsheets):
            sh = book.sheet_by_index(idx)
            rows = []
            for r_idx in range(sh.nrows):
                row_vals = []
                for c_idx in range(sh.ncols):
                    cell = sh.cell(r_idx, c_idx)
                    if cell.ctype == xlrd.XL_CELL_DATE:
                        dt_tuple = xlrd.xldate_as_tuple(cell.value, book.datemode)
                        row_vals.append(datetime(*dt_tuple).strftime("%Y-%m-%d"))
                    else:
                        row_vals.append(cell.value)
                if any(v is not None and str(v).strip() != "" for v in row_vals):
                    rows.append(row_vals)
            if len(rows) > len(best_rows):
                best_rows = rows
        return best_rows

    # Otherwise parse as CSV / TSV / delimited text
    text = ""
    for enc in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
        try:
            text = file_bytes.decode(enc)
            break
        except UnicodeDecodeError:
            continue

    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return []

    sample = "\n".join(lines[:25])
    delimiter = ","
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;|")
        delimiter = dialect.delimiter
    except Exception:
        # Fallback: count occurrences in first few lines
        counts = {d: sample.count(d) for d in (",", "\t", ";", "|")}
        delimiter = max(counts, key=counts.get) if max(counts.values()) > 0 else ","

    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    return [row for row in reader if any(str(c).strip() != "" for c in row)]


def try_parse_date(val: Any) -> date | None:
    """Attempt to parse a cell value into a Python `date` object."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val

    # Handle Excel serial date floats (e.g. 45200.0) if present
    if isinstance(val, (int, float)) and 25000 <= float(val) <= 60000:
        try:
            return (datetime(1899, 12, 30) + timedelta(days=int(val))).date()
        except Exception:
            pass

    s = str(val).strip()
    if not s or len(s) < 6 or len(s) > 32:
        return None

    # Strip trailing timestamp if present (e.g., "12/08/2025 14:32:10" or "2025-08-12T10:20:00")
    s_clean = re.split(r"[T\s]+", s)[0].strip()
    for candidate in (s_clean, s):
        for fmt in DATE_FORMATS:
            try:
                parsed = datetime.strptime(candidate, fmt).date()
                if 1990 <= parsed.year <= 2035:
                    return parsed
            except ValueError:
                continue
    return None


def try_parse_amount(val: Any) -> tuple[float | None, str | None]:
    """
    Parse a currency/number cell into `(amount, drcr_hint)`.

    Handles Indian formatting (`"1,25,450.50"`, `"Rs. 1,200.00 Dr"`, `"(4,500.00)"`, `"-850.00"`).
    `drcr_hint` is `"DR"`, `"CR"`, or `None`.
    """
    if val is None:
        return None, None
    if isinstance(val, (int, float)):
        fval = float(val)
        if np_isnan(fval):
            return None, None
        return abs(fval), ("DR" if fval < 0 else None)

    s = str(val).strip()
    if not s or s in ("-", "--", "NIL", "null", "None", "NaN"):
        return None, None

    # Check if string looks like a date or pure long account/reference number
    if re.match(r"^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$", s):
        return None, None

    upper = s.upper()
    drcr_hint: str | None = None
    if re.search(r"\b(DR|DEBIT)\b", upper) or upper.endswith("DR") or upper.endswith("D"):
        drcr_hint = "DR"
    elif re.search(r"\b(CR|CREDIT)\b", upper) or upper.endswith("CR") or upper.endswith("C"):
        drcr_hint = "CR"

    is_negative = s.startswith("-") or (s.startswith("(") and s.endswith(")"))
    if is_negative and drcr_hint is None:
        drcr_hint = "DR"

    # Strip currency symbols, commas, spaces, Dr/Cr markers
    cleaned = re.sub(r"(?:INR|RS\.?|₹|,|\s|\bDR\.?\b|\bCR\.?\b|\bDEBIT\b|\bCREDIT\b|\(|\))", "", upper)
    cleaned = cleaned.lstrip("+-")
    if not cleaned:
        return None, None

    if not re.match(r"^\d+(?:\.\d+)?$", cleaned):
        return None, None

    num = float(cleaned)
    # Exclude 11-16 digit reference/UTR numbers that have no decimal point
    if num > 1_00_00_00_000 and "." not in cleaned:
        return None, None

    return num, drcr_hint


def np_isnan(val: float) -> bool:
    return val != val


def _score_header_cell(cell_text: str, cues: tuple[str, ...]) -> int:
    norm = re.sub(r"[^a-z0-9/ ]+", " ", cell_text.lower()).strip()
    if not norm:
        return 0
    for cue in cues:
        if norm == cue:
            return 10
        if cue in norm:
            return 6
    return 0


def discover_statement_schema_and_extract(
    raw_rows: list[list[Any]],
) -> dict[str, Any]:
    """
    Discover the header row and column roles at runtime, then extract all debit/outflow rows.

    Returns
    -------
    dict with:
      - `discovered_schema`: details on detected header row, column names/indices, and layout mode
      - `transactions`: list of normalized outflow dicts `{date, month, description, amount, raw_row_index}`
      - `skipped_inflows_count`: number of credit/deposit rows ignored
    """
    if not raw_rows:
        raise ValueError("The uploaded file contains no readable rows.")

    # 1. Find the header row among the first 35 rows
    best_header_idx = 0
    best_header_score = -1

    scan_limit = min(35, len(raw_rows))
    for r_idx in range(scan_limit):
        row = raw_rows[r_idx]
        non_empty_cells = [str(c).strip() for c in row if c is not None and str(c).strip() != ""]
        if len(non_empty_cells) < 2:
            continue

        row_score = 0
        has_date_cue = False
        has_desc_cue = False
        has_amt_cue = False
        for cell in row:
            s = str(cell or "").strip()
            if _score_header_cell(s, DATE_HEADER_CUES) > 0:
                has_date_cue = True
                row_score += 5
            if _score_header_cell(s, DESC_HEADER_CUES) > 0:
                has_desc_cue = True
                row_score += 5
            if (
                _score_header_cell(s, DEBIT_HEADER_CUES) > 0
                or _score_header_cell(s, AMOUNT_HEADER_CUES) > 0
                or _score_header_cell(s, CREDIT_HEADER_CUES) > 0
            ):
                has_amt_cue = True
                row_score += 5

        if has_date_cue and (has_desc_cue or has_amt_cue):
            row_score += 10

        if row_score > best_header_score:
            best_header_score = row_score
            best_header_idx = r_idx

    # Determine if best_header_idx is a real header row or if the sheet has no headers
    has_explicit_headers = best_header_score >= 10
    data_start_idx = best_header_idx + 1 if has_explicit_headers else 0
    header_row = (
        [str(c or "").strip() for c in raw_rows[best_header_idx]]
        if has_explicit_headers
        else [f"Column {i + 1}" for i in range(max(len(r) for r in raw_rows[:20]))]
    )

    max_cols = max(len(header_row), max((len(r) for r in raw_rows[data_start_idx:data_start_idx + 50]), default=0))
    while len(header_row) < max_cols:
        header_row.append(f"Column {len(header_row) + 1}")

    sample_data_rows = raw_rows[data_start_idx : data_start_idx + 100]
    if not sample_data_rows:
        raise ValueError("No transaction rows found below the header row.")

    # 2. Profile each column using both header cues and actual cell values
    col_profiles: list[dict[str, Any]] = []
    for c_idx in range(max_cols):
        h_text = header_row[c_idx] if c_idx < len(header_row) else ""
        vals = [r[c_idx] for r in sample_data_rows if c_idx < len(r) and r[c_idx] is not None and str(r[c_idx]).strip() != ""]
        n_vals = max(1, len(vals))

        date_hits = sum(1 for v in vals if try_parse_date(v) is not None)
        amt_hits = 0
        drcr_flag_hits = 0
        text_lengths = []

        for v in vals:
            s_v = str(v).strip().upper()
            if s_v in ("DR", "CR", "DEBIT", "CREDIT", "DR.", "CR.", "D", "C"):
                drcr_flag_hits += 1
            amt, _ = try_parse_amount(v)
            if amt is not None and try_parse_date(v) is None:
                amt_hits += 1
            if try_parse_date(v) is None and amt is None and s_v not in ("DR", "CR", "DEBIT", "CREDIT"):
                text_lengths.append(len(s_v))

        col_profiles.append(
            {
                "col_idx": c_idx,
                "header": h_text or f"Col {c_idx + 1}",
                "date_score": _score_header_cell(h_text, DATE_HEADER_CUES) * 3 + (date_hits / n_vals) * 25,
                "desc_score": _score_header_cell(h_text, DESC_HEADER_CUES) * 3
                + (sum(text_lengths) / max(1, len(text_lengths)) * 0.4 if text_lengths else 0),
                "debit_score": _score_header_cell(h_text, DEBIT_HEADER_CUES) * 4 + (amt_hits / n_vals) * 10,
                "credit_score": _score_header_cell(h_text, CREDIT_HEADER_CUES) * 4 + (amt_hits / n_vals) * 10,
                "amount_score": _score_header_cell(h_text, AMOUNT_HEADER_CUES) * 4 + (amt_hits / n_vals) * 12,
                "drcr_score": _score_header_cell(h_text, DRCR_HEADER_CUES) * 4 + (drcr_flag_hits / n_vals) * 30,
                "balance_score": _score_header_cell(h_text, BALANCE_HEADER_CUES) * 5,
                "amt_ratio": amt_hits / n_vals,
                "date_ratio": date_hits / n_vals,
            }
        )

    # Pick Date column
    date_candidates = sorted(col_profiles, key=lambda p: p["date_score"], reverse=True)
    date_col = date_candidates[0]["col_idx"] if date_candidates and date_candidates[0]["date_score"] > 3 else None

    # Pick Description / Narration column (excluding date_col)
    desc_candidates = sorted(
        [p for p in col_profiles if p["col_idx"] != date_col],
        key=lambda p: p["desc_score"],
        reverse=True,
    )
    if not desc_candidates:
        raise ValueError("Could not identify a transaction description/narration column.")
    desc_col = desc_candidates[0]["col_idx"]

    # Identify Balance column so we never confuse it with transaction amount
    bal_candidates = [
        p for p in col_profiles
        if p["col_idx"] not in (date_col, desc_col) and p["balance_score"] >= 15
    ]
    balance_col = bal_candidates[0]["col_idx"] if bal_candidates else None

    # Identify Dr/Cr indicator column if present
    drcr_candidates = sorted(
        [p for p in col_profiles if p["col_idx"] not in (date_col, desc_col, balance_col)],
        key=lambda p: p["drcr_score"],
        reverse=True,
    )
    drcr_col = (
        drcr_candidates[0]["col_idx"]
        if drcr_candidates and drcr_candidates[0]["drcr_score"] >= 15
        else None
    )

    # Identify Debit & Credit or Single Amount columns
    remaining_cols = [
        p for p in col_profiles
        if p["col_idx"] not in (date_col, desc_col, balance_col, drcr_col)
    ]

    debit_col: int | None = None
    credit_col: int | None = None
    amount_col: int | None = None
    layout_mode = "single_amount"

    explicit_debit = [p for p in remaining_cols if _score_header_cell(p["header"], DEBIT_HEADER_CUES) >= 6]
    explicit_credit = [p for p in remaining_cols if _score_header_cell(p["header"], CREDIT_HEADER_CUES) >= 6]

    if explicit_debit:
        debit_col = sorted(explicit_debit, key=lambda p: p["debit_score"], reverse=True)[0]["col_idx"]
        credit_filtered = [p for p in explicit_credit if p["col_idx"] != debit_col]
        if credit_filtered:
            credit_col = sorted(credit_filtered, key=lambda p: p["credit_score"], reverse=True)[0]["col_idx"]
        layout_mode = "separate_debit_credit"
    else:
        # Pick highest-scoring numeric amount column
        amt_candidates = sorted(remaining_cols, key=lambda p: p["amount_score"], reverse=True)
        if not amt_candidates:
            raise ValueError("Could not identify a numeric transaction amount or withdrawal column.")
        amount_col = amt_candidates[0]["col_idx"]
        layout_mode = "amount_with_drcr_column" if drcr_col is not None else "single_amount"

    # 3. Iterate through data rows and extract outflow (expense/debit) transactions
    transactions: list[dict[str, Any]] = []
    skipped_inflows = 0

    for r_offset, row in enumerate(raw_rows[data_start_idx:]):
        actual_row_num = data_start_idx + r_offset + 1
        if desc_col >= len(row):
            continue

        raw_desc = str(row[desc_col] if row[desc_col] is not None else "").strip()
        if not raw_desc or len(raw_desc) < 2:
            continue

        # Skip repeated header rows or summary/total footer rows
        lower_desc = raw_desc.lower()
        if lower_desc in ("narration", "description", "particulars", "transaction details", "opening balance", "closing balance", "total", "grand total", "statement summary"):
            continue
        if lower_desc.startswith(("opening balance", "closing balance", "**end of statement", "this is a computer generated")):
            continue

        # Parse Date
        tx_date: date | None = None
        if date_col is not None and date_col < len(row):
            tx_date = try_parse_date(row[date_col])

        # Parse Outflow Amount according to discovered layout_mode
        outflow_amt: float | None = None

        if layout_mode == "separate_debit_credit" and debit_col is not None:
            raw_deb = row[debit_col] if debit_col < len(row) else None
            raw_cred = row[credit_col] if (credit_col is not None and credit_col < len(row)) else None
            deb_val, _ = try_parse_amount(raw_deb)
            cred_val, _ = try_parse_amount(raw_cred)

            if deb_val is not None and deb_val > 0:
                outflow_amt = deb_val
            elif cred_val is not None and cred_val > 0:
                skipped_inflows += 1
                continue
        elif amount_col is not None and amount_col < len(row):
            raw_amt = row[amount_col]
            amt_val, inline_drcr = try_parse_amount(raw_amt)
            if amt_val is None or amt_val <= 0:
                continue

            # Check explicit drcr_col if available
            col_drcr: str | None = None
            if drcr_col is not None and drcr_col < len(row) and row[drcr_col] is not None:
                flag_str = str(row[drcr_col]).strip().upper()
                if flag_str.startswith("D") or "DEBIT" in flag_str or "WITHDRAW" in flag_str:
                    col_drcr = "DR"
                elif flag_str.startswith("C") or "CREDIT" in flag_str or "DEPOSIT" in flag_str:
                    col_drcr = "CR"

            effective_drcr = col_drcr or inline_drcr
            if effective_drcr == "CR":
                skipped_inflows += 1
                continue

            # Also check if narration itself is clearly a salary/interest credit when no Dr/Cr flag exists
            if effective_drcr is None and re.search(r"\b(SALARY CREDIT|INTEREST CREDIT|DIVIDEND|REFUND|NEFT CR|IMPS CR|ACH CR)\b", raw_desc.upper()):
                skipped_inflows += 1
                continue

            outflow_amt = amt_val

        if outflow_amt is None or outflow_amt <= 0:
            continue

        month_key = tx_date.strftime("%Y-%m") if tx_date else "Unknown-Month"
        date_str = tx_date.strftime("%Y-%m-%d") if tx_date else "N/A"

        transactions.append(
            {
                "row_number": actual_row_num,
                "date": date_str,
                "month": month_key,
                "day": tx_date.day if tx_date else None,
                "description": re.sub(r"\s+", " ", raw_desc),
                "amount": round(float(outflow_amt), 2),
            }
        )

    discovered_schema = {
        "header_row_number": best_header_idx + 1 if has_explicit_headers else None,
        "layout_mode": layout_mode,
        "columns_discovered": {
            "date": header_row[date_col] if date_col is not None else "Not Present (Undated)",
            "description": header_row[desc_col],
            "debit_or_amount": (
                header_row[debit_col]
                if debit_col is not None
                else (header_row[amount_col] if amount_col is not None else None)
            ),
            "credit": header_row[credit_col] if credit_col is not None else None,
            "drcr_indicator": header_row[drcr_col] if drcr_col is not None else None,
            "balance_ignored": header_row[balance_col] if balance_col is not None else None,
        },
        "total_raw_rows": len(raw_rows),
        "extracted_debit_rows": len(transactions),
        "skipped_credit_rows": skipped_inflows,
    }

    return {
        "discovered_schema": discovered_schema,
        "transactions": transactions,
    }
