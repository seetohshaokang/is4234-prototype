"""Check engine — pure functions: run(raw_data, params, check_version) -> (outcome, measured_value, evidence_summary)."""

import re
from datetime import date
from typing import Any

PASS = "PASS"
FAIL = "FAIL"


# ── T-LEASTPRIV ───────────────────────────────────────────────────────────────

def run_leastpriv(raw: dict, params: dict, **_) -> tuple[str, Any, str]:
    accounts = raw.get("accounts", [])
    enabled_humans = [
        a for a in accounts
        if str(a.get("enabled", "")).lower() in ("true", "1", "yes")
        and str(a.get("is_service_account", "")).lower() not in ("true", "1", "yes")
    ]
    if not enabled_humans:
        return FAIL, None, "No enabled human accounts found in directory snapshot."

    admin_count = sum(1 for a in enabled_humans if str(a.get("is_admin", "")).lower() in ("true", "1", "yes"))
    shared_count = sum(1 for a in enabled_humans if str(a.get("is_shared", "")).lower() in ("true", "1", "yes"))
    admin_share = admin_count / len(enabled_humans)

    max_admin = params.get("max_admin_share", 0.10)
    max_shared = params.get("max_shared_accounts", 0)

    failures = []
    if admin_share > max_admin:
        failures.append(f"admin share {admin_share:.1%} exceeds threshold {max_admin:.0%}")
    if shared_count > max_shared:
        failures.append(f"{shared_count} shared account(s) found (max {max_shared})")

    if failures:
        return FAIL, {"admin_share": round(admin_share, 4), "shared_count": shared_count}, "; ".join(failures)
    return PASS, {"admin_share": round(admin_share, 4), "shared_count": shared_count}, \
        f"Admin share {admin_share:.1%} ≤ {max_admin:.0%}; {shared_count} shared accounts."


# ── T-VPNDEVICE ───────────────────────────────────────────────────────────────

def run_vpndevice(raw: dict, params: dict, **_) -> tuple[str, Any, str]:
    logins = raw.get("vpn_logins", [])
    devices = {d["device_id"]: d for d in raw.get("managed_devices", [])}

    if not logins:
        return PASS, {"unmanaged_logins": 0}, "No VPN logins in snapshot."

    unmanaged = [
        l for l in logins
        if l.get("device_id") not in devices
        or str(devices[l["device_id"]].get("mdm_enrolled", "")).lower() not in ("true", "1", "yes")
    ]

    max_unmanaged = params.get("max_unmanaged_logins", 0)
    if len(unmanaged) > max_unmanaged:
        sample = ", ".join(u["device_id"] for u in unmanaged[:3])
        return FAIL, {"unmanaged_logins": len(unmanaged)}, \
            f"{len(unmanaged)} VPN login(s) from unmanaged devices (e.g. {sample})."
    return PASS, {"unmanaged_logins": 0}, f"All {len(logins)} VPN logins from managed devices."


# ── T-MFA ─────────────────────────────────────────────────────────────────────

def run_mfa(raw: dict, params: dict, **_) -> tuple[str, Any, str]:
    accounts = raw.get("accounts", [])
    remote_humans = [
        a for a in accounts
        if str(a.get("enabled", "")).lower() in ("true", "1", "yes")
        and str(a.get("is_service_account", "")).lower() not in ("true", "1", "yes")
        and str(a.get("has_remote_access", "")).lower() in ("true", "1", "yes")
    ]
    if not remote_humans:
        return PASS, {"mfa_coverage_pct": 100.0}, "No human accounts with remote access."

    mfa_count = sum(1 for a in remote_humans if str(a.get("mfa_enabled", "")).lower() in ("true", "1", "yes"))
    coverage = mfa_count / len(remote_humans) * 100

    min_coverage = params.get("min_coverage_pct", 98.0)
    if coverage < min_coverage:
        return FAIL, {"mfa_coverage_pct": round(coverage, 1)}, \
            f"MFA coverage {coverage:.1f}% below threshold {min_coverage}% ({mfa_count}/{len(remote_humans)} accounts)."
    return PASS, {"mfa_coverage_pct": round(coverage, 1)}, \
        f"MFA coverage {coverage:.1f}% ≥ {min_coverage}% ({mfa_count}/{len(remote_humans)} accounts)."


# ── T-PWDPOLICY ───────────────────────────────────────────────────────────────

def run_pwdpolicy(raw: dict, params: dict, check_version: str = "1", **_) -> tuple[str, Any, str]:
    policies = raw.get("policies", [])
    if not policies:
        return FAIL, None, "No password policy data in snapshot."

    failures = []
    for pol in policies:
        system = pol.get("system", "?")

        if check_version == "2":
            # Only check non-SSO systems; thresholds are stricter (min 12)
            if str(pol.get("sso", "false")).lower() in ("true", "1", "yes"):
                continue
            min_len = 12
            # No rotation rule in v2
            if pol.get("min_length", 0) < min_len:
                failures.append(f"{system}: min_length {pol['min_length']} < {min_len}")
            if not pol.get("complexity_required", False):
                failures.append(f"{system}: complexity not required")
            if pol.get("history_count", 0) < 5:
                failures.append(f"{system}: history_count {pol['history_count']} < 5")
        else:
            # v1: all systems, min 8
            if pol.get("min_length", 0) < 8:
                failures.append(f"{system}: min_length {pol['min_length']} < 8")
            if not pol.get("complexity_required", False):
                failures.append(f"{system}: complexity not required")
            if pol.get("rotation_days", 999) > 90:
                failures.append(f"{system}: rotation_days {pol['rotation_days']} > 90")
            if pol.get("history_count", 0) < 5:
                failures.append(f"{system}: history_count {pol['history_count']} < 5")

    if failures:
        return FAIL, {"failing_systems": failures}, "; ".join(failures[:3]) + ("…" if len(failures) > 3 else "")
    label = "v2 (non-SSO systems only)" if check_version == "2" else "v1"
    return PASS, {}, f"All systems pass password policy {label}."


def severity_pwdpolicy(raw: dict, check_version: str = "1") -> str:
    """Return HIGH if any system has min_length < 6, else MEDIUM."""
    for pol in raw.get("policies", []):
        if check_version == "2" and str(pol.get("sso", "false")).lower() in ("true", "1", "yes"):
            continue
        if pol.get("min_length", 999) < 6:
            return "HIGH"
    return "MEDIUM"


# ── T-SECRETS ─────────────────────────────────────────────────────────────────

_SECRET_PATTERNS = [
    re.compile(r'password\s*[=:]\s*\S+', re.IGNORECASE),
    re.compile(r'ftp_pass\s*[=:]\s*\S+', re.IGNORECASE),
    re.compile(r'secret\s*[=:]\s*\S+', re.IGNORECASE),
    re.compile(r'AKIA[0-9A-Z]{16}'),
]

def _mask(value: str) -> str:
    if len(value) <= 3:
        return "***"
    return value[:3] + "*" * (len(value) - 3)


def run_secrets(raw: dict, params: dict, **_) -> tuple[str, Any, str]:
    files = raw.get("files", [])
    hits = []
    for f in files:
        content = f.get("content", "")
        for line_no, line in enumerate(content.splitlines(), 1):
            for pat in _SECRET_PATTERNS:
                m = pat.search(line)
                if m:
                    # mask the matched value
                    matched = m.group(0)
                    eq_pos = max(matched.find("="), matched.find(":"))
                    if eq_pos >= 0:
                        raw_val = matched[eq_pos + 1:].strip()
                        masked = matched[:eq_pos + 1] + " " + _mask(raw_val)
                    else:
                        masked = _mask(matched)
                    hits.append({
                        "file": f["path"],
                        "line": line_no,
                        "match": masked,
                        "is_public": f.get("is_public", False),
                    })

    if hits:
        in_public = any(h["is_public"] for h in hits)
        severity = "CRITICAL" if in_public else "HIGH"
        sample = hits[0]
        return FAIL, {"hits": hits, "severity": severity}, \
            f"Credential found in {'public' if sample['is_public'] else 'private'} repo " \
            f"{sample['file']} line {sample['line']}: {sample['match']}"
    return PASS, {}, "No credential patterns found in repositories."


def severity_secrets(raw_result: dict) -> str:
    hits = raw_result.get("hits", [])
    if any(h.get("is_public") for h in hits):
        return "CRITICAL"
    return "HIGH"


# ── T-SDLSCAN ─────────────────────────────────────────────────────────────────

def run_sdlscan(raw: dict, params: dict, **_) -> tuple[str, Any, str]:
    pipelines = raw.get("pipelines", [])
    if not pipelines:
        return FAIL, None, "No pipeline definitions found."

    failures = []
    for pipe in pipelines:
        steps = [s.get("type", "") for s in pipe.get("steps", [])]
        has_scan = "security_scan" in steps
        has_dep = "dependency_check" in steps
        has_release = "release" in steps

        if not has_scan or not has_dep:
            failures.append(
                f"{pipe['name']}: missing "
                + (", ".join(filter(None, [
                    "security_scan" if not has_scan else "",
                    "dependency_check" if not has_dep else "",
                ])))
            )
            continue

        # Ensure scan and dep check appear before release
        scan_idx = next((i for i, s in enumerate(pipe.get("steps", [])) if s.get("type") == "security_scan"), 999)
        dep_idx = next((i for i, s in enumerate(pipe.get("steps", [])) if s.get("type") == "dependency_check"), 999)
        rel_idx = next((i for i, s in enumerate(pipe.get("steps", [])) if s.get("type") == "release"), 999)

        if has_release and (scan_idx > rel_idx or dep_idx > rel_idx):
            failures.append(f"{pipe['name']}: security steps appear after release")

    if failures:
        return FAIL, {"failing_pipelines": failures}, "; ".join(failures)
    return PASS, {}, f"All {len(pipelines)} pipeline(s) have required security steps."


# ── T-UPTIME ──────────────────────────────────────────────────────────────────

def run_uptime(raw: dict, params: dict, as_of: date | None = None, **_) -> tuple[str, Any, str]:
    monthly = raw.get("monthly", {})
    if not monthly:
        return FAIL, None, "No uptime data in snapshot."

    min_pct = params.get("min_monthly_pct", 99.9)
    failing = {k: v for k, v in monthly.items() if v < min_pct}

    # Only check months that are fully completed relative to as_of
    if as_of:
        completed = {k: v for k, v in monthly.items()
                     if k < f"{as_of.year}-{as_of.month:02d}"}
        failing = {k: v for k, v in completed.items() if v < min_pct}

    if failing:
        worst_month = min(failing, key=failing.get)
        return FAIL, {"failing_months": failing}, \
            f"Availability below {min_pct}%: {worst_month} = {failing[worst_month]:.2f}%"
    return PASS, {}, f"All completed months ≥ {min_pct}% availability."


# ── Dispatch ──────────────────────────────────────────────────────────────────

def run_check(check_id: str, check_version: str, raw: dict, params: dict,
              as_of: date | None = None) -> tuple[str, Any, str]:
    dispatch = {
        "T-LEASTPRIV": run_leastpriv,
        "T-VPNDEVICE":  run_vpndevice,
        "T-MFA":        run_mfa,
        "T-PWDPOLICY":  run_pwdpolicy,
        "T-SECRETS":    run_secrets,
        "T-SDLSCAN":    run_sdlscan,
        "T-UPTIME":     run_uptime,
    }
    fn = dispatch.get(check_id)
    if fn is None:
        return FAIL, None, f"Unknown check: {check_id}"
    return fn(raw, params, check_version=check_version, as_of=as_of)


def infer_severity(check_id: str, check_version: str, outcome: str, measured: Any) -> str:
    """Return the finding severity for a FAIL result."""
    if outcome != FAIL:
        return "LOW"
    if check_id == "T-SECRETS":
        return severity_secrets(measured if isinstance(measured, dict) else {})
    if check_id == "T-PWDPOLICY":
        return "HIGH"  # simplified; full logic in run_pwdpolicy
    defaults = {
        "T-LEASTPRIV": "HIGH",
        "T-VPNDEVICE":  "HIGH",
        "T-MFA":        "HIGH",
        "T-SDLSCAN":    "HIGH",
        "T-UPTIME":     "MEDIUM",
    }
    return defaults.get(check_id, "MEDIUM")
