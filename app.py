"""Disclosure Gate — main Streamlit entry point."""

import streamlit as st

st.set_page_config(
    page_title="Disclosure Gate",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.sidebar.title("🛡️ Disclosure Gate")
st.sidebar.caption("NimbusWatch Inc. — synthetic demo data")

pg = st.navigation([
    st.Page("pages/1_claim_registry.py",      title="Claim Registry",       icon="📋"),
    st.Page("pages/2_control_health.py",      title="Control Health",       icon="🔬"),
    st.Page("pages/3_findings.py",            title="Findings",             icon="⚠️"),
    st.Page("pages/4_escalation_inbox.py",    title="Escalation Inbox",     icon="📥"),
    st.Page("pages/5_gate_review.py",         title="Gate Review",          icon="🚦"),
    st.Page("pages/6_internal_audit.py",      title="Internal Audit",       icon="🔒"),
    st.Page("pages/7_oversight_dashboard.py", title="Oversight Dashboard",  icon="📊"),
    st.Page("pages/8_about.py",               title="About",                icon="ℹ️"),
])

pg.run()
