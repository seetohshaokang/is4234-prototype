"""Shared UI helpers for all Streamlit pages."""

import json
import streamlit as st
from db import Role

ACTORS = [
    {"id": "P-PRIYA",   "name": "Priya N.",    "role": Role.CONTROL_OWNER,       "title": "IT Ops Engineer"},
    {"id": "P-MARCUS",   "name": "T. Grant",    "role": Role.SECURITY_LEAD,        "title": "VP Security"},
    {"id": "P-DANA",    "name": "Dana L.",     "role": Role.CLAIM_AUTHOR,         "title": "Comms / Legal"},
    {"id": "P-RACHEL",  "name": "M. Okafor",  "role": Role.DISCLOSURE_COMMITTEE, "title": "CFO"},
    {"id": "P-CHEN",    "name": "R. Chen",     "role": Role.DISCLOSURE_COMMITTEE, "title": "General Counsel"},
    {"id": "P-IBRAHIM", "name": "S. Ibrahim",  "role": Role.INTERNAL_AUDIT,       "title": "Head of Internal Audit"},
    {"id": "P-SHARON", "name": "J. Morales",  "role": Role.AUDIT_COMMITTEE,      "title": "Audit Committee Chair"},
    {"id": "P-LEO",     "name": "Leo K.",      "role": Role.CONTROL_OWNER,        "title": "DevOps Engineer"},
]
ACTORS_BY_ID = {a["id"]: a for a in ACTORS}

VERDICT_COLORS = {
    "APPROVE":  ("🟢", "green",  "SUPPORTED"),
    "ESCALATE": ("🟡", "orange", "AT RISK"),
    "BLOCK":    ("🔴", "red",    "UNSUPPORTED"),
}
SUPPORT_STATE_COLORS = {
    "SUPPORTED":   ("🟢", "green"),
    "AT_RISK":     ("🟡", "orange"),
    "UNSUPPORTED": ("🔴", "red"),
    "UNMAPPED":    ("⚪", "gray"),
}
SEVERITY_COLORS = {
    "CRITICAL": "🔴",
    "HIGH":     "🟠",
    "MEDIUM":   "🟡",
    "LOW":      "🟢",
}


def init_session():
    if "actor_id" not in st.session_state:
        st.session_state.actor_id = "P-MARCUS"


def render_sidebar_role():
    """Render role switcher in sidebar. Returns current actor dict."""
    init_session()
    st.sidebar.header("👤 Acting as")
    actor_labels = [f"{a['name']} ({a['role']})" for a in ACTORS]
    current_idx = next((i for i, a in enumerate(ACTORS) if a["id"] == st.session_state.actor_id), 1)
    choice = st.sidebar.selectbox("Role", actor_labels, index=current_idx, label_visibility="collapsed")
    chosen = ACTORS[actor_labels.index(choice)]
    st.session_state.actor_id = chosen["id"]
    st.sidebar.caption(f"**{chosen['title']}**")
    return chosen


def render_sidebar_clock(session):
    """Render simulated clock and timeline controls in sidebar."""
    from services import get_clock, set_clock, advance_clock, apply_checkpoint, run_all_tests, evaluate_all_claims
    from db import GateTrigger

    current = get_clock(session)
    st.sidebar.divider()
    st.sidebar.header("🕐 Simulated Clock")
    st.sidebar.metric("Current date", str(current))

    st.sidebar.subheader("Scenario checkpoints")
    CPS = [
        ("CP1",  "2017-12-01", "Draft claims"),
        ("CP1b", "2017-12-01", "First test run"),
        ("CP2",  "2018-03-02", "Override expires"),
        ("CP3",  "2018-06-04", "VPN gap reported"),
        ("CP4",  "2018-09-03", "90 days, no fix"),
        ("CP5",  "2019-08-16", "Access review"),
        ("CP6",  "2019-11-19", "Leaked password"),
        ("CP7",  "2020-06-15", "Incident 1"),
        ("CP8",  "2020-10-14", "Incident 2"),
        ("CP9",  "2020-12-14", "Wrap-up"),
    ]
    cols = st.sidebar.columns(2)
    for i, (cp_id, cp_date, label) in enumerate(CPS):
        if cols[i % 2].button(f"{cp_id}\n{label}", key=f"cp_{cp_id}", use_container_width=True):
            apply_checkpoint(session, cp_id)
            st.rerun()

    st.sidebar.subheader("Free advance")
    days = st.sidebar.number_input("Advance N days", min_value=1, max_value=365, value=30, step=1)
    if st.sidebar.button("▶ Advance", use_container_width=True):
        advance_clock(session, int(days))
        run_all_tests(session)
        evaluate_all_claims(session, GateTrigger.CLOCK_ADVANCE)
        st.rerun()

    if st.sidebar.button("↺ Reset to seed state", use_container_width=True):
        import subprocess
        subprocess.run(["uv", "run", "python", "seed.py"], check=True)
        st.rerun()


def badge(text: str, color: str) -> str:
    colors = {"green": "#1a7f37", "red": "#cf222e", "orange": "#b35000",
              "gray": "#666", "blue": "#0550ae"}
    bg = {"green": "#dafbe1", "red": "#ffdede", "orange": "#fff3cd",
          "gray": "#eee", "blue": "#ddf4ff"}
    c = colors.get(color, "#333")
    b = bg.get(color, "#eee")
    return f'<span style="background:{b};color:{c};padding:2px 8px;border-radius:4px;font-size:0.8em;font-weight:600">{text}</span>'


def verdict_badge(verdict: str) -> str:
    icon, color, label = VERDICT_COLORS.get(verdict, ("⚪", "gray", verdict))
    return badge(f"{icon} {label}", color)


def support_badge(state: str) -> str:
    icon, color = SUPPORT_STATE_COLORS.get(state, ("⚪", "gray"))
    return badge(f"{icon} {state.replace('_',' ')}", color)


def severity_badge(sev: str) -> str:
    icon = SEVERITY_COLORS.get(sev, "⚪")
    color_map = {"CRITICAL": "red", "HIGH": "orange", "MEDIUM": "orange", "LOW": "green"}
    return badge(f"{icon} {sev}", color_map.get(sev, "gray"))


def parse_rules(rules_json: str | None) -> list[dict]:
    if not rules_json:
        return []
    try:
        return json.loads(rules_json)
    except Exception:
        return []
