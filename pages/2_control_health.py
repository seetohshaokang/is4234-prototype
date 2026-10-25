import json
import streamlit as st
import pandas as pd
import plotly.express as px
from sqlmodel import select
from datetime import date

from db import get_session, Control, TestResult, Finding, FindingStatus, ClaimControlMap, Claim, ClaimStatus, ManualEvidence
from services import run_all_tests, get_clock
from ui_helpers import render_sidebar_role, render_sidebar_clock, severity_badge, ACTORS_BY_ID

st.title("🔬 Control Health")

with get_session() as session:
    actor = render_sidebar_role()
    render_sidebar_clock(session)
    as_of = get_clock(session)

    controls = list(session.exec(select(Control)).all())

    if st.button("▶ Run All Tests Now"):
        run_all_tests(session, actor["id"])
        st.rerun()

    st.divider()

    for ctl in controls:
        # Latest result
        result = session.exec(
            select(TestResult)
            .where(TestResult.control_id == ctl.id)
            .order_by(TestResult.run_on.desc())
        ).first()

        # Open findings
        open_findings = list(session.exec(
            select(Finding).where(Finding.control_id == ctl.id,
                                  Finding.status == FindingStatus.OPEN)
        ).all())

        # Which published claims depend on this control (blast radius)
        blast = [m.claim_id for m in session.exec(
            select(ClaimControlMap).where(ClaimControlMap.control_id == ctl.id)
        ).all() if session.exec(
            select(Claim).where(Claim.id == m.claim_id, Claim.status == ClaimStatus.PUBLISHED)
        ).first()]

        # Manual evidence
        manual = session.exec(
            select(ManualEvidence)
            .where(ManualEvidence.control_id == ctl.id,
                   ManualEvidence.valid_until >= as_of)
        ).first()

        # Stale check
        stale = False
        age_days = None
        if result:
            age_days = (as_of - result.run_on).days
            stale = age_days > ctl.test_frequency_days

        # Header status icon
        if not result and not manual:
            status_icon = "⚫"
        elif result and result.outcome == "FAIL":
            status_icon = "🔴"
        elif stale:
            status_icon = "🟡"
        elif manual:
            status_icon = "🔵"
        else:
            status_icon = "🟢"

        with st.expander(f"{status_icon} **{ctl.id}** — {ctl.name}"):
            cols = st.columns([2, 1, 1, 1])
            cols[0].markdown(f"_{ctl.description}_")
            cols[1].markdown(f"**Owner:** {ACTORS_BY_ID.get(ctl.owner_id, {}).get('name', ctl.owner_id)}")
            cols[2].markdown(f"**Frequency:** {ctl.test_frequency_days}d")

            # Evidence
            if ctl.test_id:
                if result:
                    outcome_color = "🟢" if result.outcome == "PASS" else "🔴"
                    st.markdown(f"{outcome_color} **Latest result ({result.run_on}):** {result.outcome}")
                    st.caption(result.evidence_summary)
                    if stale:
                        st.warning(f"⚠️ Evidence is stale — {age_days} days old (threshold: {ctl.test_frequency_days}d)")
                    if result.metrics:
                        metrics = json.loads(result.metrics)
                        st.json(metrics, expanded=False)
                else:
                    st.warning("⚫ Control has never been tested.")
            else:
                if manual:
                    st.info(f"🔵 Manual evidence (valid until {manual.valid_until}): {manual.summary}")
                else:
                    st.warning("Manual evidence required — none on file.")

            # Blast radius
            if blast:
                st.markdown(f"**Blast radius:** Published claims depending on this control: `{', '.join(blast)}`")

            # Open findings
            if open_findings:
                st.markdown(f"**Open findings ({len(open_findings)}):**")
                for f in open_findings:
                    st.markdown(f"- {severity_badge(f.severity)} **{f.id}** — {f.title} _(open since {f.opened_on})_",
                                unsafe_allow_html=True)

            # Framework refs
            if ctl.framework_refs:
                refs = json.loads(ctl.framework_refs)
                st.caption("Framework refs: " + " · ".join(refs))

            # Result history chart
            all_results = list(session.exec(
                select(TestResult)
                .where(TestResult.control_id == ctl.id)
                .order_by(TestResult.run_on)
            ).all())
            if len(all_results) > 1:
                df = pd.DataFrame([{
                    "date": r.run_on, "outcome": 1 if r.outcome == "PASS" else 0,
                    "label": r.outcome,
                } for r in all_results])
                fig = px.line(df, x="date", y="outcome", markers=True,
                              title=f"{ctl.id} test history",
                              labels={"outcome": "PASS=1 / FAIL=0"}, height=200)
                fig.update_layout(margin=dict(t=30, b=10, l=10, r=10), showlegend=False)
                st.plotly_chart(fig, use_container_width=True)
