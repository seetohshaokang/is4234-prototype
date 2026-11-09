"""Minimal smoke tests — gate rules R0–R2 and escalation ageing."""

from datetime import date
from pathlib import Path

import pytest

from engine.gate import evaluate
from engine.escalation import compute_new_escalations

SNAP = Path("data/snapshots")


# ── Gate tests ────────────────────────────────────────────────────────────────

def _eval(controls=None, mappings=None, results=None, findings=None,
          acceptances=None, overrides=None, manual=None):
    return evaluate(
        claim={"id": "C-01", "owner_id": "P-MARCUS"},
        controls=controls or [],
        mappings=mappings or [],
        latest_results=results or {},
        open_findings=findings or [],
        risk_acceptances=acceptances or [],
        active_overrides=overrides or [],
        manual_evidence=manual or [],
        as_of=date(2017, 12, 1),
    )


def test_r0_no_mappings():
    verdict, rules, _ = _eval()
    assert verdict == "ESCALATE"
    assert any(r.rule_id == "R0" for r in rules)


def test_r1_never_tested():
    verdict, rules, missing = _eval(
        controls=[{"id": "AC-01", "test_frequency_days": 30}],
        mappings=[{"claim_id": "C-01", "control_id": "AC-01", "approved_by": "P-RACHEL"}],
    )
    assert verdict == "BLOCK"
    assert any(r.rule_id == "R1" for r in rules)
    assert "AC-01" in missing


def test_r1_manual_evidence_prevents_block():
    verdict, rules, _ = _eval(
        controls=[{"id": "CM-01", "test_frequency_days": 90}],
        mappings=[{"claim_id": "C-01", "control_id": "CM-01", "approved_by": "P-RACHEL"}],
        manual=[{"control_id": "CM-01", "valid_until": date(2018, 2, 1), "summary": "attested"}],
    )
    assert verdict == "APPROVE"
    assert not any(r.rule_id == "R1" for r in rules)


def test_r2_fail_result():
    verdict, rules, _ = _eval(
        controls=[{"id": "AC-01", "test_frequency_days": 30}],
        mappings=[{"claim_id": "C-01", "control_id": "AC-01", "approved_by": "P-RACHEL"}],
        results={"AC-01": {"id": 1, "run_on": date(2017, 12, 1),
                           "outcome": "FAIL", "evidence_summary": "72% admin"}},
    )
    assert verdict == "BLOCK"
    assert any(r.rule_id == "R2" for r in rules)


def test_r2_pass_result_approves():
    verdict, rules, _ = _eval(
        controls=[{"id": "AC-01", "test_frequency_days": 30}],
        mappings=[{"claim_id": "C-01", "control_id": "AC-01", "approved_by": "P-RACHEL"}],
        results={"AC-01": {"id": 1, "run_on": date(2017, 12, 1),
                           "outcome": "PASS", "evidence_summary": "all good"}},
    )
    assert verdict == "APPROVE"


def test_r3_open_high_finding():
    verdict, rules, _ = _eval(
        controls=[{"id": "AC-01", "test_frequency_days": 30}],
        mappings=[{"claim_id": "C-01", "control_id": "AC-01", "approved_by": "P-RACHEL"}],
        results={"AC-01": {"id": 1, "run_on": date(2017, 12, 1),
                           "outcome": "PASS", "evidence_summary": "ok"}},
        findings=[{"id": "F-001", "control_id": "AC-01", "severity": "HIGH",
                   "status": "OPEN", "opened_on": date(2017, 12, 1)}],
    )
    assert verdict == "BLOCK"
    assert any(r.rule_id == "R3" for r in rules)


def test_r8_override_downgrades_block_not_approve():
    verdict, rules, _ = _eval(
        controls=[{"id": "AC-01", "test_frequency_days": 30}],
        mappings=[{"claim_id": "C-01", "control_id": "AC-01", "approved_by": "P-RACHEL"}],
        results={"AC-01": {"id": 1, "run_on": date(2017, 12, 1),
                           "outcome": "FAIL", "evidence_summary": "fail"}},
        overrides=[{"id": "OV-1", "by_id": "P-RACHEL", "reason": "approved",
                    "expires_on": date(2018, 3, 1), "status": "ACTIVE"}],
    )
    assert verdict == "ESCALATE"  # BLOCK downgraded to ESCALATE, not APPROVE
    assert any(r.rule_id == "R8" for r in rules)


def test_block_beats_escalate():
    # R0 would give ESCALATE, but R2 should give BLOCK and win
    verdict, rules, _ = _eval(
        controls=[{"id": "AC-01", "test_frequency_days": 30}],
        mappings=[{"claim_id": "C-01", "control_id": "AC-01", "approved_by": "P-RACHEL"}],
        results={"AC-01": {"id": 1, "run_on": date(2017, 11, 1),  # stale (R4) AND fail (R2)
                           "outcome": "FAIL", "evidence_summary": "fail"}},
    )
    assert verdict == "BLOCK"


# ── Escalation tests ──────────────────────────────────────────────────────────

PEOPLE = [
    {"id": "P-PRIYA",   "role": "control_owner"},
    {"id": "P-MARCUS",   "role": "security_lead"},
    {"id": "P-RACHEL",  "role": "disclosure_committee"},
    {"id": "P-SHARON", "role": "audit_committee"},
]


def _finding(opened_on: str, severity="HIGH", owner="P-PRIYA") -> dict:
    return {"id": "F-001", "control_id": "AC-01", "severity": severity,
            "status": "OPEN", "opened_on": opened_on,
            "owner_id": owner, "raised_by_id": owner}


def test_escalation_l1_l2_immediately():
    escs = compute_new_escalations(
        findings=[_finding("2018-06-04")],
        published_claim_control_ids=set(),
        claim_by_control={},
        existing_escalations=[],
        people=PEOPLE,
        as_of=date(2018, 6, 4),
    )
    levels = [e["level"] for e in escs]
    assert 1 in levels or 2 in levels  # L1 or L2 created (L1 may be skipped if owner conflicted)


def test_escalation_l3_at_30_days_if_published_claim():
    escs = compute_new_escalations(
        findings=[_finding("2018-06-04")],
        published_claim_control_ids={"AC-01"},
        claim_by_control={"AC-01": {"id": "C-01", "owner_id": "P-MARCUS"}},
        existing_escalations=[],
        people=PEOPLE,
        as_of=date(2018, 7, 4),  # 30 days later
    )
    levels = [e["level"] for e in escs]
    assert 3 in levels


def test_escalation_l4_at_90_days():
    escs = compute_new_escalations(
        findings=[_finding("2018-06-04")],
        published_claim_control_ids=set(),
        claim_by_control={},
        existing_escalations=[],
        people=PEOPLE,
        as_of=date(2018, 9, 3),  # 91 days
    )
    levels = [e["level"] for e in escs]
    assert 4 in levels


def test_independence_skip_all_conflicted():
    # Everyone at L3 (disclosure_committee) is conflicted — should jump to L4
    conflicted_people = [
        {"id": "P-PRIYA",   "role": "control_owner"},
        {"id": "P-MARCUS",   "role": "security_lead"},
        {"id": "P-RACHEL",  "role": "disclosure_committee"},  # will be conflicted as claim owner
        {"id": "P-SHARON", "role": "audit_committee"},
    ]
    finding = _finding("2018-06-04")
    finding["owner_id"] = "P-PRIYA"
    finding["raised_by_id"] = "P-PRIYA"
    # claim owner is P-RACHEL (same as the only disclosure_committee member)
    escs = compute_new_escalations(
        findings=[finding],
        published_claim_control_ids={"AC-01"},
        claim_by_control={"AC-01": {"id": "C-01", "owner_id": "P-RACHEL"}},
        existing_escalations=[],
        people=conflicted_people,
        as_of=date(2018, 7, 4),
    )
    # L3 candidate P-RACHEL is conflicted, should jump to L4
    levels = [e["level"] for e in escs]
    assert 4 in levels or any("independence_skip" in e.get("reason","") for e in escs)


# ── Control test engine ───────────────────────────────────────────────────────

def test_leastpriv_fail_on_2017_snapshot():
    from engine.control_tests import run_leastpriv
    r = run_leastpriv(SNAP, "2017-12-01")
    assert r.outcome == "FAIL"
    assert r.metrics["admin_share_pct"] > 10


def test_leastpriv_threshold_exactly_met():
    # All accounts non-admin => PASS
    import tempfile, csv
    from pathlib import Path as P
    from engine.control_tests import run_leastpriv as _run_leastpriv
    with tempfile.TemporaryDirectory() as tmp:
        snap = P(tmp) / "2000-01-01"
        snap.mkdir()
        with open(snap / "directory.csv", "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["account_id","display_name","dept","job_role",
                                               "is_admin","is_shared","is_service_account","enabled"])
            w.writeheader()
            for i in range(10):
                w.writerow({"account_id": f"U{i}", "display_name": f"U{i}", "dept": "Eng",
                             "job_role": "Eng", "is_admin": False, "is_shared": False,
                             "is_service_account": False, "enabled": True})
        r = _run_leastpriv(P(tmp), "2000-01-01")
        assert r.outcome == "PASS"


def test_secrets_critical_on_public_repo():
    from engine.control_tests import run_secrets
    r = run_secrets(SNAP, "2019-11-19")
    assert r.outcome == "FAIL"
    assert r.severity == "CRITICAL"
    assert "PUBLIC REPO" in r.evidence_summary


def test_secrets_masked_value():
    from engine.control_tests import run_secrets
    r = run_secrets(SNAP, "2019-11-19")
    # Should not contain raw password
    assert "nimbus123" not in r.evidence_summary


def test_vpndevice_fail_2018():
    from engine.control_tests import run_vpndevice
    r = run_vpndevice(SNAP, "2018-06-04")
    assert r.outcome == "FAIL"
    assert r.metrics["unmanaged_logins"] == 6


def test_sdlscan_fail_missing_security_scan():
    from engine.control_tests import run_sdlscan
    r = run_sdlscan(SNAP, "2017-12-01")
    assert r.outcome == "FAIL"
    assert "horizon-telemetry" in r.evidence_summary


def test_pwdpolicy_fail_critical_on_zero_length():
    from engine.control_tests import run_pwdpolicy
    r = run_pwdpolicy(SNAP, "2017-12-01")
    assert r.outcome == "FAIL"
    assert r.severity == "HIGH"  # HIGH because min_length=0 (< 6)
