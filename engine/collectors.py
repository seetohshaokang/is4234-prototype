"""Collectors — read raw data from the latest snapshot on or before as_of."""

import csv
import json
from datetime import date
from pathlib import Path


SNAP_DIR = Path("data/snapshots")


def _latest_snapshot(as_of: date) -> Path | None:
    dirs = sorted(
        [d for d in SNAP_DIR.iterdir() if d.is_dir()],
        key=lambda d: d.name,
    )
    best = None
    for d in dirs:
        if d.name <= str(as_of):
            best = d
    return best


def _read_csv(path: Path) -> list[dict]:
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def collect_leastpriv(snap_dir: Path | None) -> dict:
    if snap_dir is None:
        return {}
    rows = _read_csv(snap_dir / "directory.csv")
    return {"accounts": rows}


def collect_vpndevice(snap_dir: Path | None) -> dict:
    if snap_dir is None:
        return {}
    logins = _read_csv(snap_dir / "vpn_logins.csv") if (snap_dir / "vpn_logins.csv").exists() else []
    devices = _read_csv(snap_dir / "managed_devices.csv") if (snap_dir / "managed_devices.csv").exists() else []
    return {"vpn_logins": logins, "managed_devices": devices}


def collect_mfa(snap_dir: Path | None) -> dict:
    if snap_dir is None:
        return {}
    rows = _read_csv(snap_dir / "directory.csv")
    return {"accounts": rows}


def collect_pwdpolicy(snap_dir: Path | None) -> dict:
    if snap_dir is None:
        return {}
    policies = json.loads((snap_dir / "password_policies.json").read_text())
    return {"policies": policies}


def collect_secrets(snap_dir: Path | None) -> dict:
    if snap_dir is None:
        return {}
    repo_dir = snap_dir / "repos"
    files = []
    if repo_dir.exists():
        for f in repo_dir.rglob("*"):
            if f.is_file():
                try:
                    content = f.read_text(errors="replace")
                    files.append({
                        "path": str(f.relative_to(snap_dir)),
                        "content": content,
                        "is_public": "public" in str(f.relative_to(snap_dir)),
                    })
                except Exception:
                    pass
    return {"files": files}


def collect_sdlscan(snap_dir: Path | None) -> dict:
    if snap_dir is None:
        return {}
    import yaml as _yaml
    pipe_dir = snap_dir / "pipelines"
    pipelines = []
    if pipe_dir.exists():
        for f in pipe_dir.glob("*.yaml"):
            data = _yaml.safe_load(f.read_text())
            pipelines.append({"name": f.stem, "steps": data.get("steps", [])})
    return {"pipelines": pipelines}


def collect_uptime(snap_dir: Path | None) -> dict:
    if snap_dir is None:
        return {}
    uptime_file = snap_dir / "uptime.json"
    if not uptime_file.exists():
        return {}
    return {"monthly": json.loads(uptime_file.read_text())}


def get_raw_data(check_id: str, as_of: date) -> dict:
    snap = _latest_snapshot(as_of)
    dispatch = {
        "T-LEASTPRIV": collect_leastpriv,
        "T-VPNDEVICE":  collect_vpndevice,
        "T-MFA":        collect_mfa,
        "T-PWDPOLICY":  collect_pwdpolicy,
        "T-SECRETS":    collect_secrets,
        "T-SDLSCAN":    collect_sdlscan,
        "T-UPTIME":     collect_uptime,
    }
    fn = dispatch.get(check_id)
    if fn is None:
        return {}
    return fn(snap)
