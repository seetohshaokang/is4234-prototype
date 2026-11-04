"""SCC state engine — rebuilds state intervals from first principles.

compute_intervals(sv_dict, controls, results_by_control, manual_ev,
                  pending_check_ids, as_of) -> list[dict]

Each dict: {state, start, end, detected_at, possibly_since, cause_note}
State precedence per day: DOWN > UNKNOWN > UPHELD.
Outside active window → NOT_ACTIVE.
"""

from datetime import date, timedelta
from typing import Any


# ── Day-state helpers ─────────────────────────────────────────────────────────

def _prev_month_start(d: date) -> date:
    """First day of the month before d."""
    if d.month == 1:
        return date(d.year - 1, 12, 1)
    return date(d.year, d.month - 1, 1)


def _last_valid_pass(results: list[dict], before: date) -> date | None:
    passes = [r["run_on"] for r in results
              if r["outcome"] == "PASS"
              and r.get("collector_approved_at_run")
              and r["run_on"] < before]
    return max(passes) if passes else None


def _day_state_for_control(
    ctl: dict,
    results: list[dict],
    manual_ev: list[dict],
    pending_check_ids: set[str],
    d: date,
    freq: int,
) -> str:
    """Return the state contribution of a single control on day d."""
    # Latest approved result on or before d
    approved_results = [
        r for r in results
        if r.get("collector_approved_at_run") and r["run_on"] <= d
    ]

    # Check if there is a PENDING collector for this check_id (at any point)
    if ctl.get("check_id") in pending_check_ids:
        # Only a problem if the pending collector is the latest submission
        # (services.py sets pending_check_ids to checks that have ANY pending collector)
        if not approved_results:
            return "UNKNOWN"

    if not approved_results:
        # Check manual evidence
        manual = [m for m in manual_ev
                  if m.get("control_id") == ctl["id"]
                  and m["valid_from"] <= d <= m["valid_until"]]
        if manual:
            return "UPHELD"
        return "UNKNOWN"

    latest = max(approved_results, key=lambda r: r["run_on"])

    # Stale check: more than freq+5 days since last run (5-day grace)
    if (d - latest["run_on"]).days > freq + 5:
        return "UNKNOWN"

    if latest["outcome"] == "FAIL":
        return "DOWN"

    return "UPHELD"


def _scc_state_on_day(
    controls: list[dict],
    results_by_control: dict[str, list[dict]],
    manual_ev: list[dict],
    pending_check_ids: set[str],
    d: date,
) -> str:
    """State precedence: DOWN > UNKNOWN > UPHELD."""
    if not controls:
        return "UNKNOWN"

    day_states = []
    for ctl in controls:
        freq = ctl.get("test_frequency_days", 30)
        results = results_by_control.get(ctl["id"], [])
        s = _day_state_for_control(ctl, results, manual_ev, pending_check_ids, d, freq)
        day_states.append(s)

    if "DOWN" in day_states:
        return "DOWN"
    if "UNKNOWN" in day_states:
        return "UNKNOWN"
    return "UPHELD"


# ── Main entry point ─────────────────────────────────────────────────────────

def compute_intervals(
    sv_dict: dict,
    controls: list[dict],
    results_by_control: dict[str, list[dict]],
    manual_ev: list[dict],
    pending_check_ids: set[str],
    as_of: date,
) -> list[dict[str, Any]]:
    """Rebuild state intervals for a single SCC version.

    Returns intervals as dicts:
      {state, start, end (None = ongoing), detected_at, possibly_since, cause_note}
    """
    active_from: date | None = sv_dict.get("active_from")
    active_to: date | None = sv_dict.get("active_to")

    if not active_from:
        # Version not yet active — single NOT_ACTIVE interval
        return [{
            "state": "NOT_ACTIVE",
            "start": date(2017, 1, 1),
            "end": as_of,
            "detected_at": None,
            "possibly_since": None,
            "cause_note": "Version not yet active",
        }]

    intervals: list[dict[str, Any]] = []

    # Period before active_from
    if active_from > date(2017, 1, 1):
        intervals.append({
            "state": "NOT_ACTIVE",
            "start": date(2017, 1, 1),
            "end": active_from - timedelta(days=1),
            "detected_at": None,
            "possibly_since": None,
            "cause_note": "Before activation",
        })

    window_end = active_to or as_of

    # Walk day by day accumulating state runs
    current_state: str | None = None
    current_start: date | None = None
    # For DOWN intervals: track detected_at and possibly_since
    down_detected: date | None = None
    down_possibly_since: date | None = None
    # For UNKNOWN intervals
    unknown_start: date | None = None

    d = active_from
    while d <= window_end:
        s = _scc_state_on_day(controls, results_by_control, manual_ev, pending_check_ids, d)

        if s != current_state:
            # Close previous interval
            if current_state is not None and current_start is not None:
                intervals.append(_make_interval(
                    current_state, current_start, d - timedelta(days=1),
                    down_detected, down_possibly_since, controls, results_by_control,
                ))

            # Open new interval
            if s == "DOWN":
                down_detected = d
                # possibly_since: last valid PASS before this day
                all_results = []
                for ctl_results in results_by_control.values():
                    all_results.extend(ctl_results)
                down_possibly_since = _last_valid_pass(all_results, d) or active_from
            elif s == "UNKNOWN":
                unknown_start = d
            else:
                down_detected = None
                down_possibly_since = None
                unknown_start = None

            current_state = s
            current_start = d

        d += timedelta(days=1)

    # Close final interval
    if current_state is not None and current_start is not None:
        end = None if active_to is None else window_end
        intervals.append(_make_interval(
            current_state, current_start, end,
            down_detected, down_possibly_since, controls, results_by_control,
        ))

    # Period after active_to (deprecated/superseded)
    if active_to is not None and active_to < as_of:
        intervals.append({
            "state": "NOT_ACTIVE",
            "start": active_to + timedelta(days=1),
            "end": as_of,
            "detected_at": None,
            "possibly_since": None,
            "cause_note": "Version no longer active (deprecated or superseded)",
        })

    return intervals


def _make_interval(
    state: str,
    start: date,
    end: date | None,
    detected_at: date | None,
    possibly_since: date | None,
    controls: list[dict],
    results_by_control: dict,
) -> dict[str, Any]:
    cause = None
    if state == "DOWN":
        failing = []
        for ctl in controls:
            results = results_by_control.get(ctl["id"], [])
            if results:
                latest = max(
                    [r for r in results if r["run_on"] <= (end or start)],
                    key=lambda r: r["run_on"],
                    default=None,
                )
                if latest and latest["outcome"] == "FAIL":
                    failing.append(ctl["id"])
        if failing:
            cause = f"Controls failing: {', '.join(failing)}"
    return {
        "state": state,
        "start": start,
        "end": end,
        "detected_at": detected_at if state == "DOWN" else None,
        "possibly_since": possibly_since if state == "DOWN" else None,
        "cause_note": cause,
    }
