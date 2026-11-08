"""Database models and session helpers — SCC Library."""

from datetime import date, datetime
from enum import StrEnum
from typing import Optional

from pydantic import NaiveDatetime  # type: ignore[attr-defined]
from sqlmodel import Field, Session, SQLModel, create_engine

DATABASE_URL = "sqlite:///./scc_library.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


from contextlib import contextmanager

@contextmanager
def get_session():
    session = Session(engine)
    try:
        yield session
    finally:
        session.close()


def create_tables() -> None:
    SQLModel.metadata.create_all(engine)


# ── Enums ─────────────────────────────────────────────────────────────────────

class Role(StrEnum):
    CONTROL_OWNER       = "control_owner"
    SECURITY_LEAD       = "security_lead"
    DISCLOSURE_COMMITTEE = "disclosure_committee"
    INDEPENDENT_AUDITOR = "independent_auditor"
    AUDIT_COMMITTEE     = "audit_committee"


class SCCState(StrEnum):
    UPHELD     = "UPHELD"
    DOWN       = "DOWN"
    UNKNOWN    = "UNKNOWN"
    NOT_ACTIVE = "NOT_ACTIVE"


class SCCVersionStatus(StrEnum):
    PROPOSED   = "PROPOSED"
    ACTIVE     = "ACTIVE"
    SUPERSEDED = "SUPERSEDED"
    DEPRECATED = "DEPRECATED"
    REJECTED   = "REJECTED"


class EvidenceType(StrEnum):
    TESTED   = "TESTED"
    ATTESTED = "ATTESTED"


class ChangeRequestType(StrEnum):
    CREATE     = "CREATE"
    REEVALUATE = "REEVALUATE"
    DEPRECATE  = "DEPRECATE"


class ChangeRequestStatus(StrEnum):
    PENDING  = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class CollectorStatus(StrEnum):
    PENDING  = "PENDING"
    APPROVED = "APPROVED"
    REVOKED  = "REVOKED"


class TestOutcome(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"


class FindingSeverity(StrEnum):
    LOW      = "LOW"
    MEDIUM   = "MEDIUM"
    HIGH     = "HIGH"
    CRITICAL = "CRITICAL"


class FindingStatus(StrEnum):
    OPEN      = "OPEN"
    IN_REVIEW = "IN_REVIEW"
    RESOLVED  = "RESOLVED"
    CLOSED    = "CLOSED"


class EscalationStatus(StrEnum):
    OPEN       = "OPEN"
    ACK        = "ACK"
    RESOLVED   = "RESOLVED"
    SUPERSEDED = "SUPERSEDED"


class CommitteeDecision(StrEnum):
    REMEDIATE           = "REMEDIATE"
    STOP_CITING         = "STOP_CITING"
    REQUEST_REEVALUATION = "REQUEST_REEVALUATION"
    DISCLOSE            = "DISCLOSE"


class CitationKind(StrEnum):
    POSITIVE = "POSITIVE"
    NEGATIVE = "NEGATIVE"


# ── Tables ────────────────────────────────────────────────────────────────────

class Person(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    role: Role
    title: str


class SimClock(SQLModel, table=True):
    __tablename__ = "simclock"
    id: Optional[int] = Field(default=None, primary_key=True)
    current_date: date


class CheckDefinition(SQLModel, table=True):
    __tablename__ = "checkdefinition"
    id: str = Field(primary_key=True)      # e.g. "T-LEASTPRIV"
    version: str = Field(default="1", primary_key=True)  # "1", "2", …
    name: str
    threshold_desc: str                    # human-readable threshold
    params: Optional[str] = None           # JSON
    test_frequency_days: int = 30
    defined_by: str = Field(foreign_key="person.id")
    created_on: date


class Collector(SQLModel, table=True):
    __tablename__ = "collector"
    id: str = Field(primary_key=True)      # e.g. "COL-AC01-1"
    check_id: str                          # FK to CheckDefinition.id (not enforced; check versions vary)
    version: str = "1"
    code_hash: str
    written_by: str = Field(foreign_key="person.id")
    submitted_on: date
    status: CollectorStatus = CollectorStatus.PENDING
    approved_by: Optional[str] = Field(default=None, foreign_key="person.id")
    approved_on: Optional[date] = None


class Control(SQLModel, table=True):
    __tablename__ = "control"
    id: str = Field(primary_key=True)
    name: str
    owner_id: str = Field(foreign_key="person.id")
    check_id: str                          # FK to CheckDefinition.id
    framework_refs: Optional[str] = None  # JSON list


class SCC(SQLModel, table=True):
    __tablename__ = "scc"
    id: str = Field(primary_key=True)      # e.g. "SCC-01"
    title: str
    owner_id: str = Field(foreign_key="person.id")


class SCCVersion(SQLModel, table=True):
    __tablename__ = "sccversion"
    id: str = Field(primary_key=True)      # e.g. "SCC-01-v1"
    scc_id: str = Field(foreign_key="scc.id")
    version: int = 1
    assertion_text: str
    status: SCCVersionStatus = SCCVersionStatus.PROPOSED
    active_from: Optional[date] = None
    active_to: Optional[date] = None
    target_uptime_pct: float = 99.0
    rolling_window_days: int = 365
    max_single_downtime_days: int = 7
    evidence_type: EvidenceType = EvidenceType.TESTED
    supersedes_version_id: Optional[str] = None
    superseded_while_down: bool = False
    deprecated_while_down: bool = False
    reason: Optional[str] = None           # why this version was created/deprecated
    approved_by: Optional[str] = Field(default=None, foreign_key="person.id")
    auditor_note: Optional[str] = None


class SCCVersionControl(SQLModel, table=True):
    __tablename__ = "sccversioncontrol"
    sccversion_id: str = Field(foreign_key="sccversion.id", primary_key=True)
    control_id: str = Field(foreign_key="control.id", primary_key=True)
    check_id: str
    check_version: str


class TestResult(SQLModel, table=True):
    __tablename__ = "testresult"
    id: Optional[int] = Field(default=None, primary_key=True)
    control_id: str = Field(foreign_key="control.id")
    check_id: str
    check_version: str
    collector_id: str                      # which collector ran
    collector_approved_at_run: bool = False  # was collector APPROVED when this ran?
    run_on: date
    snapshot_date: str
    outcome: TestOutcome
    measured_value: Optional[str] = None   # JSON-encoded numeric or string
    evidence_summary: str


class ManualEvidence(SQLModel, table=True):
    __tablename__ = "manualevidence"
    id: Optional[int] = Field(default=None, primary_key=True)
    control_id: str = Field(foreign_key="control.id")
    attested_by: str = Field(foreign_key="person.id")
    summary: str
    valid_from: date
    valid_until: date


class StateInterval(SQLModel, table=True):
    __tablename__ = "stateinterval"
    id: Optional[int] = Field(default=None, primary_key=True)
    sccversion_id: str = Field(foreign_key="sccversion.id")
    state: SCCState
    start: date
    end: Optional[date] = None             # null = ongoing
    detected_at: Optional[date] = None
    possibly_since: Optional[date] = None
    cause_note: Optional[str] = None


class Finding(SQLModel, table=True):
    __tablename__ = "finding"
    id: str = Field(primary_key=True)
    control_id: str = Field(foreign_key="control.id")
    severity: FindingSeverity
    status: FindingStatus = FindingStatus.OPEN
    opened_on: date
    closed_on: Optional[date] = None
    root_cause_note: Optional[str] = None
    source: str = "automated_check"
    title: str = ""
    description: str = ""
    level: Optional[int] = None
    assigned_to_id: Optional[str] = Field(default=None, foreign_key="person.id")


class CaseNote(SQLModel, table=True):
    __tablename__ = "casenote"
    id: Optional[int] = Field(default=None, primary_key=True)
    finding_id: str = Field(foreign_key="finding.id")
    author_id: str = Field(foreign_key="person.id")
    created_on: date
    body: str


class ChangeRequestNote(SQLModel, table=True):
    __tablename__ = "changerequestnote"
    id: Optional[int] = Field(default=None, primary_key=True)
    cr_id: str = Field(foreign_key="changerequest.id")
    author_id: str = Field(foreign_key="person.id")
    created_on: date
    body: str


class ChangeRequest(SQLModel, table=True):
    __tablename__ = "changerequest"
    id: str = Field(primary_key=True)
    type: ChangeRequestType
    scc_id: str = Field(foreign_key="scc.id")
    requested_by: str = Field(foreign_key="person.id")
    requested_on: date
    reason: str
    proposal: Optional[str] = None         # JSON (new assertion, standard, etc.)
    status: ChangeRequestStatus = ChangeRequestStatus.PENDING
    decided_by: Optional[str] = Field(default=None, foreign_key="person.id")
    decided_on: Optional[date] = None
    auditor_note: Optional[str] = None
    effective_on: Optional[date] = None    # for DEPRECATE


class Escalation(SQLModel, table=True):
    __tablename__ = "escalation"
    id: Optional[int] = Field(default=None, primary_key=True)
    finding_id: str = Field(foreign_key="finding.id")
    level: int
    assigned_to_role: Role
    reason: str
    created_on: date
    acknowledged_on: Optional[date] = None
    resolved_on: Optional[date] = None
    status: EscalationStatus = EscalationStatus.OPEN


class CommitteeResponse(SQLModel, table=True):
    __tablename__ = "committeeresponse"
    id: Optional[int] = Field(default=None, primary_key=True)
    escalation_id: int = Field(foreign_key="escalation.id")
    decision: CommitteeDecision
    rationale: str
    due_on: Optional[date] = None
    decided_by: str = Field(foreign_key="person.id")
    decided_on: date


class IssuedCitation(SQLModel, table=True):
    __tablename__ = "issuedcitation"
    id: Optional[int] = Field(default=None, primary_key=True)
    sccversion_id: str = Field(foreign_key="sccversion.id")
    kind: CitationKind
    period_from: date
    period_to: date
    uptime_pct: Optional[float] = None
    unknown_pct: Optional[float] = None
    target_met: Optional[bool] = None
    citation_string: str
    issued_by: str
    issued_on: date
    record_hash: str


class AuditEvent(SQLModel, table=True):
    __tablename__ = "auditevent"
    seq: Optional[int] = Field(default=None, primary_key=True)
    ts_sim: date
    ts_real: NaiveDatetime
    actor_id: str
    action: str
    subject_type: str
    subject_id: str
    payload: Optional[str] = None
    prev_hash: str
    hash: str


class CheckpointApplied(SQLModel, table=True):
    __tablename__ = "checkpointapplied"
    cp_id: str = Field(primary_key=True)
    applied_on: date
