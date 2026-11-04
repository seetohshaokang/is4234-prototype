"""FastAPI wrapper around services.py — runs from prototype/ root."""

import json
from datetime import date
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlmodel import select

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from db import (
    get_session, create_tables,
    Control, Finding, FindingStatus, CaseNote,
    CheckDefinition, Collector, CollectorStatus,
    SCC, SCCVersion, SCCVersionStatus, SCCVersionControl,
    StateInterval, SCCState,
    Escalation, EscalationStatus, CommitteeResponse,
    ChangeRequest, ChangeRequestType, ChangeRequestStatus,
    IssuedCitation, CitationKind, TestResult, ManualEvidence,
    AuditEvent, CheckpointApplied, Person, Role,
)
from services import (
    get_clock, set_clock, advance_clock,
    run_due_checks, rebuild_all_intervals,
    escalate_case, ack_escalation, resolve_escalation, respond_escalation,
    create_change_request, approve_change_request, reject_change_request,
    approve_collector, submit_collector, apply_checkpoint, CHECKPOINTS,
)
from engine.sla import uptime_pct, rolling_target_met
from audit import verify_chain, append_event
from seed import seed_db, generate_snapshots, apply_all_checkpoints

app = FastAPI(title="SCC Library API", version="1.0.0")
create_tables()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic models ───────────────────────────────────────────────────────────

class ClockSet(BaseModel):
    date: str


class AdvanceDays(BaseModel):
    days: int


class ChangeRequestBody(BaseModel):
    type: str
    scc_id: str
    reason: str
    proposal: Optional[dict] = None


class ApproveChangeRequestBody(BaseModel):
    auditor_note: str = ""
    assertion_text: str = ""
    target_uptime_pct: float = 99.0
    rolling_window_days: int = 365
    max_single_downtime_days: int = 7
    evidence_type: str = "TESTED"
    pinned_controls: Optional[list[dict]] = None
    effective_on: Optional[str] = None


class RejectBody(BaseModel):
    auditor_note: str


class CaseStatusUpdate(BaseModel):
    status: str


class CaseNoteCreate(BaseModel):
    body: str
    author_id: str


class CaseLevelUpdate(BaseModel):
    level: int


class CollectorSubmitBody(BaseModel):
    check_id: str
    version: str
    code_hash: str


class EscalationRespondBody(BaseModel):
    decision: str
    rationale: str
    due_on: Optional[str] = None


class CitationGenerateBody(BaseModel):
    sccversion_id: str
    period_from: str
    period_to: str
    kind: str = "POSITIVE"
    issued_by: str = "PUBLIC"


class ResolveBody(BaseModel):
    citation_string: Optional[str] = None
    sccversion_id: Optional[str] = None
    period_from: Optional[str] = None
    period_to: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _actor(actor_id: str) -> str:
    return actor_id or "P-GRANT"


def _intervals_for(session, sccversion_id: str) -> list[dict]:
    ivs = list(session.exec(
        select(StateInterval).where(StateInterval.sccversion_id == sccversion_id)
        .order_by(StateInterval.start)  # type: ignore[attr-defined]
    ).all())
    return [{"state": str(i.state), "start": i.start, "end": i.end,
             "detected_at": i.detected_at, "possibly_since": i.possibly_since,
             "cause_note": i.cause_note} for i in ivs]


def _sv_dict(sv: SCCVersion) -> dict:
    return {
        "id": sv.id, "scc_id": sv.scc_id, "version": sv.version,
        "assertion_text": sv.assertion_text, "status": str(sv.status),
        "active_from": str(sv.active_from) if sv.active_from else None,
        "active_to": str(sv.active_to) if sv.active_to else None,
        "target_uptime_pct": sv.target_uptime_pct,
        "rolling_window_days": sv.rolling_window_days,
        "max_single_downtime_days": sv.max_single_downtime_days,
        "evidence_type": str(sv.evidence_type),
        "supersedes_version_id": sv.supersedes_version_id,
        "superseded_while_down": sv.superseded_while_down,
        "deprecated_while_down": sv.deprecated_while_down,
        "reason": sv.reason, "approved_by": sv.approved_by,
        "auditor_note": sv.auditor_note,
    }


def _current_state_on(intervals: list[dict], as_of: date) -> str:
    for iv in reversed(intervals):
        start = iv["start"] if isinstance(iv["start"], date) else date.fromisoformat(str(iv["start"]))
        end = iv["end"]
        if end and not isinstance(end, date):
            end = date.fromisoformat(str(end))
        if start <= as_of and (end is None or end >= as_of):
            return iv["state"]
    return "NOT_ACTIVE"


# ── Clock ─────────────────────────────────────────────────────────────────────

@app.get("/clock")
def get_clock_route():
    with get_session() as session:
        return {"date": str(get_clock(session))}


@app.post("/clock/set")
def set_clock_route(body: ClockSet, actor_id: str = "SYSTEM"):
    with get_session() as session:
        d = date.fromisoformat(body.date)
        set_clock(session, d, _actor(actor_id))
        return {"date": str(d)}


@app.post("/clock/advance")
def advance_clock_route(body: AdvanceDays, actor_id: str = "SYSTEM"):
    with get_session() as session:
        new_date = advance_clock(session, body.days, _actor(actor_id))
        return {"date": str(new_date)}


# ── Personas ──────────────────────────────────────────────────────────────────

@app.get("/personas")
def get_personas():
    with get_session() as session:
        people = list(session.exec(select(Person)).all())
        return [{"id": p.id, "name": p.name, "role": str(p.role), "title": p.title}
                for p in people]


# ── SCCs ──────────────────────────────────────────────────────────────────────

@app.get("/sccs")
def list_sccs():
    with get_session() as session:
        as_of = get_clock(session)
        sccs = list(session.exec(select(SCC)).all())
        result = []
        for scc in sccs:
            versions = list(session.exec(
                select(SCCVersion).where(SCCVersion.scc_id == scc.id)
                .order_by(SCCVersion.version.desc())  # type: ignore[attr-defined]
            ).all())
            active_sv = next((sv for sv in versions
                              if sv.status not in (SCCVersionStatus.REJECTED, SCCVersionStatus.PROPOSED)), None)
            # Skip SCCs that have no non-rejected version (e.g. SCC-04)
            if not active_sv:
                continue
            intervals = _intervals_for(session, active_sv.id)
            current_state = _current_state_on(intervals, as_of)
            uptime = None
            if active_sv.active_from:
                u, unk, days = uptime_pct(intervals, active_sv.active_from, as_of)
                uptime = round(u, 2)
            visible_versions = [sv for sv in versions
                                if sv.status != SCCVersionStatus.REJECTED]
            result.append({
                "id": scc.id, "title": scc.title, "owner_id": scc.owner_id,
                "current_state": current_state,
                "active_version_id": active_sv.id,
                "versions": [_sv_dict(sv) for sv in visible_versions],
                "rolling_uptime_pct": uptime,
            })
        return result


@app.get("/sccs/{scc_id}")
def get_scc(scc_id: str):
    with get_session() as session:
        as_of = get_clock(session)
        scc = session.get(SCC, scc_id)
        if not scc:
            raise HTTPException(404, f"SCC {scc_id} not found")
        versions = list(session.exec(
            select(SCCVersion).where(SCCVersion.scc_id == scc_id)
            .order_by(SCCVersion.version)  # type: ignore[attr-defined]
        ).all())
        versions = [sv for sv in versions if sv.status != SCCVersionStatus.REJECTED]
        if not versions:
            raise HTTPException(404, f"SCC {scc_id} has no visible versions")
        versions_with_intervals = []
        for sv in versions:
            ivs = _intervals_for(session, sv.id)
            p_from = sv.active_from or as_of
            p_to = sv.active_to or as_of
            u_pct, unk_pct, active_days = uptime_pct(ivs, p_from, p_to) if sv.active_from else (0.0, 0.0, 0)
            controls = list(session.exec(
                select(SCCVersionControl).where(SCCVersionControl.sccversion_id == sv.id)
            ).all())
            versions_with_intervals.append({
                **_sv_dict(sv),
                "intervals": [{"state": iv["state"],
                                "start": str(iv["start"]),
                                "end": str(iv["end"]) if iv["end"] else None,
                                "detected_at": str(iv["detected_at"]) if iv["detected_at"] else None,
                                "possibly_since": str(iv["possibly_since"]) if iv["possibly_since"] else None,
                                "cause_note": iv["cause_note"]}
                               for iv in ivs],
                "uptime_pct": round(u_pct, 2),
                "unknown_pct": round(unk_pct, 2),
                "active_days": active_days,
                "controls": [{"control_id": c.control_id, "check_id": c.check_id,
                               "check_version": c.check_version} for c in controls],
            })
        return {"id": scc.id, "title": scc.title, "owner_id": scc.owner_id,
                "versions": versions_with_intervals}


# ── Controls & check runs ─────────────────────────────────────────────────────

@app.get("/controls")
def list_controls():
    with get_session() as session:
        controls = list(session.exec(select(Control)).all())
        result = []
        for ctl in controls:
            last_result = session.exec(
                select(TestResult).where(TestResult.control_id == ctl.id)
                .order_by(TestResult.run_on.desc())  # type: ignore[attr-defined]
            ).first()
            result.append({
                "id": ctl.id, "name": ctl.name, "owner_id": ctl.owner_id,
                "check_id": ctl.check_id,
                "last_outcome": str(last_result.outcome) if last_result else None,
                "last_run_on": str(last_result.run_on) if last_result else None,
                "last_summary": last_result.evidence_summary if last_result else None,
            })
        return result


@app.get("/test-results")
def list_test_results(control_id: Optional[str] = None, limit: int = 50):
    with get_session() as session:
        q = select(TestResult).order_by(TestResult.run_on.desc())  # type: ignore[attr-defined]
        if control_id:
            q = q.where(TestResult.control_id == control_id)
        results = list(session.exec(q.limit(limit)).all())
        return [{"id": r.id, "control_id": r.control_id, "check_id": r.check_id,
                 "check_version": r.check_version, "run_on": str(r.run_on),
                 "outcome": str(r.outcome), "evidence_summary": r.evidence_summary,
                 "measured_value": r.measured_value,
                 "collector_approved_at_run": r.collector_approved_at_run}
                for r in results]


# ── Checks & Collectors ───────────────────────────────────────────────────────

@app.get("/checks")
def list_checks():
    with get_session() as session:
        defs = list(session.exec(select(CheckDefinition)).all())
        return [{"id": d.id, "version": d.version, "name": d.name,
                 "threshold_desc": d.threshold_desc,
                 "test_frequency_days": d.test_frequency_days,
                 "defined_by": d.defined_by,
                 "params": json.loads(d.params) if d.params else {}}
                for d in defs]


@app.get("/collectors")
def list_collectors():
    with get_session() as session:
        cols = list(session.exec(select(Collector)).all())
        return [{"id": c.id, "check_id": c.check_id, "version": c.version,
                 "status": str(c.status), "written_by": c.written_by,
                 "submitted_on": str(c.submitted_on),
                 "approved_by": c.approved_by,
                 "approved_on": str(c.approved_on) if c.approved_on else None}
                for c in cols]


@app.post("/collectors")
def submit_collector_route(body: CollectorSubmitBody, actor_id: str = "P-PRIYA"):
    with get_session() as session:
        col = submit_collector(session, body.check_id, body.version,
                               body.code_hash, _actor(actor_id))
        return {"id": col.id, "status": str(col.status)}


@app.post("/collectors/{collector_id}/approve")
def approve_collector_route(collector_id: str, actor_id: str = "P-REYES"):
    with get_session() as session:
        try:
            col = approve_collector(session, collector_id, _actor(actor_id))
            return {"id": col.id, "status": str(col.status)}
        except ValueError as e:
            raise HTTPException(403, str(e))


# ── Change Requests ───────────────────────────────────────────────────────────

@app.get("/change-requests")
def list_change_requests():
    with get_session() as session:
        crs = list(session.exec(select(ChangeRequest)).all())
        return [{"id": cr.id, "type": str(cr.type), "scc_id": cr.scc_id,
                 "requested_by": cr.requested_by, "requested_on": str(cr.requested_on),
                 "reason": cr.reason, "status": str(cr.status),
                 "decided_by": cr.decided_by,
                 "decided_on": str(cr.decided_on) if cr.decided_on else None,
                 "auditor_note": cr.auditor_note,
                 "effective_on": str(cr.effective_on) if cr.effective_on else None}
                for cr in crs]


@app.post("/change-requests")
def create_change_request_route(body: ChangeRequestBody, actor_id: str = "P-GRANT"):
    with get_session() as session:
        try:
            cr = create_change_request(session, body.type, body.scc_id,
                                       _actor(actor_id), body.reason, body.proposal)
            return {"id": cr.id, "status": str(cr.status)}
        except ValueError as e:
            raise HTTPException(403, str(e))


@app.post("/change-requests/{cr_id}/approve")
def approve_change_request_route(cr_id: str, body: ApproveChangeRequestBody,
                                  actor_id: str = "P-REYES"):
    with get_session() as session:
        try:
            kwargs = body.model_dump(exclude_none=True)
            if "effective_on" in kwargs and kwargs["effective_on"]:
                kwargs["effective_on"] = date.fromisoformat(kwargs["effective_on"])
            cr = approve_change_request(session, cr_id, _actor(actor_id), **kwargs)
            return {"id": cr.id, "status": str(cr.status)}
        except ValueError as e:
            raise HTTPException(400, str(e))


@app.post("/change-requests/{cr_id}/reject")
def reject_change_request_route(cr_id: str, body: RejectBody, actor_id: str = "P-REYES"):
    with get_session() as session:
        try:
            cr = reject_change_request(session, cr_id, _actor(actor_id), body.auditor_note)
            return {"id": cr.id, "status": str(cr.status)}
        except ValueError as e:
            raise HTTPException(403, str(e))


# ── Findings ──────────────────────────────────────────────────────────────────

@app.get("/findings")
def list_findings(status: Optional[str] = None):
    with get_session() as session:
        as_of = get_clock(session)
        q = select(Finding)
        if status:
            q = q.where(Finding.status == status)
        findings = list(session.exec(q.order_by(Finding.opened_on.desc(), Finding.id.asc())).all())  # type: ignore[attr-defined]
        control_map = {c.id: c for c in session.exec(select(Control)).all()}
        return [{"id": f.id, "control_id": f.control_id,
                 "check_id": control_map[f.control_id].check_id if f.control_id in control_map else None,
                 "severity": str(f.severity),
                 "status": str(f.status), "opened_on": str(f.opened_on),
                 "closed_on": str(f.closed_on) if f.closed_on else None,
                 "days_open": (as_of - f.opened_on).days if f.status == FindingStatus.OPEN else None,
                 "source": f.source, "title": f.title, "description": f.description,
                 "root_cause_note": f.root_cause_note, "level": f.level}
                for f in findings]


@app.get("/findings/{finding_id}")
def get_finding(finding_id: str):
    with get_session() as session:
        as_of = get_clock(session)
        f = session.get(Finding, finding_id)
        if not f:
            raise HTTPException(status_code=404, detail="Case not found")
        control_map = {c.id: c for c in session.exec(select(Control)).all()}
        return {
            "id": f.id, "control_id": f.control_id,
            "check_id": control_map[f.control_id].check_id if f.control_id in control_map else None,
            "severity": str(f.severity), "status": str(f.status),
            "opened_on": str(f.opened_on),
            "closed_on": str(f.closed_on) if f.closed_on else None,
            "days_open": (as_of - f.opened_on).days if f.status == FindingStatus.OPEN else None,
            "source": f.source, "title": f.title, "description": f.description,
            "root_cause_note": f.root_cause_note, "level": f.level,
        }


VALID_TRANSITIONS: dict[str, list[str]] = {
    "OPEN":      ["IN_REVIEW"],
    "IN_REVIEW": ["RESOLVED", "CLOSED"],
    "RESOLVED":  [],
    "CLOSED":    [],
}

@app.patch("/findings/{finding_id}/status")
def update_finding_status(finding_id: str, body: CaseStatusUpdate):
    with get_session() as session:
        as_of = get_clock(session)
        f = session.get(Finding, finding_id)
        if not f:
            raise HTTPException(status_code=404, detail="Case not found")
        allowed = VALID_TRANSITIONS.get(str(f.status), [])
        if body.status not in allowed:
            raise HTTPException(status_code=400, detail=f"Cannot transition from {f.status} to {body.status}")
        f.status = FindingStatus(body.status)
        if body.status in ("RESOLVED", "CLOSED"):
            f.closed_on = as_of
        session.add(f)
        session.commit()
        if body.status == "IN_REVIEW" and f.level is None:
            escalate_case(session, finding_id, 1, "SYSTEM")
        return {"ok": True, "status": body.status}


@app.patch("/findings/{finding_id}/level")
def update_finding_level(finding_id: str, body: CaseLevelUpdate):
    with get_session() as session:
        f = session.get(Finding, finding_id)
        if not f:
            raise HTTPException(status_code=404, detail="Case not found")
        if body.level not in (1, 2, 3):
            raise HTTPException(status_code=400, detail="Level must be 1, 2, or 3")
        if f.level is not None and body.level <= f.level:
            raise HTTPException(status_code=400, detail="Can only escalate to a higher level")
        try:
            esc = escalate_case(session, finding_id, body.level, "SYSTEM")
            return {"ok": True, "level": body.level, "escalation_id": esc.id}
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))


@app.get("/findings/{finding_id}/notes")
def list_case_notes(finding_id: str):
    with get_session() as session:
        notes = list(session.exec(
            select(CaseNote)
            .where(CaseNote.finding_id == finding_id)
            .order_by(CaseNote.created_on.asc())  # type: ignore[attr-defined]
        ).all())
        person_map = {p.id: p for p in session.exec(select(Person)).all()}
        return [
            {
                "id": n.id, "author_id": n.author_id,
                "author_name": person_map[n.author_id].name if n.author_id in person_map else n.author_id,
                "created_on": str(n.created_on), "body": n.body,
            }
            for n in notes
        ]


@app.post("/findings/{finding_id}/notes")
def add_case_note(finding_id: str, body: CaseNoteCreate):
    with get_session() as session:
        f = session.get(Finding, finding_id)
        if not f:
            raise HTTPException(status_code=404, detail="Case not found")
        as_of = get_clock(session)
        note = CaseNote(finding_id=finding_id, author_id=body.author_id, created_on=as_of, body=body.body)
        session.add(note)
        session.commit()
        session.refresh(note)
        return {"id": note.id, "author_id": note.author_id, "created_on": str(note.created_on), "body": note.body}


# ── Escalations ───────────────────────────────────────────────────────────────

@app.get("/escalations")
def list_escalations():
    with get_session() as session:
        escs = list(session.exec(
            select(Escalation).order_by(Escalation.created_on.desc())  # type: ignore[attr-defined]
        ).all())
        finding_map = {f.id: f for f in session.exec(select(Finding)).all()}
        control_map = {c.id: c for c in session.exec(select(Control)).all()}
        result = []
        for e in escs:
            responses = list(session.exec(
                select(CommitteeResponse).where(CommitteeResponse.escalation_id == e.id)
            ).all())
            f = finding_map.get(e.finding_id)
            check_id = control_map[f.control_id].check_id if f and f.control_id in control_map else None
            result.append({
                "id": e.id,
                "finding_id": e.finding_id,
                "finding_title": f.title if f else None,
                "check_id": check_id,
                "level": e.level,
                "assigned_to_role": str(e.assigned_to_role),
                "reason": e.reason,
                "created_on": str(e.created_on),
                "acknowledged_on": str(e.acknowledged_on) if e.acknowledged_on else None,
                "resolved_on": str(e.resolved_on) if e.resolved_on else None,
                "status": str(e.status),
                "responses": [{"decision": str(r.decision), "rationale": r.rationale,
                                "due_on": str(r.due_on) if r.due_on else None,
                                "decided_by": r.decided_by,
                                "decided_on": str(r.decided_on)} for r in responses],
            })
        return result


@app.post("/escalations/{esc_id}/ack")
def ack_escalation_route(esc_id: int, actor_id: str = "P-PRIYA"):
    with get_session() as session:
        try:
            esc = ack_escalation(session, esc_id, _actor(actor_id))
            return {"id": esc.id, "status": str(esc.status)}
        except ValueError as e:
            raise HTTPException(404, str(e))


@app.post("/escalations/{esc_id}/resolve")
def resolve_escalation_route(esc_id: int, actor_id: str = "P-PRIYA"):
    with get_session() as session:
        try:
            esc = resolve_escalation(session, esc_id, _actor(actor_id))
            return {"id": esc.id, "status": str(esc.status)}
        except ValueError as e:
            raise HTTPException(404, str(e))


@app.post("/escalations/{esc_id}/respond")
def respond_escalation_route(esc_id: int, body: EscalationRespondBody,
                              actor_id: str = "P-OKAFOR"):
    with get_session() as session:
        try:
            due = date.fromisoformat(body.due_on) if body.due_on else None
            resp = respond_escalation(session, esc_id, _actor(actor_id),
                                      body.decision, body.rationale, due)
            return {"id": resp.id, "decision": str(resp.decision)}
        except ValueError as e:
            raise HTTPException(400, str(e))


def _generate_negative_citation(session, sccversion_id: str, as_of: date, issued_by: str):
    sv = session.get(SCCVersion, sccversion_id)
    if not sv or sv.status not in (SCCVersionStatus.ACTIVE, SCCVersionStatus.SUPERSEDED,
                                    SCCVersionStatus.DEPRECATED):
        return
    intervals = _intervals_for(session, sccversion_id)
    period_from = sv.active_from or as_of
    period_to = sv.active_to or as_of
    u_pct, unk_pct, days = uptime_pct(intervals, period_from, period_to)
    met = u_pct >= sv.target_uptime_pct
    citation_str = (f"({sv.scc_id} v{sv.version}, "
                    f"{period_from.year}: {u_pct:.1f}% upheld, "
                    f"target {sv.target_uptime_pct:.0f}% {'met' if met else 'missed'}) [NEGATIVE]")
    import hashlib
    payload = f"{sccversion_id}|{period_from}|{period_to}|{u_pct}|NEGATIVE"
    record_hash = hashlib.sha256(payload.encode()).hexdigest()[:16]
    citation = IssuedCitation(
        sccversion_id=sccversion_id,
        kind=CitationKind.NEGATIVE,
        period_from=period_from,
        period_to=period_to,
        uptime_pct=u_pct,
        unknown_pct=unk_pct,
        target_met=met,
        citation_string=citation_str,
        issued_by=issued_by,
        issued_on=as_of,
        record_hash=record_hash,
    )
    session.add(citation)
    session.flush()


# ── Citations ─────────────────────────────────────────────────────────────────

@app.get("/citations")
def list_citations():
    with get_session() as session:
        cits = list(session.exec(select(IssuedCitation)).all())
        return [{"id": c.id, "sccversion_id": c.sccversion_id, "kind": str(c.kind),
                 "period_from": str(c.period_from), "period_to": str(c.period_to),
                 "uptime_pct": c.uptime_pct, "unknown_pct": c.unknown_pct,
                 "target_met": c.target_met, "citation_string": c.citation_string,
                 "issued_by": c.issued_by, "issued_on": str(c.issued_on),
                 "record_hash": c.record_hash}
                for c in cits]


@app.post("/citations/generate")
def generate_citation(body: CitationGenerateBody):
    with get_session() as session:
        sv = session.get(SCCVersion, body.sccversion_id)
        if not sv:
            raise HTTPException(404, "SCC version not found")
        if sv.status in (SCCVersionStatus.PROPOSED, SCCVersionStatus.REJECTED):
            raise HTTPException(400, "Cannot cite a PROPOSED or REJECTED SCC version.")
        period_from = date.fromisoformat(body.period_from)
        period_to = date.fromisoformat(body.period_to)
        if sv.active_from and period_from < sv.active_from:
            raise HTTPException(400, "period_from is before the SCC active_from date.")
        if sv.active_to and period_to > sv.active_to:
            raise HTTPException(400, "period_to is after the SCC active_to date.")
        intervals = _intervals_for(session, body.sccversion_id)
        u_pct, unk_pct, days = uptime_pct(intervals, period_from, period_to)
        met = u_pct >= sv.target_uptime_pct
        kind = CitationKind(body.kind)
        citation_str = (f"({sv.scc_id} v{sv.version}, "
                        f"{period_from.year}: {u_pct:.1f}% upheld, "
                        f"target {sv.target_uptime_pct:.0f}% {'met' if met else 'missed'})"
                        + (" [NEGATIVE]" if kind == CitationKind.NEGATIVE else ""))
        import hashlib
        payload = f"{body.sccversion_id}|{period_from}|{period_to}|{u_pct}|{body.kind}"
        record_hash = hashlib.sha256(payload.encode()).hexdigest()[:16]
        as_of = get_clock(session)
        citation = IssuedCitation(
            sccversion_id=body.sccversion_id, kind=kind,
            period_from=period_from, period_to=period_to,
            uptime_pct=u_pct, unknown_pct=unk_pct, target_met=met,
            citation_string=citation_str, issued_by=body.issued_by,
            issued_on=as_of, record_hash=record_hash,
        )
        session.add(citation)
        session.commit()
        session.refresh(citation)
        return {"id": citation.id, "citation_string": citation_str,
                "uptime_pct": u_pct, "unknown_pct": unk_pct,
                "target_met": met, "record_hash": record_hash}


@app.post("/resolve")
def resolve_citation(body: ResolveBody):
    with get_session() as session:
        if body.citation_string:
            result = _parse_citation_string(body.citation_string)
            if not result:
                raise HTTPException(400, "Cannot parse citation string.")
            sccversion_id, period_from, period_to, claimed_uptime = result
        elif body.sccversion_id and body.period_from and body.period_to:
            sccversion_id = body.sccversion_id
            period_from = date.fromisoformat(body.period_from)
            period_to = date.fromisoformat(body.period_to)
            claimed_uptime = None
        else:
            raise HTTPException(400, "Provide citation_string or sccversion_id+period_from+period_to")
        sv = session.get(SCCVersion, sccversion_id)
        if not sv:
            raise HTTPException(404, f"SCC version {sccversion_id} not found")
        intervals = _intervals_for(session, sccversion_id)
        u_pct, unk_pct, days = uptime_pct(intervals, period_from, period_to)
        met = u_pct >= sv.target_uptime_pct
        logged = list(session.exec(
            select(IssuedCitation).where(
                IssuedCitation.sccversion_id == sccversion_id,
                IssuedCitation.period_from == period_from,
                IssuedCitation.period_to == period_to,
            )
        ).all())
        mismatch = None
        if claimed_uptime is not None:
            diff = abs(u_pct - claimed_uptime)
            mismatch = diff > 0.1
        return {
            "sccversion_id": sccversion_id,
            "period_from": str(period_from), "period_to": str(period_to),
            "computed_uptime_pct": u_pct, "computed_unknown_pct": unk_pct,
            "target_met": met, "claimed_uptime_pct": claimed_uptime,
            "mismatch": mismatch,
            "mismatch_delta": round(abs(u_pct - claimed_uptime), 4) if claimed_uptime is not None else None,
            "logged_citations": [{"id": c.id, "kind": str(c.kind),
                                   "uptime_pct": c.uptime_pct,
                                   "citation_string": c.citation_string,
                                   "record_hash": c.record_hash}
                                  for c in logged],
        }


def _parse_citation_string(s: str):
    import re
    m = re.search(r'\(?(SCC-\d+)\s*v(\d+),\s*(\d{4}):\s*([\d.]+)%\s*upheld', s)
    if m:
        scc_id, version, year, pct = m.groups()
        sccversion_id = f"{scc_id}-v{version}"
        period_from = date(int(year), 1, 1)
        period_to = date(int(year), 12, 31)
        return sccversion_id, period_from, period_to, float(pct)
    m = re.search(r'\(?(SCC-\d+-v\d+),\s*(\d{4}):\s*([\d.]+)%\s*upheld', s)
    if m:
        sccversion_id, year, pct = m.groups()
        period_from = date(int(year), 1, 1)
        period_to = date(int(year), 12, 31)
        return sccversion_id, period_from, period_to, float(pct)
    return None


# ── Audit ─────────────────────────────────────────────────────────────────────

@app.get("/audit")
def list_audit(limit: int = 100):
    with get_session() as session:
        events = list(session.exec(
            select(AuditEvent).order_by(AuditEvent.seq.desc())  # type: ignore[attr-defined]
            .limit(limit)
        ).all())
        return [{"seq": e.seq, "ts_sim": str(e.ts_sim), "actor_id": e.actor_id,
                 "action": e.action, "subject_type": e.subject_type,
                 "subject_id": e.subject_id,
                 "payload": json.loads(e.payload) if e.payload else None,
                 "hash": e.hash}
                for e in events]


@app.get("/audit/verify")
def verify_audit():
    with get_session() as session:
        ok, msg = verify_chain(session)
        return {"valid": ok, "message": msg}


# ── Checkpoints ───────────────────────────────────────────────────────────────

@app.get("/checkpoints")
def list_checkpoints():
    with get_session() as session:
        applied = {r.cp_id for r in session.exec(select(CheckpointApplied)).all()}
        return {"available": list(CHECKPOINTS.keys()), "applied": list(applied)}


@app.post("/checkpoints/{cp_id}/apply")
def apply_checkpoint_route(cp_id: str):
    with get_session() as session:
        if cp_id not in CHECKPOINTS:
            raise HTTPException(404, f"Unknown checkpoint: {cp_id}")
        apply_checkpoint(session, cp_id)
        return {"cp_id": cp_id, "applied": True, "clock": str(get_clock(session))}


# ── Reset ─────────────────────────────────────────────────────────────────────

@app.post("/reset")
def reset_db():
    from db import engine
    from sqlmodel import SQLModel
    SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)
    generate_snapshots()
    seed_db()
    apply_all_checkpoints()
    return {"status": "reset"}


# ── SLA ───────────────────────────────────────────────────────────────────────

@app.get("/sccs/{scc_id}/versions/{version_id}/sla")
def get_scc_sla(scc_id: str, version_id: str,
                period_from: Optional[str] = None, period_to: Optional[str] = None):
    with get_session() as session:
        as_of = get_clock(session)
        sv = session.get(SCCVersion, version_id)
        if not sv or sv.scc_id != scc_id:
            raise HTTPException(404, "SCC version not found")
        intervals = _intervals_for(session, version_id)
        p_from = date.fromisoformat(period_from) if period_from else (sv.active_from or as_of)
        p_to = date.fromisoformat(period_to) if period_to else (sv.active_to or as_of)
        u_pct, unk_pct, days = uptime_pct(intervals, p_from, p_to)
        from engine.sla import target_met as _target_met
        met = _target_met(u_pct, unk_pct, sv.target_uptime_pct,
                          sv.max_single_downtime_days, intervals, p_from, p_to)
        return {
            "sccversion_id": version_id,
            "period_from": str(p_from), "period_to": str(p_to),
            "uptime_pct": u_pct, "unknown_pct": unk_pct,
            "active_days": days, "target_met": met,
            "target_uptime_pct": sv.target_uptime_pct,
        }
