"""SLA calculations over state intervals.

uptime_pct(intervals, from_date, to_date, active_from, active_to)
    -> (uptime_pct, unknown_pct, active_days)

target_met(uptime_pct, unknown_pct, target_uptime, max_single_downtime_days, intervals, from_date, to_date)
    -> bool
"""

from datetime import date, timedelta
from typing import Any


def _days(start: date, end: date) -> int:
    """Inclusive day count."""
    return (end - start).days + 1


def _clamp(d: date, lo: date, hi: date) -> date:
    return max(lo, min(hi, d))


def uptime_pct(
    intervals: list[dict[str, Any]],
    from_date: date,
    to_date: date,
    active_from: date | None = None,
    active_to: date | None = None,
) -> tuple[float, float, int]:
    """Return (uptime_pct, unknown_pct, active_days).

    active_days = days within [from_date, to_date] where SCC version was ACTIVE/SUPERSEDED/DEPRECATED
    (i.e. not NOT_ACTIVE).

    uptime_pct  = upheld_days / active_days * 100  (0 if no active days)
    unknown_pct = unknown_days / active_days * 100
    """
    upheld = 0
    unknown = 0
    active_total = 0

    for iv in intervals:
        state = iv["state"]
        if state == "NOT_ACTIVE":
            continue
        iv_start: date = iv["start"]
        iv_end: date = iv.get("end") or to_date

        # Intersect with [from_date, to_date]
        lo = max(iv_start, from_date)
        hi = min(iv_end, to_date)
        if lo > hi:
            continue

        days = _days(lo, hi)
        active_total += days
        if state == "UPHELD":
            upheld += days
        elif state == "UNKNOWN":
            unknown += days

    if active_total == 0:
        return 0.0, 0.0, 0

    u_pct = round(upheld / active_total * 100, 4)
    unk_pct = round(unknown / active_total * 100, 4)
    return u_pct, unk_pct, active_total


def _longest_down_stretch(
    intervals: list[dict[str, Any]],
    from_date: date,
    to_date: date,
) -> int:
    """Return the length in days of the longest single DOWN stretch."""
    max_down = 0
    for iv in intervals:
        if iv["state"] != "DOWN":
            continue
        iv_start: date = iv["start"]
        iv_end: date = iv.get("end") or to_date
        lo = max(iv_start, from_date)
        hi = min(iv_end, to_date)
        if lo > hi:
            continue
        max_down = max(max_down, _days(lo, hi))
    return max_down


def target_met(
    uptime: float,
    unknown: float,
    target_uptime_pct: float,
    max_single_downtime_days: int,
    intervals: list[dict[str, Any]],
    from_date: date,
    to_date: date,
) -> bool:
    """Return True if the SCC met its SLA target.

    Fails if:
      - uptime_pct < target_uptime_pct
      - longest DOWN stretch > max_single_downtime_days
    UNKNOWN days count against uptime (conservative).
    """
    effective_uptime = uptime  # unknown already excluded from upheld days

    if effective_uptime < target_uptime_pct:
        return False

    if _longest_down_stretch(intervals, from_date, to_date) > max_single_downtime_days:
        return False

    return True


def rolling_target_met(
    intervals: list[dict[str, Any]],
    as_of: date,
    rolling_window_days: int,
    target_uptime_pct: float,
    max_single_downtime_days: int,
    active_from: date | None = None,
    active_to: date | None = None,
) -> tuple[bool, float, float]:
    """Check the rolling window ending on as_of.

    Returns (met, uptime_pct, unknown_pct).
    """
    window_start = as_of - timedelta(days=rolling_window_days - 1)
    if active_from:
        window_start = max(window_start, active_from)

    u_pct, unk_pct, active_days = uptime_pct(
        intervals, window_start, as_of, active_from, active_to
    )
    if active_days == 0:
        return False, 0.0, 0.0

    met = target_met(u_pct, unk_pct, target_uptime_pct,
                     max_single_downtime_days, intervals, window_start, as_of)
    return met, u_pct, unk_pct
