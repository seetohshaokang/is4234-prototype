"""Five pure control test functions. No DB access — snapshot files in, result out."""

import csv
import json
import re
from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass
class TestOutcome:
    outcome: str          # "PASS" | "FAIL" | "ERROR"
    severity: str         # severity if FAIL: "LOW"|"MEDIUM"|"HIGH"|"CRITICAL"
    metrics: dict
    evidence_summary: str


def _latest_snapshot(snap_dir: Path, as_of: str) -> Path | None:
    """Return the most recent snapshot directory dated <= as_of."""
    available = sorted([d.name for d in snap_dir.iterdir() if d.is_dir() and d.name <= as_of])
    return snap_dir / available[-1] if available else None


# ── T-LEASTPRIV ──────────────────────────────────────────────────────────────

def run_leastpriv(snap_dir: Path, as_of: str, params: dict | None = None) -> TestOutcome:
    p = params or {"max_admin_share": 0.10, "max_shared_accounts": 0}
    snap = _latest_snapshot(snap_dir, as_of)
    if not snap:
        return TestOutcome("ERROR", "HIGH", {}, "No snapshot available.")

    with open(snap / "directory.csv") as f:
        rows = list(csv.DictReader(f))

    human = [r for r in rows if r["is_service_account"] == "False" and r["enabled"] == "True"]
    admins = [r for r in human if r["is_admin"] == "True"]
    shared = [r for r in human if r["is_shared"] == "True"]
    total = len(human) or 1
    admin_share = len(admins) / total
    shared_count = len(shared)

    metrics = {
        "total_human_accounts": total,
        "admin_count": len(admins),
        "admin_share_pct": round(admin_share * 100, 1),
        "shared_account_count": shared_count,
        "threshold_admin_share_pct": p["max_admin_share"] * 100,
    }

    failures = []
    if admin_share > p["max_admin_share"]:
        failures.append(f"{metrics['admin_share_pct']}% of accounts have admin rights (threshold: {p['max_admin_share']*100}%)")
    if shared_count > p["max_shared_accounts"]:
        failures.append(f"{shared_count} shared/service accounts found (threshold: {p['max_shared_accounts']})")

    if failures:
        summary = "FAIL: " + "; ".join(failures)
        return TestOutcome("FAIL", "HIGH", metrics, summary)
    return TestOutcome("PASS", "HIGH", metrics, f"Admin share {metrics['admin_share_pct']}% within threshold.")


# ── T-PWDPOLICY ──────────────────────────────────────────────────────────────

def run_pwdpolicy(snap_dir: Path, as_of: str, params: dict | None = None) -> TestOutcome:
    snap = _latest_snapshot(snap_dir, as_of)
    if not snap:
        return TestOutcome("ERROR", "HIGH", {}, "No snapshot available.")

    with open(snap / "password_policies.json") as f:
        policies = json.load(f)

    failures = []
    critical = False
    for pol in policies:
        sys = pol["system"]
        if pol["min_length"] < 6:
            critical = True
            failures.append(f"{sys}: min_length={pol['min_length']} (critical — under 6)")
        elif pol["min_length"] < 8:
            failures.append(f"{sys}: min_length={pol['min_length']} (must be >= 8)")
        if not pol["complexity_required"]:
            failures.append(f"{sys}: complexity_required=false")
        if pol["rotation_days"] > 90:
            failures.append(f"{sys}: rotation_days={pol['rotation_days']} (must be <= 90)")
        if pol["history_count"] < 5:
            failures.append(f"{sys}: history_count={pol['history_count']} (must be >= 5)")

    metrics = {"systems_checked": len(policies), "systems_failing": len(set(f.split(":")[0] for f in failures))}
    if failures:
        severity = "HIGH" if critical else "MEDIUM"
        return TestOutcome("FAIL", severity, metrics, "FAIL: " + "; ".join(failures))
    return TestOutcome("PASS", "MEDIUM", metrics, f"All {len(policies)} systems meet password policy requirements.")


# ── T-SECRETS ────────────────────────────────────────────────────────────────

_SECRET_PATTERNS = [
    re.compile(r'password\s*[=:]\s*\S+', re.IGNORECASE),
    re.compile(r'ftp_pass\s*[=:]\s*\S+', re.IGNORECASE),
    re.compile(r'secret\s*[=:]\s*\S+', re.IGNORECASE),
    re.compile(r'AKIA[0-9A-Z]{16}'),
]

def _mask(val: str) -> str:
    if len(val) <= 4:
        return "****"
    return val[:2] + "*" * (len(val) - 4) + val[-2:]

def run_secrets(snap_dir: Path, as_of: str, params: dict | None = None) -> TestOutcome:
    snap = _latest_snapshot(snap_dir, as_of)
    if not snap:
        return TestOutcome("ERROR", "CRITICAL", {}, "No snapshot available.")

    repo_dir = snap / "repos"
    findings = []
    public_hit = False

    for fpath in repo_dir.rglob("*"):
        if not fpath.is_file():
            continue
        is_public = "public" in fpath.parts
        try:
            content = fpath.read_text(errors="ignore")
        except Exception:
            continue
        for lineno, line in enumerate(content.splitlines(), 1):
            for pat in _SECRET_PATTERNS:
                m = pat.search(line)
                if m:
                    matched = m.group(0)
                    # mask the value part
                    if "=" in matched or ":" in matched:
                        sep = "=" if "=" in matched else ":"
                        key, val = matched.split(sep, 1)
                        masked = f"{key}{sep}{_mask(val.strip())}"
                    else:
                        masked = _mask(matched)
                    rel = fpath.relative_to(snap)
                    findings.append(f"{rel}:{lineno}: {masked}" + (" [PUBLIC REPO]" if is_public else ""))
                    if is_public:
                        public_hit = True

    metrics = {"files_scanned": sum(1 for f in repo_dir.rglob("*") if f.is_file()),
               "secrets_found": len(findings)}
    if findings:
        severity = "CRITICAL" if public_hit else "HIGH"
        summary = "FAIL: Exposed credentials found — " + "; ".join(findings[:3])
        if len(findings) > 3:
            summary += f" (and {len(findings)-3} more)"
        return TestOutcome("FAIL", severity, metrics, summary)
    return TestOutcome("PASS", "CRITICAL", metrics, f"No exposed credentials in {metrics['files_scanned']} files.")


# ── T-VPNDEVICE ──────────────────────────────────────────────────────────────

def run_vpndevice(snap_dir: Path, as_of: str, params: dict | None = None) -> TestOutcome:
    p = params or {"max_unmanaged_logins": 0}
    snap = _latest_snapshot(snap_dir, as_of)
    if not snap:
        return TestOutcome("ERROR", "HIGH", {}, "No snapshot available.")

    vpn_file = snap / "vpn_logins.csv"
    mgd_file = snap / "managed_devices.csv"

    if vpn_file.stat().st_size == 0:
        return TestOutcome("PASS", "HIGH", {"vpn_logins": 0, "unmanaged": 0},
                           "No VPN logins in this snapshot period.")

    with open(vpn_file) as f:
        logins = list(csv.DictReader(f))
    with open(mgd_file) as f:
        managed = {r["device_id"] for r in csv.DictReader(f) if r["mdm_enrolled"] == "True"}

    unmanaged = [l for l in logins if l["device_id"] not in managed]
    metrics = {"vpn_logins": len(logins), "unmanaged_logins": len(unmanaged),
               "threshold": p["max_unmanaged_logins"]}

    if len(unmanaged) > p["max_unmanaged_logins"]:
        examples = ", ".join(set(l["device_id"] for l in unmanaged[:3]))
        return TestOutcome("FAIL", "HIGH", metrics,
                           f"FAIL: {len(unmanaged)} VPN logins from unmanaged devices (e.g. {examples})")
    return TestOutcome("PASS", "HIGH", metrics, f"All {len(logins)} VPN logins from managed devices.")


# ── T-SDLSCAN ────────────────────────────────────────────────────────────────

def run_sdlscan(snap_dir: Path, as_of: str, params: dict | None = None) -> TestOutcome:
    snap = _latest_snapshot(snap_dir, as_of)
    if not snap:
        return TestOutcome("ERROR", "HIGH", {}, "No snapshot available.")

    pipe_dir = snap / "pipelines"
    failures = []
    checked = 0

    for yaml_file in pipe_dir.glob("*.yaml"):
        checked += 1
        with open(yaml_file) as f:
            data = yaml.safe_load(f)
        steps = data.get("steps", [])
        types = [st.get("type") for st in steps]

        # find index of release step
        release_idx = next((i for i, t in enumerate(types) if t == "release"), None)
        if release_idx is None:
            failures.append(f"{yaml_file.name}: no release step found")
            continue
        before_release = types[:release_idx]
        if "security_scan" not in before_release:
            failures.append(f"{yaml_file.name}: missing security_scan before release")
        if "dependency_check" not in before_release:
            failures.append(f"{yaml_file.name}: missing dependency_check before release")

    metrics = {"pipelines_checked": checked, "pipelines_failing": len(failures)}
    if failures:
        return TestOutcome("FAIL", "HIGH", metrics, "FAIL: " + "; ".join(failures))
    return TestOutcome("PASS", "HIGH", metrics, f"All {checked} pipelines include required security steps.")


# ── Dispatch ─────────────────────────────────────────────────────────────────

TESTS = {
    "T-LEASTPRIV": run_leastpriv,
    "T-PWDPOLICY": run_pwdpolicy,
    "T-SECRETS":   run_secrets,
    "T-VPNDEVICE": run_vpndevice,
    "T-SDLSCAN":   run_sdlscan,
}

def run_test(test_id: str, snap_dir: Path, as_of: str, params: dict | None = None) -> TestOutcome:
    fn = TESTS.get(test_id)
    if not fn:
        return TestOutcome("ERROR", "LOW", {}, f"Unknown test: {test_id}")
    return fn(snap_dir, as_of, params)
