"""
System 1 Fast Associative Decision Model for Bank Statement Line Classification.

Evaluates each transaction line in microseconds by combining:
1. Weighted domain & category keyword associative cues
2. Payment rail structural prefixes (UPI, NACH/ACH, POS, BBPS, ATM/ATW, NEFT/IMPS)
3. Contextual magnitude & calendar-day intuition for ambiguous lines
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any


@dataclass(frozen=True)
class CategoryDefinition:
    id: str
    label: str
    color: str
    icon: str
    is_living_expense: bool = True


CATEGORIES: dict[str, CategoryDefinition] = {
    "groceries": CategoryDefinition(
        id="groceries",
        label="Groceries & Essentials",
        color="#10b981",
        icon="🛒",
        is_living_expense=True,
    ),
    "utilities": CategoryDefinition(
        id="utilities",
        label="Utilities, Bills & Wifi",
        color="#38bdf8",
        icon="⚡",
        is_living_expense=True,
    ),
    "rent": CategoryDefinition(
        id="rent",
        label="Rent & Maintenance",
        color="#6366f1",
        icon="🏠",
        is_living_expense=True,
    ),
    "emis": CategoryDefinition(
        id="emis",
        label="EMIs & Loan Repayments",
        color="#f43f5e",
        icon="🏦",
        is_living_expense=True,
    ),
    "dining": CategoryDefinition(
        id="dining",
        label="Dining & Food Delivery",
        color="#f59e0b",
        icon="🍽️",
        is_living_expense=True,
    ),
    "transport": CategoryDefinition(
        id="transport",
        label="Transport, Fuel & Travel",
        color="#a855f7",
        icon="🚗",
        is_living_expense=True,
    ),
    "shopping": CategoryDefinition(
        id="shopping",
        label="Shopping & Lifestyle",
        color="#ec4899",
        icon="🛍️",
        is_living_expense=True,
    ),
    "healthcare": CategoryDefinition(
        id="healthcare",
        label="Healthcare & Fitness",
        color="#14b8a6",
        icon="🩺",
        is_living_expense=True,
    ),
    "subscriptions": CategoryDefinition(
        id="subscriptions",
        label="Subscriptions & Insurance",
        color="#8b5cf6",
        icon="📺",
        is_living_expense=True,
    ),
    "investments": CategoryDefinition(
        id="investments",
        label="Investments & SIPs",
        color="#22c55e",
        icon="📈",
        is_living_expense=False,
    ),
    "other": CategoryDefinition(
        id="other",
        label="Cash, Transfers & Misc",
        color="#64748b",
        icon="💸",
        is_living_expense=True,
    ),
}


# Weighted associative cues: list of (pattern_regex, weight, cue_label) per category
# Uses generic functional and domain keywords without any specific company, brand, or person names.
ASSOCIATIVE_LEXICON: dict[str, list[tuple[re.Pattern[str], float, str]]] = {
    "groceries": [
        (
            re.compile(
                r"\b(SUPERMARKET|HYPERMARKET|GROCERY|GROCERIES|PROVISION|KIRANA|DEPARTMENTAL STORE|DAILY NEEDS|FRESH MART|FOOD MART)\b"
            ),
            9.5,
            "Supermarket / Grocery Store",
        ),
        (
            re.compile(
                r"\b(VEGETABLE|VEGETABLES|FRUITS|DAIRY|MILK|ORGANIC|MEAT|POULTRY|PRODUCE|BAKERY GOODS|HOUSEHOLD ESSENTIALS)\b"
            ),
            8.5,
            "Fresh Produce / Dairy / Essentials",
        ),
    ],
    "utilities": [
        (
            re.compile(
                r"\b(ELECTRICITY|POWER BILL|ELECTRIC BILL|ENERGY BILL|WATER BILL|MUNICIPAL WATER|SEWAGE BILL)\b"
            ),
            9.5,
            "Electricity / Water Utility",
        ),
        (
            re.compile(
                r"\b(BROADBAND|INTERNET BILL|WIFI|FIBER NET|TELECOM|MOBILE BILL|POSTPAID|PREPAID|RECHARGE|LANDLINE|DTH|CABLE TV)\b"
            ),
            9.0,
            "Telecom / Broadband / DTH",
        ),
        (
            re.compile(
                r"\b(PIPED GAS|GAS BILL|LPG|COOKING GAS|GAS CYLINDER|BBPS|UTILITY BILL|UTILITY PAYMENT)\b"
            ),
            9.0,
            "Gas / Utility Bill Payment",
        ),
    ],
    "rent": [
        (
            re.compile(
                r"\b(HOUSE RENT|FLAT RENT|MONTHLY RENT|APARTMENT RENT|RESIDENTIAL RENT|RENTAL PAYMENT|LANDLORD|LEASE RENT)\b"
            ),
            9.5,
            "Residential Rent Payment",
        ),
        (
            re.compile(
                r"\b(SOCIETY MAINT|MAINTENANCE BILL|APARTMENT MAINT|BUILDING MAINT|HOA|RWA|HOUSEHOLD HELP|DOMESTIC HELP)\b"
            ),
            8.8,
            "Society Maintenance / Household Services",
        ),
        (re.compile(r"\b(RENT)\b"), 8.0, "Rent Keyword"),
    ],
    "emis": [
        (
            re.compile(
                r"\b(HOME LOAN|HOUSING LOAN|MORTGAGE|CAR LOAN|AUTO LOAN|VEHICLE LOAN|PERSONAL LOAN|EDUCATION LOAN|LOAN EMI|EMI/|/EMI|EQUATED MONTHLY)\b"
            ),
            9.8,
            "Loan EMI Repayment",
        ),
        (
            re.compile(
                r"\b(NACH[-/ ]?DR|ACH[-/ ]?D|ECS[-/ ]?DR|LOAN REPAY|LOAN INSTALLMENT|EMI)\b"
            ),
            8.5,
            "Automated Loan Mandate (NACH/ACH)",
        ),
    ],
    "dining": [
        (
            re.compile(
                r"\b(FOOD DELIVERY|FOOD ORDER|ONLINE FOOD|MEAL DELIVERY|DINNER ORDER|LUNCH ORDER)\b"
            ),
            9.2,
            "Food Delivery / Meal Order",
        ),
        (
            re.compile(
                r"\b(RESTAURANT|CAFE|COFFEE SHOP|BISTRO|DINER|EATERY|BAKERY|PIZZERIA|DINING|RESTO|BAR & KITCHEN|BREWERY|CANTEEN|CATERING|SNACKS|SWEET SHOP)\b"
            ),
            8.5,
            "Restaurant / Cafe / Dining",
        ),
    ],
    "transport": [
        (
            re.compile(
                r"\b(CAB RIDE|TAXI|RIDE HAILING|AIRPORT CAB|AUTO RICKSHAW|COMMUTE RIDE|CAR RENTAL|CITY RIDE)\b"
            ),
            9.2,
            "Cab / Ride Commute",
        ),
        (
            re.compile(
                r"\b(PETROL|DIESEL|FUEL|PETROL PUMP|FILLING STATION|SERVICE STATION|EV CHARGING|AUTO CARE|VEHICLE SERVICE)\b"
            ),
            9.2,
            "Fuel / Service Station",
        ),
        (
            re.compile(
                r"\b(FASTAG|HIGHWAY TOLL|TOLL PLAZA|PARKING|METRO RAIL|CITY BUS|RAILWAY TICKET|TRAIN TICKET|AIRLINE TICKET|FLIGHT BOOKING|BUS TICKET|TRANSIT)\b"
            ),
            9.0,
            "Transit / Toll / Travel",
        ),
    ],
    "shopping": [
        (
            re.compile(
                r"\b(ONLINE SHOPPING|E-COMMERCE|MARKETPLACE ORDER|RETAIL STORE|SHOPPING MALL|DEPARTMENT STORE)\b"
            ),
            9.2,
            "Retail / Online Shopping",
        ),
        (
            re.compile(
                r"\b(ELECTRONICS|APPLIANCES|HOME DECOR|FURNITURE|FURNISHING|KITCHENWARE|GADGETS)\b"
            ),
            9.0,
            "Electronics / Home Retail",
        ),
        (
            re.compile(
                r"\b(APPAREL|CLOTHING|GARMENTS|FASHION|FOOTWEAR|JEWELLERY|OPTICALS|COSMETICS|PERSONAL CARE|SALON|SPA|GROOMING|SHOPPING)\b"
            ),
            8.8,
            "Apparel / Lifestyle / Personal Care",
        ),
    ],
    "healthcare": [
        (
            re.compile(
                r"\b(PHARMACY|MEDICAL STORE|CHEMIST|DRUG STORE|MEDICINES|PRESCRIPTION|PHARMA)\b"
            ),
            9.5,
            "Pharmacy / Medicines",
        ),
        (
            re.compile(
                r"\b(HOSPITAL|MEDICAL CENTER|CLINIC|NURSING HOME|POLYCLINIC|DENTAL CARE|EYE CARE|ORTHO|PHYSIOTHERAPY|HEALTH CHECKUP)\b"
            ),
            9.2,
            "Hospital / Clinic",
        ),
        (
            re.compile(
                r"\b(DIAGNOSTICS|PATHOLOGY|LAB TEST|BLOOD TEST|RADIOLOGY|HEALTHCARE|FITNESS CENTER|GYM|YOGA STUDIO|WELLNESS)\b"
            ),
            8.5,
            "Diagnostics / Healthcare / Fitness",
        ),
    ],
    "subscriptions": [
        (
            re.compile(
                r"\b(STREAMING|DIGITAL SUBSCRIPTION|VIDEO SUBSCRIPTION|MUSIC SUBSCRIPTION|CLOUD STORAGE|SOFTWARE SUBSCRIPTION|MEMBERSHIP FEE|MAGAZINE|NEWSPAPER|MOVIE TICKET|CINEMA)\b"
            ),
            9.2,
            "Digital Subscription / Membership",
        ),
        (
            re.compile(
                r"\b(LIFE INSURANCE|HEALTH INSURANCE|MEDICAL INSURANCE|TERM INSURANCE|MOTOR INSURANCE|INSURANCE PREMIUM|POLICY RENEWAL|SUBSCRIPTION)\b"
            ),
            9.0,
            "Insurance Premium / Subscription",
        ),
    ],
    "investments": [
        (
            re.compile(
                r"\b(MUTUAL FUND|MF SIP|SIP/|/SIP|SYSTEMATIC INVESTMENT|EQUITY SIP|INDEX FUND|BROKERAGE|SECURITIES|DEMAT|STOCK BROKER)\b"
            ),
            9.8,
            "Mutual Fund SIP / Securities Investment",
        ),
        (
            re.compile(
                r"\b(CLEARING CORP|DEPOSITORY|PROVIDENT FUND|PPF|EPF|NPS|PENSION FUND|SOVEREIGN GOLD|FIXED DEPOSIT|FD BOOKING|RD INSTALLMENT|RECURRING DEPOSIT|INVESTMENT)\b"
            ),
            9.8,
            "Clearing / Deposit / Retirement Contribution",
        ),
    ],
}


def classify_transaction_system1(
    description: str,
    amount: float,
    day_of_month: int | None = None,
    recurring_amount_count: int = 1,
) -> dict[str, Any]:
    """
    Execute the System 1 fast associative decision model on a single transaction line.

    Returns category_id, category_label, confidence (0.0-1.0), matched_cue, and is_living_expense.
    """
    upper_desc = (description or "").upper().strip()

    # 1. Evaluate all associative lexicon rules in parallel
    best_cat = "other"
    best_score = 0.0
    best_cue = "General / Unclassified Outflow"

    for cat_id, rules in ASSOCIATIVE_LEXICON.items():
        for regex, weight, cue_label in rules:
            match = regex.search(upper_desc)
            if match:
                span_len = match.end() - match.start()
                score = weight + min(0.8, span_len * 0.04)
                if score > best_score:
                    best_score = score
                    best_cat = cat_id
                    best_cue = cue_label

    # 2. If a strong associative match was triggered, return immediately (System 1 recognition)
    if best_score >= 7.0:
        cat_def = CATEGORIES[best_cat]
        confidence = min(0.99, round(0.75 + (best_score - 7.0) * 0.08, 2))
        return {
            "category_id": cat_def.id,
            "category_label": cat_def.label,
            "confidence": confidence,
            "matched_cue": best_cue,
            "is_living_expense": cat_def.is_living_expense,
        }

    # 3. System 1 Contextual & Magnitude Heuristics for ambiguous narrations (P2P UPI, NEFT, IMPS, ATM)
    # 3a. ATM / Cash Withdrawal
    if re.search(r"\b(ATM|ATW|CASH WDL|CASH WITHDRAWAL|NFS/|SELF CHQ)\b", upper_desc):
        cat_def = CATEGORIES["other"]
        return {
            "category_id": cat_def.id,
            "category_label": cat_def.label,
            "confidence": 0.90,
            "matched_cue": "ATM / Cash Withdrawal",
            "is_living_expense": True,
        }

    # 3b. Ambiguous recurring monthly transfer in the 1st-10th of the month for ₹8,000 - ₹1,50,000 -> Rent / Maintenance intuition
    if (
        8000 <= amount <= 150000
        and amount % 500 == 0
        and ((day_of_month is not None and 1 <= day_of_month <= 10) or recurring_amount_count >= 2)
        and re.search(r"\b(NEFT|IMPS|RTGS|UPI|FT|TRANSFER)\b", upper_desc)
    ):
        cat_def = CATEGORIES["rent"]
        return {
            "category_id": cat_def.id,
            "category_label": cat_def.label,
            "confidence": 0.72,
            "matched_cue": "System 1 Heuristic: Recurring Early-Month Round Transfer (Likely Rent)",
            "is_living_expense": True,
        }

    # 3c. Ambiguous recurring fixed amount on ACH / NACH / SI -> EMI or Subscription intuition
    if re.search(r"\b(SI-|STANDING INST|MANDATE|AUTO DEBIT)\b", upper_desc):
        target_cat = "emis" if amount >= 2500 else "subscriptions"
        cat_def = CATEGORIES[target_cat]
        return {
            "category_id": cat_def.id,
            "category_label": cat_def.label,
            "confidence": 0.70,
            "matched_cue": "System 1 Heuristic: Standing Instruction / Mandate",
            "is_living_expense": True,
        }

    # 3d. Small everyday UPI QR payments (<= ₹350) -> Daily Essentials / Groceries
    if "UPI" in upper_desc and amount <= 350:
        cat_def = CATEGORIES["groceries"]
        return {
            "category_id": cat_def.id,
            "category_label": cat_def.label,
            "confidence": 0.64,
            "matched_cue": "System 1 Heuristic: Small Everyday UPI Merchant Payment",
            "is_living_expense": True,
        }

    # Default fallback: Miscellaneous / Transfers
    cat_def = CATEGORIES["other"]
    return {
        "category_id": cat_def.id,
        "category_label": cat_def.label,
        "confidence": 0.55,
        "matched_cue": best_cue,
        "is_living_expense": True,
    }
