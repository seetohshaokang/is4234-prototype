"""Orchestration layer: coordinates DB, engines, and audit log."""

import json
from datetime import date, timedelta
from pathlib import Path

from sqlmodel import Session, select

from db import (
    get_session, SimClock, Claim, ClaimStatus, SupportState,
    Control, ClaimControlMap, ControlTest, TestResult, TestOutcome,
    Finding, FindingSeverity, FindingStatus,
    RiskAcceptance, RiskAcceptanceStatus,
    GateDecision, GateVerdict, GateTrigger,
    Override, OverrideStatus,
    Escalation, EscalationStatus,
    ManualEvidence, AuditEvent, CheckpointApplied, Person, Role,
)
from engine.control_tests import run_test
from engine.gate import evaluate
from engine.escalation import compute_new_escalations
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
    return set_clock(session, current + timedelta(days=days), actor_id)


# ── Tests ─────────────────────────────────────────────────────────────────────

def run_all_tests(session: Session, actor_id: str = "SYSTEM") -> list[TestResult]:
    as_of = get_clock(session)
    as_of_str = str(as_of)
    controls = list(session.exec(select(Control)).all())
    tests = {t.id: t for t in session.exec(select(ControlTest)).all()}
    results = []

    for ctl in controls:
        if not ctl.test_id or ctl.test_id not in tests:
            continue
        test = tests[ctl.test_id]
        params = json.loads(test.parameters) if test.parameters else None
        outcome = run_test(ctl.test_id, SNAP_DIR, as_of_str, params)
        if outcome.outcome == "ERROR":
            continue  # no snapshot available yet — don't write a result, so R1 fires

        snap_dates = sorted([d.name for d in SNAP_DIR.iterdir() if d.is_dir() and d.name <= as_of_str])
        snap_date = snap_dates[-1] if snap_dates else as_of_str

        result = TestResult(
            control_id=ctl.id,
            test_id=ctl.test_id,
            run_on=as_of,
            snapshot_date=snap_date,
            outcome=TestOutcome(outcome.outcome),
            metrics=json.dumps(outcome.metrics),
            evidence_summary=outcome.evidence_summary,
        )
        session.add(result)
        session.flush()
        results.append(result)

        append_event(session, as_of, actor_id, "test_run", "test_result", str(result.id),
                     {"control_id": ctl.id, "test_id": ctl.test_id, "outcome": outcome.outcome})

        # Auto-open finding on FAIL if none already open for this control+test
        if outcome.outcome == "FAIL":
            existing = session.exec(
                select(Finding).where(
                    Finding.control_id == ctl.id,
                    Finding.status == FindingStatus.OPEN,
                )
            ).first()
            if not existing:
                _auto_open_finding(session, ctl, outcome, as_of, actor_id)

    session.commit()
    _run_escalation_ageing(session, as_of, actor_id)
    return results


def _auto_open_finding(session: Session, ctl: Control, outcome, as_of: date, actor_id: str) -> Finding:
    sev_map = {"LOW": FindingSeverity.LOW, "MEDIUM": FindingSeverity.MEDIUM,
               "HIGH": FindingSeverity.HIGH, "CRITICAL": FindingSeverity.CRITICAL}
    count = len(list(session.exec(select(Finding)).all())) + 1
    fid = f"F-{as_of.year}-{count:03d}"
    f = Finding(
        id=fid,
        control_id=ctl.id,
        title=f"Automated test failure: {ctl.name}",
        description=outcome.evidence_summary,
        severity=sev_map.get(outcome.severity, FindingSeverity.HIGH),
        source="automated_test",
        raised_by_id=actor_id if actor_id != "SYSTEM" else "P-PRIYA",
        owner_id=ctl.owner_id,
        opened_on=as_of,
        due_on=as_of + timedelta(days=30),
    )
    session.add(f)
    session.flush()
    append_event(session, as_of, actor_id, "finding_opened", "finding", fid,
                 {"control_id": ctl.id, "severity": outcome.severity, "auto": True})
    return f


# ── Gate ──────────────────────────────────────────────────────────────────────

def evaluate_all_claims(session: Session, trigger: GateTrigger,
                        actor_id: str = "SYSTEM") -> list[GateDecision]:
    as_of = get_clock(session)
    claims = list(session.exec(select(Claim)).all())
    decisions = []
    for claim in claims:
        d = evaluate_claim(session, claim.id, trigger, actor_id, as_of)
        decisions.append(d)
    session.commit()
    return decisions


def evaluate_claim(session: Session, claim_id: str, trigger: GateTrigger,
                   actor_id: str = "SYSTEM", as_of: date | None = None) -> GateDecision:
    if as_of is None:
        as_of = get_clock(session)

    claim = session.get(Claim, claim_id)
    if not claim:
        raise ValueError(f"Claim {claim_id} not found")

    mappings = list(session.exec(
        select(ClaimControlMap).where(ClaimControlMap.claim_id == claim_id)
    ).all())
    control_ids = [m.control_id for m in mappings]
    controls = [session.get(Control, cid) for cid in control_ids if session.get(Control, cid)]

    # Latest result per control
    latest_results = {}
    for cid in control_ids:
        result = session.exec(
            select(TestResult)
            .where(TestResult.control_id == cid, TestResult.run_on <= as_of)
            .order_by(TestResult.run_on.desc())  # type: ignore[attr-defined]
        ).first()
        if result:
            latest_results[cid] = {
                "id": result.id, "run_on": result.run_on,
                "outcome": result.outcome, "evidence_summary": result.evidence_summary,
            }

    open_findings = [
        {"id": f.id, "control_id": f.control_id, "severity": f.severity,
         "status": f.status, "opened_on": f.opened_on}
        for f in session.exec(
            select(Finding).where(
                Finding.control_id.in_(control_ids),  # type: ignore[attr-defined]
                Finding.status.in_([FindingStatus.OPEN, FindingStatus.RISK_ACCEPTED]),  # type: ignore[attr-defined]
            )
        ).all()
    ]

    finding_ids = [f["id"] for f in open_findings]
    risk_acceptances = [
        {"id": r.id, "finding_id": r.finding_id, "status": r.status,
         "expires_on": r.expires_on, "approved_by": r.approved_by}
        for r in session.exec(
            select(RiskAcceptance).where(RiskAcceptance.finding_id.in_(finding_ids))  # type: ignore[attr-defined]
        ).all()
    ] if finding_ids else []

    active_overrides = [
        {"id": o.id, "by_id": o.by_id, "reason": o.reason,
         "expires_on": o.expires_on, "status": o.status}
        for o in session.exec(
            select(Override).where(Override.claim_id == claim_id,
                                   Override.status == OverrideStatus.ACTIVE)
        ).all()
    ]

    manual_ev = [
        {"control_id": m.control_id, "valid_until": m.valid_until, "summary": m.summary}
        for m in session.exec(
            select(ManualEvidence).where(ManualEvidence.control_id.in_(control_ids))  # type: ignore[attr-defined]
        ).all()
    ] if control_ids else []

    verdict, rules, missing = evaluate(
        claim={"id": claim.id, "owner_id": claim.owner_id},
        controls=[{"id": c.id, "test_frequency_days": c.test_frequency_days} for c in controls if c],
        mappings=[{"claim_id": m.claim_id, "control_id": m.control_id, "approved_by": m.approved_by} for m in mappings],
        latest_results=latest_results,
        open_findings=open_findings,
        risk_acceptances=risk_acceptances,
        active_overrides=active_overrides,
        manual_evidence=manual_ev,
        as_of=as_of,
    )

    decision = GateDecision(
        claim_id=claim_id,
        evaluated_on=as_of,
        trigger=trigger,
        decision=GateVerdict(verdict),
        rules_fired=json.dumps([{"rule_id": r.rule_id, "message": r.message,
                                  "evidence_ids": r.evidence_ids} for r in rules]),
        missing_evidence=json.dumps(missing),
    )
    session.add(decision)
    session.flush()

    # Update claim support state
    state_map = {"APPROVE": SupportState.SUPPORTED, "ESCALATE": SupportState.AT_RISK,
                 "BLOCK": SupportState.UNSUPPORTED}
    if not mappings:
        claim.support_state = SupportState.UNMAPPED
    else:
        claim.support_state = state_map[verdict]
    session.add(claim)

    # Drift rule: published claim just became BLOCK -> L3 escalation
    if claim.status == ClaimStatus.PUBLISHED and verdict == "BLOCK":
        _create_drift_escalation(session, claim_id, as_of, actor_id)

    append_event(session, as_of, actor_id, "gate_evaluated", "gate_decision", str(decision.id),
                 {"claim_id": claim_id, "verdict": verdict, "trigger": str(trigger)})
    return decision


def _create_drift_escalation(session: Session, claim_id: str, as_of: date, actor_id: str) -> None:
    existing = session.exec(
        select(Escalation).where(
            Escalation.subject_id == claim_id,
            Escalation.subject_type == "claim",
            Escalation.level == 3,
            Escalation.status.in_([EscalationStatus.OPEN, EscalationStatus.ACK]),  # type: ignore[attr-defined]
        )
    ).first()
    if existing:
        return
    esc = Escalation(
        subject_type="claim", subject_id=claim_id, level=3,
        assigned_to_role="disclosure_committee", assigned_to_id="P-OKAFOR",
        reason=f"Published claim {claim_id} no longer supported by evidence.",
        created_on=as_of, status=EscalationStatus.OPEN,
    )
    session.add(esc)
    session.flush()
    append_event(session, as_of, actor_id, "escalation_created", "escalation", str(esc.id),
                 {"claim_id": claim_id, "level": 3, "reason": "drift"})


# ── Escalation ageing ────────────────────────────────────────────────────────

def _run_escalation_ageing(session: Session, as_of: date, actor_id: str) -> None:
    findings = [
        {"id": f.id, "control_id": f.control_id, "severity": f.severity,
         "status": f.status, "opened_on": f.opened_on,
         "owner_id": f.owner_id, "raised_by_id": f.raised_by_id}
        for f in session.exec(select(Finding).where(Finding.status == FindingStatus.OPEN)).all()
    ]

    # Which controls back published claims
    published_claim_controls: set[str] = set()
    claim_by_control: dict[str, dict] = {}
    for claim in session.exec(select(Claim).where(Claim.status == ClaimStatus.PUBLISHED)).all():
        for m in session.exec(select(ClaimControlMap).where(ClaimControlMap.claim_id == claim.id)).all():
            published_claim_controls.add(m.control_id)
            claim_by_control[m.control_id] = {"id": claim.id, "owner_id": claim.owner_id}

    existing_escs = [
        {"id": e.id, "subject_type": e.subject_type, "subject_id": e.subject_id,
         "level": e.level, "requested_level": e.requested_level,
         "status": e.status, "created_on": e.created_on,
         "acknowledged_on": e.acknowledged_on}
        for e in session.exec(select(Escalation)).all()
    ]
    people = [{"id": p.id, "role": p.role} for p in session.exec(select(Person)).all()]

    new_escs = compute_new_escalations(
        findings=findings,
        published_claim_control_ids=published_claim_controls,
        claim_by_control=claim_by_control,
        existing_escalations=existing_escs,
        people=people,
        as_of=as_of,
    )

    for esc_data in new_escs:
        supersedes = esc_data.pop("_supersedes", None)
        esc = Escalation(**{k: v for k, v in esc_data.items()
                           if k in Escalation.model_fields})
        session.add(esc)
        session.flush()
        if supersedes:
            old = session.get(Escalation, supersedes)
            if old:
                old.status = EscalationStatus.SUPERSEDED
                session.add(old)
        append_event(session, as_of, actor_id, "escalation_created", "escalation", str(esc.id),
                     {"subject_id": esc.subject_id, "level": esc.level, "reason": esc.reason[:80]})
    session.commit()


# ── Findings ──────────────────────────────────────────────────────────────────

def create_finding(session: Session, control_id: str, title: str, description: str,
                   severity: str, raised_by_id: str, owner_id: str,
                   source: str = "manual_review") -> Finding:
    as_of = get_clock(session)
    count = len(list(session.exec(select(Finding)).all())) + 1
    fid = f"F-{as_of.year}-{count:03d}"
    f = Finding(
        id=fid, control_id=control_id, title=title, description=description,
        severity=FindingSeverity(severity), source=source,
        raised_by_id=raised_by_id, owner_id=owner_id,
        opened_on=as_of, due_on=as_of + timedelta(days=30),
    )
    session.add(f)
    session.flush()
    append_event(session, as_of, raised_by_id, "finding_opened", "finding", fid,
                 {"control_id": control_id, "severity": severity})
    session.commit()
    return f


def close_finding(session: Session, finding_id: str, actor_id: str) -> Finding:
    as_of = get_clock(session)
    f = session.get(Finding, finding_id)
    if not f:
        raise ValueError(f"Finding {finding_id} not found")
    f.status = FindingStatus.CLOSED
    f.closed_on = as_of
    session.add(f)
    append_event(session, as_of, actor_id, "finding_closed", "finding", finding_id, {})
    session.commit()
    evaluate_all_claims(session, GateTrigger.EVIDENCE_CHANGE, actor_id)
    return f


# ── Risk Acceptance ───────────────────────────────────────────────────────────

def propose_risk_acceptance(session: Session, finding_id: str, proposed_by: str,
                            rationale: str, cost_benefit_note: str,
                            expires_on: date) -> RiskAcceptance:
    as_of = get_clock(session)
    # Check if finding's control backs a published claim
    f = session.get(Finding, finding_id)
    affects = False
    if f:
        published_ids = {c.claim_id for c in session.exec(
            select(ClaimControlMap).where(ClaimControlMap.control_id == f.control_id)
        ).all() if session.exec(
            select(Claim).where(Claim.id == c.claim_id, Claim.status == ClaimStatus.PUBLISHED)
        ).first()}
        affects = bool(published_ids)

    ra_id = f"RA-{as_of.year}-{finding_id}"
    ra = RiskAcceptance(
        id=ra_id, finding_id=finding_id, proposed_by=proposed_by,
        rationale=rationale, cost_benefit_note=cost_benefit_note,
        expires_on=expires_on, affects_public_claims=affects,
    )
    session.add(ra)
    session.flush()
    append_event(session, as_of, proposed_by, "risk_acceptance_proposed", "risk_acceptance", ra_id,
                 {"finding_id": finding_id, "affects_public_claims": affects})
    session.commit()
    return ra


def approve_risk_acceptance(session: Session, ra_id: str, approved_by: str) -> RiskAcceptance:
    as_of = get_clock(session)
    approver = session.get(Person, approved_by)
    if not approver or approver.role != Role.DISCLOSURE_COMMITTEE:
        raise ValueError(
            "Only a disclosure-committee member can approve a risk acceptance."
        )
    ra = session.get(RiskAcceptance, ra_id)
    if not ra:
        raise ValueError(f"Risk acceptance {ra_id} not found")
    ra.status = RiskAcceptanceStatus.APPROVED
    ra.approved_by = approved_by
    # Update finding status
    f = session.get(Finding, ra.finding_id)
    if f:
        f.status = FindingStatus.RISK_ACCEPTED
        session.add(f)
    session.add(ra)
    append_event(session, as_of, approved_by, "risk_acceptance_approved", "risk_acceptance", ra_id,
                 {"finding_id": ra.finding_id})
    session.commit()
    evaluate_all_claims(session, GateTrigger.EVIDENCE_CHANGE, approved_by)
    return ra


# ── Overrides ────────────────────────────────────────────────────────────────

def create_override(session: Session, claim_id: str, by_id: str,
                    reason: str, conditions: str, expires_on: date) -> Override:
    if len(reason) < 50:
        raise ValueError("Override reason must be at least 50 characters.")
    claim = session.get(Claim, claim_id)
    if claim and by_id == claim.owner_id:
        raise ValueError(
            f"Independence rule: {by_id} owns {claim_id} and cannot override it. "
            "A disclosure-committee member must override instead."
        )
    as_of = get_clock(session)
    ov_id = f"OV-{claim_id}-{as_of}"
    ov = Override(id=ov_id, claim_id=claim_id, by_id=by_id, reason=reason,
                  conditions=conditions, created_on=as_of, expires_on=expires_on)
    session.add(ov)
    session.flush()
    append_event(session, as_of, by_id, "override_created", "override", ov_id,
                 {"claim_id": claim_id, "expires_on": str(expires_on)})
    session.commit()
    evaluate_claim(session, claim_id, GateTrigger.EVIDENCE_CHANGE, by_id)
    return ov


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


# ── Claim publication ────────────────────────────────────────────────────────

def publish_claim(session: Session, claim_id: str, actor_id: str) -> Claim:
    as_of = get_clock(session)
    claim = session.get(Claim, claim_id)
    if not claim:
        raise ValueError(f"Claim {claim_id} not found")

    # Evaluate first
    d = evaluate_claim(session, claim_id, GateTrigger.PRE_PUBLICATION, actor_id)

    # Can only publish if APPROVE, or BLOCK/ESCALATE with active override
    has_override = session.exec(
        select(Override).where(Override.claim_id == claim_id,
                               Override.status == OverrideStatus.ACTIVE)
    ).first()
    if d.decision == GateVerdict.BLOCK and not has_override:
        raise ValueError(f"Cannot publish: claim is BLOCKED with no active override.")

    claim.status = ClaimStatus.PUBLISHED
    claim.published_on = as_of
    session.add(claim)
    append_event(session, as_of, actor_id, "claim_published", "claim", claim_id,
                 {"decision": d.decision})
    session.commit()
    return claim


def withdraw_claim(session: Session, claim_id: str, actor_id: str) -> Claim:
    as_of = get_clock(session)
    claim = session.get(Claim, claim_id)
    if not claim:
        raise ValueError(f"Claim {claim_id} not found")
    claim.status = ClaimStatus.WITHDRAWN
    session.add(claim)
    append_event(session, as_of, actor_id, "claim_withdrawn", "claim", claim_id, {})
    session.commit()
    return claim


# ── Checkpoints ───────────────────────────────────────────────────────────────

def apply_checkpoint(session: Session, cp_id: str) -> None:
    """Apply a scripted checkpoint. Idempotent — won't re-apply."""
    already = session.get(CheckpointApplied, cp_id)
    if already:
        return

    as_of = get_clock(session)
    CHECKPOINTS[cp_id](session, as_of)

    session.add(CheckpointApplied(cp_id=cp_id, applied_on=as_of))
    append_event(session, as_of, "SYSTEM", "checkpoint_applied", "checkpoint", cp_id, {})
    session.commit()

    # After scripted events, run tests + ageing + gate
    run_all_tests(session)
    evaluate_all_claims(session, GateTrigger.CLOCK_ADVANCE)


def _cp1(session: Session, as_of: date) -> None:
    """CP1 — 2017-12-01: Draft all claims, submit for gate evaluation."""
    set_clock(session, date(2017, 12, 1))


def _cp1b(session: Session, as_of: date) -> None:
    """CP1b — first test run (handled by apply_checkpoint via run_all_tests)."""
    set_clock(session, date(2017, 12, 1))


def _cp2(session: Session, as_of: date) -> None:
    """CP2 — 2018-03-02: Override expires."""
    set_clock(session, date(2018, 3, 2))
    # Expire any overrides past their expiry
    for ov in session.exec(select(Override).where(Override.status == OverrideStatus.ACTIVE)).all():
        if ov.expires_on < date(2018, 3, 2):
            ov.status = OverrideStatus.EXPIRED
            session.add(ov)
            append_event(session, date(2018, 3, 2), "SYSTEM", "override_expired",
                         "override", ov.id, {"claim_id": ov.claim_id})
    session.flush()


def _cp3(session: Session, as_of: date) -> None:
    """CP3 — 2018-06-04: Engineer reports VPN gap."""
    set_clock(session, date(2018, 6, 4))
    create_finding(session, "AC-02",
        "Unmanaged devices can connect to corporate VPN",
        "Unmanaged devices can connect to corporate VPN; activity undetectable by DLP.",
        "HIGH", "P-PRIYA", "P-PRIYA", source="manual_review")


def _cp4(session: Session, as_of: date) -> None:
    """CP4 — 2018-09-03: 90 days of no traction."""
    set_clock(session, date(2018, 9, 3))


def _cp5(session: Session, as_of: date) -> None:
    """CP5 — 2019-08-16: Internal review — access inappropriate."""
    set_clock(session, date(2019, 8, 16))
    create_finding(session, "AC-01",
        "Access and privilege to critical systems is inappropriate",
        "Quarterly review finds access and privilege to critical systems/data is inappropriate.",
        "HIGH", "P-GRANT", "P-PRIYA", source="manual_review")


def _cp6(session: Session, as_of: date) -> None:
    """CP6 — 2019-11-19: Password leaked in public repo."""
    set_clock(session, date(2019, 11, 19))


def _cp7(session: Session, as_of: date) -> None:
    """CP7 — 2020-06-15: First customer incident."""
    from db import Incident
    set_clock(session, date(2020, 6, 15))
    inc = Incident(id="I-01", reported_on=date(2020, 6, 15),
                   reporter="Customer A – government agency",
                   product="Horizon", component="BusinessLayer",
                   description="Horizon contacting unknown external domains",
                   severity_rating=0, rated_by="P-GRANT")
    session.add(inc)
    session.flush()
    append_event(session, date(2020, 6, 15), "P-GRANT", "incident_reported",
                 "incident", "I-01", {"component": "BusinessLayer", "severity": 0})


def _cp8(session: Session, as_of: date) -> None:
    """CP8 — 2020-10-14: Second customer incident."""
    from db import Incident
    set_clock(session, date(2020, 10, 14))
    inc = Incident(id="I-02", reported_on=date(2020, 10, 14),
                   reporter="Customer B – security firm",
                   product="Horizon", component="BusinessLayer",
                   description="Horizon downloading a malicious file",
                   severity_rating=0, rated_by="P-GRANT")
    session.add(inc)
    session.flush()
    append_event(session, date(2020, 10, 14), "P-GRANT", "incident_reported",
                 "incident", "I-02", {"component": "BusinessLayer", "severity": 0})


def _cp9(session: Session, as_of: date) -> None:
    """CP9 — 2020-12-14: Wrap-up."""
    set_clock(session, date(2020, 12, 14))


CHECKPOINTS: dict[str, object] = {
    "CP1": _cp1, "CP1b": _cp1b, "CP2": _cp2, "CP3": _cp3,
    "CP4": _cp4, "CP5": _cp5, "CP6": _cp6,
    "CP7": _cp7, "CP8": _cp8, "CP9": _cp9,
}
