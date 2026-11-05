"""Orchestration layer: coordinates DB, engine, and audit log."""

import json
from datetime import date, timedelta
from pathlib import Path

from sqlmodel import Session, select

from db import (
    get_session, SimClock,
    CheckDefinition, Collector, CollectorStatus,
    Control, SCC, SCCVersion, SCCVersionStatus, SCCVersionControl, EvidenceType,
    TestResult, TestOutcome,
    Finding, FindingSeverity, FindingStatus,
    StateInterval, SCCState,
    Escalation, EscalationStatus,
    CommitteeResponse, CommitteeDecision,
    ChangeRequest, ChangeRequestType, ChangeRequestStatus,
    IssuedCitation,
    ManualEvidence, AuditEvent, CheckpointApplied, Person, Role,
)
from engine.collectors import get_raw_data
from engine.checks import run_check, infer_severity
from audit import append_event

SNAP_DIR = Path("data/snapshots")


# ── Clock ─────────────────────────────────────────────────────────────────────

def get_clock(session: Session) -> date:
    clock = session.exec(select(SimClock)).first()
    return clock.current_date if clock else date(2017, 11, 15)


def set_clock(session: Session, new_date: date, actor_id: str = "SYSTEM") -> date:
    clock = session.exec(select(SimClock)).first()
    old = clock.current_date if clock else new_date
    if clock:
        clock.current_date = new_date
    else:
        clock = SimClock(current_date=new_date)
        session.add(clock)
    session.flush()
    append_event(session, new_date, actor_id, "clock_set", "sim_clock", str(new_date),
                 {"from": str(old), "to": str(new_date)})
    session.commit()
    return new_date


def advance_clock(session: Session, days: int, actor_id: str = "SYSTEM") -> date:
    current = get_clock(session)
    new_date = current + timedelta(days=days)
    return _advance_to(session, new_date, actor_id)


def _advance_to(session: Session, new_date: date, actor_id: str = "SYSTEM") -> date:
    set_clock(session, new_date, actor_id)
    check_pending_deprecations(session, new_date, actor_id)
    run_due_checks(session, new_date, actor_id)
    rebuild_all_intervals(session, new_date)
    return new_date


# ── Check runs ────────────────────────────────────────────────────────────────

def _latest_collector(session: Session, check_id: str, as_of: date) -> Collector | None:
    cols = list(session.exec(
        select(Collector).where(Collector.check_id == check_id)
    ).all())
    approved = [c for c in cols if c.status == CollectorStatus.APPROVED
                and c.approved_on and c.approved_on <= as_of]
    return max(approved, key=lambda c: c.approved_on) if approved else None


def _get_check_def(session: Session, check_id: str, check_version: str) -> CheckDefinition | None:
    return session.get(CheckDefinition, (check_id, check_version))


def _last_run_date(session: Session, control_id: str) -> date | None:
    r = session.exec(
        select(TestResult).where(TestResult.control_id == control_id)
        .order_by(TestResult.run_on.desc())  # type: ignore[attr-defined]
    ).first()
    return r.run_on if r else None


def run_due_checks(session: Session, as_of: date, actor_id: str = "SYSTEM") -> list[TestResult]:
    """Run every scheduled check for every control up to as_of, in chronological order."""
    controls = list(session.exec(select(Control)).all())
    all_results = []

    # Collect (control, run_date) pairs across all controls, then sort
    runs: list[tuple[Control, date]] = []
    for ctl in controls:
        if not ctl.check_id:
            continue
        # Find the check definition (use latest version pinned by any active SCC)
        check_version = _pinned_check_version(session, ctl.id) or "1"
        check_def = _get_check_def(session, ctl.check_id, check_version)
        if not check_def:
            continue

        freq = check_def.test_frequency_days
        last_run = _last_run_date(session, ctl.id)

        # First run: start from the date the first active SCC version using this control became active
        first_active = _first_active_date(session, ctl.id)
        if first_active is None:
            continue

        next_run = (last_run + timedelta(days=freq)) if last_run else first_active
        while next_run <= as_of:
            runs.append((ctl, next_run))
            next_run += timedelta(days=freq)

    runs.sort(key=lambda x: x[1])

    for ctl, run_date in runs:
        check_version = _pinned_check_version(session, ctl.id) or "1"
        result = _run_single_check(session, ctl, check_version, run_date, actor_id)
        if result:
            all_results.append(result)

    if all_results:
        session.commit()
    return all_results


def _first_active_date(session: Session, control_id: str) -> date | None:
    """Return the earliest active_from across all SCC versions that pin this control."""
    maps = list(session.exec(
        select(SCCVersionControl).where(SCCVersionControl.control_id == control_id)
    ).all())
    dates = []
    for m in maps:
        sv = session.get(SCCVersion, m.sccversion_id)
        if sv and sv.status in (SCCVersionStatus.ACTIVE, SCCVersionStatus.SUPERSEDED, SCCVersionStatus.DEPRECATED) and sv.active_from:
            dates.append(sv.active_from)
    return min(dates) if dates else None


def _pinned_check_version(session: Session, control_id: str) -> str | None:
    """Return the check_version pinned by the most recent active SCC version for this control."""
    maps = list(session.exec(
        select(SCCVersionControl).where(SCCVersionControl.control_id == control_id)
    ).all())
    best_version = None
    best_from = None
    for m in maps:
        sv = session.get(SCCVersion, m.sccversion_id)
        if sv and sv.status == SCCVersionStatus.ACTIVE and sv.active_from:
            if best_from is None or sv.active_from > best_from:
                best_from = sv.active_from
                best_version = m.check_version
    return best_version


def _run_single_check(session: Session, ctl: Control, check_version: str,
                      run_date: date, actor_id: str) -> TestResult | None:
    collector = _latest_collector(session, ctl.check_id, run_date)
    collector_approved = collector is not None and collector.status == CollectorStatus.APPROVED

    # If no approved collector exists at run time, skip (SCC will be UNKNOWN)
    # We still record the attempt so the interval engine knows there was no valid evidence
    if not collector_approved:
        return None

    check_def = _get_check_def(session, ctl.check_id, check_version)
    params = json.loads(check_def.params) if check_def and check_def.params else {}

    raw = get_raw_data(ctl.check_id, run_date)
    outcome_str, measured, summary = run_check(ctl.check_id, check_version, raw, params, as_of=run_date)

    snap_dirs = sorted([d.name for d in SNAP_DIR.iterdir() if d.is_dir() and d.name <= str(run_date)])
    snap_date = snap_dirs[-1] if snap_dirs else str(run_date)

    result = TestResult(
        control_id=ctl.id,
        check_id=ctl.check_id,
        check_version=check_version,
        collector_id=collector.id,
        collector_approved_at_run=True,
        run_on=run_date,
        snapshot_date=snap_date,
        outcome=TestOutcome(outcome_str),
        measured_value=json.dumps(measured) if measured is not None else None,
        evidence_summary=summary,
    )
    session.add(result)
    session.flush()

    append_event(session, run_date, actor_id, "check_run", "testresult", str(result.id),
                 {"control_id": ctl.id, "check_id": ctl.check_id,
                  "check_version": check_version, "outcome": outcome_str})

    # Auto-open finding on FAIL if no open finding for this control
    if outcome_str == "FAIL":
        existing = session.exec(
            select(Finding).where(
                Finding.control_id == ctl.id,
                Finding.status == FindingStatus.OPEN,
            )
        ).first()
        if not existing:
            _auto_open_finding(session, ctl, outcome_str, measured, summary, run_date, actor_id)

    # Auto-close open finding on PASS
    elif outcome_str == "PASS":
        open_finding = session.exec(
            select(Finding).where(
                Finding.control_id == ctl.id,
                Finding.status == FindingStatus.OPEN,
            )
        ).first()
        if open_finding:
            open_finding.status = FindingStatus.CLOSED
            open_finding.closed_on = run_date
            session.add(open_finding)
            append_event(session, run_date, "SYSTEM", "finding_closed", "finding",
                         open_finding.id, {"reason": "check_passed"})

    return result


def _auto_open_finding(session: Session, ctl: Control, outcome: str, measured,
                       summary: str, as_of: date, actor_id: str) -> Finding:
    sev = infer_severity(ctl.check_id, _pinned_check_version(session, ctl.id) or "1",
                         outcome, measured if isinstance(measured, dict) else {})
    count = session.exec(select(Finding)).all()
    fid = f"CASE_{as_of.year}_{len(list(count)) + 1:03d}"
    f = Finding(
        id=fid,
        control_id=ctl.id,
        severity=FindingSeverity(sev),
        status=FindingStatus.OPEN,
        opened_on=as_of,
        source="automated_check",
        title=f"Check failure: {ctl.name}",
        description=summary,
    )
    session.add(f)
    session.flush()
    append_event(session, as_of, actor_id, "finding_opened", "finding", fid,
                 {"control_id": ctl.id, "severity": sev, "auto": True})
    return f


# ── SCC state intervals ───────────────────────────────────────────────────────

def rebuild_all_intervals(session: Session, as_of: date) -> None:
    from engine.scc_state import compute_intervals as _compute
    scc_versions = list(session.exec(
        select(SCCVersion).where(SCCVersion.status.in_([  # type: ignore[attr-defined]
            SCCVersionStatus.ACTIVE, SCCVersionStatus.SUPERSEDED, SCCVersionStatus.DEPRECATED
        ]))
    ).all())
    for sv in scc_versions:
        _rebuild_intervals_for_version(session, sv, as_of, _compute)
    session.commit()


def _rebuild_intervals_for_version(session: Session, sv: SCCVersion, as_of: date, compute_fn) -> None:
    maps = list(session.exec(
        select(SCCVersionControl).where(SCCVersionControl.sccversion_id == sv.id)
    ).all())

    controls = []
    results_by_control = {}
    for m in maps:
        ctl = session.get(Control, m.control_id)
        if not ctl:
            continue
        controls.append({"id": ctl.id, "check_id": ctl.check_id,
                         "check_version": m.check_version,
                         "test_frequency_days": _get_check_def(session, ctl.check_id, m.check_version).test_frequency_days
                         if _get_check_def(session, ctl.check_id, m.check_version) else 30})
        results_by_control[ctl.id] = [
            {"run_on": r.run_on, "outcome": r.outcome,
             "collector_approved_at_run": r.collector_approved_at_run,
             "check_version": r.check_version}
            for r in session.exec(
                select(TestResult).where(TestResult.control_id == ctl.id)
                .order_by(TestResult.run_on)  # type: ignore[attr-defined]
            ).all()
        ]

    manual_ev = [
        {"control_id": m.control_id, "valid_from": me.valid_from, "valid_until": me.valid_until}
        for m in maps
        for me in session.exec(
            select(ManualEvidence).where(ManualEvidence.control_id == m.control_id)
        ).all()
    ]

    # Pending collector check (current status at as_of)
    pending_check_ids = set()
    for m in maps:
        ctl = session.get(Control, m.control_id)
        if not ctl:
            continue
        latest_col = _latest_collector(session, ctl.check_id, as_of)
        # Check if there's a newer PENDING collector after the last APPROVED one
        all_cols = list(session.exec(
            select(Collector).where(Collector.check_id == ctl.check_id)
        ).all())
        pending = [c for c in all_cols if c.status == CollectorStatus.PENDING]
        if pending:
            pending_check_ids.add(ctl.check_id)

    sv_dict = {
        "id": sv.id, "active_from": sv.active_from, "active_to": sv.active_to,
        "evidence_type": sv.evidence_type,
    }

    new_intervals = compute_fn(sv_dict, controls, results_by_control,
                               manual_ev, pending_check_ids, as_of)

    # Delete old intervals and replace
    old = list(session.exec(
        select(StateInterval).where(StateInterval.sccversion_id == sv.id)
    ).all())
    for o in old:
        session.delete(o)
    session.flush()

    for iv in new_intervals:
        session.add(StateInterval(
            sccversion_id=sv.id,
            state=SCCState(iv["state"]),
            start=iv["start"],
            end=iv.get("end"),
            detected_at=iv.get("detected_at"),
            possibly_since=iv.get("possibly_since"),
            cause_note=iv.get("cause_note"),
        ))
    session.flush()


# ── Escalation engine ────────────────────────────────────────────────────────

LEVEL_ROLES = {
    1: Role.CONTROL_OWNER,
    2: Role.SECURITY_LEAD,
    3: Role.DISCLOSURE_COMMITTEE,
}

LEVEL_REASONS = {
    1: "Case picked up — control owner begins remediation",
    2: "Escalated to security lead for review",
    3: "Escalated to disclosure committee for formal decision",
}


def escalate_case(session: Session, finding_id: str, level: int, actor_id: str) -> Escalation:
    as_of = get_clock(session)
    f = session.get(Finding, finding_id)
    if not f:
        raise ValueError(f"Case {finding_id} not found")
    if level not in LEVEL_ROLES:
        raise ValueError("Level must be 1, 2, or 3")
    # Supersede prior live demands — a case holds one open escalation at a
    # time; the closed list records the climb.
    for prev in session.exec(
        select(Escalation).where(
            Escalation.finding_id == finding_id,
            Escalation.status.in_([EscalationStatus.OPEN, EscalationStatus.ACK]),  # type: ignore[attr-defined]
        )
    ).all():
        prev.status = EscalationStatus.RESOLVED
        prev.resolved_on = as_of
        session.add(prev)
        append_event(session, as_of, actor_id, "escalation_resolved", "escalation",
                     str(prev.id), {"finding_id": finding_id, "reason": "superseded"})
    esc = Escalation(
        finding_id=finding_id,
        level=level,
        assigned_to_role=LEVEL_ROLES[level],
        reason=LEVEL_REASONS[level],
        created_on=as_of,
        status=EscalationStatus.OPEN,
    )
    session.add(esc)
    f.level = level
    session.add(f)
    session.flush()
    append_event(session, as_of, actor_id, "escalation_created", "escalation",
                 str(esc.id), {"finding_id": finding_id, "level": level})
    session.commit()
    return esc


# ── Escalation actions ────────────────────────────────────────────────────────

def ack_escalation(session: Session, esc_id: int, actor_id: str) -> Escalation:
    as_of = get_clock(session)
    esc = session.get(Escalation, esc_id)
    if not esc:
        raise ValueError(f"Escalation {esc_id} not found")
    esc.status = EscalationStatus.ACK
    esc.acknowledged_on = as_of
    session.add(esc)
    append_event(session, as_of, actor_id, "escalation_acked", "escalation", str(esc_id), {})
    session.commit()
    return esc


def resolve_escalation(session: Session, esc_id: int, actor_id: str) -> Escalation:
    as_of = get_clock(session)
    esc = session.get(Escalation, esc_id)
    if not esc:
        raise ValueError(f"Escalation {esc_id} not found")
    esc.status = EscalationStatus.RESOLVED
    esc.resolved_on = as_of
    session.add(esc)
    append_event(session, as_of, actor_id, "escalation_resolved", "escalation", str(esc_id), {})
    session.commit()
    return esc


def respond_escalation(session: Session, esc_id: int, actor_id: str,
                       decision: str, rationale: str, due_on: date | None = None) -> CommitteeResponse:
    if len(rationale) < 50:
        raise ValueError("Rationale must be at least 50 characters.")
    as_of = get_clock(session)
    esc = session.get(Escalation, esc_id)
    if not esc:
        raise ValueError(f"Escalation {esc_id} not found")
    resp = CommitteeResponse(
        escalation_id=esc_id,
        decision=CommitteeDecision(decision),
        rationale=rationale,
        due_on=due_on,
        decided_by=actor_id,
        decided_on=as_of,
    )
    session.add(resp)
    esc.status = EscalationStatus.RESOLVED
    esc.resolved_on = as_of
    session.add(esc)
    session.flush()
    append_event(session, as_of, actor_id, "committee_response", "escalation", str(esc_id),
                 {"decision": decision, "finding_id": esc.finding_id})
    session.commit()
    return resp


# ── Change requests ───────────────────────────────────────────────────────────

def create_change_request(session: Session, cr_type: str, scc_id: str,
                          requested_by: str, reason: str,
                          proposal: dict | None = None) -> ChangeRequest:
    as_of = get_clock(session)
    requester = session.get(Person, requested_by)
    if not requester or requester.role != Role.SECURITY_LEAD:
        raise ValueError("Only security_lead may submit change requests.")
    count = len(list(session.exec(select(ChangeRequest)).all())) + 1
    cr = ChangeRequest(
        id=f"CR-{as_of.year}-{count:03d}",
        type=ChangeRequestType(cr_type),
        scc_id=scc_id,
        requested_by=requested_by,
        requested_on=as_of,
        reason=reason,
        proposal=json.dumps(proposal) if proposal else None,
    )
    session.add(cr)
    session.flush()
    append_event(session, as_of, requested_by, "change_request_submitted",
                 "changerequest", cr.id, {"type": cr_type, "scc_id": scc_id})
    session.commit()
    return cr


def approve_change_request(session: Session, cr_id: str, actor_id: str,
                            auditor_note: str = "", **kwargs) -> ChangeRequest:
    as_of = get_clock(session)
    approver = session.get(Person, actor_id)
    if not approver or approver.role != Role.INDEPENDENT_AUDITOR:
        raise ValueError("Only independent_auditor may approve change requests.")
    cr = session.get(ChangeRequest, cr_id)
    if not cr:
        raise ValueError(f"Change request {cr_id} not found")
    cr.status = ChangeRequestStatus.APPROVED
    cr.decided_by = actor_id
    cr.decided_on = as_of
    cr.auditor_note = auditor_note
    session.add(cr)
    session.flush()

    if cr.type == ChangeRequestType.CREATE:
        _apply_create(session, cr, as_of, actor_id, **kwargs)
    elif cr.type == ChangeRequestType.REEVALUATE:
        _apply_reevaluate(session, cr, as_of, actor_id, **kwargs)
    elif cr.type == ChangeRequestType.DEPRECATE:
        effective_on = kwargs.get("effective_on", as_of)
        _apply_deprecate(session, cr, as_of, effective_on, actor_id)

    append_event(session, as_of, actor_id, "change_request_approved",
                 "changerequest", cr_id, {"type": cr.type, "scc_id": cr.scc_id})
    session.commit()
    return cr


def reject_change_request(session: Session, cr_id: str, actor_id: str, auditor_note: str) -> ChangeRequest:
    as_of = get_clock(session)
    approver = session.get(Person, actor_id)
    if not approver or approver.role != Role.INDEPENDENT_AUDITOR:
        raise ValueError("Only independent_auditor may reject change requests.")
    cr = session.get(ChangeRequest, cr_id)
    if not cr:
        raise ValueError(f"Change request {cr_id} not found")
    cr.status = ChangeRequestStatus.REJECTED
    cr.decided_by = actor_id
    cr.decided_on = as_of
    cr.auditor_note = auditor_note
    if cr.type == ChangeRequestType.CREATE:
        # Mark SCC version as REJECTED
        sv = session.exec(
            select(SCCVersion).where(SCCVersion.scc_id == cr.scc_id,
                                     SCCVersion.status == SCCVersionStatus.PROPOSED)
        ).first()
        if sv:
            sv.status = SCCVersionStatus.REJECTED
            session.add(sv)
    session.add(cr)
    append_event(session, as_of, actor_id, "change_request_rejected",
                 "changerequest", cr_id, {"scc_id": cr.scc_id, "note": auditor_note})
    session.commit()
    return cr


def _apply_create(session: Session, cr: ChangeRequest, as_of: date, actor_id: str,
                  assertion_text: str = "", target_uptime_pct: float = 99.0,
                  rolling_window_days: int = 365, max_single_downtime_days: int = 7,
                  evidence_type: str = "TESTED", pinned_controls: list[dict] | None = None,
                  **_) -> None:
    sv = session.exec(
        select(SCCVersion).where(SCCVersion.scc_id == cr.scc_id,
                                 SCCVersion.status == SCCVersionStatus.PROPOSED)
    ).first()
    if not sv:
        return
    if assertion_text:
        sv.assertion_text = assertion_text
    sv.status = SCCVersionStatus.ACTIVE
    sv.active_from = as_of
    sv.target_uptime_pct = target_uptime_pct
    sv.rolling_window_days = rolling_window_days
    sv.max_single_downtime_days = max_single_downtime_days
    sv.evidence_type = EvidenceType(evidence_type)
    sv.approved_by = actor_id
    session.add(sv)
    session.flush()

    if pinned_controls:
        for pc in pinned_controls:
            session.add(SCCVersionControl(
                sccversion_id=sv.id,
                control_id=pc["control_id"],
                check_id=pc["check_id"],
                check_version=pc.get("check_version", "1"),
            ))
    session.flush()


def _apply_reevaluate(session: Session, cr: ChangeRequest, as_of: date, actor_id: str,
                      new_version_id: str = "", assertion_text: str = "",
                      target_uptime_pct: float = 99.0, rolling_window_days: int = 365,
                      max_single_downtime_days: int = 7, evidence_type: str = "TESTED",
                      pinned_controls: list[dict] | None = None, **_) -> None:
    # Freeze old version
    old_sv = session.exec(
        select(SCCVersion).where(SCCVersion.scc_id == cr.scc_id,
                                  SCCVersion.status == SCCVersionStatus.ACTIVE)
    ).first()
    if not old_sv:
        return

    # Check if old version was DOWN at supersession
    current_intervals = list(session.exec(
        select(StateInterval).where(StateInterval.sccversion_id == old_sv.id,
                                    StateInterval.end == None)  # noqa: E711
    ).all())
    was_down = any(i.state == SCCState.DOWN for i in current_intervals)

    old_sv.status = SCCVersionStatus.SUPERSEDED
    old_sv.active_to = as_of
    old_sv.superseded_while_down = was_down
    # Close any open state intervals
    for i in current_intervals:
        i.end = as_of
        session.add(i)
    session.add(old_sv)
    session.flush()

    # Create new version
    new_v_num = old_sv.version + 1
    new_id = new_version_id or f"{cr.scc_id}-v{new_v_num}"
    new_sv = SCCVersion(
        id=new_id,
        scc_id=cr.scc_id,
        version=new_v_num,
        assertion_text=assertion_text or old_sv.assertion_text,
        status=SCCVersionStatus.ACTIVE,
        active_from=as_of,
        target_uptime_pct=target_uptime_pct,
        rolling_window_days=rolling_window_days,
        max_single_downtime_days=max_single_downtime_days,
        evidence_type=EvidenceType(evidence_type),
        supersedes_version_id=old_sv.id,
        approved_by=actor_id,
        reason=cr.reason,
    )
    session.add(new_sv)
    session.flush()

    if pinned_controls:
        for pc in pinned_controls:
            session.add(SCCVersionControl(
                sccversion_id=new_id,
                control_id=pc["control_id"],
                check_id=pc["check_id"],
                check_version=pc.get("check_version", "1"),
            ))
    session.flush()


def _apply_deprecate(session: Session, cr: ChangeRequest, as_of: date,
                     effective_on: date, actor_id: str) -> None:
    if effective_on < as_of:
        raise ValueError("effective_on must be on or after decision date.")
    sv = session.exec(
        select(SCCVersion).where(SCCVersion.scc_id == cr.scc_id,
                                  SCCVersion.status == SCCVersionStatus.ACTIVE)
    ).first()
    if not sv:
        return
    # Mark effective_on on the change request
    cr.effective_on = effective_on
    # If effective_on is today, deprecate now
    if effective_on <= as_of:
        current_intervals = list(session.exec(
            select(StateInterval).where(StateInterval.sccversion_id == sv.id,
                                        StateInterval.end == None)  # noqa: E711
        ).all())
        was_down = any(i.state == SCCState.DOWN for i in current_intervals)
        sv.status = SCCVersionStatus.DEPRECATED
        sv.active_to = effective_on
        sv.deprecated_while_down = was_down
        for i in current_intervals:
            i.end = effective_on
            session.add(i)
        session.add(sv)
    # else: deprecation fires on the effective_on date during clock advance


def check_pending_deprecations(session: Session, as_of: date, actor_id: str = "SYSTEM") -> None:
    """Apply any DEPRECATE change requests whose effective_on has arrived."""
    crs = list(session.exec(
        select(ChangeRequest).where(
            ChangeRequest.type == ChangeRequestType.DEPRECATE,
            ChangeRequest.status == ChangeRequestStatus.APPROVED,
            ChangeRequest.effective_on != None,  # noqa: E711
        )
    ).all())
    for cr in crs:
        if cr.effective_on and cr.effective_on <= as_of:
            sv = session.exec(
                select(SCCVersion).where(SCCVersion.scc_id == cr.scc_id,
                                          SCCVersion.status == SCCVersionStatus.ACTIVE)
            ).first()
            if sv:
                current_intervals = list(session.exec(
                    select(StateInterval).where(StateInterval.sccversion_id == sv.id,
                                                StateInterval.end == None)  # noqa: E711
                ).all())
                was_down = any(i.state == SCCState.DOWN for i in current_intervals)
                sv.status = SCCVersionStatus.DEPRECATED
                sv.active_to = cr.effective_on
                sv.deprecated_while_down = was_down
                for i in current_intervals:
                    i.end = cr.effective_on
                    session.add(i)
                session.add(sv)
                append_event(session, as_of, actor_id, "scc_deprecated",
                             "sccversion", sv.id, {"effective_on": str(cr.effective_on)})
    session.commit()


# ── Collector approval ────────────────────────────────────────────────────────

def approve_collector(session: Session, collector_id: str, actor_id: str) -> Collector:
    as_of = get_clock(session)
    approver = session.get(Person, actor_id)
    if not approver or approver.role != Role.INDEPENDENT_AUDITOR:
        raise ValueError("Only independent_auditor may approve collectors.")
    col = session.get(Collector, collector_id)
    if not col:
        raise ValueError(f"Collector {collector_id} not found")
    col.status = CollectorStatus.APPROVED
    col.approved_by = actor_id
    col.approved_on = as_of
    session.add(col)
    append_event(session, as_of, actor_id, "collector_approved", "collector", collector_id, {})
    session.commit()
    return col


def submit_collector(session: Session, check_id: str, version: str, code_hash: str,
                     actor_id: str) -> Collector:
    as_of = get_clock(session)
    col = Collector(
        id=f"COL-{check_id}-{version}-{as_of}",
        check_id=check_id,
        version=version,
        code_hash=code_hash,
        written_by=actor_id,
        submitted_on=as_of,
        status=CollectorStatus.PENDING,
    )
    session.add(col)
    session.flush()
    append_event(session, as_of, actor_id, "collector_submitted", "collector", col.id,
                 {"check_id": check_id, "version": version})
    session.commit()
    return col


# ── Checkpoints ───────────────────────────────────────────────────────────────

def apply_checkpoint(session: Session, cp_id: str) -> None:
    already = session.get(CheckpointApplied, cp_id)
    if already:
        return
    as_of = get_clock(session)
    CHECKPOINTS[cp_id](session, as_of)
    session.add(CheckpointApplied(cp_id=cp_id, applied_on=get_clock(session)))
    append_event(session, get_clock(session), "SYSTEM", "checkpoint_applied",
                 "checkpoint", cp_id, {})
    session.commit()
    # Run checks + rebuild intervals + fire escalations after each checkpoint
    cur = get_clock(session)
    check_pending_deprecations(session, cur)
    run_due_checks(session, cur)
    rebuild_all_intervals(session, cur)


# ── Checkpoint scripts ────────────────────────────────────────────────────────

def _cp1(session: Session, _: date) -> None:
    """CP1 — 2017-12-01: Reyes defines checks (already seeded); Grant submits CREATE for SCC-01–07; Reyes approves all except SCC-04."""
    d = date(2017, 12, 1)
    set_clock(session, d)

    # Submit CREATE change requests for all 7 SCCs
    for scc_id in ["SCC-01", "SCC-02", "SCC-03", "SCC-04", "SCC-05", "SCC-06", "SCC-07"]:
        cr = ChangeRequest(
            id=f"CR-{scc_id}-CREATE",
            type=ChangeRequestType.CREATE,
            scc_id=scc_id,
            requested_by="P-GRANT",
            requested_on=d,
            reason=f"Initial creation of {scc_id}",
            status=ChangeRequestStatus.PENDING,
        )
        session.add(cr)
    session.flush()

    # Reyes rejects SCC-04 (not measurable)
    sv04 = session.get(SCCVersion, "SCC-04-v1")
    if sv04:
        sv04.status = SCCVersionStatus.REJECTED
        sv04.auditor_note = "Assertion not measurable — cannot define a checkable threshold."
        session.add(sv04)
    cr04 = session.get(ChangeRequest, "CR-SCC-04-CREATE")
    if cr04:
        cr04.status = ChangeRequestStatus.REJECTED
        cr04.decided_by = "P-REYES"
        cr04.decided_on = d
        cr04.auditor_note = "Assertion not measurable."
        session.add(cr04)

    # Reyes approves SCC-01 to SCC-03, SCC-05, SCC-06, SCC-07 with pinned controls
    scc_pins = {
        "SCC-01": [("AC-01", "T-LEASTPRIV", "1"), ("AC-02", "T-VPNDEVICE", "1")],
        "SCC-02": [("IA-01", "T-PWDPOLICY", "1"), ("IA-02", "T-SECRETS", "1")],
        "SCC-03": [("SA-01", "T-SDLSCAN", "1")],
        "SCC-05": [("CM-01", "", "")],
        "SCC-06": [("AC-03", "T-MFA", "1")],
        "SCC-07": [("OP-01", "T-UPTIME", "1")],
    }
    scc_standards = {
        "SCC-01": (99.0, 365, 7, "TESTED"),
        "SCC-02": (99.0, 365, 7, "TESTED"),
        "SCC-03": (99.0, 365, 7, "TESTED"),
        "SCC-05": (95.0, 365, 30, "ATTESTED"),
        "SCC-06": (99.0, 365, 7, "TESTED"),
        "SCC-07": (90.0, 365, 31, "TESTED"),
    }
    for scc_id, pins in scc_pins.items():
        sv = session.get(SCCVersion, f"{scc_id}-v1")
        if not sv:
            continue
        tup, roll, mx, ev = scc_standards[scc_id]
        sv.status = SCCVersionStatus.ACTIVE
        sv.active_from = d
        sv.target_uptime_pct = tup
        sv.rolling_window_days = roll
        sv.max_single_downtime_days = mx
        sv.evidence_type = EvidenceType(ev)
        sv.approved_by = "P-REYES"
        session.add(sv)
        for ctrl_id, check_id, check_ver in pins:
            if check_id:
                session.add(SCCVersionControl(
                    sccversion_id=sv.id,
                    control_id=ctrl_id,
                    check_id=check_id,
                    check_version=check_ver,
                ))
        # Approve the CR
        cr = session.get(ChangeRequest, f"CR-{scc_id}-CREATE")
        if cr:
            cr.status = ChangeRequestStatus.APPROVED
            cr.decided_by = "P-REYES"
            cr.decided_on = d
            session.add(cr)
    session.flush()


def _cp1b(session: Session, _: date) -> None:
    """CP1b — 2017-12-01: First check runs (handled via run_due_checks after apply_checkpoint)."""
    # Clock stays 2017-12-01; run_due_checks fires via apply_checkpoint
    pass


def _cp2(session: Session, _: date) -> None:
    """CP2 — 2018-03-02: SCC-01 still DOWN past Okafor's remediate due date → L4."""
    set_clock(session, date(2018, 3, 2))


def _cp3(session: Session, _: date) -> None:
    """CP3 — 2018-06-04: New VPN snapshot → 6 unmanaged logins → AC-02 FAIL."""
    set_clock(session, date(2018, 6, 4))


def _cp4(session: Session, _: date) -> None:
    """CP4 — 2018-09-03: Reyes approves T-PWDPOLICY v2; SCC-02 v1 → SUPERSEDED while down; v2 → ACTIVE."""
    d = date(2018, 9, 3)
    set_clock(session, d)

    # Create REEVALUATE change request for SCC-02 (Grant)
    cr = ChangeRequest(
        id="CR-SCC-02-REEVAL",
        type=ChangeRequestType.REEVALUATE,
        scc_id="SCC-02",
        requested_by="P-GRANT",
        requested_on=d,
        reason="Most systems moved to SSO; password policy standard should only apply to non-SSO systems with stricter length requirement.",
        status=ChangeRequestStatus.APPROVED,
        decided_by="P-REYES",
        decided_on=d,
        auditor_note="Approved. T-PWDPOLICY v2 replaces v1 for SCC-02.",
    )
    session.add(cr)
    session.flush()

    # Freeze SCC-02-v1
    old_sv = session.get(SCCVersion, "SCC-02-v1")
    if old_sv:
        current_iv = session.exec(
            select(StateInterval).where(StateInterval.sccversion_id == "SCC-02-v1",
                                        StateInterval.end == None)  # noqa: E711
        ).all()
        was_down = any(i.state == SCCState.DOWN for i in list(current_iv))
        old_sv.status = SCCVersionStatus.SUPERSEDED
        old_sv.active_to = d
        old_sv.superseded_while_down = was_down
        session.add(old_sv)
        for i in list(session.exec(
            select(StateInterval).where(StateInterval.sccversion_id == "SCC-02-v1",
                                        StateInterval.end == None)  # noqa: E711
        ).all()):
            i.end = d
            session.add(i)

    # Create SCC-02-v2
    new_sv = SCCVersion(
        id="SCC-02-v2",
        scc_id="SCC-02",
        version=2,
        assertion_text="Systems not behind SSO enforce a minimum password length of 12 characters; Password complexity rules are enabled on all non-SSO systems; No credentials or secrets are exposed in code repositories",
        status=SCCVersionStatus.ACTIVE,
        active_from=d,
        target_uptime_pct=99.0,
        rolling_window_days=365,
        max_single_downtime_days=7,
        evidence_type=EvidenceType.TESTED,
        supersedes_version_id="SCC-02-v1",
        approved_by="P-REYES",
        reason="SSO transition — stricter non-SSO standard.",
    )
    session.add(new_sv)
    session.flush()
    session.add(SCCVersionControl(sccversion_id="SCC-02-v2", control_id="IA-01",
                                   check_id="T-PWDPOLICY", check_version="2"))
    session.add(SCCVersionControl(sccversion_id="SCC-02-v2", control_id="IA-02",
                                   check_id="T-SECRETS", check_version="1"))
    session.flush()


def _cp5(session: Session, _: date) -> None:
    """CP5 — 2019-08-16: New OP-01 collector submitted → PENDING → SCC-07 UNKNOWN.
    Then clock advances to 2019-09-05 and Reyes approves it."""
    d_start = date(2019, 8, 16)
    set_clock(session, d_start)

    # Priya submits a new OP-01 collector (simulating vendor switch)
    new_col = Collector(
        id="COL-OP01-2",
        check_id="T-UPTIME",
        version="2",
        code_hash="def007",
        written_by="P-PRIYA",
        submitted_on=d_start,
        status=CollectorStatus.PENDING,
    )
    session.add(new_col)
    session.flush()
    append_event(session, d_start, "P-PRIYA", "collector_submitted", "collector",
                 "COL-OP01-2", {"check_id": "T-UPTIME", "version": "2"})
    # Advance to 2019-09-05 and Reyes approves
    # (clock advance with pending collector means SCC-07 is UNKNOWN during 2019-08-16 to 2019-09-05)
    # Note: clock advance and approval done by CP5 continuation


def _cp5_approve(session: Session) -> None:
    """Advance clock to 2019-09-05 and approve OP-01 collector v2."""
    d_approve = date(2019, 9, 5)
    set_clock(session, d_approve)
    col = session.get(Collector, "COL-OP01-2")
    if col:
        col.status = CollectorStatus.APPROVED
        col.approved_by = "P-REYES"
        col.approved_on = d_approve
        session.add(col)
        append_event(session, d_approve, "P-REYES", "collector_approved",
                     "collector", "COL-OP01-2", {})
    session.flush()


def _cp6(session: Session, _: date) -> None:
    """CP6 — 2019-11-19: ftp_pass in public repo → T-SECRETS CRITICAL → SCC-02 v2 new L3."""
    set_clock(session, date(2019, 11, 19))


def _cp7(session: Session, _: date) -> None:
    """CP7 — 2020-06-15: Grant requests DEPRECATE SCC-05, Reyes approves effective 2020-06-30."""
    d = date(2020, 6, 15)
    effective = date(2020, 6, 30)
    set_clock(session, d)
    cr = ChangeRequest(
        id="CR-SCC-05-DEPRECATE",
        type=ChangeRequestType.DEPRECATE,
        scc_id="SCC-05",
        requested_by="P-GRANT",
        requested_on=d,
        reason="Company no longer maintaining CM-01 as an attested SCC.",
        status=ChangeRequestStatus.APPROVED,
        decided_by="P-REYES",
        decided_on=d,
        effective_on=effective,
        auditor_note="Approved. SCC-05 citable for periods ending on or before 2020-06-30.",
    )
    session.add(cr)
    session.flush()
    # Apply the deprecation immediately (effective_on is in the near future;
    # check_pending_deprecations will fire it when the clock reaches 2020-06-30)
    append_event(session, d, "P-REYES", "change_request_approved",
                 "changerequest", cr.id, {"type": "DEPRECATE", "scc_id": "SCC-05"})


def _cp8(session: Session, _: date) -> None:
    """CP8 — 2020-10-14: Sep 2020 availability 99.71% → SCC-07 DOWN for September."""
    set_clock(session, date(2020, 10, 14))


def _cp9(session: Session, _: date) -> None:
    """CP9 — 2020-12-14: Wrap-up."""
    set_clock(session, date(2020, 12, 14))


CHECKPOINTS: dict = {
    "CP1": _cp1, "CP1b": _cp1b, "CP2": _cp2, "CP3": _cp3,
    "CP4": _cp4, "CP5": _cp5, "CP6": _cp6,
    "CP7": _cp7, "CP8": _cp8, "CP9": _cp9,
}
