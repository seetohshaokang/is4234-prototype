"""Append-only hash-chained audit log."""

import hashlib
import json
from datetime import date, datetime

from sqlmodel import Session, select

from db import AuditEvent


def _canonical(seq: int, ts_sim: date, actor_id: str, action: str,
               subject_type: str, subject_id: str, payload: dict) -> str:
    return json.dumps({
        "seq": seq, "ts_sim": str(ts_sim), "actor_id": actor_id,
        "action": action, "subject_type": subject_type,
        "subject_id": subject_id, "payload": payload,
    }, sort_keys=True)


def append_event(
    session: Session,
    ts_sim: date,
    actor_id: str,
    action: str,
    subject_type: str,
    subject_id: str,
    payload: dict,
) -> AuditEvent:
    # Get last event for chaining
    last = session.exec(select(AuditEvent).order_by(AuditEvent.seq.desc())).first()  # type: ignore[attr-defined]
    prev_hash = last.hash if last else "GENESIS"

    # Temporary seq to compute hash — will be set by DB autoincrement
    # We use a placeholder and patch after insert
    event = AuditEvent(
        ts_sim=ts_sim,
        ts_real=datetime.utcnow(),
        actor_id=actor_id,
        action=action,
        subject_type=subject_type,
        subject_id=subject_id,
        payload=json.dumps(payload),
        prev_hash=prev_hash,
        hash="pending",
    )
    session.add(event)
    session.flush()  # assigns seq

    canonical = _canonical(event.seq, ts_sim, actor_id, action,
                           subject_type, subject_id, payload)
    event.hash = hashlib.sha256((prev_hash + canonical).encode()).hexdigest()
    session.add(event)
    return event


def verify_chain(session: Session) -> tuple[bool, int | None]:
    """Return (valid, broken_at_seq). broken_at_seq is None if chain is valid."""
    events = list(session.exec(select(AuditEvent).order_by(AuditEvent.seq)).all())
    prev_hash = "GENESIS"
    for ev in events:
        payload = json.loads(ev.payload or "{}")
        canonical = _canonical(ev.seq, ev.ts_sim, ev.actor_id, ev.action,
                               ev.subject_type, ev.subject_id, payload)
        expected = hashlib.sha256((prev_hash + canonical).encode()).hexdigest()
        if ev.hash != expected or ev.prev_hash != prev_hash:
            return False, ev.seq
        prev_hash = ev.hash
    return True, None
