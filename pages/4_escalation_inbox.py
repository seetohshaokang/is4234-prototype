import streamlit as st
from sqlmodel import select

from db import get_session, Escalation, EscalationStatus, Finding, Claim
from services import get_clock, ack_escalation, resolve_escalation
from ui_helpers import render_sidebar_role, render_sidebar_clock, ACTORS_BY_ID

st.title("📥 Escalation Inbox")

LEVEL_LABELS = {1: "1st line (Control Owner)", 2: "2nd line (Security Lead)",
                3: "3rd line (Disclosure Committee)", 4: "Board (Audit Committee)"}

with get_session() as session:
    actor = render_sidebar_role()
    render_sidebar_clock(session)
    as_of = get_clock(session)
    role = actor["role"]

    all_escs = list(session.exec(
        select(Escalation).order_by(Escalation.created_on.desc())
    ).all())

    # Filter to this role's escalations
    mine = [e for e in all_escs if e.assigned_to_role == role or e.assigned_to_id == actor["id"]]
    open_mine = [e for e in mine if e.status in (EscalationStatus.OPEN, EscalationStatus.ACK)]

    c1, c2, c3 = st.columns(3)
    c1.metric("Assigned to your role", len(open_mine))
    c2.metric("Unacknowledged", sum(1 for e in open_mine if e.status == EscalationStatus.OPEN))
    c3.metric("Total open (all roles)", sum(1 for e in all_escs if e.status in (EscalationStatus.OPEN, EscalationStatus.ACK)))

    st.divider()

    if not open_mine:
        st.success("✅ No open escalations for your role.")

    for esc in open_mine:
        days_open = (as_of - esc.created_on).days
        level_label = LEVEL_LABELS.get(esc.level, f"Level {esc.level}")
        age_warn = " ⏰" if days_open >= 14 else ""

        # Resolve subject display
        subject_display = esc.subject_id
        if esc.subject_type == "finding":
            f = session.get(Finding, esc.subject_id)
            if f:
                subject_display = f"{f.id}: {f.title} ({f.severity})"
        elif esc.subject_type == "claim":
            c = session.get(Claim, esc.subject_id)
            if c:
                subject_display = f"{c.id}: {c.text[:60]}…"

        with st.expander(
            f"**Esc #{esc.id}** — {esc.subject_type.upper()} · Level {esc.level} · {days_open}d old{age_warn} · `{esc.status}`"
        ):
            st.markdown(f"**Subject:** {subject_display}")
            st.markdown(f"**Level:** {level_label}")
            st.markdown(f"**Reason:** {esc.reason}")
            st.markdown(f"**Created:** {esc.created_on}")
            if esc.acknowledged_on:
                st.markdown(f"**Acknowledged:** {esc.acknowledged_on}")

            # Independence skip explanation
            skips = esc.independence_skips
            if skips and skips not in ("[]", "None", ""):
                st.info(f"ℹ️ **Why you are seeing this:** Independence skip — some candidates were conflicted: `{skips}`")

            if days_open >= 14 and esc.status == EscalationStatus.OPEN:
                st.warning("⏰ Unacknowledged for 14+ days — will be auto-promoted on next clock advance.")

            acols = st.columns(3)
            if esc.status == EscalationStatus.OPEN:
                if acols[0].button("👁️ Acknowledge", key=f"ack_{esc.id}"):
                    ack_escalation(session, esc.id, actor["id"])
                    st.rerun()
            if esc.status in (EscalationStatus.OPEN, EscalationStatus.ACK):
                if acols[1].button("✅ Resolve", key=f"res_{esc.id}"):
                    resolve_escalation(session, esc.id, actor["id"])
                    st.rerun()

    st.divider()
    with st.expander("📜 All escalations (history)"):
        for esc in all_escs:
            icon = {"OPEN": "🔴", "ACK": "🟡", "RESOLVED": "🟢", "SUPERSEDED": "⚫"}.get(esc.status, "⚪")
            st.markdown(
                f"{icon} **#{esc.id}** L{esc.level} · {esc.subject_type} `{esc.subject_id}` · "
                f"{esc.created_on} · `{esc.status}` — {esc.reason[:60]}"
            )
