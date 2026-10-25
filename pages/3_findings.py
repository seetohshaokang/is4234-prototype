import streamlit as st
from sqlmodel import select
from datetime import date, timedelta

from db import get_session, Finding, FindingStatus, RiskAcceptance, Escalation, EscalationStatus, ClaimControlMap, Claim, ClaimStatus
from services import get_clock, close_finding, propose_risk_acceptance, create_finding
from ui_helpers import render_sidebar_role, render_sidebar_clock, severity_badge, ACTORS_BY_ID

st.title("⚠️ Findings & Risk Acceptance")

with get_session() as session:
    actor = render_sidebar_role()
    render_sidebar_clock(session)
    as_of = get_clock(session)
    role = actor["role"]

    findings = list(session.exec(select(Finding).order_by(Finding.opened_on.desc())).all())

    # Summary
    open_f = [f for f in findings if f.status == FindingStatus.OPEN]
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Open findings", len(open_f))
    c2.metric("Critical/High", sum(1 for f in open_f if f.severity in ("CRITICAL","HIGH")))
    c3.metric("Risk accepted", sum(1 for f in findings if f.status == FindingStatus.RISK_ACCEPTED))
    oldest = max((as_of - f.opened_on).days for f in open_f) if open_f else 0
    c4.metric("Oldest open (days)", oldest)

    st.divider()

    # Raise manual finding (control_owner or security_lead)
    if role in ("control_owner", "security_lead", "internal_audit"):
        with st.expander("➕ Raise a new finding"):
            from db import Control
            controls = list(session.exec(select(Control)).all())
            ctl_choice = st.selectbox("Control", [c.id + " — " + c.name for c in controls])
            ctl_id = ctl_choice.split(" — ")[0]
            title = st.text_input("Title")
            desc = st.text_area("Description")
            sev = st.selectbox("Severity", ["LOW","MEDIUM","HIGH","CRITICAL"], index=2)
            if st.button("Raise Finding"):
                if title and desc:
                    create_finding(session, ctl_id, title, desc, sev, actor["id"], actor["id"])
                    st.success("Finding raised.")
                    st.rerun()

    st.divider()

    for f in findings:
        days_open = (as_of - f.opened_on).days
        icon = severity_badge(f.severity)

        # Get escalation level
        esc = session.exec(
            select(Escalation)
            .where(Escalation.subject_id == f.id,
                   Escalation.status.in_([EscalationStatus.OPEN, EscalationStatus.ACK]))
            .order_by(Escalation.level.desc())
        ).first()
        esc_badge = f"L{esc.level}" if esc else "—"

        # Linked published claims
        linked_claims = [m.claim_id for m in session.exec(
            select(ClaimControlMap).where(ClaimControlMap.control_id == f.control_id)
        ).all() if session.exec(
            select(Claim).where(Claim.id == m.claim_id, Claim.status == ClaimStatus.PUBLISHED)
        ).first()]

        status_color = {"OPEN": "🔴", "RISK_ACCEPTED": "🟡", "CLOSED": "🟢"}.get(f.status, "⚪")

        with st.expander(
            f"{status_color} **{f.id}** — {f.title} "
            f"| {f.severity} | open {days_open}d | esc: {esc_badge}"
        ):
            col1, col2 = st.columns(2)
            col1.markdown(f"**Control:** `{f.control_id}`")
            col1.markdown(f"**Owner:** {ACTORS_BY_ID.get(f.owner_id,{}).get('name', f.owner_id)}")
            col1.markdown(f"**Raised by:** {ACTORS_BY_ID.get(f.raised_by_id,{}).get('name', f.raised_by_id)}")
            col2.markdown(f"**Opened:** {f.opened_on}")
            col2.markdown(f"**Due:** {f.due_on}")
            col2.markdown(f"**Status:** `{f.status}`")

            st.markdown(f"_{f.description}_")

            if linked_claims:
                st.info(f"🔗 Backs published claims: {', '.join(linked_claims)}")

            if f.status == FindingStatus.OPEN:
                acols = st.columns(3)

                # Close finding
                if role in ("control_owner", "security_lead"):
                    if acols[0].button("✅ Close Finding", key=f"close_{f.id}"):
                        close_finding(session, f.id, actor["id"])
                        st.success("Finding closed.")
                        st.rerun()

                # Propose risk acceptance (security_lead only)
                if role == "security_lead":
                    with st.form(key=f"ra_{f.id}"):
                        st.markdown("**Propose Risk Acceptance**")
                        rationale = st.text_area("Rationale", key=f"rat_{f.id}")
                        cost_note = st.text_area("Cost/benefit note (required)", key=f"cb_{f.id}")
                        exp_date = st.date_input("Expires on", value=date.today() + timedelta(days=90),
                                                 key=f"exp_{f.id}")
                        if st.form_submit_button("Propose Acceptance"):
                            if rationale and cost_note:
                                propose_risk_acceptance(session, f.id, actor["id"],
                                                        rationale, cost_note, exp_date)
                                st.success("Risk acceptance proposed.")
                                st.rerun()
                            else:
                                st.error("Rationale and cost/benefit note are required.")

            # Existing risk acceptances
            ras = list(session.exec(
                select(RiskAcceptance).where(RiskAcceptance.finding_id == f.id)
            ).all())
            if ras:
                for ra in ras:
                    st.markdown(f"**Risk Acceptance {ra.id}:** `{ra.status}` — expires {ra.expires_on}")
                    st.caption(f"Rationale: {ra.rationale}")
                    st.caption(f"Cost/benefit: {ra.cost_benefit_note}")
                    if ra.status == "PROPOSED" and role == "disclosure_committee":
                        from services import approve_risk_acceptance
                        if st.button(f"✅ Approve RA {ra.id}", key=f"appra_{ra.id}"):
                            approve_risk_acceptance(session, ra.id, actor["id"])
                            st.success("Risk acceptance approved.")
                            st.rerun()
