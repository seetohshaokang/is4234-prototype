"""FastAPI wrapper around services.py — runs from prototype/ root."""

import json
import shutil
import sqlite3
from datetime import date
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlmodel import select

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from db import (
    get_session, Claim, Control, Finding, FindingStatus, GateDecision,
    GateVerdict, Escalation, EscalationStatus, Override, OverrideStatus,
    RiskAcceptance, AuditEvent, ControlTest, TestResult, Person,
    ClaimControlMap, ManualEvidence, CheckpointApplied, create_tables,
)
from services import (
    get_clock, set_clock, advance_clock, run_all_tests,
    evaluate_claim, evaluate_all_claims, publish_claim, withdraw_claim,
    create_finding, close_finding, propose_risk_acceptance,
    approve_risk_acceptance, create_override, ack_escalation,
    resolve_escalation, apply_checkpoint, CHECKPOINTS,
)
from audit import verify_chain, append_event
from db import GateTrigger
from seed import seed_db

app = FastAPI(title="Disclosure Gate API", version="0.1.0")
create_tables()  # ensure newly added tables exist on older DBs
# lightweight column migration for pre-requested_level DBs
try:
    from sqlalchemy import text
    from db import engine as _engine
    with _engine.begin() as _conn:
        _conn.execute(text("ALTER TABLE escalation ADD COLUMN requested_level INTEGER"))
        _conn.execute(text("UPDATE escalation SET requested_level = level"))
except Exception:
    pass  # column already exists or fresh schema
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ACTORS = [
    {"id": "P-PRIYA",   "name": "Priya N.",   "role": "control_owner",       "title": "IT Ops Engineer"},
    {"id": "P-GRANT",   "name": "T. Grant",   "role": "security_lead",       "title": "VP Security"},
    {"id": "P-DANA",    "name": "Dana L.",    "role": "claim_author",        "title": "Comms / Legal"},
    {"id": "P-OKAFOR",  "name": "M. Okafor", "role": "disclosure_committee", "title": "CFO"},
    {"id": "P-CHEN",    "name": "R. Chen",   "role": "disclosure_committee", "title": "General Counsel"},
    {"id": "P-IBRAHIM", "name": "S. Ibrahim","role": "internal_audit",       "title": "Head of Internal Audit"},
    {"id": "P-MORALES", "name": "J. Morales","role": "audit_committee",      "title": "Audit Committee Chair"},
    {"id": "P-LEO",     "name": "Leo K.",    "role": "control_owner",        "title": "DevOps Engineer"},
]
ACTORS_BY_ID = {a["id"]: a for a in ACTORS}

CHECKPOINT_META = [
    ("CP1",  "2017-12-01", "Claims drafted, no tests"),
    ("CP1b", "2017-12-01", "First test run — AC-01/IA-01/SA-01 FAIL"),
    ("CP2",  "2018-03-02", "Override expires → C-01 back to BLOCK"),
    ("CP3",  "2018-06-04", "VPN gap reported → F-2018-VPN"),
    ("CP4",  "2018-09-03", "90 days no fix → L4 escalation"),
    ("CP5",  "2019-08-16", 'Internal review: "access inappropriate"'),
    ("CP6",  "2019-11-19", "ftp_pass=nimbus123 found in public repo"),
    ("CP7",  "2020-06-15", "Incident 1: Customer A"),
    ("CP8",  "2020-10-14", "Incident 2: Customer B"),
    ("CP9",  "2020-12-14", "Wrap-up comparison panel"),
]
CHECKPOINT_ORDER = [cp_id for cp_id, _, _ in CHECKPOINT_META]


def _j(s: Optional[str]) -> Any:
    return json.loads(s) if s else None


# ── Clock ─────────────────────────────────────────────────────────────────────

@app.get("/clock")
def api_get_clock():
    with get_session() as s:
        return {"date": str(get_clock(s))}


class AdvanceBody(BaseModel):
    days: int

class SetClockBody(BaseModel):
    date: str

@app.post("/clock/advance")
def api_advance_clock(body: AdvanceBody):
    with get_session() as s:
        new_date = advance_clock(s, body.days)
        run_all_tests(s)
        evaluate_all_claims(s, GateTrigger.CLOCK_ADVANCE)
        return {"date": str(new_date)}

@app.post("/clock/set")
def api_set_clock(body: SetClockBody):
    with get_session() as s:
        new_date = set_clock(s, date.fromisoformat(body.date))
        run_all_tests(s)
        evaluate_all_claims(s, GateTrigger.CLOCK_ADVANCE)
        return {"date": str(new_date)}

@app.get("/actors")
def api_actors():
    return ACTORS

@app.post("/checkpoints/{cp_id}/apply")
def api_apply_checkpoint(cp_id: str):
    if cp_id not in CHECKPOINTS:
        raise HTTPException(404, f"Unknown checkpoint: {cp_id}")
    with get_session() as s:
        apply_checkpoint(s, cp_id)
    return {"ok": True, "cp_id": cp_id}


def _applied_prefix() -> tuple[set, int]:
    """Return (applied cp ids, length of longest applied prefix of CHECKPOINT_ORDER)."""
    with get_session() as s:
        applied = {r.cp_id for r in s.exec(select(CheckpointApplied)).all()}
    n = 0
    while n < len(CHECKPOINT_ORDER) and CHECKPOINT_ORDER[n] in applied:
        n += 1
    return applied, n


def _replay_to(target_idx: int) -> None:
    """Rebuild demo state deterministically: reseed, then re-apply CPs in order."""
    seed_db()
    with get_session() as s:
        for cp in CHECKPOINT_ORDER[: target_idx + 1]:
            apply_checkpoint(s, cp)


@app.post("/checkpoints/{cp_id}/goto")
def api_goto_checkpoint(cp_id: str):
    """Jump to a checkpoint like a timeline scrubber.

    Forward  → apply the missing checkpoints in order (manual actions preserved).
    Backward → reseed and replay CP1..target (manual actions are lost).
    """
    if cp_id not in CHECKPOINTS:
        raise HTTPException(404, f"Unknown checkpoint: {cp_id}")
    target_idx = CHECKPOINT_ORDER.index(cp_id)
    applied, prefix = _applied_prefix()
    clean = applied == set(CHECKPOINT_ORDER[:prefix])
    if clean and prefix < target_idx + 1:
        with get_session() as s:
            for cp in CHECKPOINT_ORDER[prefix : target_idx + 1]:
                apply_checkpoint(s, cp)
    elif not (clean and prefix == target_idx + 1):
        _replay_to(target_idx)
    return {"ok": True, "cp_id": cp_id}


@app.post("/demo/reset")
def api_demo_reset():
    """Wipe all demo state and reseed (jump back to before CP1)."""
    seed_db()
    return {"ok": True}

@app.post("/seed")
def api_seed():
    import subprocess
    subprocess.run(["uv", "run", "python", "seed.py"], check=True)
    return {"ok": True}


# ── Claims ────────────────────────────────────────────────────────────────────

def _claim_out(s, claim):
    latest = s.exec(
        select(GateDecision).where(GateDecision.claim_id == claim.id)
        .order_by(GateDecision.id.desc())
    ).first()
    maps = list(s.exec(
        select(ClaimControlMap).where(ClaimControlMap.claim_id == claim.id)
    ).all())
    return {
        "id": claim.id, "text": claim.text, "channel": claim.channel,
        "owner_id": claim.owner_id, "status": claim.status,
        "published_on": str(claim.published_on) if claim.published_on else None,
        "support_state": claim.support_state,
        "latest_decision": {
            "id": latest.id, "decision": latest.decision,
            "evaluated_on": str(latest.evaluated_on),
            "rules_fired": _j(latest.rules_fired),
            "missing_evidence": _j(latest.missing_evidence),
        } if latest else None,
        "mappings": [{"control_id": m.control_id, "approved_by": m.approved_by,
                       "approved_on": str(m.approved_on) if m.approved_on else None} for m in maps],
    }

@app.get("/claims")
def api_claims():
    with get_session() as s:
        claims = list(s.exec(select(Claim)).all())
        return [_claim_out(s, c) for c in claims]

class ActorBody(BaseModel):
    actor_id: str

@app.post("/claims/{claim_id}/evaluate")
def api_evaluate_claim(claim_id: str, body: ActorBody):
    with get_session() as s:
        d = evaluate_claim(s, claim_id, GateTrigger.MANUAL, body.actor_id)
        return _claim_out(s, s.get(Claim, claim_id))

@app.post("/claims/{claim_id}/publish")
def api_publish_claim(claim_id: str, body: ActorBody):
    with get_session() as s:
        try:
            publish_claim(s, claim_id, body.actor_id)
            return _claim_out(s, s.get(Claim, claim_id))
        except ValueError as e:
            raise HTTPException(400, str(e))

@app.post("/claims/{claim_id}/withdraw")
def api_withdraw_claim(claim_id: str, body: ActorBody):
    with get_session() as s:
        withdraw_claim(s, claim_id, body.actor_id)
        return _claim_out(s, s.get(Claim, claim_id))


# ── Controls ──────────────────────────────────────────────────────────────────

def _control_out(s, ctl, as_of):
    latest = s.exec(
        select(TestResult).where(TestResult.control_id == ctl.id)
        .order_by(TestResult.run_on.desc())
    ).first()
    open_findings = list(s.exec(
        select(Finding).where(Finding.control_id == ctl.id,
                              Finding.status == FindingStatus.OPEN)
    ).all())
    blast = [m.claim_id for m in s.exec(
        select(ClaimControlMap).where(ClaimControlMap.control_id == ctl.id)
    ).all() if s.exec(
        select(Claim).where(Claim.id == m.claim_id, Claim.status == "published")
    ).first()]
    manual = s.exec(
        select(ManualEvidence).where(
            ManualEvidence.control_id == ctl.id,
            ManualEvidence.valid_until >= as_of,
        )
    ).first()
    stale = False
    age_days = None
    if latest:
        age_days = (as_of - latest.run_on).days
        stale = age_days > ctl.test_frequency_days

    all_results = list(s.exec(
        select(TestResult).where(TestResult.control_id == ctl.id)
        .order_by(TestResult.run_on)
    ).all())

    return {
        "id": ctl.id, "name": ctl.name, "description": ctl.description,
        "owner_id": ctl.owner_id, "test_id": ctl.test_id,
        "test_frequency_days": ctl.test_frequency_days,
        "framework_refs": _j(ctl.framework_refs) if ctl.framework_refs else [],
        "latest_result": {
            "id": latest.id, "run_on": str(latest.run_on),
            "outcome": latest.outcome, "evidence_summary": latest.evidence_summary,
            "metrics": _j(latest.metrics), "snapshot_date": latest.snapshot_date,
        } if latest else None,
        "stale": stale, "age_days": age_days,
        "open_findings": [{"id": f.id, "severity": f.severity, "title": f.title,
                            "opened_on": str(f.opened_on)} for f in open_findings],
        "blast_radius_claims": blast,
        "manual_evidence": {"summary": manual.summary, "valid_until": str(manual.valid_until),
                             "attested_by": manual.attested_by} if manual else None,
        "result_history": [{"run_on": str(r.run_on), "outcome": r.outcome} for r in all_results],
    }

@app.get("/controls")
def api_controls():
    with get_session() as s:
        as_of = get_clock(s)
        return [_control_out(s, c, as_of) for c in s.exec(select(Control)).all()]

@app.post("/controls/run-tests")
def api_run_tests(body: ActorBody):
    with get_session() as s:
        results = run_all_tests(s, body.actor_id)
        evaluate_all_claims(s, GateTrigger.EVIDENCE_CHANGE, body.actor_id)
        return {"ran": len(results), "results": [
            {"control_id": r.control_id, "outcome": r.outcome,
             "evidence_summary": r.evidence_summary} for r in results
        ]}


# ── Findings ──────────────────────────────────────────────────────────────────

def _finding_out(s, f, as_of):
    esc = s.exec(
        select(Escalation).where(
            Escalation.subject_id == f.id,
            Escalation.status.in_([EscalationStatus.OPEN, EscalationStatus.ACK]),
        ).order_by(Escalation.level.desc())
    ).first()
    ras = list(s.exec(select(RiskAcceptance).where(RiskAcceptance.finding_id == f.id)).all())
    linked = [m.claim_id for m in s.exec(
        select(ClaimControlMap).where(ClaimControlMap.control_id == f.control_id)
    ).all() if s.exec(
        select(Claim).where(Claim.id == m.claim_id, Claim.status == "published")
    ).first()]
    return {
        "id": f.id, "control_id": f.control_id, "title": f.title,
        "description": f.description, "severity": f.severity, "source": f.source,
        "raised_by_id": f.raised_by_id, "owner_id": f.owner_id,
        "opened_on": str(f.opened_on), "due_on": str(f.due_on),
        "status": f.status, "closed_on": str(f.closed_on) if f.closed_on else None,
        "days_open": (as_of - f.opened_on).days,
        "escalation_level": esc.level if esc else None,
        "linked_claims": linked,
        "risk_acceptances": [{
            "id": r.id, "status": r.status, "rationale": r.rationale,
            "cost_benefit_note": r.cost_benefit_note,
            "expires_on": str(r.expires_on), "approved_by": r.approved_by,
        } for r in ras],
    }

@app.get("/findings")
def api_findings():
    with get_session() as s:
        as_of = get_clock(s)
        findings = list(s.exec(select(Finding).order_by(Finding.opened_on.desc())).all())
        return [_finding_out(s, f, as_of) for f in findings]

class CreateFindingBody(BaseModel):
    control_id: str
    title: str
    description: str
    severity: str
    actor_id: str

@app.post("/findings")
def api_create_finding(body: CreateFindingBody):
    with get_session() as s:
        f = create_finding(s, body.control_id, body.title, body.description,
                           body.severity, body.actor_id, body.actor_id)
        as_of = get_clock(s)
        return _finding_out(s, s.get(Finding, f.id), as_of)

@app.post("/findings/{finding_id}/close")
def api_close_finding(finding_id: str, body: ActorBody):
    with get_session() as s:
        close_finding(s, finding_id, body.actor_id)
        as_of = get_clock(s)
        return _finding_out(s, s.get(Finding, finding_id), as_of)

class ProposeRABody(BaseModel):
    rationale: str
    cost_benefit_note: str
    expires_on: str
    actor_id: str

@app.post("/findings/{finding_id}/risk-acceptance")
def api_propose_ra(finding_id: str, body: ProposeRABody):
    with get_session() as s:
        ra = propose_risk_acceptance(s, finding_id, body.actor_id, body.rationale,
                                     body.cost_benefit_note, date.fromisoformat(body.expires_on))
        return {"id": ra.id, "status": ra.status}

@app.post("/risk-acceptances/{ra_id}/approve")
def api_approve_ra(ra_id: str, body: ActorBody):
    with get_session() as s:
        try:
            ra = approve_risk_acceptance(s, ra_id, body.actor_id)
            return {"id": ra.id, "status": ra.status}
        except ValueError as e:
            raise HTTPException(400, str(e))


# ── Gate Review ───────────────────────────────────────────────────────────────

@app.get("/gate/decisions")
def api_gate_decisions():
    with get_session() as s:
        claims = list(s.exec(select(Claim)).all())
        out = []
        for c in claims:
            d = s.exec(
                select(GateDecision).where(GateDecision.claim_id == c.id)
                .order_by(GateDecision.id.desc())
            ).first()
            ovs = list(s.exec(
                select(Override).where(Override.claim_id == c.id,
                                       Override.status == OverrideStatus.ACTIVE)
            ).all())
            out.append({
                "claim": _claim_out(s, c),
                "active_overrides": [{
                    "id": o.id, "by_id": o.by_id, "reason": o.reason,
                    "conditions": o.conditions, "created_on": str(o.created_on),
                    "expires_on": str(o.expires_on),
                } for o in ovs],
            })
        return out

class CreateOverrideBody(BaseModel):
    claim_id: str
    actor_id: str
    reason: str
    conditions: str
    expires_on: str

@app.post("/gate/overrides")
def api_create_override(body: CreateOverrideBody):
    with get_session() as s:
        try:
            ov = create_override(s, body.claim_id, body.actor_id, body.reason,
                                 body.conditions, date.fromisoformat(body.expires_on))
            return {"id": ov.id, "status": ov.status}
        except ValueError as e:
            raise HTTPException(400, str(e))


# ── Escalations ───────────────────────────────────────────────────────────────

def _esc_out(s, e):
    subject_label = e.subject_id
    if e.subject_type == "finding":
        f = s.get(Finding, e.subject_id)
        if f:
            subject_label = f"{f.id}: {f.title} ({f.severity})"
    elif e.subject_type == "claim":
        c = s.get(Claim, e.subject_id)
        if c:
            subject_label = f"{c.id}: {c.text[:60]}"
    return {
        "id": e.id, "subject_type": e.subject_type, "subject_id": e.subject_id,
        "subject_label": subject_label, "level": e.level,
        "assigned_to_role": e.assigned_to_role, "assigned_to_id": e.assigned_to_id,
        "reason": e.reason, "created_on": str(e.created_on),
        "acknowledged_on": str(e.acknowledged_on) if e.acknowledged_on else None,
        "resolved_on": str(e.resolved_on) if e.resolved_on else None,
        "status": e.status,
        "independence_skips": e.independence_skips,
    }

@app.get("/escalations")
def api_escalations():
    with get_session() as s:
        escs = list(s.exec(select(Escalation).order_by(Escalation.created_on.desc())).all())
        return [_esc_out(s, e) for e in escs]

@app.post("/escalations/{esc_id}/ack")
def api_ack_escalation(esc_id: int, body: ActorBody):
    with get_session() as s:
        ack_escalation(s, esc_id, body.actor_id)
        return _esc_out(s, s.get(Escalation, esc_id))

@app.post("/escalations/{esc_id}/resolve")
def api_resolve_escalation(esc_id: int, body: ActorBody):
    with get_session() as s:
        resolve_escalation(s, esc_id, body.actor_id)
        return _esc_out(s, s.get(Escalation, esc_id))


# ── Audit ─────────────────────────────────────────────────────────────────────

@app.get("/audit/events")
def api_audit_events(limit: int = 50, offset: int = 0):
    with get_session() as s:
        events = list(s.exec(
            select(AuditEvent).order_by(AuditEvent.seq.desc()).offset(offset).limit(limit)
        ).all())
        total = len(list(s.exec(select(AuditEvent)).all()))
        return {"total": total, "events": [{
            "seq": e.seq, "ts_sim": str(e.ts_sim), "ts_real": str(e.ts_real),
            "actor_id": e.actor_id, "action": e.action,
            "subject_type": e.subject_type, "subject_id": e.subject_id,
            "payload": _j(e.payload), "hash": e.hash[:12] + "…",
        } for e in events]}

@app.get("/audit/verify-chain")
def api_verify_chain():
    with get_session() as s:
        valid, broken_at = verify_chain(s)
        return {"valid": valid, "broken_at": broken_at}

@app.get("/audit/control-tests")
def api_audit_tests():
    with get_session() as s:
        tests = list(s.exec(select(ControlTest)).all())
        import random
        all_results = list(s.exec(select(TestResult)).all())
        sample = random.sample(all_results, min(5, len(all_results)))
        return {
            "tests": [{"id": t.id, "name": t.name, "version": t.version,
                        "reviewed_by_audit": t.reviewed_by_audit,
                        "parameters": _j(t.parameters)} for t in tests],
            "sample_results": [{"id": r.id, "control_id": r.control_id, "run_on": str(r.run_on),
                                  "outcome": r.outcome, "evidence_summary": r.evidence_summary} for r in sample],
        }

@app.post("/audit/control-tests/{test_id}/mark-reviewed")
def api_mark_reviewed(test_id: str, body: ActorBody):
    with get_session() as s:
        t = s.get(ControlTest, test_id)
        if not t:
            raise HTTPException(404)
        t.reviewed_by_audit = True
        s.add(t)
        s.commit()
        return {"id": t.id, "reviewed_by_audit": True}

# ── Alias / convenience routes for frontend ───────────────────────────────────

@app.get("/checkpoints")
def api_list_checkpoints():
    """Return ordered list of checkpoint metadata for sidebar buttons."""
    with get_session() as s:
        applied = {r.cp_id for r in s.exec(select(CheckpointApplied)).all()}
    return [{"id": cp_id, "label": cp_id, "date": d, "description": desc,
             "applied": cp_id in applied}
            for cp_id, d, desc in CHECKPOINT_META if cp_id in CHECKPOINTS]


@app.get("/gate/evaluate/{claim_id}")
def api_gate_evaluate(claim_id: str):
    """Return latest gate decision for a single claim in frontend-friendly shape."""
    with get_session() as s:
        claim = s.get(Claim, claim_id)
        if not claim:
            raise HTTPException(404, f"Claim {claim_id} not found")
        d = evaluate_claim(s, claim_id, GateTrigger.MANUAL)
        rules = _j(d.rules_fired) or []
        missing = _j(d.missing_evidence) or []
        return {
            "claim_id": claim_id,
            "claim_title": claim.text[:80],
            "verdict": d.decision,
            "rules_fired": [
                {"rule_id": r.get("rule_id", r.get("id", "?")),
                 "verdict": r.get("verdict", ""),
                 "detail": r.get("detail", r.get("reason", ""))}
                for r in rules
            ],
            "missing_controls": missing,
        }


@app.post("/gate/run-all")
def api_run_all():
    """Run all tests + re-evaluate all claims. Used by Dashboard & ControlTests."""
    with get_session() as s:
        results = run_all_tests(s)
        evaluate_all_claims(s, GateTrigger.EVIDENCE_CHANGE)
        return {"ran": len([r for r in results if r.outcome != "ERROR"])}


@app.get("/overrides")
def api_list_overrides():
    with get_session() as s:
        ovs = list(s.exec(select(Override).where(Override.status == OverrideStatus.ACTIVE)).all())
        as_of = get_clock(s)
        return [{
            "id": o.id, "claim_id": o.claim_id, "by_id": o.by_id,
            "reason": o.reason, "conditions": o.conditions,
            "expires_on": str(o.expires_on), "status": o.status,
            "days_left": (o.expires_on - as_of).days,
        } for o in ovs]


class CreateOverrideFrontend(BaseModel):
    claim_id: str
    by_id: str
    reason: str
    conditions: str
    expires_on: str

@app.post("/overrides")
def api_create_override_frontend(body: CreateOverrideFrontend):
    with get_session() as s:
        try:
            ov = create_override(s, body.claim_id, body.by_id, body.reason,
                                 body.conditions, date.fromisoformat(body.expires_on))
            return {"id": ov.id, "status": ov.status}
        except ValueError as e:
            raise HTTPException(400, str(e))


@app.get("/audit")
def api_audit_simple(limit: int = 100):
    with get_session() as s:
        events = list(s.exec(
            select(AuditEvent).order_by(AuditEvent.seq.desc()).limit(limit)
        ).all())
        return [{
            "id": e.seq, "seq": e.seq, "ts_sim": str(e.ts_sim),
            "actor_id": e.actor_id, "action": e.action,
            "subject_type": e.subject_type, "subject_id": e.subject_id,
            "payload_json": e.payload, "hash": e.hash,
        } for e in events]


@app.post("/audit/verify")
def api_verify_chain_post():
    with get_session() as s:
        valid, broken_at = verify_chain(s)
        return {"valid": valid, "broken_at": broken_at}


# ── Dashboard (frontend-friendly shape) ───────────────────────────────────────

COMPARISON_ROWS = [
    ("Claim contradicted internal evidence", "No mechanism to detect", "Gate blocks publication"),
    ("Escalation path", "Manual, stalled with VP Security", "Automatic 30/60/90-day ageing"),
    ("Independence on escalation", "Same person owned claim + security", "Conflict skip bypasses claim owner"),
    ("Controls tested?", "Paper-only; never verified", "Automated tests; never tested = BLOCK"),
    ("Risk acceptance tracking", "Ad-hoc, undocumented", "Ledger tied to published claims"),
    ("Board visibility", "None until breach", "L4 escalation to Audit Committee"),
]

@app.get("/dashboard")
def api_dashboard_frontend():
    with get_session() as s:
        as_of = get_clock(s)
        claims = list(s.exec(select(Claim)).all())
        findings = list(s.exec(select(Finding)).all())
        overrides = list(s.exec(select(Override)).all())

        active_ovs = [o for o in overrides if o.status == OverrideStatus.ACTIVE
                      and o.expires_on >= as_of]
        open_findings = [f for f in findings if f.status == FindingStatus.OPEN]

        claim_states = []
        blocked = 0
        for c in claims:
            d = s.exec(
                select(GateDecision).where(GateDecision.claim_id == c.id)
                .order_by(GateDecision.id.desc())
            ).first()
            verdict = d.decision if d else "PENDING"
            if verdict == "BLOCK":
                blocked += 1
            claim_states.append({
                "id": c.id,
                "title": c.text[:60],
                "verdict": verdict,
                "support_state": c.support_state or "UNMAPPED",
            })

        return {
            "sim_date": str(as_of),
            "claims_total": len(claims),
            "claims_blocked": blocked,
            "open_findings": len(open_findings),
            "active_overrides": len(active_ovs),
            "claim_states": claim_states,
            "comparison": [
                {"metric": m, "without_gate": wg, "with_gate": w}
                for m, wg, w in COMPARISON_ROWS
            ],
        }


@app.post("/audit/tamper-demo")
def api_tamper_demo():
    shutil.copy("disclosure_gate.db", "tamper_demo.db")
    conn = sqlite3.connect("tamper_demo.db")
    cur = conn.cursor()
    cur.execute("SELECT seq, payload FROM auditevent ORDER BY seq LIMIT 1 OFFSET 2")
    row = cur.fetchone()
    if not row:
        conn.close()
        os.remove("tamper_demo.db")
        raise HTTPException(400, "Not enough audit events yet.")
    seq, payload_str = row
    payload = json.loads(payload_str or "{}")
    payload["__tampered__"] = True
    cur.execute("UPDATE auditevent SET payload=? WHERE seq=?", (json.dumps(payload), seq))
    conn.commit()
    conn.close()
    from sqlmodel import create_engine, Session as TSession
    tamper_engine = create_engine("sqlite:///./tamper_demo.db",
                                  connect_args={"check_same_thread": False})
    with TSession(tamper_engine) as ts:
        valid, broken_at = verify_chain(ts)
    os.remove("tamper_demo.db")
    return {"valid": valid, "broken_at": broken_at}


# ── Dashboard ─────────────────────────────────────────────────────────────────

@app.get("/dashboard")
def api_dashboard():
    with get_session() as s:
        as_of = get_clock(s)
        claims = list(s.exec(select(Claim)).all())
        findings = list(s.exec(select(Finding)).all())
        overrides = list(s.exec(select(Override)).all())
        ras = list(s.exec(select(RiskAcceptance)).all())
        controls = list(s.exec(select(Control)).all())
        escs = list(s.exec(select(Escalation)).all())

        published = [c for c in claims if c.status == "published"]
        open_high = [f for f in findings if f.status == FindingStatus.OPEN
                     and f.severity in ("HIGH", "CRITICAL")]
        active_ovs = [o for o in overrides if o.status == OverrideStatus.ACTIVE
                      and o.expires_on >= as_of]
        ra_public = [r for r in ras if r.affects_public_claims and r.status == "APPROVED"]
        never_tested = [c for c in controls if c.test_id and not s.exec(
            select(TestResult).where(TestResult.control_id == c.id)
        ).first()]

        longest_unsupported = 0
        for c in published:
            if c.support_state == "UNSUPPORTED":
                first_block = s.exec(
                    select(GateDecision).where(
                        GateDecision.claim_id == c.id, GateDecision.decision == "BLOCK"
                    ).order_by(GateDecision.id)
                ).first()
                if first_block:
                    longest_unsupported = max(longest_unsupported,
                                              (as_of - first_block.evaluated_on).days)

        level3_escs = [e for e in escs if e.subject_type == "claim" and e.level >= 3]
        level4_escs = [e for e in escs if e.level >= 4]
        override_authors = list({o.by_id for o in overrides})

        state_counts = {st: sum(1 for c in published if c.support_state == st)
                        for st in ("SUPPORTED", "AT_RISK", "UNSUPPORTED", "UNMAPPED")}

        return {
            "as_of": str(as_of),
            "kpis": {
                "published_claims": len(published),
                "supported": state_counts["SUPPORTED"],
                "at_risk": state_counts["AT_RISK"],
                "unsupported": state_counts["UNSUPPORTED"],
                "longest_unsupported_days": longest_unsupported,
                "open_high_critical": len(open_high),
                "oldest_high_days": max((as_of - f.opened_on).days for f in open_high) if open_high else 0,
                "active_overrides": len(active_ovs),
                "expiring_soon_overrides": sum(1 for o in active_ovs if (o.expires_on - as_of).days <= 14),
                "ra_on_public_claims": len(ra_public),
                "controls_never_tested": len(never_tested),
            },
            "claim_states": state_counts,
            "comparison": {
                "longest_unsupported_days": longest_unsupported,
                "disclosure_committee_saw_vpn": len(level3_escs),
                "audit_committee_saw_it": len(level4_escs),
                "override_authors": [ACTORS_BY_ID.get(oid, {}).get("name", oid)
                                     for oid in override_authors],
            },
            "active_overrides": [{
                "id": o.id, "claim_id": o.claim_id, "by_id": o.by_id,
                "reason": o.reason[:80], "expires_on": str(o.expires_on),
                "days_left": (o.expires_on - as_of).days,
                "by_name": ACTORS_BY_ID.get(o.by_id, {}).get("name", o.by_id),
            } for o in active_ovs],
        }
