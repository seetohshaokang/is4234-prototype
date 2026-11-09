"""FastAPI wrapper around services.py — runs from prototype/ root."""

import json
from datetime import date
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from sqlmodel import select

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from db import (
    get_session, create_tables,
    Control, Finding, FindingStatus, CaseNote, ChangeRequestNote,
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
    auditor_create_scc, auditor_revise_scc, auditor_deprecate_scc,
)
from engine.sla import uptime_pct, rolling_target_met
from audit import verify_chain, append_event
from seed import seed_db, generate_snapshots, apply_all_checkpoints, patch_case_statuses

app = FastAPI(title="SCC Library API", version="1.0.0")
router = APIRouter()
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
    reason: Optional[str] = None  # required when closing as false alarm


class CaseNoteCreate(BaseModel):
    body: str
    author_id: str


class CaseLevelUpdate(BaseModel):
    level: int


class CaseAssign(BaseModel):
    person_id: str


class CRNoteCreate(BaseModel):
    body: str
    author_id: str


class SCCCreateBody(BaseModel):
    scc_id: str
    title: str
    owner_id: str
    assertion_text: str
    target_uptime_pct: float = 99.0
    rolling_window_days: int = 365
    max_single_downtime_days: int = 7
    evidence_type: str = "TESTED"


class SCCReviseBody(BaseModel):
    assertion_text: str
    reason: str
    target_uptime_pct: float = 99.0
    rolling_window_days: int = 365
    max_single_downtime_days: int = 7
    evidence_type: str = "TESTED"


class SCCDeprecateBody(BaseModel):
    reason: str


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
    return actor_id or "P-MARCUS"


# ── Case & escalation permissions ─────────────────────────────────────────────
# Audit Committee and the independent auditor are read-only on cases/escalations.

CASE_PICKUP_ROLES   = {Role.CONTROL_OWNER, Role.SECURITY_LEAD}
CASE_RESOLVE_ROLES  = {Role.CONTROL_OWNER, Role.SECURITY_LEAD}
CASE_CLOSE_ROLES    = {Role.SECURITY_LEAD, Role.DISCLOSURE_COMMITTEE}
CASE_NOTE_ROLES     = {Role.CONTROL_OWNER, Role.SECURITY_LEAD, Role.DISCLOSURE_COMMITTEE}
ESCALATE_ROLES      = {2: {Role.CONTROL_OWNER, Role.SECURITY_LEAD}, 3: {Role.SECURITY_LEAD}}
RESPOND_ROLES       = {Role.DISCLOSURE_COMMITTEE}
CLOSE_REASON_MIN    = 20


def _require_role(session, actor_id: Optional[str], allowed: set, action: str) -> Person:
    person = session.get(Person, actor_id) if actor_id else None
    if not person or person.role not in allowed:
        who = person.name if person else "This persona"
        raise HTTPException(403, f"{who} is not allowed to {action}.")
    return person


def _close_case_escalations(session, finding_id: str, as_of: date, actor_id: str) -> None:
    for esc in session.exec(
        select(Escalation).where(
            Escalation.finding_id == finding_id,
            Escalation.status.in_([EscalationStatus.OPEN, EscalationStatus.ACK]),  # type: ignore[attr-defined]
        )
    ).all():
        esc.status = EscalationStatus.RESOLVED
        esc.resolved_on = as_of
        session.add(esc)
        append_event(session, as_of, actor_id, "escalation_resolved", "escalation",
                     str(esc.id), {"finding_id": finding_id, "reason": "case_closed"})


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

@router.get("/clock")
def get_clock_route():
    with get_session() as session:
        return {"date": str(get_clock(session))}


@router.post("/clock/set")
def set_clock_route(body: ClockSet, actor_id: str = "SYSTEM"):
    with get_session() as session:
        d = date.fromisoformat(body.date)
        set_clock(session, d, _actor(actor_id))
        return {"date": str(d)}


@router.post("/clock/advance")
def advance_clock_route(body: AdvanceDays, actor_id: str = "SYSTEM"):
    with get_session() as session:
        new_date = advance_clock(session, body.days, _actor(actor_id))
        return {"date": str(new_date)}


# ── Personas ──────────────────────────────────────────────────────────────────

@router.get("/personas")
def get_personas():
    with get_session() as session:
        people = list(session.exec(select(Person)).all())
        return [{"id": p.id, "name": p.name, "role": str(p.role), "title": p.title}
                for p in people]


# ── SCCs ──────────────────────────────────────────────────────────────────────

@router.get("/sccs")
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


@router.get("/sccs/{scc_id}")
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


@router.post("/sccs")
def create_scc_route(body: SCCCreateBody, actor_id: str = "P-DAVID"):
    with get_session() as session:
        try:
            scc = auditor_create_scc(
                session, _actor(actor_id), body.scc_id, body.title,
                body.owner_id, body.assertion_text,
                body.target_uptime_pct, body.rolling_window_days,
                body.max_single_downtime_days, body.evidence_type,
            )
            return {"id": scc.id, "title": scc.title}
        except ValueError as e:
            raise HTTPException(400, str(e))


@router.post("/sccs/{scc_id}/revise")
def revise_scc_route(scc_id: str, body: SCCReviseBody, actor_id: str = "P-DAVID"):
    with get_session() as session:
        try:
            sv = auditor_revise_scc(
                session, _actor(actor_id), scc_id,
                body.assertion_text, body.reason,
                body.target_uptime_pct, body.rolling_window_days,
                body.max_single_downtime_days, body.evidence_type,
            )
            return {"id": sv.id, "version": sv.version, "status": str(sv.status)}
        except ValueError as e:
            raise HTTPException(400, str(e))


@router.post("/sccs/{scc_id}/deprecate")
def deprecate_scc_route(scc_id: str, body: SCCDeprecateBody, actor_id: str = "P-DAVID"):
    with get_session() as session:
        try:
            sv = auditor_deprecate_scc(session, _actor(actor_id), scc_id, body.reason)
            return {"id": sv.id, "status": str(sv.status)}
        except ValueError as e:
            raise HTTPException(400, str(e))


# ── Controls & check runs ─────────────────────────────────────────────────────

@router.get("/controls")
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


@router.get("/test-results")
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

@router.get("/checks")
def list_checks():
    with get_session() as session:
        defs = list(session.exec(select(CheckDefinition)).all())
        return [{"id": d.id, "version": d.version, "name": d.name,
                 "threshold_desc": d.threshold_desc,
                 "test_frequency_days": d.test_frequency_days,
                 "defined_by": d.defined_by,
                 "params": json.loads(d.params) if d.params else {}}
                for d in defs]


@router.get("/collectors")
def list_collectors():
    with get_session() as session:
        cols = list(session.exec(select(Collector)).all())
        return [{"id": c.id, "check_id": c.check_id, "version": c.version,
                 "status": str(c.status), "written_by": c.written_by,
                 "submitted_on": str(c.submitted_on),
                 "approved_by": c.approved_by,
                 "approved_on": str(c.approved_on) if c.approved_on else None}
                for c in cols]


@router.post("/collectors")
def submit_collector_route(body: CollectorSubmitBody, actor_id: str = "P-PRIYA"):
    with get_session() as session:
        col = submit_collector(session, body.check_id, body.version,
                               body.code_hash, _actor(actor_id))
        return {"id": col.id, "status": str(col.status)}


@router.post("/collectors/{collector_id}/approve")
def approve_collector_route(collector_id: str, actor_id: str = "P-DAVID"):
    with get_session() as session:
        try:
            col = approve_collector(session, collector_id, _actor(actor_id))
            return {"id": col.id, "status": str(col.status)}
        except ValueError as e:
            raise HTTPException(403, str(e))


# ── Change Requests ───────────────────────────────────────────────────────────

@router.get("/change-requests")
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


@router.post("/change-requests")
def create_change_request_route(body: ChangeRequestBody, actor_id: str = "P-MARCUS"):
    with get_session() as session:
        try:
            cr = create_change_request(session, body.type, body.scc_id,
                                       _actor(actor_id), body.reason, body.proposal)
            return {"id": cr.id, "status": str(cr.status)}
        except ValueError as e:
            raise HTTPException(403, str(e))


@router.post("/change-requests/{cr_id}/approve")
def approve_change_request_route(cr_id: str, body: ApproveChangeRequestBody,
                                  actor_id: str = "P-DAVID"):
    with get_session() as session:
        try:
            kwargs = body.model_dump(exclude_none=True)
            if "effective_on" in kwargs and kwargs["effective_on"]:
                kwargs["effective_on"] = date.fromisoformat(kwargs["effective_on"])
            cr = approve_change_request(session, cr_id, _actor(actor_id), **kwargs)
            return {"id": cr.id, "status": str(cr.status)}
        except ValueError as e:
            raise HTTPException(400, str(e))


@router.post("/change-requests/{cr_id}/reject")
def reject_change_request_route(cr_id: str, body: RejectBody, actor_id: str = "P-DAVID"):
    with get_session() as session:
        try:
            cr = reject_change_request(session, cr_id, _actor(actor_id), body.auditor_note)
            return {"id": cr.id, "status": str(cr.status)}
        except ValueError as e:
            raise HTTPException(403, str(e))


@router.get("/change-requests/{cr_id}/notes")
def list_cr_notes(cr_id: str):
    with get_session() as session:
        notes = list(session.exec(
            select(ChangeRequestNote)
            .where(ChangeRequestNote.cr_id == cr_id)
            .order_by(ChangeRequestNote.created_on.asc())  # type: ignore[attr-defined]
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


@router.post("/change-requests/{cr_id}/notes")
def add_cr_note(cr_id: str, body: CRNoteCreate):
    with get_session() as session:
        cr = session.get(ChangeRequest, cr_id)
        if not cr:
            raise HTTPException(status_code=404, detail="Change request not found")
        as_of = get_clock(session)
        note = ChangeRequestNote(cr_id=cr_id, author_id=body.author_id, created_on=as_of, body=body.body)
        session.add(note)
        session.flush()
        append_event(session, as_of, body.author_id, "cr_note_added",
                     "changerequest", cr_id, {"preview": body.body[:80]})
        session.commit()
        session.refresh(note)
        person = session.get(Person, body.author_id)
        return {"id": note.id, "author_id": note.author_id,
                "author_name": person.name if person else note.author_id,
                "created_on": str(note.created_on), "body": note.body}


# ── Findings ──────────────────────────────────────────────────────────────────

@router.get("/findings")
def list_findings(status: Optional[str] = None):
    with get_session() as session:
        as_of = get_clock(session)
        q = select(Finding)
        if status:
            q = q.where(Finding.status == status)
        findings = list(session.exec(q.order_by(Finding.opened_on.desc(), Finding.id.asc())).all())  # type: ignore[attr-defined]
        control_map = {c.id: c for c in session.exec(select(Control)).all()}
        person_map = {p.id: p for p in session.exec(select(Person)).all()}
        return [{"id": f.id, "control_id": f.control_id,
                 "check_id": control_map[f.control_id].check_id if f.control_id in control_map else None,
                 "severity": str(f.severity),
                 "status": str(f.status), "opened_on": str(f.opened_on),
                 "closed_on": str(f.closed_on) if f.closed_on else None,
                 "days_open": (as_of - f.opened_on).days if f.status == FindingStatus.OPEN else None,
                 "source": f.source, "title": f.title, "description": f.description,
                 "root_cause_note": f.root_cause_note, "level": f.level,
                 "assigned_to_id": f.assigned_to_id,
                 "assigned_to_name": person_map[f.assigned_to_id].name if f.assigned_to_id and f.assigned_to_id in person_map else None}
                for f in findings]


@router.get("/findings/{finding_id}")
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
            "assigned_to_id": f.assigned_to_id,
            "assigned_to_name": session.get(Person, f.assigned_to_id).name if f.assigned_to_id else None,
        }


VALID_TRANSITIONS: dict[str, list[str]] = {
    "OPEN":      ["IN_REVIEW"],
    "IN_REVIEW": ["RESOLVED", "CLOSED"],
    "RESOLVED":  [],
    "CLOSED":    [],
}

def _has_committee_response(session, finding_id: str) -> bool:
    l3_ids = [e.id for e in session.exec(
        select(Escalation).where(Escalation.finding_id == finding_id, Escalation.level == 3)
    ).all()]
    if not l3_ids:
        return False
    return session.exec(
        select(CommitteeResponse).where(CommitteeResponse.escalation_id.in_(l3_ids))  # type: ignore[attr-defined]
    ).first() is not None


@router.patch("/findings/{finding_id}/status")
def update_finding_status(finding_id: str, body: CaseStatusUpdate, actor_id: Optional[str] = None):
    with get_session() as session:
        as_of = get_clock(session)
        f = session.get(Finding, finding_id)
        if not f:
            raise HTTPException(status_code=404, detail="Case not found")
        allowed = VALID_TRANSITIONS.get(str(f.status), [])
        if body.status not in allowed:
            raise HTTPException(status_code=400, detail=f"Cannot transition from {f.status} to {body.status}")

        reason = (body.reason or "").strip()
        if body.status == "IN_REVIEW":
            actor = _require_role(session, actor_id, CASE_PICKUP_ROLES, "pick up cases")
        elif body.status == "RESOLVED":
            actor = _require_role(session, actor_id, CASE_RESOLVE_ROLES, "resolve cases")
            if f.level == 3 and not _has_committee_response(session, finding_id):
                raise HTTPException(400, "An L3 case can only be resolved after the disclosure "
                                         "committee has recorded a formal response.")
        else:  # CLOSED
            actor = _require_role(session, actor_id, CASE_CLOSE_ROLES, "close cases as a false alarm")
            if len(reason) < CLOSE_REASON_MIN:
                raise HTTPException(400, f"Closing as a false alarm needs a reason of at least "
                                         f"{CLOSE_REASON_MIN} characters.")

        old_status = str(f.status)
        f.status = FindingStatus(body.status)
        if body.status == "IN_REVIEW" and f.assigned_to_id is None:
            f.assigned_to_id = _actor(actor_id)
        if body.status in ("RESOLVED", "CLOSED"):
            f.closed_on = as_of
            _close_case_escalations(session, finding_id, as_of, actor.id)
        if body.status == "CLOSED":
            session.add(CaseNote(finding_id=finding_id, author_id=actor.id, created_on=as_of,
                                 body=f"Closed as false alarm: {reason}"))
        session.add(f)
        append_event(session, as_of, actor.id, "case_status_changed", "finding", finding_id,
                     {"from": old_status, "to": body.status, **({"reason": reason} if reason else {})})
        session.commit()
        if body.status == "IN_REVIEW" and f.level is None:
            escalate_case(session, finding_id, 1, actor.id)
        return {"ok": True, "status": body.status}


@router.patch("/findings/{finding_id}/level")
def update_finding_level(finding_id: str, body: CaseLevelUpdate, actor_id: Optional[str] = None):
    with get_session() as session:
        f = session.get(Finding, finding_id)
        if not f:
            raise HTTPException(status_code=404, detail="Case not found")
        if f.status not in (FindingStatus.OPEN, FindingStatus.IN_REVIEW):
            raise HTTPException(400, "Only active cases can be escalated")
        if f.level is None:
            raise HTTPException(400, "Pick up the case first — it starts at L1")
        if body.level != f.level + 1 or body.level not in ESCALATE_ROLES:
            raise HTTPException(400, f"Can only escalate one level at a time (L{f.level} → L{f.level + 1})")
        actor = _require_role(session, actor_id, ESCALATE_ROLES[body.level],
                              f"escalate cases to L{body.level}")
        try:
            esc = escalate_case(session, finding_id, body.level, actor.id)
            return {"ok": True, "level": body.level, "escalation_id": esc.id}
        except ValueError as e:
            raise HTTPException(status_code=403, detail=str(e))


@router.patch("/findings/{finding_id}/assign")
def assign_finding(finding_id: str, body: CaseAssign, actor_id: str = "SYSTEM"):
    with get_session() as session:
        f = session.get(Finding, finding_id)
        if not f:
            raise HTTPException(status_code=404, detail="Case not found")
        person = session.get(Person, body.person_id)
        if not person:
            raise HTTPException(status_code=404, detail="Person not found")
        f.assigned_to_id = body.person_id
        session.add(f)
        session.flush()
        as_of = get_clock(session)
        append_event(session, as_of, _actor(actor_id), "case_assigned",
                     "finding", finding_id,
                     {"assigned_to": body.person_id, "name": person.name})
        session.commit()
        return {"ok": True, "assigned_to_id": body.person_id, "assigned_to_name": person.name}


@router.get("/findings/{finding_id}/notes")
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


@router.post("/findings/{finding_id}/notes")
def add_case_note(finding_id: str, body: CaseNoteCreate):
    with get_session() as session:
        f = session.get(Finding, finding_id)
        if not f:
            raise HTTPException(status_code=404, detail="Case not found")
        if not body.body.strip():
            raise HTTPException(400, "Note cannot be empty")
        actor = _require_role(session, body.author_id, CASE_NOTE_ROLES, "add case notes")
        as_of = get_clock(session)
        note = CaseNote(finding_id=finding_id, author_id=actor.id, created_on=as_of, body=body.body)
        session.add(note)
        session.flush()
        append_event(session, as_of, actor.id, "case_note_added", "finding", finding_id,
                     {"note_id": note.id})
        session.commit()
        session.refresh(note)
        return {"id": note.id, "author_id": note.author_id, "created_on": str(note.created_on), "body": note.body}


# ── Escalations ───────────────────────────────────────────────────────────────

@router.get("/escalations")
def list_escalations():
    with get_session() as session:
        as_of = get_clock(session)
        escs = list(session.exec(
            select(Escalation).order_by(Escalation.created_on.desc())  # type: ignore[attr-defined]
        ).all())
        finding_map = {f.id: f for f in session.exec(select(Finding)).all()}
        control_map = {c.id: c for c in session.exec(select(Control)).all()}
        person_map = {p.id: p for p in session.exec(select(Person)).all()}
        result = []
        for e in escs:
            responses = list(session.exec(
                select(CommitteeResponse).where(CommitteeResponse.escalation_id == e.id)
            ).all())
            f = finding_map.get(e.finding_id)
            check_id = control_map[f.control_id].check_id if f and f.control_id in control_map else None
            assigned_name = person_map[f.assigned_to_id].name if f and f.assigned_to_id and f.assigned_to_id in person_map else None
            days_open = (as_of - f.opened_on).days if f and f.status == FindingStatus.OPEN else None
            result.append({
                "id": e.id,
                "finding_id": e.finding_id,
                "finding_title": f.title if f else None,
                "finding_status": str(f.status) if f else None,
                "check_id": check_id,
                "level": e.level,
                "assigned_to_role": str(e.assigned_to_role),
                "assigned_to_name": assigned_name,
                "reason": e.reason,
                "days_open": days_open,
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


def _get_escalation(session, esc_id: int) -> Escalation:
    esc = session.get(Escalation, esc_id)
    if not esc:
        raise HTTPException(404, f"Escalation {esc_id} not found")
    return esc


@router.post("/escalations/{esc_id}/ack")
def ack_escalation_route(esc_id: int, actor_id: Optional[str] = None):
    with get_session() as session:
        esc = _get_escalation(session, esc_id)
        role = str(esc.assigned_to_role).replace("_", " ")
        actor = _require_role(session, actor_id, {esc.assigned_to_role},
                              f"acknowledge this escalation (assigned to {role})")
        if esc.status != EscalationStatus.OPEN:
            raise HTTPException(400, f"Escalation is already {esc.status}")
        esc = ack_escalation(session, esc_id, actor.id)
        return {"id": esc.id, "status": str(esc.status)}


@router.post("/escalations/{esc_id}/resolve")
def resolve_escalation_route(esc_id: int, actor_id: Optional[str] = None):
    with get_session() as session:
        esc = _get_escalation(session, esc_id)
        actor = _require_role(session, actor_id, {esc.assigned_to_role}, "resolve this escalation")
        esc = resolve_escalation(session, esc_id, actor.id)
        return {"id": esc.id, "status": str(esc.status)}


@router.post("/escalations/{esc_id}/respond")
def respond_escalation_route(esc_id: int, body: EscalationRespondBody,
                              actor_id: Optional[str] = None):
    with get_session() as session:
        esc = _get_escalation(session, esc_id)
        actor = _require_role(session, actor_id, RESPOND_ROLES, "record a formal committee response")
        if esc.level != 3:
            raise HTTPException(400, "Formal responses are only for L3 escalations")
        if esc.status not in (EscalationStatus.OPEN, EscalationStatus.ACK):
            raise HTTPException(400, f"Escalation is already {esc.status}")
        actor_id = actor.id
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

@router.get("/citations")
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


@router.post("/citations/generate")
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


@router.post("/resolve")
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

@router.get("/audit")
def list_audit(limit: int = 500, action: Optional[str] = None, actor_id: Optional[str] = None):
    with get_session() as session:
        q = select(AuditEvent).order_by(AuditEvent.seq.desc())  # type: ignore[attr-defined]
        if action:
            q = q.where(AuditEvent.action == action)
        if actor_id:
            q = q.where(AuditEvent.actor_id == actor_id)
        events = list(session.exec(q.limit(limit)).all())
        person_map = {p.id: p.name for p in session.exec(select(Person)).all()}
        return [{"seq": e.seq, "ts_sim": str(e.ts_sim),
                 "actor_id": e.actor_id,
                 "actor_name": person_map.get(e.actor_id, e.actor_id),
                 "action": e.action, "subject_type": e.subject_type,
                 "subject_id": e.subject_id,
                 "payload": json.loads(e.payload) if e.payload else None,
                 "hash": e.hash}
                for e in events]


@router.get("/audit/verify")
def verify_audit():
    with get_session() as session:
        ok, broken_at = verify_chain(session)
        message = "Chain intact — all hashes verified." if ok else f"Chain broken at event #{broken_at}."
        return {"valid": ok, "message": message}


# ── Checkpoints ───────────────────────────────────────────────────────────────

@router.get("/checkpoints")
def list_checkpoints():
    with get_session() as session:
        applied = {r.cp_id for r in session.exec(select(CheckpointApplied)).all()}
        return {"available": list(CHECKPOINTS.keys()), "applied": list(applied)}


@router.post("/checkpoints/{cp_id}/apply")
def apply_checkpoint_route(cp_id: str):
    with get_session() as session:
        if cp_id not in CHECKPOINTS:
            raise HTTPException(404, f"Unknown checkpoint: {cp_id}")
        apply_checkpoint(session, cp_id)
        return {"cp_id": cp_id, "applied": True, "clock": str(get_clock(session))}


# ── Reset ─────────────────────────────────────────────────────────────────────

@router.post("/reset")
def reset_db():
    from db import engine
    from sqlmodel import SQLModel
    SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)
    generate_snapshots()
    seed_db()
    apply_all_checkpoints()
    patch_case_statuses()
    return {"status": "reset"}


# ── SLA ───────────────────────────────────────────────────────────────────────

@router.get("/sccs/{scc_id}/versions/{version_id}/sla")
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


# ── Mount API + serve frontend SPA ────────────────────────────────────────────

app.include_router(router, prefix="/api")

DIST_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"


@app.get("/{full_path:path}", include_in_schema=False)
def spa_fallback(full_path: str):
    if full_path.startswith("api/"):
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    if DIST_DIR.is_dir():
        candidate = DIST_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST_DIR / "index.html")
    return JSONResponse({"detail": "Frontend not built — run `npm run build` in frontend/"},
                        status_code=404)
