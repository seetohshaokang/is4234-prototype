import json
import streamlit as st
import plotly.graph_objects as go
from sqlmodel import select

from db import (get_session, Claim, ClaimStatus, SupportState, Finding, FindingStatus,
                Override, OverrideStatus, RiskAcceptance, Control, TestResult, GateDecision)
from services import get_clock
from ui_helpers import render_sidebar_role, render_sidebar_clock, support_badge, ACTORS_BY_ID

st.title("📊 Oversight Dashboard")
st.caption("Audit Committee view — NimbusWatch Inc.")

with get_session() as session:
    actor = render_sidebar_role()
    render_sidebar_clock(session)
    as_of = get_clock(session)

    claims = list(session.exec(select(Claim)).all())
    findings = list(session.exec(select(Finding)).all())
    overrides = list(session.exec(select(Override)).all())
    risk_acceptances = list(session.exec(select(RiskAcceptance)).all())
    controls = list(session.exec(select(Control)).all())

    published = [c for c in claims if c.status == ClaimStatus.PUBLISHED]
    open_high = [f for f in findings if f.status == FindingStatus.OPEN
                 and f.severity in ("HIGH","CRITICAL")]
    active_overrides = [o for o in overrides if o.status == OverrideStatus.ACTIVE
                        and o.expires_on >= as_of]
    ra_public = [r for r in risk_acceptances if r.affects_public_claims
                 and r.status == "APPROVED"]
    never_tested = [c for c in controls if c.test_id and not session.exec(
        select(TestResult).where(TestResult.control_id == c.id)
    ).first()]

    # Days longest unsupported published claim has been live
    unsupported_pub = [c for c in published if c.support_state == SupportState.UNSUPPORTED]
    longest_unsupported = 0
    if unsupported_pub:
        for c in unsupported_pub:
            # find when it first became unsupported (first BLOCK decision after publication)
            first_block = session.exec(
                select(GateDecision)
                .where(GateDecision.claim_id == c.id, GateDecision.decision == "BLOCK")
                .order_by(GateDecision.id)
            ).first()
            if first_block:
                days = (as_of - first_block.evaluated_on).days
                longest_unsupported = max(longest_unsupported, days)

    oldest_high = max(((as_of - f.opened_on).days for f in open_high), default=0)

    # ── KPI Tiles ─────────────────────────────────────────────────────────────
    st.subheader("Key Risk Indicators")
    k1, k2, k3, k4 = st.columns(4)
    k1.metric("Published claims", len(published),
              delta=f"{sum(1 for c in published if c.support_state=='SUPPORTED')} supported",
              delta_color="normal")
    k2.metric("Days longest unsupported claim live", longest_unsupported,
              delta="0 = none" if longest_unsupported == 0 else None,
              delta_color="inverse")
    k3.metric("Open HIGH/CRITICAL findings", len(open_high),
              delta=f"oldest: {oldest_high}d", delta_color="inverse")
    k4.metric("Active overrides", len(active_overrides))

    k5, k6, k7, _ = st.columns(4)
    k5.metric("Risk acceptances on public claims", len(ra_public))
    k6.metric("Controls never tested", len(never_tested))
    expiring_soon = [o for o in active_overrides
                     if (o.expires_on - as_of).days <= 14]
    k7.metric("Overrides expiring ≤ 14 days", len(expiring_soon))

    # ── Claim support state chart ─────────────────────────────────────────────
    st.divider()
    st.subheader("Published claim support states")
    if published:
        state_counts = {s: sum(1 for c in published if c.support_state == s)
                        for s in ("SUPPORTED","AT_RISK","UNSUPPORTED","UNMAPPED")}
        fig = go.Figure(go.Bar(
            x=list(state_counts.keys()),
            y=list(state_counts.values()),
            marker_color=["#1a7f37","#b35000","#cf222e","#888"],
        ))
        fig.update_layout(height=250, margin=dict(t=10,b=10,l=10,r=10))
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.info("No published claims yet.")

    # ── Active overrides table ────────────────────────────────────────────────
    if active_overrides:
        st.divider()
        st.subheader("Active overrides")
        for ov in active_overrides:
            days_left = (ov.expires_on - as_of).days
            warn = " ⚠️" if days_left <= 14 else ""
            by_name = ACTORS_BY_ID.get(ov.by_id, {}).get("name", ov.by_id)
            st.markdown(
                f"- **{ov.id}** · Claim `{ov.claim_id}` · Override by **{by_name}** · "
                f"expires `{ov.expires_on}` ({days_left}d left){warn}: _{ov.reason[:80]}_"
            )

    # ── Status quo vs With Gate comparison ───────────────────────────────────
    st.divider()
    st.subheader("Status quo vs With Gate — Comparison Panel")
    st.caption("_'Status quo' values are based on SEC allegations (unproven). 'With Gate' values are computed from this simulation._")

    # Compute "with gate" metrics
    level3_plus_escs = len([e for e in session.exec(select(__import__('db').Escalation)).all()
                             if e.subject_type == "claim" and e.level >= 3])
    level4_escs = len([e for e in session.exec(select(__import__('db').Escalation)).all()
                       if e.level >= 4])
    override_authors = list({o.by_id for o in overrides})
    override_author_names = [ACTORS_BY_ID.get(oid, {}).get("name", oid) for oid in override_authors]

    comparison = {
        "Metric": [
            "Days a contradicted claim stayed live with no recorded decision",
            "Times Disclosure Committee saw the VPN issue",
            "Times Audit Committee saw it",
            "Named person accountable for keeping claim live",
        ],
        "Status quo (baseline)": [
            "~1,100 (2017–2020)",
            "0",
            "0",
            "None",
        ],
        "With Gate (computed)": [
            f"{longest_unsupported} days" if longest_unsupported > 0 else "0 (claim blocked)",
            str(level3_plus_escs),
            str(level4_escs),
            ", ".join(override_author_names) if override_author_names else "No overrides yet",
        ],
    }

    import pandas as pd
    df = pd.DataFrame(comparison)
    st.dataframe(df, use_container_width=True, hide_index=True)
