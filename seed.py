"""Seed the DB and generate synthetic snapshots. Run once before demo."""

import csv
import json
import random
import shutil
from datetime import date, timedelta
from pathlib import Path

import yaml
from sqlmodel import SQLModel, Session

from db import (
    engine, create_tables,
    Person, Role, SimClock,
    CheckDefinition, Collector, CollectorStatus,
    Control, SCC, SCCVersion, SCCVersionControl, SCCVersionStatus, EvidenceType,
    ManualEvidence, CheckpointApplied,
)

SNAP_DIR = Path("data/snapshots")
RNG = random.Random(4234)

DEPTS = ["Engineering", "Finance", "HR", "Sales", "IT Ops", "Legal", "DevOps"]
JOBS  = ["Engineer", "Manager", "Analyst", "Director", "Coordinator", "Specialist"]


# ── Snapshot helpers ──────────────────────────────────────────────────────────

def _accounts(n: int, admin_pct: float, shared_count: int, mfa_pct: float) -> list[dict]:
    rows = []
    admin_slots = int(n * admin_pct)
    mfa_slots = int(n * mfa_pct)
    for i in range(1, n + 1):
        rows.append({
            "account_id": f"USR{i:04d}",
            "display_name": f"shared-svc-{i}" if i <= shared_count else f"User {i}",
            "dept": RNG.choice(DEPTS),
            "job_role": RNG.choice(JOBS),
            "is_admin": i <= admin_slots,
            "is_shared": i <= shared_count,
            "is_service_account": False,
            "enabled": True,
            "mfa_enabled": i <= mfa_slots,
            "has_remote_access": i <= int(n * 0.6),
        })
    return rows


def _vpn(n: int, unmanaged: int, date_str: str) -> tuple[list[dict], list[dict]]:
    logins, devices = [], {}
    for i in range(n):
        is_bad = i >= (n - unmanaged)
        dev_id = f"UNDEV{i:04d}" if is_bad else f"DEV{i:04d}"
        logins.append({
            "ts": f"{date_str}T{8 + i % 10:02d}:00:00",
            "account_id": f"USR{i + 1:04d}",
            "device_id": dev_id,
            "source_ip": f"10.0.{i // 255}.{i % 255 + 1}",
        })
        devices[dev_id] = {
            "device_id": dev_id,
            "owner": "IT" if not is_bad else "unknown",
            "mdm_enrolled": not is_bad,
        }
    return logins, list(devices.values())


def _write_snapshot(d: str, accounts: list, policies: list, vpn_logins: list,
                    managed_devs: list, pipelines: dict, secret_files: list,
                    uptime: dict) -> None:
    p = SNAP_DIR / d
    p.mkdir(parents=True, exist_ok=True)

    with open(p / "directory.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(accounts[0].keys()))
        w.writeheader(); w.writerows(accounts)

    (p / "password_policies.json").write_text(json.dumps(policies, indent=2))

    with open(p / "vpn_logins.csv", "w", newline="") as f:
        if vpn_logins:
            w = csv.DictWriter(f, fieldnames=["ts", "account_id", "device_id", "source_ip"])
            w.writeheader(); w.writerows(vpn_logins)
    with open(p / "managed_devices.csv", "w", newline="") as f:
        if managed_devs:
            w = csv.DictWriter(f, fieldnames=["device_id", "owner", "mdm_enrolled"])
            w.writeheader(); w.writerows(managed_devs)

    pipe_dir = p / "pipelines"
    pipe_dir.mkdir(exist_ok=True)
    for name, steps in pipelines.items():
        (pipe_dir / f"{name}.yaml").write_text(yaml.dump({"pipeline": name, "steps": steps}))

    repo_dir = p / "repos"
    repo_dir.mkdir(exist_ok=True)
    (repo_dir / "README.md").write_text("# NimbusWatch Repos\n")
    for sf in secret_files:
        fpath = repo_dir / sf["file"]
        fpath.parent.mkdir(parents=True, exist_ok=True)
        fpath.write_text(sf["content"])

    (p / "uptime.json").write_text(json.dumps(uptime, indent=2))


# ── Static data ───────────────────────────────────────────────────────────────

POLICIES_BAD = [
    {"system": "corp-ad",     "min_length": 8, "complexity_required": True,  "rotation_days": 90,  "history_count": 5,  "mfa_required": True,  "sso": False},
    {"system": "vpn-gateway", "min_length": 8, "complexity_required": True,  "rotation_days": 90,  "history_count": 5,  "mfa_required": True,  "sso": False},
    {"system": "prod-db",     "min_length": 0, "complexity_required": False, "rotation_days": 180, "history_count": 2,  "mfa_required": False, "sso": False},
    {"system": "code-repo",   "min_length": 8, "complexity_required": True,  "rotation_days": 90,  "history_count": 5,  "mfa_required": False, "sso": False},
]

# 2018-09-03: 11 of 12 systems on SSO; billing-ftp still non-SSO with min_length=0
POLICIES_SSO = [
    {"system": "corp-ad",      "min_length": 12, "complexity_required": True, "rotation_days": 90, "history_count": 5, "mfa_required": True,  "sso": True},
    {"system": "vpn-gateway",  "min_length": 12, "complexity_required": True, "rotation_days": 90, "history_count": 5, "mfa_required": True,  "sso": True},
    {"system": "prod-db",      "min_length": 12, "complexity_required": True, "rotation_days": 90, "history_count": 5, "mfa_required": False, "sso": True},
    {"system": "code-repo",    "min_length": 12, "complexity_required": True, "rotation_days": 90, "history_count": 5, "mfa_required": False, "sso": True},
    {"system": "hr-portal",    "min_length": 12, "complexity_required": True, "rotation_days": 90, "history_count": 5, "mfa_required": False, "sso": True},
    {"system": "crm",          "min_length": 12, "complexity_required": True, "rotation_days": 90, "history_count": 5, "mfa_required": False, "sso": True},
    {"system": "wiki",         "min_length": 12, "complexity_required": True, "rotation_days": 90, "history_count": 5, "mfa_required": False, "sso": True},
    {"system": "jira",         "min_length": 12, "complexity_required": True, "rotation_days": 90, "history_count": 5, "mfa_required": False, "sso": True},
    {"system": "monitoring",   "min_length": 12, "complexity_required": True, "rotation_days": 90, "history_count": 5, "mfa_required": False, "sso": True},
    {"system": "analytics",    "min_length": 12, "complexity_required": True, "rotation_days": 90, "history_count": 5, "mfa_required": False, "sso": True},
    {"system": "deploy-tools", "min_length": 12, "complexity_required": True, "rotation_days": 90, "history_count": 5, "mfa_required": False, "sso": True},
    # Non-SSO legacy system — still fails T-PWDPOLICY v2
    {"system": "billing-ftp",  "min_length": 0,  "complexity_required": False, "rotation_days": 180, "history_count": 2, "mfa_required": False, "sso": False},
]

# All non-SSO systems fixed after remediation
POLICIES_FIXED = [
    {"system": s, "min_length": 12, "complexity_required": True, "rotation_days": 90,
     "history_count": 5, "mfa_required": True, "sso": True}
    for s in ["corp-ad", "vpn-gateway", "prod-db", "code-repo", "hr-portal",
              "crm", "wiki", "jira", "monitoring", "analytics", "deploy-tools"]
] + [
    {"system": "billing-ftp", "min_length": 12, "complexity_required": True,
     "rotation_days": 90, "history_count": 5, "mfa_required": False, "sso": False},
]

PIPELINES_FIXED = {
    "horizon-core": [
        {"name": "build",            "type": "build"},
        {"name": "unit-tests",       "type": "test"},
        {"name": "dependency-check", "type": "dependency_check"},
        {"name": "security-scan",    "type": "security_scan"},
        {"name": "release",          "type": "release"},
    ],
    "horizon-telemetry": [
        {"name": "build",            "type": "build"},
        {"name": "unit-tests",       "type": "test"},
        {"name": "dependency-check", "type": "dependency_check"},
        {"name": "security-scan",    "type": "security_scan"},
        {"name": "release",          "type": "release"},
    ],
}

PIPELINES = {
    "horizon-core": [
        {"name": "build",            "type": "build"},
        {"name": "unit-tests",       "type": "test"},
        {"name": "dependency-check", "type": "dependency_check"},
        {"name": "security-scan",    "type": "security_scan"},
        {"name": "release",          "type": "release"},
    ],
    "horizon-telemetry": [
        {"name": "build",            "type": "build"},
        {"name": "unit-tests",       "type": "test"},
        {"name": "dependency-check", "type": "dependency_check"},
        # deliberately missing security_scan
        {"name": "release",          "type": "release"},
    ],
}

SECRET_FILE = [{
    "file": "public/updates-mirror/config.ini",
    "content": "[ftp]\nhost = updates.nimbus.internal\nftp_pass = nimbus123\nport = 21\n",
}]

# Monthly availability 2017-12 to 2020-11; Sep 2020 = 99.71%, all others ≥ 99.9%
def _build_uptime() -> dict:
    months = {}
    start = date(2017, 12, 1)
    for i in range(36):
        m = start.month + i
        y = start.year + (m - 1) // 12
        m = (m - 1) % 12 + 1
        key = f"{y}-{m:02d}"
        if y == 2020 and m == 9:
            months[key] = 99.71
        else:
            months[key] = round(RNG.uniform(99.91, 99.98), 2)
    return months


def generate_snapshots() -> None:
    if SNAP_DIR.exists():
        shutil.rmtree(SNAP_DIR)

    uptime = _build_uptime()

    specs = [
        ("2017-12-01", _accounts(150, 0.72, 3, 0.41), POLICIES_BAD,   [],              [],              [],          PIPELINES),
        ("2018-06-04", _accounts(180, 0.70, 3, 0.52), POLICIES_BAD,   *_vpn(40, 6, "2018-06-04"), [],  PIPELINES),
        ("2018-09-03", _accounts(185, 0.70, 3, 0.55), POLICIES_SSO,   *_vpn(42, 5, "2018-09-03"), [],  PIPELINES),
        ("2019-08-16", _accounts(220, 0.68, 2, 0.60), POLICIES_SSO,   *_vpn(55, 9, "2019-08-16"), [],  PIPELINES),
        ("2019-11-19", _accounts(220, 0.68, 2, 0.60), POLICIES_SSO,   *_vpn(55, 9, "2019-11-19"), SECRET_FILE, PIPELINES),
        ("2020-06-15", _accounts(240, 0.65, 2, 0.63), POLICIES_SSO,   *_vpn(60, 7, "2020-06-15"), SECRET_FILE, PIPELINES),
        ("2020-10-14", _accounts(240, 0.65, 2, 0.63), POLICIES_SSO,   *_vpn(60, 7, "2020-10-14"), SECRET_FILE, PIPELINES),
        # Post-remediation: admin bloat fixed, MFA near-universal, pipelines fixed, secrets removed
        ("2020-11-15", _accounts(240, 0.05, 0, 0.99), POLICIES_FIXED, *_vpn(60, 0, "2020-11-15"), [], PIPELINES_FIXED),
    ]
    for d, accts, pols, vpn_l, vpn_d, secs, pipes in specs:
        _write_snapshot(d, accts, pols, vpn_l, vpn_d, pipes, secs, uptime)
        print(f"  snapshot {d}: {len(accts)} accounts, {len(vpn_l)} VPN logins")


# ── DB seed ───────────────────────────────────────────────────────────────────

def seed_db() -> None:
    SQLModel.metadata.drop_all(engine)
    create_tables()

    with Session(engine) as s:
        # People
        people = [
            Person(id="P-PRIYA",   name="Priya N.",   role=Role.CONTROL_OWNER,        title="IT Ops Engineer"),
            Person(id="P-GRANT",   name="T. Grant",   role=Role.SECURITY_LEAD,         title="VP Security"),
            Person(id="P-OKAFOR",  name="M. Okafor",  role=Role.DISCLOSURE_COMMITTEE,  title="CFO"),
            Person(id="P-REYES",   name="A. Reyes",   role=Role.INDEPENDENT_AUDITOR,   title="Independent Auditor"),
            Person(id="P-MORALES", name="J. Morales", role=Role.AUDIT_COMMITTEE,       title="Audit Committee Chair"),
        ]
        for p in people:
            s.add(p)

        # Clock starts pre-CP1
        s.add(SimClock(current_date=date(2017, 11, 15)))

        # Check definitions (defined by P-REYES, all v1)
        checks = [
            CheckDefinition(id="T-LEASTPRIV", version="1", name="Least Privilege",
                            threshold_desc="Admin share ≤ 10% of enabled human accounts; no shared accounts",
                            params=json.dumps({"max_admin_share": 0.10, "max_shared_accounts": 0}),
                            test_frequency_days=30, defined_by="P-REYES", created_on=date(2017, 11, 15)),
            CheckDefinition(id="T-VPNDEVICE", version="1", name="VPN Managed Devices",
                            threshold_desc="0 VPN logins from unmanaged devices in trailing 30 days",
                            params=json.dumps({"max_unmanaged_logins": 0}),
                            test_frequency_days=30, defined_by="P-REYES", created_on=date(2017, 11, 15)),
            CheckDefinition(id="T-MFA", version="1", name="MFA Coverage",
                            threshold_desc="MFA enforced on ≥ 98% of human accounts with remote access",
                            params=json.dumps({"min_coverage_pct": 98.0}),
                            test_frequency_days=30, defined_by="P-REYES", created_on=date(2017, 11, 15)),
            CheckDefinition(id="T-PWDPOLICY", version="1", name="Password Policy v1",
                            threshold_desc="Every system: min_length ≥ 8, complexity on, rotation ≤ 90, history ≥ 5",
                            test_frequency_days=30, defined_by="P-REYES", created_on=date(2017, 11, 15)),
            CheckDefinition(id="T-PWDPOLICY", version="2", name="Password Policy v2",
                            threshold_desc="Non-SSO systems: min_length ≥ 12, complexity on, history ≥ 5",
                            test_frequency_days=30, defined_by="P-REYES", created_on=date(2018, 9, 3)),
            CheckDefinition(id="T-SECRETS", version="1", name="No Exposed Credentials",
                            threshold_desc="No credential patterns in repos",
                            params=json.dumps({"public_repos_only": False}),
                            test_frequency_days=7, defined_by="P-REYES", created_on=date(2017, 11, 15)),
            CheckDefinition(id="T-SDLSCAN", version="1", name="SDL Security Scan",
                            threshold_desc="All pipelines have security_scan and dependency_check before release",
                            test_frequency_days=30, defined_by="P-REYES", created_on=date(2017, 11, 15)),
            CheckDefinition(id="T-UPTIME", version="1", name="Platform Availability",
                            threshold_desc="Each calendar month ≥ 99.9% availability",
                            params=json.dumps({"min_monthly_pct": 99.9}),
                            test_frequency_days=30, defined_by="P-REYES", created_on=date(2017, 11, 15)),
        ]
        for c in checks:
            s.add(c)

        # Collectors (v1, pre-approved by P-REYES)
        collectors = [
            Collector(id="COL-AC01-1", check_id="T-LEASTPRIV", version="1", code_hash="abc001",
                      written_by="P-PRIYA", submitted_on=date(2017, 11, 15),
                      status=CollectorStatus.APPROVED, approved_by="P-REYES", approved_on=date(2017, 11, 15)),
            Collector(id="COL-AC02-1", check_id="T-VPNDEVICE", version="1", code_hash="abc002",
                      written_by="P-PRIYA", submitted_on=date(2017, 11, 15),
                      status=CollectorStatus.APPROVED, approved_by="P-REYES", approved_on=date(2017, 11, 15)),
            Collector(id="COL-AC03-1", check_id="T-MFA", version="1", code_hash="abc003",
                      written_by="P-PRIYA", submitted_on=date(2017, 11, 15),
                      status=CollectorStatus.APPROVED, approved_by="P-REYES", approved_on=date(2017, 11, 15)),
            Collector(id="COL-IA01-1", check_id="T-PWDPOLICY", version="1", code_hash="abc004",
                      written_by="P-PRIYA", submitted_on=date(2017, 11, 15),
                      status=CollectorStatus.APPROVED, approved_by="P-REYES", approved_on=date(2017, 11, 15)),
            Collector(id="COL-IA02-1", check_id="T-SECRETS", version="1", code_hash="abc005",
                      written_by="P-PRIYA", submitted_on=date(2017, 11, 15),
                      status=CollectorStatus.APPROVED, approved_by="P-REYES", approved_on=date(2017, 11, 15)),
            Collector(id="COL-SA01-1", check_id="T-SDLSCAN", version="1", code_hash="abc006",
                      written_by="P-PRIYA", submitted_on=date(2017, 11, 15),
                      status=CollectorStatus.APPROVED, approved_by="P-REYES", approved_on=date(2017, 11, 15)),
            Collector(id="COL-OP01-1", check_id="T-UPTIME", version="1", code_hash="abc007",
                      written_by="P-PRIYA", submitted_on=date(2017, 11, 15),
                      status=CollectorStatus.APPROVED, approved_by="P-REYES", approved_on=date(2017, 11, 15)),
        ]
        for c in collectors:
            s.add(c)

        # Controls (all owned by P-PRIYA)
        controls = [
            Control(id="AC-01", name="Least Privilege",          owner_id="P-PRIYA", check_id="T-LEASTPRIV",
                    framework_refs='["NIST 800-53 AC-6", "COBIT DSS05"]'),
            Control(id="AC-02", name="Remote Access from Managed Devices", owner_id="P-PRIYA", check_id="T-VPNDEVICE",
                    framework_refs='["NIST 800-53 AC-17", "COBIT DSS05"]'),
            Control(id="AC-03", name="Multi-Factor Authentication", owner_id="P-PRIYA", check_id="T-MFA",
                    framework_refs='["NIST 800-53 IA-2(1)", "COBIT DSS05"]'),
            Control(id="IA-01", name="Password Policy",           owner_id="P-PRIYA", check_id="T-PWDPOLICY",
                    framework_refs='["NIST 800-53 IA-5", "COBIT DSS05"]'),
            Control(id="IA-02", name="No Exposed Credentials",    owner_id="P-PRIYA", check_id="T-SECRETS",
                    framework_refs='["NIST 800-53 IA-5(7)", "COBIT DSS05"]'),
            Control(id="SA-01", name="Secure Development Lifecycle", owner_id="P-PRIYA", check_id="T-SDLSCAN",
                    framework_refs='["NIST 800-53 SA-11", "COBIT BAI03"]'),
            Control(id="OP-01", name="Platform Availability",    owner_id="P-PRIYA", check_id="T-UPTIME",
                    framework_refs='["NIST 800-53 CP-7", "COBIT DSS04"]'),
            Control(id="CM-01", name="Change Management",        owner_id="P-PRIYA", check_id="",
                    framework_refs='["NIST 800-53 CM-3", "COBIT BAI06"]'),
        ]
        for c in controls:
            s.add(c)

        # SCCs (all owned by P-GRANT, all PROPOSED — activated in CP1)
        sccs = [
            SCC(id="SCC-01", title="Admin accounts and remote access controls", owner_id="P-GRANT"),
            SCC(id="SCC-02", title="Password and credential security",          owner_id="P-GRANT"),
            SCC(id="SCC-03", title="Secure development lifecycle",              owner_id="P-GRANT"),
            SCC(id="SCC-04", title="NIST Cybersecurity Framework adherence",    owner_id="P-GRANT"),
            SCC(id="SCC-05", title="Change management process",                 owner_id="P-GRANT"),
            SCC(id="SCC-06", title="Multi-factor authentication",               owner_id="P-GRANT"),
            SCC(id="SCC-07", title="Platform availability",                     owner_id="P-GRANT"),
        ]
        for sc in sccs:
            s.add(sc)

        # SCC versions (PROPOSED at seed time; CP1 activates them or rejects SCC-04)
        scc_versions = [
            SCCVersion(id="SCC-01-v1", scc_id="SCC-01", version=1,
                       assertion_text="Admin accounts are ≤ 10% of enabled human accounts, none are shared, and remote access comes only from managed devices.",
                       target_uptime_pct=99.0, rolling_window_days=365, max_single_downtime_days=7,
                       evidence_type=EvidenceType.TESTED),
            SCCVersion(id="SCC-02-v1", scc_id="SCC-02", version=1,
                       assertion_text="Every system enforces passwords of ≥ 8 characters with complexity, and no credentials are exposed in code repositories.",
                       target_uptime_pct=99.0, rolling_window_days=365, max_single_downtime_days=7,
                       evidence_type=EvidenceType.TESTED),
            SCCVersion(id="SCC-03-v1", scc_id="SCC-03", version=1,
                       assertion_text="Every release pipeline runs security scanning and dependency checks before release.",
                       target_uptime_pct=99.0, rolling_window_days=365, max_single_downtime_days=7,
                       evidence_type=EvidenceType.TESTED),
            SCCVersion(id="SCC-04-v1", scc_id="SCC-04", version=1,
                       assertion_text="NimbusWatch follows the NIST Cybersecurity Framework.",
                       target_uptime_pct=99.0, rolling_window_days=365, max_single_downtime_days=7,
                       evidence_type=EvidenceType.TESTED),
            SCCVersion(id="SCC-05-v1", scc_id="SCC-05", version=1,
                       assertion_text="Changes to production systems are reviewed, approved and monitored.",
                       target_uptime_pct=95.0, rolling_window_days=365, max_single_downtime_days=30,
                       evidence_type=EvidenceType.ATTESTED),
            SCCVersion(id="SCC-06-v1", scc_id="SCC-06", version=1,
                       assertion_text="MFA is enforced on ≥ 98% of human accounts with remote access.",
                       target_uptime_pct=99.0, rolling_window_days=365, max_single_downtime_days=7,
                       evidence_type=EvidenceType.TESTED),
            SCCVersion(id="SCC-07-v1", scc_id="SCC-07", version=1,
                       assertion_text="Horizon platform availability is ≥ 99.9% each calendar month.",
                       target_uptime_pct=90.0, rolling_window_days=365, max_single_downtime_days=31,
                       evidence_type=EvidenceType.TESTED),
        ]
        for sv in scc_versions:
            s.add(sv)

        s.commit()

        # CM-01 manual attestations: 90-day windows from 2017-12-01 to 2020-06-30
        att_start = date(2017, 12, 1)
        att_end = date(2020, 6, 30)
        cur = att_start
        while cur < att_end:
            win_end = min(cur + timedelta(days=90), att_end)
            s.add(ManualEvidence(
                control_id="CM-01",
                attested_by="P-PRIYA",
                summary="Change management process reviewed and confirmed operational. CAB minutes on file.",
                valid_from=cur,
                valid_until=win_end,
            ))
            cur = win_end + timedelta(days=1)

        s.commit()


if __name__ == "__main__":
    print("Generating snapshots...")
    generate_snapshots()
    print("Seeding database...")
    seed_db()
    print("Done. make backend && make frontend to start.")
