# Disclosure Gate — IS4234 Prototype

A React + FastAPI demo that shows how a systematic gate between internal security evidence
and public security claims could surface contradictions earlier.
Modelled on the SolarWinds case (2017–2020) using **100% synthetic data**.

## Setup

Requires Python 3.12+, [uv](https://docs.astral.sh/uv/), and Node 18+.

```bash
# 1. Install Python deps + seed DB
uv sync
uv run python seed.py

# 2. Install frontend deps (first time only)
cd frontend && npm install && cd ..

# 3. Run both servers (in separate terminals)
uv run uvicorn backend.main:app --reload --port 8000   # terminal 1
cd frontend && npm run dev                              # terminal 2
```

Or use `make`:
```bash
make seed           # seed the database
make backend        # run FastAPI on :8000
make frontend       # run Vite dev on :5173
```

Open http://localhost:5173 in your browser.

**New here?** The app offers a guided tour on first launch (replayable via the
"How to use this app" button in the sidebar). For the full playbook — injectable
variables, expected outcomes, and a manual verification checklist — see
[DEMO-GUIDE.md](DEMO-GUIDE.md).

## Roles (use the sidebar switcher)

| Person | Role | Purpose |
|--------|------|---------|
| Priya N. | control_owner | Owns controls, fixes failures |
| T. Grant | security_lead | VP Security — owns the Security Statement |
| Dana L. | claim_author | Comms / Legal — drafts claims |
| M. Okafor | disclosure_committee | CFO — approves overrides, risk acceptances |
| R. Chen | disclosure_committee | General Counsel |
| S. Ibrahim | internal_audit | Head of Internal Audit — read-all, verifies chain |
| J. Morales | audit_committee | Audit Committee Chair — oversight dashboard |

## Demo Checkpoints

| CP | Date | What happens |
|----|------|-------------|
| CP1 | 2017-12-01 | Claims drafted — no tests yet → all BLOCK via R1 |
| CP1b | 2017-12-01 | First test run → AC-01/IA-01/SA-01 FAIL, findings auto-opened |
| CP2 | 2018-03-02 | Override expires → C-01 back to BLOCK, L4 escalation |
| CP3 | 2018-06-04 | VPN gap reported → F-2018-VPN, independence skip routes around Grant |
| CP4 | 2018-09-03 | 90 days no fix → L4 escalation to Audit Committee |
| CP5 | 2019-08-16 | Internal review: "access inappropriate" |
| CP6 | 2019-11-19 | `ftp_pass = nimbus123` found in public repo → CRITICAL finding |
| CP7 | 2020-06-15 | Incident 1: Customer A |
| CP8 | 2020-10-14 | Incident 2: Customer B |
| CP9 | 2020-12-14 | Wrap-up: compare panel, verify audit chain |

## Key Demo Talking Points

- **Gate Review**: show C-01 BLOCKED, then create an override as M. Okafor
  (note: T. Grant can't override — he owns the claim)
- **Escalation Inbox**: show "why you are seeing this" independence skip text
- **Oversight Dashboard**: "Status quo vs With Gate" comparison panel
- **Internal Audit**: run Tamper Demo to show hash chain breaking

## Limitation

This is a **governance** control. It would **not** have detected the SUNBURST
build-server malware. Say so clearly during the demo — see the About page.

## Run tests

```bash
uv run pytest
```
