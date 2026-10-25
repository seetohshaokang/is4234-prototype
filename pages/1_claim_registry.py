import json
import streamlit as st
from sqlmodel import select

from db import get_session, Claim, ClaimControlMap, GateDecision, GateTrigger
from services import evaluate_claim, publish_claim, withdraw_claim
from ui_helpers import render_sidebar_role, render_sidebar_clock, support_badge, verdict_badge, parse_rules, ACTORS_BY_ID

st.title("📋 Claim Registry")

with get_session() as session:
    actor = render_sidebar_role()
    render_sidebar_clock(session)

    claims = list(session.exec(select(Claim)).all())

    # Summary counts
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Total claims", len(claims))
    c2.metric("Published", sum(1 for c in claims if c.status == "published"))
    c3.metric("Unsupported", sum(1 for c in claims if c.support_state == "UNSUPPORTED"))
    c4.metric("At risk", sum(1 for c in claims if c.support_state == "AT_RISK"))

    st.divider()

    for claim in claims:
        # Red banner for published + unsupported
        if claim.status == "published" and claim.support_state == "UNSUPPORTED":
            st.error(f"⚠️ **{claim.id}** — This published claim is no longer backed by evidence.")

        # Latest decision
        latest = session.exec(
            select(GateDecision)
            .where(GateDecision.claim_id == claim.id)
            .order_by(GateDecision.id.desc())
        ).first()

        with st.expander(
            f"**{claim.id}** — {claim.text[:80]}{'…' if len(claim.text) > 80 else ''}",
            expanded=(claim.status == "published" and claim.support_state == "UNSUPPORTED"),
        ):
            col1, col2, col3 = st.columns([3, 1, 1])
            col1.markdown(f"_{claim.text}_")
            col2.markdown(f"**Status:** `{claim.status}`")
            # render support state badge
            col3.markdown(support_badge(claim.support_state), unsafe_allow_html=True)

            # Mapped controls
            maps = list(session.exec(
                select(ClaimControlMap).where(ClaimControlMap.claim_id == claim.id)
            ).all())
            approved_maps = [m for m in maps if m.approved_by]
            if approved_maps:
                st.caption(f"Mapped controls: {', '.join(m.control_id for m in approved_maps)}")
            else:
                st.caption("⚪ No approved control mappings.")

            # Gate decision panel
            if latest:
                rules = parse_rules(latest.rules_fired)
                st.markdown(f"**Latest gate decision:** {verdict_badge(latest.decision)} on `{latest.evaluated_on}`",
                            unsafe_allow_html=True)
                if rules:
                    st.markdown("**Rules fired:**")
                    for r in rules:
                        color = "🔴" if r["rule_id"] in ("R1","R2","R3","R6") else "🟡"
                        st.markdown(f"- {color} **{r['rule_id']}**: {r['message']}")
                else:
                    st.success("No gate rules fired — claim is supported.")
            else:
                st.info("No gate evaluation yet. Advance clock or run tests to evaluate.")

            # Actions (role-gated)
            role = actor["role"]
            st.divider()
            acols = st.columns(4)

            # Evaluate gate
            if acols[0].button("🔄 Evaluate", key=f"eval_{claim.id}"):
                evaluate_claim(session, claim.id, GateTrigger.MANUAL, actor["id"])
                st.rerun()

            # Publish
            if role in ("security_lead", "claim_author", "disclosure_committee"):
                if claim.status == "draft":
                    if acols[1].button("✅ Publish", key=f"pub_{claim.id}"):
                        try:
                            publish_claim(session, claim.id, actor["id"])
                            st.success(f"Claim {claim.id} published.")
                            st.rerun()
                        except ValueError as e:
                            st.error(str(e))

            # Withdraw
            if role in ("security_lead", "claim_author") and claim.status == "published":
                if acols[2].button("↩ Withdraw", key=f"wd_{claim.id}"):
                    withdraw_claim(session, claim.id, actor["id"])
                    st.rerun()
