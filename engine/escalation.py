"""Escalation engine — pure function, no DB access.

compute_escalations(findings, claims, mappings, existing_escalations, people, as_of)
  -> list of new escalation dicts to create
"""

from datetime import date

LEVEL_ROLES = {
    1: "control_owner",
    2: "security_lead",
    3: "disclosure_committee",
    4: "audit_committee",
}


def _conflicted_ids(finding: dict, claim: dict | None, people: list[dict]) -> set[str]:
    """IDs of people who cannot handle this escalation due to conflict of interest."""
    ids = set()
    ids.add(finding.get("owner_id", ""))
    ids.add(finding.get("raised_by_id", ""))
    if claim:
        ids.add(claim.get("owner_id", ""))
    ids.discard("")
    return ids


def _assignee(level: int, conflicted: set[str], people: list[dict]) -> tuple[str | None, list[str]]:
    """Pick an assignee at the given level, skipping conflicted people.
    Returns (person_id or None, list of skipped person_ids).
    """
    role = LEVEL_ROLES.get(level)
    candidates = [p for p in people if p["role"] == role]
    skipped = []
    for p in candidates:
        if p["id"] in conflicted:
            skipped.append(p["id"])
        else:
            return p["id"], skipped
    # all conflicted — jump to next level
    return None, skipped


def compute_new_escalations(
    findings: list[dict],
    published_claim_control_ids: set[str],  # control IDs backing published claims
    claim_by_control: dict[str, dict],      # control_id -> claim dict (for owner conflict)
    existing_escalations: list[dict],       # current open escalation records
    people: list[dict],
    as_of: date,
) -> list[dict]:
    """Return list of new escalation dicts to create. Does not write to DB."""

    new_escalations = []

    # Index existing open escalations by (subject_id, requested_level).
    # Bumped escalations count toward the level they originated at, so
    # re-runs don't recreate them.
    existing = {
        (e["subject_id"], e.get("requested_level") or e["level"])
        for e in existing_escalations
        if e["status"] in ("OPEN", "ACK")
    }

    def needs(finding_id: str, level: int) -> bool:
        return (finding_id, level) not in existing

    for f in findings:
        if f["status"] != "OPEN":
            continue
        fid = f["id"]
        sev = f["severity"]
        opened = date.fromisoformat(str(f["opened_on"]))
        days_open = (as_of - opened).days
        on_published_claim = f["control_id"] in published_claim_control_ids
        claim = claim_by_control.get(f["control_id"])
        conflicted = _conflicted_ids(f, claim, people)

        if sev in ("HIGH", "CRITICAL"):
            # L1 + L2 immediately on open
            for level in (1, 2):
                if needs(fid, level):
                    assignee_id, skipped = _assignee(level, conflicted, people)
                    new_escalations.append(_make(fid, level, assignee_id, skipped, people,
                        f"High/Critical finding {fid} requires immediate attention.", as_of))

            # L3 at 30 days if backs published claim, else at 60 days
            l3_threshold = 30 if on_published_claim else 60
            if days_open >= l3_threshold and needs(fid, 3):
                assignee_id, skipped = _assignee(3, conflicted, people)
                new_escalations.append(_make(fid, 3, assignee_id, skipped, people,
                    f"Finding {fid} open {days_open} days" +
                    (" — backs a published claim" if on_published_claim else "") + ".", as_of))

            # L4 at 90 days
            if days_open >= 90 and needs(fid, 4):
                assignee_id, skipped = _assignee(4, conflicted, people)
                new_escalations.append(_make(fid, 4, assignee_id, skipped, people,
                    f"Finding {fid} open {days_open} days with no resolution — board-level escalation.", as_of))

        elif sev == "MEDIUM":
            # L3 at 90 days
            if days_open >= 90 and needs(fid, 3):
                assignee_id, skipped = _assignee(3, conflicted, people)
                new_escalations.append(_make(fid, 3, assignee_id, skipped, people,
                    f"Medium finding {fid} open {days_open} days.", as_of))

    # Unacknowledged 14-day auto-promote
    for esc in existing_escalations:
        if esc["status"] != "OPEN" or esc["acknowledged_on"]:
            continue
        created = date.fromisoformat(str(esc["created_on"]))
        if (as_of - created).days >= 14:
            next_level = min(esc["level"] + 1, 4)
            subject_id = esc["subject_id"]
            if (subject_id, next_level) not in existing:
                new_escalations.append({
                    "subject_type": esc["subject_type"],
                    "subject_id": subject_id,
                    "level": next_level,
                    "requested_level": next_level,
                    "assigned_to_role": LEVEL_ROLES[next_level],
                    "assigned_to_id": None,
                    "reason": f"Escalation at level {esc['level']} unacknowledged for 14 days — auto-promoted.",
                    "created_on": as_of,
                    "status": "OPEN",
                    "independence_skips": "[]",
                    "_supersedes": esc.get("id"),
                })

    return new_escalations


def _make(finding_id: str, level: int, assignee_id: str | None, skipped: list[str],
          people: list[dict], reason: str, as_of: date) -> dict:
    # If assignee_id is None (all conflicted), bump to next level
    actual_level = level
    if assignee_id is None and level < 4:
        actual_level = level + 1
        role = LEVEL_ROLES[actual_level]
        candidates = [p for p in people if p["role"] == role]
        assignee_id = candidates[0]["id"] if candidates else None
        reason += f" (independence_skip: all level-{level} candidates conflicted)"
    else:
        role = LEVEL_ROLES[actual_level]

    return {
        "subject_type": "finding",
        "subject_id": finding_id,
        "level": actual_level,
        "requested_level": level,
        "assigned_to_role": role,
        "assigned_to_id": assignee_id,
        "reason": reason,
        "created_on": as_of,
        "status": "OPEN",
        "independence_skips": str(skipped),
    }
