"""Escalation engine — pure function, no DB access.

compute_new_escalations(sv_dict, interval_dicts, existing_escalations,
                        people, as_of, control_owner_ids) -> list[dict]

Returns new escalation dicts to persist. Does not write to DB.

Trigger rules:
  - SCC DOWN → L3 immediately (L1 also created for control_owner)
  - SCC UNKNOWN > 14 days → L2; if all L2 conflicted → L3 (independence skip)
  - Unacknowledged escalation 14 days old → promote one level
  - Rolling SLA missed (checked externally via trigger="sla_missed") → L4
"""

from datetime import date, timedelta
from typing import Any

LEVEL_ROLES = {
    1: "control_owner",
    2: "security_lead",
    3: "disclosure_committee",
    4: "audit_committee",
}


def _assignee(level: int, conflicted: set[str], people: list[dict]) -> tuple[str | None, list[str]]:
    role = LEVEL_ROLES.get(level)
    candidates = [p for p in people if p.get("role") == role]
    skipped: list[str] = []
    for p in candidates:
        if p["id"] in conflicted:
            skipped.append(p["id"])
        else:
            return p["id"], skipped
    return None, skipped


def _make_esc(trigger: str, level: int, assignee_id: str | None, skipped: list[str],
              people: list[dict], reason: str, as_of: date,
              requested_level: int | None = None,
              supersedes: int | None = None) -> dict:
    actual_level = level
    role = LEVEL_ROLES.get(actual_level, "audit_committee")
    if assignee_id is None and level < 4:
        actual_level = level + 1
        role = LEVEL_ROLES.get(actual_level, "audit_committee")
        candidates = [p for p in people if p.get("role") == role]
        assignee_id = candidates[0]["id"] if candidates else None
        reason += f" (skipped level {level}: all candidates conflicted)"
    return {
        "trigger": trigger,
        "level": actual_level,
        "requested_level": requested_level or level,
        "assigned_to_role": role,
        "assigned_to_id": assignee_id,
        "reason": reason,
        "independence_skips": skipped,
        "_supersedes": supersedes,
    }


def _current_state(interval_dicts: list[dict], as_of: date) -> str:
    """Return the state on as_of from the interval list."""
    for iv in interval_dicts:
        start: date = iv["start"] if isinstance(iv["start"], date) else date.fromisoformat(str(iv["start"]))
        end_raw = iv.get("end")
        end: date | None = None
        if end_raw:
            end = end_raw if isinstance(end_raw, date) else date.fromisoformat(str(end_raw))
        if start <= as_of and (end is None or end >= as_of):
            return iv["state"]
    return "UNKNOWN"


def _days_in_state(interval_dicts: list[dict], state: str, as_of: date) -> int:
    """Return days the SCC has been continuously in `state` up to as_of."""
    # Find the latest interval in that state ending on or after as_of
    # and contiguous with today
    total = 0
    # Walk backwards: find ongoing or most recent interval in that state
    for iv in reversed(interval_dicts):
        s = iv["state"]
        start: date = iv["start"] if isinstance(iv["start"], date) else date.fromisoformat(str(iv["start"]))
        end_raw = iv.get("end")
        end: date | None = None
        if end_raw:
            end = end_raw if isinstance(end_raw, date) else date.fromisoformat(str(end_raw))

        if s != state:
            if total > 0:
                break  # state chain broken
            continue

        if end is None or end >= as_of:
            # Interval covers today
            total += (as_of - start).days + 1
            # Keep going backwards if the previous interval is also in same state
        elif end == as_of - timedelta(days=1):
            total += (end - start).days + 1
        else:
            break

    return total


def compute_new_escalations(
    sv_dict: dict,
    interval_dicts: list[dict],
    existing_escalations: list[dict],
    people: list[dict],
    as_of: date,
    control_owner_ids: list[str] | None = None,
) -> list[dict]:
    """Return list of new escalation dicts to create."""

    sccversion_id: str = sv_dict["id"]
    scc_id: str = sv_dict.get("scc_id", "")
    scc_owner_id: str = sv_dict.get("owner_id", scc_id)

    # People who own the SCC (conflict of interest for independence)
    # Grant (P-MARCUS) owns every SCC → always conflicts at L1/L2
    conflicted: set[str] = {scc_owner_id}
    if control_owner_ids:
        conflicted.update(control_owner_ids)

    # Index existing open/ack escalations by (sccversion_id, trigger, level)
    existing_keys: set[tuple] = set()
    for e in existing_escalations:
        if e.get("status") in ("OPEN", "ACK") and e.get("sccversion_id") == sccversion_id:
            key = (sccversion_id, e.get("trigger", ""), e.get("requested_level") or e.get("level"))
            existing_keys.add(key)

    new_escs: list[dict] = []

    def already_exists(trigger: str, level: int) -> bool:
        return (sccversion_id, trigger, level) in existing_keys

    state = _current_state(interval_dicts, as_of)

    # ── Trigger: SCC DOWN ─────────────────────────────────────────────────────
    if state == "DOWN":
        # L1 → control owner (immediate)
        if not already_exists("scc_down", 1):
            aid, skipped = _assignee(1, conflicted, people)
            new_escs.append(_make_esc(
                "scc_down", 1, aid, skipped, people,
                f"{sccversion_id} has entered DOWN state. Immediate remediation required.",
                as_of, requested_level=1,
            ))

        # L3 → committee immediately (committee response required)
        if not already_exists("scc_down", 3):
            aid, skipped = _assignee(3, conflicted, people)
            new_escs.append(_make_esc(
                "scc_down", 3, aid, skipped, people,
                f"{sccversion_id} is DOWN — committee response required.",
                as_of, requested_level=3,
            ))

    # ── Trigger: SCC UNKNOWN > 14 days ───────────────────────────────────────
    if state == "UNKNOWN":
        unknown_days = _days_in_state(interval_dicts, "UNKNOWN", as_of)
        if unknown_days > 14 and not already_exists("scc_unknown_14d", 2):
            aid, skipped = _assignee(2, conflicted, people)
            if aid is None:
                # Grant is security_lead and owns every SCC → skip to L3
                aid, skipped2 = _assignee(3, conflicted, people)
                skipped += skipped2
                new_escs.append(_make_esc(
                    "scc_unknown_14d", 3, aid, skipped, people,
                    f"{sccversion_id} has been UNKNOWN for {unknown_days} days. "
                    f"L2 skipped (independence): escalating to committee.",
                    as_of, requested_level=2,
                ))
            else:
                new_escs.append(_make_esc(
                    "scc_unknown_14d", 2, aid, skipped, people,
                    f"{sccversion_id} has been UNKNOWN for {unknown_days} days.",
                    as_of, requested_level=2,
                ))

    # ── Auto-promote unacknowledged escalations after 14 days ───────────────
    for esc in existing_escalations:
        if esc.get("status") != "OPEN":
            continue
        if esc.get("sccversion_id") != sccversion_id:
            continue
        if esc.get("acknowledged_on"):
            continue
        created_raw = esc.get("created_on")
        if not created_raw:
            continue
        created = created_raw if isinstance(created_raw, date) else date.fromisoformat(str(created_raw))
        if (as_of - created).days < 14:
            continue
        current_level = esc.get("level", 1)
        next_level = min(current_level + 1, 4)
        trigger = esc.get("trigger", "unknown")
        if already_exists(trigger, next_level):
            continue
        aid, skipped = _assignee(next_level, conflicted, people)
        new_escs.append(_make_esc(
            trigger, next_level, aid, skipped, people,
            f"Escalation at L{current_level} unacknowledged for 14 days — auto-promoted.",
            as_of, requested_level=next_level,
            supersedes=esc.get("id"),
        ))

    return new_escs
