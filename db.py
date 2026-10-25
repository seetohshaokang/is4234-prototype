"""Database models and session helpers."""

from datetime import date, datetime
from enum import StrEnum
from typing import Any, Optional

from sqlalchemy import JSON, Column
from sqlmodel import Field, Session, SQLModel, create_engine
from pydantic import NaiveDatetime  # type: ignore[attr-defined]

DATABASE_URL = "sqlite:///./disclosure_gate.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


def get_session() -> Session:
    return Session(engine)


def create_tables() -> None:
    SQLModel.metadata.create_all(engine)


# ── Enums ────────────────────────────────────────────────────────────────────

class Role(StrEnum):
    CONTROL_OWNER = "control_owner"
    SECURITY_LEAD = "security_lead"
    CLAIM_AUTHOR = "claim_author"
    DISCLOSURE_COMMITTEE = "disclosure_committee"
    INTERNAL_AUDIT = "internal_audit"
    AUDIT_COMMITTEE = "audit_committee"


class ClaimStatus(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"
    WITHDRAWN = "withdrawn"


class SupportState(StrEnum):
    SUPPORTED = "SUPPORTED"
    AT_RISK = "AT_RISK"
    UNSUPPORTED = "UNSUPPORTED"
    UNMAPPED = "UNMAPPED"


class FindingSeverity(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class FindingStatus(StrEnum):
    OPEN = "OPEN"
    RISK_ACCEPTED = "RISK_ACCEPTED"
    CLOSED = "CLOSED"


class TestOutcome(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    ERROR = "ERROR"


class GateVerdict(StrEnum):
    APPROVE = "APPROVE"
    ESCALATE = "ESCALATE"
    BLOCK = "BLOCK"


class GateTrigger(StrEnum):
    PRE_PUBLICATION = "pre_publication"
    EVIDENCE_CHANGE = "evidence_change"
    CLOCK_ADVANCE = "clock_advance"
    MANUAL = "manual"


class EscalationStatus(StrEnum):
    OPEN = "OPEN"
    ACK = "ACK"
    RESOLVED = "RESOLVED"
    SUPERSEDED = "SUPERSEDED"


class RiskAcceptanceStatus(StrEnum):
    PROPOSED = "PROPOSED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"


class OverrideStatus(StrEnum):
    ACTIVE = "ACTIVE"
    EXPIRED = "EXPIRED"
    REVOKED = "REVOKED"


# ── Tables ───────────────────────────────────────────────────────────────────

class Person(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    role: Role
    title: str


class SimClock(SQLModel, table=True):
    __tablename__ = "simclock"
    id: Optional[int] = Field(default=None, primary_key=True)
    current_date: date


class Claim(SQLModel, table=True):
    id: str = Field(primary_key=True)
    text: str
    channel: str = "website_security_statement"
    owner_id: str = Field(foreign_key="person.id")
    status: ClaimStatus = ClaimStatus.DRAFT
    published_on: Optional[date] = None
    support_state: SupportState = SupportState.UNMAPPED


class Control(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    description: str
    owner_id: str = Field(foreign_key="person.id")
    test_id: Optional[str] = None
    test_frequency_days: int = 30
    framework_refs: Optional[str] = None  # stored as JSON string


class ClaimControlMap(SQLModel, table=True):
    __tablename__ = "claimcontrolmap"
    claim_id: str = Field(foreign_key="claim.id", primary_key=True)
    control_id: str = Field(foreign_key="control.id", primary_key=True)
    approved_by: Optional[str] = Field(default=None, foreign_key="person.id")
    approved_on: Optional[date] = None


class ControlTest(SQLModel, table=True):
    __tablename__ = "controltest"
    id: str = Field(primary_key=True)
    name: str
    parameters: Optional[str] = None  # JSON string
    version: str = "1.0"
    reviewed_by_audit: bool = False


class TestResult(SQLModel, table=True):
    __tablename__ = "testresult"
    id: Optional[int] = Field(default=None, primary_key=True)
    control_id: str = Field(foreign_key="control.id")
    test_id: str = Field(foreign_key="controltest.id")
    run_on: date
    snapshot_date: str
    outcome: TestOutcome
    metrics: Optional[str] = None  # JSON string
    evidence_summary: str


class Finding(SQLModel, table=True):
    id: str = Field(primary_key=True)
    control_id: str = Field(foreign_key="control.id")
    title: str
    description: str
    severity: FindingSeverity
    source: str = "automated_test"
    raised_by_id: str = Field(foreign_key="person.id")
    owner_id: str = Field(foreign_key="person.id")
    opened_on: date
    due_on: date
    status: FindingStatus = FindingStatus.OPEN
    closed_on: Optional[date] = None


class RiskAcceptance(SQLModel, table=True):
    __tablename__ = "riskacceptance"
    id: str = Field(primary_key=True)
    finding_id: str = Field(foreign_key="finding.id")
    proposed_by: str = Field(foreign_key="person.id")
    rationale: str
    cost_benefit_note: str
    expires_on: date
    status: RiskAcceptanceStatus = RiskAcceptanceStatus.PROPOSED
    approved_by: Optional[str] = Field(default=None, foreign_key="person.id")
    affects_public_claims: bool = False


class GateDecision(SQLModel, table=True):
    __tablename__ = "gatedecision"
    id: Optional[int] = Field(default=None, primary_key=True)
    claim_id: str = Field(foreign_key="claim.id")
    evaluated_on: date
    trigger: GateTrigger
    decision: GateVerdict
    rules_fired: Optional[str] = None  # JSON string
    missing_evidence: Optional[str] = None  # JSON string


class Override(SQLModel, table=True):
    id: str = Field(primary_key=True)
    claim_id: str = Field(foreign_key="claim.id")
    by_id: str = Field(foreign_key="person.id")
    reason: str
    conditions: str
    created_on: date
    expires_on: date
    status: OverrideStatus = OverrideStatus.ACTIVE


class Escalation(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    subject_type: str  # "finding" | "claim"
    subject_id: str
    level: int
    assigned_to_role: Role
    assigned_to_id: Optional[str] = None
    reason: str
    created_on: date
    acknowledged_on: Optional[date] = None
    resolved_on: Optional[date] = None
    status: EscalationStatus = EscalationStatus.OPEN
    independence_skips: Optional[str] = None  # JSON list of skipped person ids


class ManualEvidence(SQLModel, table=True):
    __tablename__ = "manualevidence"
    id: Optional[int] = Field(default=None, primary_key=True)
    control_id: str = Field(foreign_key="control.id")
    date: date
    attested_by: str = Field(foreign_key="person.id")
    summary: str
    valid_until: date


class AuditEvent(SQLModel, table=True):
    __tablename__ = "auditevent"
    seq: Optional[int] = Field(default=None, primary_key=True)
    ts_sim: date
    ts_real: NaiveDatetime
    actor_id: str
    action: str
    subject_type: str
    subject_id: str
    payload: Optional[str] = None  # JSON string
    prev_hash: str
    hash: str


class CheckpointApplied(SQLModel, table=True):
    __tablename__ = "checkpointapplied"
    cp_id: str = Field(primary_key=True)
    applied_on: date
