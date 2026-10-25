"""Consistency Gate — pure function, no DB access.

evaluate(...) -> (verdict, rules_fired, missing_evidence)
verdict: "APPROVE" | "ESCALATE" | "BLOCK"
rules_fired: list of {rule_id, message, evidence_ids}
"""

from dataclasses import dataclass, field
from datetime import date


@dataclass
class RuleFired:
    rule_id: str
    message: str
    evidence_ids: list[str] = field(default_factory=list)


SEVERITY_ORDER = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}
VERDICT_ORDER  = {"APPROVE": 0, "ESCALATE": 1, "BLOCK": 2}


def _worse(a: str, b: str) -> str:
    return a if VERDICT_ORDER[a] >= VERDICT_ORDER[b] else b


def evaluate(
    claim: dict,
    controls: list[dict],           # controls mapped to this claim
    mappings: list[dict],           # ClaimControlMap rows for this claim
    latest_results: dict,           # control_id -> most recent TestResult dict (or None)
    open_findings: list[dict],      # Finding dicts for mapped controls
    risk_acceptances: list[dict],   # RiskAcceptance dicts for those findings
    active_overrides: list[dict],   # Override dicts for this claim
    manual_evidence: list[dict],    # ManualEvidence dicts for mapped controls
    as_of: date,
) -> tuple[str, list[RuleFired], list[str]]:

    rules: list[RuleFired] = []
    missing: list[str] = []
    verdict = "APPROVE"

    approved_mappings = [m for m in mappings if m.get("approved_by")]

    # R0 — no approved mapped controls
    if not approved_mappings:
        rules.append(RuleFired("R0",
            "Claim cannot be traced to any control — vague or unsupported wording."))
        return "ESCALATE", rules, missing

    for ctl in controls:
        cid = ctl["id"]
        result = latest_results.get(cid)
        freq = ctl.get("test_frequency_days", 30)

        # valid manual evidence for this control?
        valid_manual = next((
            m for m in manual_evidence
            if m["control_id"] == cid and date.fromisoformat(str(m["valid_until"])) >= as_of
        ), None)

        # R1 — never tested, no manual evidence
        if result is None and valid_manual is None:
            missing.append(cid)
            rules.append(RuleFired("R1",
                f"Control {cid} has never been tested. A policy on paper is not evidence of practice.",
                [cid]))
            verdict = _worse(verdict, "BLOCK")
            continue

        # R4 — stale evidence (check before R2 so we can still catch R2)
        if result:
            run_on = date.fromisoformat(str(result["run_on"]))
            age = (as_of - run_on).days
            if age > freq:
                rules.append(RuleFired("R4",
                    f"Evidence for {cid} is stale ({age} days old; required every {freq}).",
                    [str(result.get("id", cid))]))
                verdict = _worse(verdict, "ESCALATE")

            # R2 — latest result is FAIL
            if result["outcome"] == "FAIL":
                rules.append(RuleFired("R2",
                    f"Latest test of {cid} failed on {result['run_on']}: {result['evidence_summary']}",
                    [str(result.get("id", cid))]))
                verdict = _worse(verdict, "BLOCK")

    # R3 / R5 / R6 / R7 — findings
    accepted_finding_ids = {ra["finding_id"] for ra in risk_acceptances
                            if ra["status"] in ("APPROVED", "PROPOSED")}

    for f in open_findings:
        fid = f["id"]
        sev = f["severity"]
        days_open = (as_of - date.fromisoformat(str(f["opened_on"]))).days
        is_accepted = fid in accepted_finding_ids

        if not is_accepted:
            if sev in ("HIGH", "CRITICAL"):
                rules.append(RuleFired("R3",
                    f"Open {sev} finding {fid} contradicts this claim (open {days_open} days).",
                    [fid]))
                verdict = _worse(verdict, "BLOCK")
            elif sev == "MEDIUM":
                rules.append(RuleFired("R5",
                    f"Open MEDIUM finding {fid} may weaken this claim.",
                    [fid]))
                verdict = _worse(verdict, "ESCALATE")
        else:
            # find the acceptance record
            ra = next((r for r in risk_acceptances if r["finding_id"] == fid), None)
            if ra:
                expires = date.fromisoformat(str(ra["expires_on"]))
                approved_by_committee = ra.get("approved_by") is not None
                if ra["status"] == "PROPOSED" or not approved_by_committee or expires < as_of:
                    # R6 — accepted but not properly approved or expired
                    rules.append(RuleFired("R6",
                        f"Risk {fid} was accepted without disclosure-committee approval, "
                        f"but the public claim still says otherwise.",
                        [fid]))
                    verdict = _worse(verdict, "BLOCK")
                else:
                    # R7 — properly accepted
                    rules.append(RuleFired("R7",
                        f"Known accepted risk {fid}: confirm claim wording reflects it.",
                        [fid]))
                    verdict = _worse(verdict, "ESCALATE")

    # R8 — active override downgrades BLOCK -> ESCALATE (never to APPROVE)
    for ov in active_overrides:
        exp = date.fromisoformat(str(ov["expires_on"]))
        if ov["status"] == "ACTIVE" and exp >= as_of:
            rules.append(RuleFired("R8",
                f"Published under override {ov['id']} by {ov['by_id']} until {ov['expires_on']}: "
                f"\"{ov['reason'][:80]}\"",
                [ov["id"]]))
            if verdict == "BLOCK":
                verdict = "ESCALATE"

    return verdict, rules, missing
