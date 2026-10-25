import json
import sqlite3
import shutil
import streamlit as st
from sqlmodel import select

from db import get_session, AuditEvent, ControlTest, TestResult
from audit import verify_chain
from ui_helpers import render_sidebar_role, render_sidebar_clock

st.title("🔒 Internal Audit")

with get_session() as session:
    actor = render_sidebar_role()
    render_sidebar_clock(session)

    tabs = st.tabs(["Audit Log", "Chain Verify", "Test Definitions", "Tamper Demo"])

    # ── Audit Log ────────────────────────────────────────────────────────────
    with tabs[0]:
        st.subheader("Audit Event Log")
        events = list(session.exec(
            select(AuditEvent).order_by(AuditEvent.seq.desc())
        ).all())
        st.caption(f"{len(events)} events total")
        limit = st.slider("Show last N events", 10, 200, 50)
        for ev in events[:limit]:
            payload = json.loads(ev.payload or "{}")
            st.markdown(
                f"`#{ev.seq}` **{ev.ts_sim}** · `{ev.actor_id}` → **{ev.action}** "
                f"on `{ev.subject_type}:{ev.subject_id}`"
            )
            if payload:
                st.json(payload, expanded=False)
            st.divider()

    # ── Chain Verify ─────────────────────────────────────────────────────────
    with tabs[1]:
        st.subheader("Audit Chain Verification")
        st.markdown("Recomputes the SHA-256 hash chain over all audit events.")
        if st.button("🔍 Verify Chain"):
            valid, broken_at = verify_chain(session)
            if valid:
                st.success(f"✅ Chain is valid — all {len(list(session.exec(select(AuditEvent)).all()))} events verified.")
            else:
                st.error(f"❌ Chain BROKEN at seq={broken_at}. Evidence of tampering.")

    # ── Test Definitions ─────────────────────────────────────────────────────
    with tabs[2]:
        st.subheader("Control Test Definitions")
        tests = list(session.exec(select(ControlTest)).all())
        for t in tests:
            with st.expander(f"**{t.id}** — {t.name}"):
                if t.parameters:
                    st.json(json.loads(t.parameters))
                reviewed = "✅ Reviewed by audit" if t.reviewed_by_audit else "⬜ Not yet reviewed"
                st.caption(reviewed)
                if not t.reviewed_by_audit and actor["role"] == "internal_audit":
                    if st.button(f"Mark {t.id} as reviewed", key=f"rev_{t.id}"):
                        t.reviewed_by_audit = True
                        session.add(t)
                        session.commit()
                        st.rerun()

        # Random sample of results
        st.subheader("Result Sample (random 5)")
        import random
        all_results = list(session.exec(select(TestResult)).all())
        sample = random.sample(all_results, min(5, len(all_results)))
        for r in sample:
            icon = "🟢" if r.outcome == "PASS" else "🔴"
            st.markdown(f"{icon} `{r.control_id}` on `{r.run_on}`: {r.outcome} — {r.evidence_summary[:80]}")

    # ── Tamper Demo ───────────────────────────────────────────────────────────
    with tabs[3]:
        st.subheader("Tamper Demo")
        st.markdown(
            "Creates a **copy** of the live DB, flips one audit event payload in the copy, "
            "then runs chain verification to show it fails. The live DB is not affected."
        )
        if st.button("🧪 Run Tamper Demo"):
            # Copy DB
            shutil.copy("disclosure_gate.db", "tamper_demo.db")
            # Flip a payload directly via sqlite3 (bypassing SQLModel)
            conn = sqlite3.connect("tamper_demo.db")
            cur = conn.cursor()
            cur.execute("SELECT seq, payload FROM auditevent ORDER BY seq LIMIT 1 OFFSET 2")
            row = cur.fetchone()
            if row:
                seq, payload_str = row
                payload = json.loads(payload_str or "{}")
                payload["__tampered__"] = True
                cur.execute("UPDATE auditevent SET payload=? WHERE seq=?",
                            (json.dumps(payload), seq))
                conn.commit()
                conn.close()

                # Verify the tampered copy
                from sqlmodel import create_engine, Session as TSession
                tamper_engine = create_engine("sqlite:///./tamper_demo.db",
                                              connect_args={"check_same_thread": False})
                with TSession(tamper_engine) as ts:
                    valid, broken_at = verify_chain(ts)

                import os
                os.remove("tamper_demo.db")

                if not valid:
                    st.error(f"❌ As expected — tampered chain detected at seq={broken_at}.")
                    st.success("✅ Live DB is unchanged and still valid.")
                else:
                    st.warning("Tamper not detected (unexpected).")
            else:
                st.warning("Not enough audit events yet — run some checkpoints first.")
