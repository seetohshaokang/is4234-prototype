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
    Person, Role, SimClock, Claim, ClaimStatus, SupportState,
    Control, ClaimControlMap, ControlTest, ManualEvidence,
)

SNAP_DIR = Path("data/snapshots")
RNG = random.Random(4234)

DEPTS = ["Engineering", "Finance", "HR", "Sales", "IT Ops", "Legal", "DevOps"]
JOBS  = ["Engineer", "Manager", "Analyst", "Director", "Coordinator", "Specialist"]


# ── Snapshot helpers ──────────────────────────────────────────────────────────

def _accounts(n: int, admin_pct: float, shared_count: int) -> list[dict]:
    rows = []
    admin_slots = int(n * admin_pct)
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
        devices[dev_id] = {"device_id": dev_id, "owner": "IT" if not is_bad else "unknown", "mdm_enrolled": not is_bad}
    return logins, list(devices.values())


def _write_snapshot(d: str, accounts: list, policies: list, vpn_logins: list,
                    managed_devs: list, pipelines: dict, secret_files: list) -> None:
    p = SNAP_DIR / d
    p.mkdir(parents=True, exist_ok=True)

    # directory.csv
    with open(p / "directory.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(accounts[0].keys()))
        w.writeheader(); w.writerows(accounts)

    # password_policies.json
    (p / "password_policies.json").write_text(json.dumps(policies, indent=2))

    # vpn
    with open(p / "vpn_logins.csv", "w", newline="") as f:
        if vpn_logins:
            w = csv.DictWriter(f, fieldnames=["ts","account_id","device_id","source_ip"])
            w.writeheader(); w.writerows(vpn_logins)
    with open(p / "managed_devices.csv", "w", newline="") as f:
        if managed_devs:
            w = csv.DictWriter(f, fieldnames=["device_id","owner","mdm_enrolled"])
            w.writeheader(); w.writerows(managed_devs)

    # pipelines
    pipe_dir = p / "pipelines"
    pipe_dir.mkdir(exist_ok=True)
    for name, steps in pipelines.items():
        (pipe_dir / f"{name}.yaml").write_text(yaml.dump({"pipeline": name, "steps": steps}))

    # repos
    repo_dir = p / "repos"
    repo_dir.mkdir(exist_ok=True)
    (repo_dir / "README.md").write_text("# NimbusWatch Repos\n")
    for sf in secret_files:
        fpath = repo_dir / sf["file"]
        fpath.parent.mkdir(parents=True, exist_ok=True)
        fpath.write_text(sf["content"])


POLICIES_BAD = [
    {"system": "corp-ad",      "min_length": 8, "complexity_required": True,  "rotation_days": 90,  "history_count": 5, "mfa_required": True},
    {"system": "vpn-gateway",  "min_length": 8, "complexity_required": True,  "rotation_days": 90,  "history_count": 5, "mfa_required": True},
    {"system": "prod-db",      "min_length": 0, "complexity_required": False, "rotation_days": 180, "history_count": 2, "mfa_required": False},
    {"system": "code-repo",    "min_length": 8, "complexity_required": True,  "rotation_days": 90,  "history_count": 5, "mfa_required": False},
]
POLICIES_PARTIAL = [
    {"system": "corp-ad",      "min_length": 8, "complexity_required": True,  "rotation_days": 90,  "history_count": 5, "mfa_required": True},
    {"system": "vpn-gateway",  "min_length": 8, "complexity_required": True,  "rotation_days": 90,  "history_count": 5, "mfa_required": True},
    {"system": "prod-db",      "min_length": 8, "complexity_required": True,  "rotation_days": 90,  "history_count": 5, "mfa_required": False},
    {"system": "code-repo",    "min_length": 5, "complexity_required": False, "rotation_days": 120, "history_count": 3, "mfa_required": False},
]
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
SECRET_FILE = [{"file": "public/updates-mirror/config.ini",
                "content": "[ftp]\nhost = updates.nimbus.internal\nftp_pass = nimbus123\nport = 21\n"}]


def generate_snapshots() -> None:
    if SNAP_DIR.exists():
        shutil.rmtree(SNAP_DIR)

    specs = [
        ("2017-12-01", _accounts(150, 0.72, 3), POLICIES_BAD,     [], [], []),
        ("2018-06-04", _accounts(180, 0.70, 3), POLICIES_BAD,     *_vpn(40, 6,  "2018-06-04"), []),
        ("2019-08-16", _accounts(220, 0.68, 2), POLICIES_PARTIAL, *_vpn(55, 9,  "2019-08-16"), []),
        ("2019-11-19", _accounts(220, 0.68, 2), POLICIES_PARTIAL, *_vpn(55, 9,  "2019-11-19"), SECRET_FILE),
        ("2020-06-15", _accounts(240, 0.65, 2), POLICIES_PARTIAL, *_vpn(60, 7,  "2020-06-15"), SECRET_FILE),
        ("2020-10-14", _accounts(240, 0.65, 2), POLICIES_PARTIAL, *_vpn(60, 7,  "2020-10-14"), SECRET_FILE),
    ]
    for d, accts, pols, vpn_l, vpn_d, secs in specs:
        _write_snapshot(d, accts, pols, vpn_l, vpn_d, PIPELINES, secs)
        print(f"  snapshot {d}: {len(accts)} accounts, {len(vpn_l)} VPN logins, {len(secs)} secret file(s)")


# ── DB seed ───────────────────────────────────────────────────────────────────

def seed_db() -> None:
    SQLModel.metadata.drop_all(engine)
    create_tables()

    with Session(engine) as s:
        # People
        people = [
            Person(id="P-PRIYA",   name="Priya N.",    role=Role.CONTROL_OWNER,        title="IT Ops Engineer"),
            Person(id="P-GRANT",   name="T. Grant",    role=Role.SECURITY_LEAD,         title="VP Security"),
            Person(id="P-DANA",    name="Dana L.",     role=Role.CLAIM_AUTHOR,          title="Comms / Legal"),
            Person(id="P-OKAFOR", name="M. Okafor",   role=Role.DISCLOSURE_COMMITTEE,  title="CFO"),
            Person(id="P-CHEN",    name="R. Chen",     role=Role.DISCLOSURE_COMMITTEE,  title="General Counsel"),
            Person(id="P-IBRAHIM", name="S. Ibrahim",  role=Role.INTERNAL_AUDIT,        title="Head of Internal Audit"),
            Person(id="P-MORALES", name="J. Morales",  role=Role.AUDIT_COMMITTEE,       title="Audit Committee Chair"),
            Person(id="P-LEO",     name="Leo K.",      role=Role.CONTROL_OWNER,         title="DevOps Engineer"),
        ]
        for p in people: s.add(p)

        # Clock starts 2017-11-15
        s.add(SimClock(current_date=date(2017, 11, 15)))

        # Control tests
        tests = [
            ControlTest(id="T-LEASTPRIV", name="Least Privilege Check",
                        parameters=json.dumps({"max_admin_share": 0.10, "max_shared_accounts": 0})),
            ControlTest(id="T-PWDPOLICY", name="Password Policy Check"),
            ControlTest(id="T-SECRETS",   name="Exposed Credentials Scan",
                        parameters=json.dumps({"public_repos_only": False})),
            ControlTest(id="T-VPNDEVICE", name="VPN Managed Device Check",
                        parameters=json.dumps({"max_unmanaged_logins": 0})),
            ControlTest(id="T-SDLSCAN",   name="SDL Security Scan Check"),
        ]
        for t in tests: s.add(t)

        # Controls
        controls = [
            Control(id="AC-01", name="Least Privilege",
                    description="Access to systems is granted on a need-to-know basis.",
                    owner_id="P-PRIYA", test_id="T-LEASTPRIV", test_frequency_days=30,
                    framework_refs='["NIST 800-53 AC-6", "COBIT DSS05"]'),
            Control(id="AC-02", name="Remote Access from Managed Devices",
                    description="VPN access is restricted to corporate-managed devices.",
                    owner_id="P-PRIYA", test_id="T-VPNDEVICE", test_frequency_days=30,
                    framework_refs='["NIST 800-53 AC-17", "COBIT DSS05"]'),
            Control(id="IA-01", name="Password Policy",
                    description="Password policy covers all systems and enforces complexity.",
                    owner_id="P-PRIYA", test_id="T-PWDPOLICY", test_frequency_days=30,
                    framework_refs='["NIST 800-53 IA-5", "COBIT DSS05"]'),
            Control(id="IA-02", name="No Exposed Credentials",
                    description="No plaintext passwords or secrets in source repositories.",
                    owner_id="P-LEO", test_id="T-SECRETS", test_frequency_days=7,
                    framework_refs='["NIST 800-53 IA-5(7)", "COBIT DSS05"]'),
            Control(id="SA-01", name="Secure Development Lifecycle",
                    description="All pipelines include security scan and dependency check before release.",
                    owner_id="P-LEO", test_id="T-SDLSCAN", test_frequency_days=30,
                    framework_refs='["NIST 800-53 SA-11", "COBIT BAI03"]'),
            Control(id="CM-01", name="Change Management",
                    description="Changes to production systems are reviewed and approved.",
                    owner_id="P-LEO", test_id=None, test_frequency_days=90,
                    framework_refs='["NIST 800-53 CM-3", "COBIT BAI06"]'),
        ]
        for c in controls: s.add(c)

        # Claims (owner = P-GRANT, channel = website)
        claims = [
            Claim(id="C-01", owner_id="P-GRANT",
                  text="Access controls to sensitive data in our systems are set on a need-to-know / least-privilege basis."),
            Claim(id="C-02", owner_id="P-GRANT",
                  text="Our password policy covers all applicable systems and enforces complex passwords. Passwords are individually salted and hashed."),
            Claim(id="C-03", owner_id="P-GRANT",
                  text="We follow a defined secure development lifecycle, including security testing, for our products."),
            Claim(id="C-04", owner_id="P-GRANT",
                  text="NimbusWatch follows the NIST Cybersecurity Framework."),
            Claim(id="C-05", owner_id="P-GRANT",
                  text="Changes to production systems are reviewed, approved and monitored."),
        ]
        for c in claims: s.add(c)

        s.commit()

        # Mappings (pre-approved by P-OKAFOR on 2017-11-15)
        mappings = [
            ("C-01", "AC-01"), ("C-01", "AC-02"),
            ("C-02", "IA-01"), ("C-02", "IA-02"),
            ("C-03", "SA-01"),
            # C-04 intentionally unmapped
            ("C-05", "CM-01"),
        ]
        for cid, ctlid in mappings:
            s.add(ClaimControlMap(claim_id=cid, control_id=ctlid,
                                  approved_by="P-OKAFOR", approved_on=date(2017, 11, 15)))

        # Manual evidence for CM-01 (valid through 2018-02-15)
        s.add(ManualEvidence(
            control_id="CM-01",
            date=date(2017, 11, 15),
            attested_by="P-IBRAHIM",
            summary="Change management process reviewed and confirmed operational. CAB minutes on file.",
            valid_until=date(2018, 2, 15),
        ))

        s.commit()


if __name__ == "__main__":
    print("Generating snapshots...")
    generate_snapshots()
    print("Seeding database...")
    seed_db()
    print("Done. Run: uv run streamlit run app.py")
