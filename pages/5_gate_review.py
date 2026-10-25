import streamlit as st
from sqlmodel import select
from datetime import timedelta

from db import get_session, Claim, ClaimStatus, GateDecision, GateVerdict, Override, OverrideStatus
from services import get_clock, evaluate_claim, create_override, withdraw_claim
from ui_helpers import render_sidebar_role, render_sidebar_clock, verdict_badge, parse_rules, ACTORS_BY_ID
from db import GateTrigger

st.title("🚦 Gate Review")
st.caption("Queue of BLOCK/ESCALATE decisions for Disclosure Committee review.")

with get_session() as session:
    actor = render_sidebar_role()
    render_sidebar_clock(session)
    as_of = get_clock(session)
    role = actor["role"]

    claims = list(session.exec(select(Claim)).all())

    # For each claim, get latest decision
    claim_decisions = []
    for c in claims:
        d = session.exec(
            select(GateDecision)
            .where(GateDecision.claim_id == c.id)
            .order_by(GateDecision.id.desc())
        ).first()
        if d and d.decision in (GateVerdict.BLOCK, GateVerdict.ESCALATE):
            claim_decisions.append((c, d))

    if not claim_decisions:
        st.success("✅ No claims currently require review — all are APPROVED or unevaluated.")
    else:
        st.warning(f"**{len(claim_decisions)} claim(s) require attention.**")

    for claim, decision in claim_decisions:
        rules = parse_rules(decision.rules_fired)
        is_drift = claim.status == ClaimStatus.PUBLISHED and decision.decision == GateVerdict.BLOCK

        header = f"**{claim.id}** — {claim.text[:70]}…"
        if is_drift:
            st.error(f"🚨 DRIFT ALERT: {header}")
        with st.expander(header, expanded=is_drift):
            st.markdown(f"**Decision:** {verdict_badge(decision.decision)}  |  "
                        f"**Claim status:** `{claim.status}`  |  "
                        f"**Evaluated:** `{decision.evaluated_on}`",
                        unsafe_allow_html=True)

            if rules:
                st.markdown("**Rules fired:**")
                for r in rules:
                    icon = "🔴" if r["rule_id"] in ("R1","R2","R3","R6") else "🟡"
                    st.markdown(f"- {icon} **{r['rule_id']}**: {r['message']}")

            # Active overrides
            overrides = list(session.exec(
                select(Override).where(Override.claim_id == claim.id)
            ).all())
            active_overrides = [o for o in overrides if o.status == OverrideStatus.ACTIVE]
            if active_overrides:
                for ov in active_overrides:
                    st.info(f"🔓 Active override by **{ACTORS_BY_ID.get(ov.by_id,{}).get('name', ov.by_id)}** "
                            f"until `{ov.expires_on}`: _{ov.reason}_")

            st.divider()
            acols = st.columns(3)

            # Re-evaluate
            if acols[0].button("🔄 Re-evaluate", key=f"reval_{claim.id}"):
                evaluate_claim(session, claim.id, GateTrigger.MANUAL, actor["id"])
                st.rerun()

            # Withdraw claim
            if role == "disclosure_committee" and claim.status == ClaimStatus.PUBLISHED:
                if acols[1].button("↩ Withdraw Claim", key=f"wd_{claim.id}"):
                    withdraw_claim(session, claim.id, actor["id"])
                    st.rerun()

            # Override — disclosure_committee only, not claim owner
            if role == "disclosure_committee":
                is_conflicted = actor["id"] == claim.owner_id
                if is_conflicted:
                    st.warning("⚠️ You are the claim owner — you cannot override this decision.")
                else:
                    with st.form(key=f"ov_{claim.id}"):
                        st.markdown("**Override BLOCK decision**")
                        reason = st.text_area("Reason (min 50 chars)", key=f"ov_reason_{claim.id}")
                        conditions = st.text_input("Conditions (e.g. remediate by date)", key=f"ov_cond_{claim.id}")
                        exp_date = st.date_input("Override expires on",
                                                 value=as_of + timedelta(days=90),
                                                 key=f"ov_exp_{claim.id}")
                        if st.form_submit_button("🔓 Create Override"):
                            if len(reason) < 50:
                                st.error("Reason must be at least 50 characters.")
                            elif not conditions:
                                st.error("Conditions are required.")
                            else:
                                try:
                                    create_override(session, claim.id, actor["id"],
                                                    reason, conditions, exp_date)
                                    st.success("Override created. Claim can now be published.")
                                    st.rerun()
                                except ValueError as e:
                                    st.error(str(e))
