# Build Spec: Policy–Practice–Disclosure Gate (IS4234 Prototype)

> **Audience:** an AI coding agent (and the human team supervising it).
> **Goal:** build a working, demo-ready prototype from this document alone.
> **Data:** 100% synthetic. The scenario is *modelled on* the SolarWinds case (2017–2020) but uses a fictional company. Do not use real SolarWinds data, names, logos or branding anywhere in the app.

---

## 0. TL;DR for the agent

Build a small web app that:

1. **Tests controls automatically** against synthetic system snapshots (user directory, config files, code repos, VPN logs, build pipelines) → produces evidence.
2. **Links every public security claim** (e.g. "access is least-privilege") to the controls that prove it.
3. **Runs a deterministic gate** that returns `APPROVE` / `ESCALATE` / `BLOCK` for each claim, with reasons — before publication **and again whenever evidence changes**.
4. **Escalates independently**: routes problems to people who do *not* own the claim or the finding, with automatic ageing (30/60/90 days).
5. **Logs everything** in a tamper-evident, append-only audit trail.
6. **Replays a timeline** (simulated clock, 2017 → 2020) so the demo can show what would have happened at each point.

Stack: **FastAPI + SQLite (SQLModel) backend, React + Vite + TypeScript + Tailwind frontend, in a single monorepo.** Exact tools, versions and repo layout are fixed in **§4.1–§4.4** — follow them; do not substitute libraries. Start everything from the repo root with `make dev`. No auth beyond a demo role switcher.

---

## 1. Problem context (why this exists)

In the SolarWinds case, the SEC alleged (claims later voluntarily dismissed, so treat as **unproven**):

- A public **Security Statement** claimed least-privilege access, strong password policy, a secure development lifecycle, and adherence to the NIST Cybersecurity Framework.
- Internal records contradicted it: most employees reportedly had admin rights; an internal review said access to critical systems was "inappropriate"; a 2019 assessment found no programme in place for ~61% of NIST 800-53 controls; a least-privilege control had "never" been audited; a weak password (`solarwinds123`) was leaked on a public code repo.
- A VPN weakness (unmanaged devices could connect) was raised by an engineer in 2018, got "no traction", and was never escalated to the Disclosure Committee.
- Two customer incidents in 2020 involving the same product component were each rated "minimal" and never linked.
- The head of security both **ran** the security programme and **owned/approved** the public Security Statement.

**Root gaps the prototype targets:**

| ID | Gap | Prototype response |
|---|---|---|
| G1 | Public claims never compared with internal evidence | Claim Registry + Consistency Gate with continuous re-check |
| G2 | Escalation depended on individuals; stalled mid-chain | Automatic ageing escalation |
| G3 | Same person owned security *and* the claims (no segregation of duties) | Independence rules on escalation and override |
| G4 | Policies existed on paper; enforcement never tested; no audit | Automated control tests + "never tested = finding" + 3rd-line review |
| G5 | Risk acceptance became the default, disconnected from public claims | Risk Acceptance Ledger tied to claims |
| G6 | Incidents judged one at a time; low ratings let them slip | Incident Pattern Linker + severity second sign-off |

**Explicit non-claim:** this is a *governance* control. It would **not** have detected the SUNBURST build-server malware. Say so in the UI's About page.

---

## 2. Scope

### In scope (MVP — must build)
- Control test engine with **5 automated tests** (§6)
- Claim Registry with claim↔control mapping (§5)
- Consistency Gate rules (§7)
- Independent escalation + ageing (§8)
- Override workflow with independence and expiry (§8.4)
- Risk Acceptance Ledger (§9)
- Append-only hash-chained audit log + verify (§11)
- Simulated clock and scenario checkpoints (§10)
- Role-based UI screens (§13)
- Board/Audit Committee oversight view incl. "Status quo vs With gate" comparison panel (§13.7)
- Seed data + demo script (§14, §15)
- Automated tests (§16)

### Stretch (build only if MVP is done)
- Incident Pattern Linker (§9.2)
- Severity-downgrade second sign-off (§8.5)
- Export decision report to PDF/Markdown

### Out of scope
- Real authentication/SSO, multi-tenancy, real integrations (AD, AWS, GitHub)
- NLP extraction of claims from free text (claims are entered/mapped manually)
- Malware or build-integrity detection
- Any real company data

---

## 3. Users, roles and permissions (Three Lines of Defence)

Demo uses a **role switcher** (dropdown in header) instead of login. Each seeded person has exactly one role.

| Role key | Line | Example persona (fictional) | Primary purpose |
|---|---|---|---|
| `control_owner` | 1st | Priya N. – IT Ops Engineer | Owns controls, fixes failures, raises findings |
| `security_lead` | 2nd | T. Grant – VP Security (CISO-equivalent) | Defines tests/thresholds, triages findings, proposes risk acceptance; **owns the Security Statement draft** (deliberately mirrors the case's conflict) |
| `claim_author` | — | Dana L. – Comms / Legal | Drafts and submits public claims |
| `disclosure_committee` | Oversight | M. Okafor (CFO), R. Chen (General Counsel) | Decides on blocked/escalated claims; may override with reason |
| `internal_audit` | 3rd | S. Ibrahim – Head of Internal Audit | Read-all; reviews test design; samples results; verifies audit chain; second sign-off on downgrades |
| `audit_committee` | Board | J. Morales – Audit Committee Chair | Oversight dashboard; receives top-level escalations |

### Permission matrix

| Action | control_owner | security_lead | claim_author | disclosure_committee | internal_audit | audit_committee |
|---|---|---|---|---|---|---|
| View everything | own controls | ✓ | claims only | ✓ | ✓ | ✓ (summary + drill-down) |
| Create/edit claim | ✗ | ✓ (draft) | ✓ (draft) | ✗ | ✗ | ✗ |
| Map claim↔control | ✗ | propose | propose | **approve** | ✗ | ✗ |
| Define/edit control test & threshold | ✗ | ✓ | ✗ | ✗ | review/comment | ✗ |
| Edit test *results* | **never (anyone)** | ✗ | ✗ | ✗ | ✗ | ✗ |
| Raise finding | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ |
| Change finding severity | ✗ | ✓ (downgrade needs 2nd sign-off) | ✗ | ✗ | ✓ (sign-off) | ✗ |
| Close finding | ✓ (needs passing retest) | ✓ | ✗ | ✗ | ✗ | ✗ |
| Propose risk acceptance | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Approve risk acceptance touching a public claim | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Override gate BLOCK | ✗ | ✗ | ✗ | ✓ (if independent, §8.4) | ✗ | ✗ |
| Verify audit chain | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |

Test results are produced **only** by the test engine. No API exists to edit them.

---

## 4. Architecture

```
frontend/ (React + Vite + TS + Tailwind)
   │  REST/JSON
backend/ (FastAPI + SQLModel + SQLite)
   ├── engine/tests/        # automated control tests (pure functions)
   ├── engine/gate.py       # consistency gate (pure function)
   ├── engine/escalation.py # ageing + routing (pure function)
   ├── engine/linker.py     # incident pattern linker (stretch)
   ├── services/            # orchestration: run tests, re-evaluate, write audit
   ├── audit/               # hash-chained log
   ├── clock.py             # simulated clock
   └── seed/                # synthetic snapshots + seed script
data/snapshots/<date>/      # JSON/YAML/CSV synthetic system state per checkpoint
```

**Design principles**
- Engine modules are **pure functions** (input data + as-of date → output). Easy to unit test and explain.
- Every state change goes through a service that **writes an audit event in the same transaction**.
- Every evaluation is **recomputed from data at the current simulated date** — no hidden state.
- Decisions must be **explainable**: each returns the list of rules that fired, with evidence IDs.

**Commands** (full list in §4.3)
- `make seed` – reset DB and load seed data
- `make dev` – run backend (`:8000`) and frontend (`:5173`)
- `make test` – run backend unit + scenario tests
- Optional: `docker compose up`

### 4.1 Tech stack (pinned choices)

Use exactly these tools. Use the **latest stable release** of each at build time, and commit lockfiles (`uv.lock`, `package-lock.json`) so versions are reproducible. If a library below is unavailable, stop and report rather than silently swapping it.

**Runtimes**
| Item | Choice |
|---|---|
| Python | 3.12 (`.python-version` file at `backend/`) |
| Node.js | 20 LTS (`.nvmrc` at repo root) |

**Backend (`backend/`)**
| Purpose | Library / tool |
|---|---|
| Package & env manager | `uv` (`pyproject.toml` + `uv.lock`) |
| Web framework | FastAPI |
| ASGI server | uvicorn (`--reload` in dev) |
| ORM / models | SQLModel (Pydantic v2) on SQLite |
| Database file | `backend/disclosure_gate.db` (git-ignored; recreated by `make seed`) |
| YAML parsing | PyYAML |
| Settings | `pydantic-settings` reading `.env` |
| Testing | pytest, `httpx` (FastAPI `TestClient`), `pytest-cov` |
| Lint + format | Ruff (`ruff check`, `ruff format`) |
| Type checking | mypy (strict on `engine/` only) |

**Frontend (`frontend/`)**
| Purpose | Library / tool |
|---|---|
| Package manager | npm (`package-lock.json`) |
| Build tool | Vite |
| Framework | React + TypeScript (`"strict": true`) |
| Styling | Tailwind CSS |
| Routing | React Router |
| Server state / data fetching | TanStack Query |
| Tables | TanStack Table |
| Charts (result history, KPIs) | Recharts |
| Incident graph (stretch) | `@xyflow/react` (React Flow) |
| API types | `openapi-typescript` generating `src/api/types.ts` from the backend OpenAPI schema |
| Icons | `lucide-react` |
| Lint + format | ESLint + Prettier |
| E2E smoke test | Playwright |

**Rules**
- Frontend calls the backend **only** through a typed client in `src/api/` using the generated types. No hand-written duplicate type definitions.
- Backend exposes OpenAPI at `/openapi.json` (FastAPI default); `make types` regenerates the frontend types from it.
- CORS: allow `http://localhost:5173` only.
- No other databases, message queues, auth providers or cloud services.

### 4.2 Repository layout (monorepo)

```
disclosure-gate/
├── README.md                     # setup, roles, demo script, limitation statement
├── Makefile                      # all root commands (§4.3)
├── .nvmrc                        # Node 20
├── .gitignore                    # *.db, node_modules, .venv, __pycache__, dist, .env
├── .env.example                  # documented defaults (§4.4)
├── docker-compose.yml            # optional: backend + frontend services
├── .github/
│   └── workflows/ci.yml          # §4.5
├── docs/
│   └── disclosure-control-gate-spec.md   # this file
├── data/
│   └── snapshots/
│       ├── 2017-12-01/           # generated synthetic data, COMMITTED
│       ├── 2018-06-04/
│       └── ...
├── backend/
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── .python-version
│   ├── app/
│   │   ├── main.py               # FastAPI app, CORS, router registration
│   │   ├── config.py             # pydantic-settings
│   │   ├── db.py                 # engine, session, create_all
│   │   ├── models/               # SQLModel tables (§5), one file per aggregate
│   │   ├── routers/              # one router per resource group (§12)
│   │   ├── services/             # orchestration, permission checks, audit writes
│   │   └── permissions.py        # §3 matrix as data + check function
│   ├── engine/                   # PURE functions, no DB access
│   │   ├── control_tests/        # one module per test (§6)
│   │   ├── gate.py               # §7
│   │   ├── escalation.py         # §8
│   │   └── linker.py             # §9.2 (stretch)
│   ├── audit/
│   │   └── chain.py              # §11 hashing + verify
│   ├── sim/
│   │   ├── clock.py
│   │   └── checkpoints.py        # CP1–CP9 scripted events (§15)
│   ├── seed/
│   │   ├── generate_snapshots.py # deterministic, RNG seed 4234
│   │   └── seed_db.py
│   └── tests/
│       ├── fixtures/             # tiny snapshots for unit tests
│       ├── engine/               # control tests, gate, escalation
│       ├── services/             # permissions, overrides, audit
│       └── test_scenario.py      # CP1→CP9 end-to-end
└── frontend/
    ├── package.json
    ├── package-lock.json
    ├── vite.config.ts
    ├── tailwind.config.ts
    ├── tsconfig.json
    ├── playwright.config.ts
    ├── e2e/                      # Playwright smoke tests
    └── src/
        ├── main.tsx
        ├── App.tsx               # layout, header, routes
        ├── api/
        │   ├── types.ts          # GENERATED — do not edit
        │   └── client.ts         # typed fetch wrappers + TanStack Query hooks
        ├── state/
        │   └── role.tsx          # current actor (role switcher) context
        ├── components/           # Header, TimelineBar, Badge, DecisionPanel, KpiTile...
        └── pages/                # one per screen in §13
            ├── ClaimRegistry.tsx
            ├── ControlHealth.tsx
            ├── Findings.tsx
            ├── EscalationInbox.tsx
            ├── GateReview.tsx
            ├── InternalAudit.tsx
            ├── OversightDashboard.tsx
            └── About.tsx
```

**Boundaries the agent must respect**
- `engine/` never imports from `app/`, `audit/` or the database.
- Only `app/services/` writes to the DB, and every write goes with an audit event in the same transaction.
- `frontend/src/api/types.ts` is generated; never hand-edit it.
- `data/snapshots/` is generated by `seed/generate_snapshots.py` but committed, so the demo runs offline.

### 4.3 Root Makefile targets

| Target | What it does |
|---|---|
| `make install` | `cd backend && uv sync` and `cd frontend && npm ci` |
| `make snapshots` | regenerate `data/snapshots/` (deterministic) |
| `make seed` | delete DB, create tables, load seed data (§14) |
| `make dev` | run uvicorn on `:8000` and Vite on `:5173` together (use a simple `trap`-based script or `npx concurrently`) |
| `make types` | start backend if needed, then `npx openapi-typescript http://localhost:8000/openapi.json -o frontend/src/api/types.ts` |
| `make test` | `cd backend && uv run pytest` |
| `make e2e` | Playwright smoke tests (expects `make dev` running) |
| `make lint` | `ruff check`, `ruff format --check`, `mypy engine`, `npm run lint`, `npm run typecheck` |
| `make fmt` | `ruff format` + `prettier --write` |
| `make demo` | `make seed` then `make dev` (clean state for presenting) |

### 4.4 Configuration

`.env.example` (copy to `.env`; all have safe defaults so `.env` is optional):

```
DATABASE_URL=sqlite:///./backend/disclosure_gate.db
SNAPSHOT_DIR=./data/snapshots
SIM_START_DATE=2017-11-15
CORS_ORIGIN=http://localhost:5173
VITE_API_BASE_URL=http://localhost:8000
```

No secrets are needed. Never commit `.env`.

### 4.5 CI (`.github/workflows/ci.yml`)

Single workflow on every push and pull request:
1. Set up Python 3.12 + `uv`, run `uv sync`.
2. `ruff check`, `ruff format --check`, `mypy engine`.
3. `uv run pytest` (unit + scenario tests must pass).
4. Set up Node 20, `npm ci`, `npm run lint`, `npm run typecheck`, `npm run build`.
5. Fail if `frontend/src/api/types.ts` is out of date: start backend, run `make types`, then `git diff --exit-code`.

Playwright runs locally only (not required in CI).

---

## 5. Data model

Use these tables (SQLModel). Dates are ISO `YYYY-MM-DD`; timestamps ISO 8601. IDs are human-readable strings for demo clarity.

### `person`
`id` (e.g. `P-GRANT`), `name`, `role` (enum §3), `title`

### `claim` — a public security statement
| field | type | notes |
|---|---|---|
| id | str | `C-01` |
| text | str | exact public wording |
| channel | enum | `website_security_statement`, `annual_report`, `customer_questionnaire` |
| owner_id | FK person | claim owner (accountable) |
| status | enum | `draft`, `published`, `withdrawn` |
| published_on | date? | |
| support_state | enum (derived) | `SUPPORTED`, `AT_RISK`, `UNSUPPORTED`, `UNMAPPED` |

### `control`
| field | type | notes |
|---|---|---|
| id | str | `AC-01` |
| name | str | |
| description | str | the internal policy requirement |
| owner_id | FK person | 1st-line owner |
| test_id | FK control_test? | null = not automatable (manual evidence only) |
| test_frequency_days | int | e.g. 30; result older than this = **stale** |
| framework_refs | json list | e.g. `["NIST 800-53 AC-6", "COBIT DSS05", "COSO Control Activities"]` |

### `claim_control_map`
`claim_id`, `control_id`, `approved_by` (FK person, must be disclosure_committee), `approved_on`

### `control_test` — definition
`id`, `name`, `type` (enum from §6), `parameters` (json, e.g. thresholds), `version`, `reviewed_by_audit` (bool), `reviewed_on`

### `test_result` — **immutable**, engine-written only
`id`, `control_id`, `test_id`, `test_version`, `run_on` (date), `snapshot_ref` (path), `outcome` (`PASS`/`FAIL`/`ERROR`), `metrics` (json), `evidence_summary` (str)

### `finding`
| field | type | notes |
|---|---|---|
| id | str | `F-2018-001` |
| control_id | FK | |
| title, description | str | |
| severity | enum | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| source | enum | `automated_test`, `manual_review`, `incident`, `external_report` |
| raised_by_id | FK person | |
| owner_id | FK person | who must fix |
| opened_on | date | |
| due_on | date | |
| status | enum | `OPEN`, `RISK_ACCEPTED`, `CLOSED` |
| closed_on | date? | requires passing retest after opened_on |
| severity_history | json | list of `{from,to,by,on,signed_off_by?}` |

### `risk_acceptance`
`id`, `finding_id`, `proposed_by`, `rationale`, `cost_benefit_note` (required), `expires_on`, `status` (`PROPOSED`/`APPROVED`/`REJECTED`/`EXPIRED`), `approved_by?`, `affects_public_claims` (derived bool)

### `gate_decision` — one per evaluation per claim
`id`, `claim_id`, `evaluated_on` (simulated date), `trigger` (`pre_publication`, `evidence_change`, `clock_advance`, `manual`), `decision` (`APPROVE`/`ESCALATE`/`BLOCK`), `rules_fired` (json list of `{rule_id, message, evidence_ids}`), `missing_evidence` (json list)

### `override`
`id`, `gate_decision_id`, `claim_id`, `by_id`, `reason` (≥ 50 chars), `conditions` (str), `created_on`, `expires_on` (default +90 days), `status` (`ACTIVE`/`EXPIRED`/`REVOKED`)

### `escalation`
`id`, `subject_type` (`finding`/`claim`/`incident`), `subject_id`, `level` (1–4, §8), `assigned_to_role`, `assigned_to_id?`, `reason`, `created_on`, `acknowledged_on?`, `resolved_on?`, `status` (`OPEN`/`ACK`/`RESOLVED`/`SUPERSEDED`)

### `incident` (stretch)
`id`, `reported_on`, `reporter` (customer label, e.g. "Customer A – government agency"), `product`, `component`, `description`, `severity_rating` (0–3), `rated_by`, `linked_incident_ids` (derived)

### `audit_event`
`seq` (int, PK autoincrement), `ts_sim` (simulated date), `ts_real` (wall clock), `actor_id` (or `SYSTEM`), `action` (str), `subject_type`, `subject_id`, `payload` (json), `prev_hash`, `hash`

### `sim_clock` (single row)
`current_date`

---

## 6. Control test engine

Each test is a pure function:

```python
def run(snapshot_dir: Path, params: dict) -> TestOutcome:
    # returns outcome PASS/FAIL/ERROR, metrics dict, evidence_summary str
```

The engine picks the **latest snapshot dated ≤ current simulated date**. Running tests writes `test_result` rows; a `FAIL` automatically opens a finding (severity from test params) if no open finding exists for that control+test.

### Snapshot files (per `data/snapshots/<YYYY-MM-DD>/`)

| File | Format | Contents |
|---|---|---|
| `directory.csv` | CSV | `account_id,display_name,dept,job_role,is_admin,is_shared,is_service_account,enabled` |
| `password_policies.json` | JSON | list of `{system, min_length, complexity_required, rotation_days, history_count, mfa_required}` |
| `repos/` | folder | small fake repos (text files, configs) to scan |
| `vpn_logins.csv` | CSV | `ts,account_id,device_id,source_ip` |
| `managed_devices.csv` | CSV | `device_id,owner,mdm_enrolled` |
| `pipelines/*.yaml` | YAML | build pipeline per product component, list of `steps` |

### The five tests

| Test ID | Control | Logic | Default params | FAIL severity |
|---|---|---|---|---|
| `T-LEASTPRIV` | AC-01 Least privilege | admin_share = enabled human accounts with `is_admin` / enabled human accounts; also count `is_shared` human accounts | `max_admin_share: 0.10`, `max_shared_accounts: 0` | HIGH |
| `T-PWDPOLICY` | IA-01 Password policy | every system: `min_length ≥ 8`, `complexity_required`, `rotation_days ≤ 90`, `history_count ≥ 5` | as listed | MEDIUM (HIGH if any system has `min_length < 6`) |
| `T-SECRETS` | IA-02 No exposed credentials | regex scan of `repos/**` for `password\s*[=:]`, `ftp_pass`, `secret`, `AKIA[0-9A-Z]{16}`; flag file path + line (mask value) | `public_repos_only: false` | CRITICAL if found in a repo marked `public`, else HIGH |
| `T-VPNDEVICE` | AC-02 Remote access from managed devices only | VPN logins whose `device_id` ∉ managed_devices (or not `mdm_enrolled`) within last 30 days of snapshot | `max_unmanaged_logins: 0` | HIGH |
| `T-SDLSCAN` | SA-01 Secure development lifecycle | every pipeline YAML contains a step with `type: security_scan` **and** `type: dependency_check` before `type: release` | — | HIGH |

### "Never tested" rule (gap G4)
Any control mapped to a claim with **zero** `test_result` rows and **no** manual evidence is treated as a finding-equivalent by the gate (rule R1). Controls with `test_id = null` show "Manual evidence required" in UI.

### Manual evidence (minimal)
Allow `security_lead` or `internal_audit` to attach a manual evidence note to a control (`manual_evidence` table: `control_id, date, attested_by, summary, valid_until`). Gate treats valid manual evidence as a PASS but labels it "attested, not tested".

---

## 7. Consistency Gate

`evaluate(claim, controls, results, findings, acceptances, overrides, as_of) -> Decision`

Evaluate **all** rules; final decision = most severe fired (`BLOCK` > `ESCALATE` > `APPROVE`). Record every fired rule.

| Rule | Condition | Effect | Message template |
|---|---|---|---|
| R0 | Claim has no approved mapped controls | ESCALATE | "Claim cannot be traced to any control — vague or unsupported wording." |
| R1 | A mapped control has never been tested and has no valid manual evidence | BLOCK | "Control {id} has never been tested. A policy on paper is not evidence of practice." |
| R2 | Latest result for a mapped control is FAIL | BLOCK | "Latest test of {id} failed on {date}: {evidence_summary}" |
| R3 | Open (not risk-accepted) finding of severity HIGH/CRITICAL on a mapped control | BLOCK | "Open {severity} finding {fid} contradicts this claim (open {n} days)." |
| R4 | Latest result older than `test_frequency_days` | ESCALATE | "Evidence for {id} is stale ({n} days old; required every {f})." |
| R5 | Open MEDIUM finding on a mapped control | ESCALATE | "Open MEDIUM finding {fid} may weaken this claim." |
| R6 | Finding is RISK_ACCEPTED but acceptance **not approved by disclosure_committee** or expired | BLOCK | "Risk {fid} was accepted without disclosure-committee approval, but the public claim still says otherwise." |
| R7 | Finding is RISK_ACCEPTED **with** valid disclosure_committee approval | ESCALATE | "Known accepted risk {fid}: confirm claim wording reflects it." |
| R8 | An ACTIVE, unexpired override exists for this claim | downgrade BLOCK→ESCALATE (never to APPROVE) | "Published under override {oid} by {person} until {date}: '{reason}'" |

Mapping to support state (shown on claims):
- `APPROVE` → `SUPPORTED`
- `ESCALATE` → `AT_RISK`
- `BLOCK` → `UNSUPPORTED`
- R0 only → `UNMAPPED`

**Triggers (re-evaluate all affected claims):**
- claim submitted for publication (`pre_publication`)
- new test result, finding opened/changed/closed, risk acceptance changed, override created/expired (`evidence_change`)
- simulated clock advanced (`clock_advance`) — staleness and ageing depend on date

**Publication rule:** a claim can move `draft → published` only if the latest decision is `APPROVE`, or `BLOCK/ESCALATE` with an ACTIVE override (§8.4).

**Drift rule (key feature):** if a **published** claim's decision becomes `BLOCK`, immediately create an escalation at level 3 (Disclosure Committee) with reason "Published claim no longer supported by evidence", and show a red banner on the claim.

---

## 8. Escalation, independence and overrides

### 8.1 Levels
| Level | Assigned to role | Meaning |
|---|---|---|
| 1 | `control_owner` (finding owner) | Fix it |
| 2 | `security_lead` | 2nd-line oversight |
| 3 | `disclosure_committee` | Affects what we tell the public |
| 4 | `audit_committee` + notify `internal_audit` | Board-level oversight |

### 8.2 Ageing rules for findings (run on every clock advance)
| Condition | Escalate to |
|---|---|
| HIGH/CRITICAL finding opened | Level 1 + Level 2 immediately |
| HIGH/CRITICAL open > 30 days | Level 3 **if** the control backs any published claim, else stays Level 2 |
| HIGH/CRITICAL open > 60 days | Level 3 (regardless) |
| HIGH/CRITICAL open > 90 days | Level 4 |
| MEDIUM open > 90 days | Level 3 |
| Escalation unacknowledged for 14 days | auto-promote one level |

When a higher level is created, previous open escalations for the same subject become `SUPERSEDED` (still visible in history).

### 8.3 Independence rule (gap G3)
When assigning an escalation, **skip** any person who is the claim owner, the finding owner, the control owner, or the person who proposed the related risk acceptance. If every eligible person at that level is conflicted, jump to the next level and log `"independence_skip"`.

Seed data must make this visible: `T. Grant` (security_lead) owns claim `C-01`, so claim-related escalations at level 2 skip him → go straight to level 3.

### 8.4 Override of a BLOCK
- Allowed only for `disclosure_committee` members who are **not** the claim owner, control owner or finding owner.
- `reason` required (≥ 50 chars) and `conditions` required (e.g. "Remediate admin rights to ≤10% by 2018-03-31").
- Default `expires_on = created_on + 90 days`. On expiry: status `EXPIRED`, gate re-runs, and if still BLOCK → level-4 escalation "Override expired without remediation".
- Overrides are listed prominently on the Audit Committee dashboard.

### 8.5 Severity downgrade second sign-off (stretch, gap G6)
If a finding or incident linked to a control that backs a published claim is downgraded (or an incident is rated 0/LOW), create a task for `internal_audit` to confirm within 7 days. Until confirmed, the gate uses the **higher** severity.

---

## 9. Risk Acceptance Ledger and Incident Linker

### 9.1 Risk acceptance (gap G5)
- `security_lead` proposes acceptance with `rationale` and **mandatory** `cost_benefit_note` (lecture: risk acceptance must be documented and justified).
- If the finding's control backs any published claim → `affects_public_claims = true` → requires `disclosure_committee` approval; the approver must choose either **"amend claim wording"** (opens claim edit for `claim_author`) or **"approve as-is with documented reason"**.
- Dashboard shows cumulative accepted risks per claim.

### 9.2 Incident Pattern Linker (stretch)
- On new incident: find other incidents in the last 180 days with the same `product` + `component`.
- If ≥ 2 linked incidents from **different reporters** → create a HIGH finding "Possible systemic issue in {component}" and a level-3 escalation, regardless of individual severity ratings.
- Display a small network graph (incidents as nodes, shared component as edges).

---

## 10. Simulated clock and scenario replay

- Global `sim_clock.current_date`; all "today" logic uses it.
- Header shows a **timeline bar** with checkpoint buttons (§15). Clicking a checkpoint:
  1. sets the clock,
  2. loads that checkpoint's scripted events (new snapshot, findings, incidents) if not already applied,
  3. runs all tests, ageing, gate re-evaluation,
  4. writes audit events.
- "Advance N days" button for free exploration.
- `POST /sim/reset` restores seed state.
- Replay must be **deterministic**: same clicks → same outputs.

---

## 11. Audit trail

- Append-only `audit_event` table; no update/delete endpoints.
- `hash = sha256(prev_hash + canonical_json(payload + seq + ts_sim + actor_id + action))`; first event's `prev_hash = "GENESIS"`.
- `GET /audit/verify` recomputes the chain and returns `{valid: bool, broken_at_seq?: int}`.
- Log at minimum: test runs, results, findings opened/changed/closed, severity changes, gate decisions, escalations created/acked/superseded, overrides, risk acceptance actions, claim publication/withdrawal, mapping approvals, clock changes, role switches.
- Internal Audit screen shows a "Tamper demo" button that flips one stored payload in a **copy** of the DB and shows verify failing (do not corrupt the live DB).

---

## 12. API (FastAPI, JSON)

All mutating endpoints take `actor_id` (from role switcher) and enforce §3 permissions; return 403 with a clear message otherwise.

```
GET  /people
GET  /sim/clock                 POST /sim/clock {date}
POST /sim/checkpoint/{cp_id}    POST /sim/advance {days}     POST /sim/reset

GET  /claims                    POST /claims                 PATCH /claims/{id}
POST /claims/{id}/submit        POST /claims/{id}/publish    POST /claims/{id}/withdraw
GET  /claims/{id}/decision      GET  /claims/{id}/history
POST /claims/{id}/map {control_id}   POST /maps/{claim_id}/{control_id}/approve

GET  /controls                  GET  /controls/{id}          POST /controls/{id}/manual-evidence
POST /tests/run                 (runs all tests at current date)
GET  /controls/{id}/results

GET  /findings                  POST /findings               PATCH /findings/{id}
POST /findings/{id}/close       POST /findings/{id}/severity {to, reason}

GET  /risk-acceptances          POST /risk-acceptances       POST /risk-acceptances/{id}/approve|reject

GET  /gate/decisions?claim_id=
POST /overrides                 GET  /overrides

GET  /escalations?role=&person_id=   POST /escalations/{id}/ack   POST /escalations/{id}/resolve

GET  /incidents                 POST /incidents              (stretch)

GET  /dashboard/oversight       GET  /dashboard/comparison
GET  /audit?limit=&offset=      GET  /audit/verify
```

---

## 13. UI screens (by user)

Global header: app name ("Disclosure Gate"), **role switcher**, simulated date, timeline/checkpoint bar, escalation inbox count.

### 13.1 Claim Registry — `claim_author`, `security_lead`
- Table: claim text, channel, owner, status, **support state badge** (green/amber/red/grey), mapped controls, last decision date.
- Claim detail: decision panel listing fired rules in plain English with evidence links; "Submit for publication"; history timeline of decisions.
- Red banner on published claims that became UNSUPPORTED ("This public claim is no longer backed by evidence").

### 13.2 Control Health — `control_owner`, `security_lead`
- Grid of controls: last result, age of evidence, stale flag, open findings, which public claims depend on it ("blast radius").
- Control detail: result history chart (pass/fail over time), metrics (e.g. admin share 72% vs threshold 10%), framework refs.

### 13.3 Findings & Risk Acceptance — `security_lead`, `control_owner`
- Findings table with age, severity, owner, escalation level, linked claims.
- Propose risk acceptance form (rationale + cost-benefit required).

### 13.4 Escalation Inbox — every role
- Items assigned to the current role/person, with age and "why you are seeing this" text (including independence skips).
- Ack / Resolve actions.

### 13.5 Gate Review — `disclosure_committee`
- Queue of BLOCK/ESCALATE claims and drift alerts.
- Each item: claim, rules fired, missing evidence, options: **Request remediation**, **Amend/withdraw claim**, **Override** (form with reason, conditions, expiry; disabled with tooltip if user is conflicted).

### 13.6 Internal Audit — `internal_audit`
- Test definitions with "reviewed by audit" toggle and comments.
- Random sample of N test results to inspect.
- Severity-downgrade sign-off queue (stretch).
- Audit log viewer + **Verify chain** button + tamper demo.

### 13.7 Oversight Dashboard — `audit_committee`
KPI tiles:
- Published claims: supported / at risk / unsupported
- **Days the longest-running unsupported published claim has been live**
- Open HIGH/CRITICAL findings and the oldest one's age
- Active overrides (and expiring soon)
- Risk acceptances affecting public claims
- Controls never tested

Plus the **Status quo vs With gate** comparison panel (the core demo argument), computed for the replayed timeline:

| Metric | Status quo (scripted baseline) | With gate (computed) |
|---|---|---|
| Days a contradicted claim stayed live with no recorded decision | ~1,100 (2017-12 → 2020-12) | days until first decision/override record |
| Times the Disclosure Committee saw the VPN issue | 0 | count of level-3+ escalations |
| Times the Audit Committee saw it | 0 | count of level-4 escalations |
| Named person accountable for keeping the claim live | none | override author(s) |
| Cross-customer incident pattern detected | no | yes/no (stretch) |

"Status quo" values are fixed constants from the narrative; label them "based on SEC allegations (unproven)".

### 13.8 About page
Short explanation, the gap table from §1, the limitation statement (does not detect build-pipeline malware), and "synthetic data, fictional company".

**Design:** clean, neutral, high-contrast; badges use colour **and** text/icons; works on a laptop projector (min 14px body). Light theme default; dark optional.

---

## 14. Seed data

Fictional company: **NimbusWatch Inc.** — sells IT monitoring software **"Horizon"** (analogue of Orion). Component analogue of the Orion Improvement Program: **"Horizon Telemetry Service"**.

### 14.1 People
As in §3: `P-PRIYA` (control_owner), `P-GRANT` (security_lead), `P-DANA` (claim_author), `P-OKAFOR`, `P-CHEN` (disclosure_committee), `P-IBRAHIM` (internal_audit), `P-MORALES` (audit_committee). Add a second control owner `P-LEO` (DevOps) for SA-01.

### 14.2 Claims (Security Statement, owner `P-GRANT`, channel website)
| ID | Text | Mapped controls |
|---|---|---|
| C-01 | "Access controls to sensitive data in our systems are set on a need-to-know / least-privilege basis." | AC-01, AC-02 |
| C-02 | "Our password policy covers all applicable systems and enforces complex passwords. Passwords are individually salted and hashed." | IA-01, IA-02 |
| C-03 | "We follow a defined secure development lifecycle, including security testing, for our products." | SA-01 |
| C-04 | "NimbusWatch follows the NIST Cybersecurity Framework." | *(none — intentionally unmapped → R0)* |
| C-05 | "Changes to production systems are reviewed, approved and monitored." | CM-01 (manual evidence only, valid) |

### 14.3 Controls
| ID | Name | Owner | Test | Freq (days) | Framework refs |
|---|---|---|---|---|---|
| AC-01 | Least privilege | P-PRIYA | T-LEASTPRIV | 30 | NIST 800-53 AC-6; COBIT DSS05; COSO Control Activities |
| AC-02 | Remote access from managed devices | P-PRIYA | T-VPNDEVICE | 30 | NIST 800-53 AC-17; COBIT DSS05 |
| IA-01 | Password policy | P-PRIYA | T-PWDPOLICY | 30 | NIST 800-53 IA-5; COBIT DSS05 |
| IA-02 | No exposed credentials | P-LEO | T-SECRETS | 7 | NIST 800-53 IA-5(7); COBIT DSS05 |
| SA-01 | Secure development lifecycle | P-LEO | T-SDLSCAN | 30 | NIST 800-53 SA-11; COBIT BAI03 |
| CM-01 | Change management | P-LEO | — (manual) | 90 | NIST 800-53 CM-3; COBIT BAI06 |

All mappings pre-approved by `P-OKAFOR` on 2017-11-15.

### 14.4 Snapshots (generate deterministically with fixed RNG seed `4234`)
| Snapshot date | directory.csv | password_policies.json | repos/ | vpn | pipelines |
|---|---|---|---|---|---|
| 2017-12-01 | 150 human accounts, **72% admin**, 3 shared | 4 systems; one with `min_length: 0`, `complexity_required: false` | clean | none yet | `horizon-core.yaml` has scan + dep check; `horizon-telemetry.yaml` **missing security_scan** |
| 2018-06-04 | 180 accounts, 70% admin, 3 shared | unchanged | clean | 40 logins, **6 from unmanaged devices** | unchanged |
| 2019-08-16 | 220 accounts, 68% admin, 2 shared | one system fixed, one still fails | clean | 55 logins, 9 unmanaged | unchanged |
| 2019-11-19 | unchanged | unchanged | `public/updates-mirror/config.ini` contains `ftp_pass = nimbus123` (repo flagged public) | unchanged | unchanged |
| 2020-06-15 | 240 accounts, 65% admin | unchanged | unchanged | 60 logins, 7 unmanaged | unchanged |
| 2020-10-14 | unchanged | unchanged | unchanged | unchanged | unchanged |

Generator script: `backend/seed/generate_snapshots.py` writes these files; commit the generated output too, so the demo works offline.

### 14.5 Scripted manual findings and incidents
| When | Item |
|---|---|
| 2018-06-04 | Manual finding `F-2018-VPN` on AC-02, HIGH, raised by `P-PRIYA`: "Unmanaged devices can connect to corporate VPN; activity undetectable by DLP." Owner `P-PRIYA`. |
| 2019-08-16 | Manual finding `F-2019-ACCESS` on AC-01, HIGH, raised by `P-GRANT` (quarterly review): "Access and privilege to critical systems/data is inappropriate." |
| 2020-06-15 | Incident `I-01`: "Customer A (government agency)", product Horizon, component `BusinessLayer`, "Horizon contacting unknown external domains", rated **0** by `P-GRANT` |
| 2020-10-14 | Incident `I-02`: "Customer B (security firm)", product Horizon, component `BusinessLayer`, "Horizon downloading a malicious file", rated **0** by `P-GRANT` |

---

## 15. Demo script (checkpoints + expected results)

Each checkpoint is a button. **Expected outputs are acceptance criteria.**

### CP1 — 2017-12-01 "Drafting the Security Statement"
Events: claims C-01..C-05 exist as `draft`; **no tests run yet**; CM-01 has valid manual evidence.
Action: `P-DANA` submits all claims.
Expected:
- C-01, C-02, C-03 → **BLOCK** via R1 ("never tested").
- C-04 → **ESCALATE** via R0 (unmapped).
- C-05 → **APPROVE** (attested evidence).

### CP1b — 2017-12-01 "First automated test run"
Action: run tests.
Expected:
- AC-01 FAIL (admin share 72% > 10%; 3 shared accounts) → finding auto-opened HIGH.
- IA-01 FAIL (one system min_length 0) → HIGH (because < 6).
- SA-01 FAIL (`horizon-telemetry.yaml` lacks security_scan) → HIGH.
- AC-02 PASS (no VPN logins yet) — show "passing on thin evidence" note.
- IA-02 PASS.
- C-01, C-02, C-03 → **BLOCK** via R2 + R3.
Action: `P-GRANT` tries to override → **disabled** (conflicted: claim owner, and not committee). `P-OKAFOR` overrides C-01 with reason + conditions "admin share ≤10% by 2018-03-01", expiry 2018-03-01. C-01 published.
Expected: override visible on Oversight dashboard; C-01 state AT_RISK (R8).

### CP2 — 2018-03-02 "Override expires"
Action: advance clock.
Expected: override `EXPIRED`; C-01 back to BLOCK; drift alert; **level-4 escalation** "Override expired without remediation" to Audit Committee.

### CP3 — 2018-06-04 "Engineer reports VPN gap"
Events: new snapshot; `F-2018-VPN` opened; tests run → AC-02 FAIL (6 unmanaged logins).
Expected: escalation L1 (`P-PRIYA`) + L2. Because C-01 is published and owned by `P-GRANT`, claim-related routing **skips Grant (independence_skip)** → L3 Disclosure Committee. Inbox shows "why you are seeing this".

### CP4 — 2018-09-03 "90 days of no traction"
Action: advance clock.
Expected: `F-2018-VPN` → **level-4** escalation to Audit Committee; dashboard "oldest HIGH finding: 91 days".

### CP5 — 2019-08-16 "Internal review: access inappropriate"
Events: `F-2019-ACCESS` opened; new snapshot; tests run.
Expected: C-01 still UNSUPPORTED; decision lists R2 + R3 (two findings); Oversight KPI "days unsupported claim live" increments; comparison panel updates.
Optional: `P-GRANT` proposes risk acceptance on `F-2019-ACCESS` → requires committee approval (R6 until approved).

### CP6 — 2019-11-19 "Password leaked in public repo"
Events: snapshot with `ftp_pass = nimbus123` in a public repo; tests run.
Expected: IA-02 FAIL → **CRITICAL** finding; C-02 (if published under override) gets drift alert → L3 immediately; secret value **masked** in UI (`nim*****`).

### CP7 — 2020-06-15 and CP8 — 2020-10-14 "Two customer incidents" (stretch)
Events: I-01 then I-02, both rated 0.
Expected at CP8: linker connects I-01 ↔ I-02 (same component, different reporters) → HIGH finding "Possible systemic issue in BusinessLayer" + L3 escalation; severity sign-off task for `P-IBRAHIM` because the ratings were 0.

### CP9 — 2020-12-14 "Wrap-up"
Expected: comparison panel fully populated; `GET /audit/verify` → valid; tamper demo shows a broken chain on a copy.

Presenter talking point (put on the About page): *"The gate doesn't stop a determined executive. It makes sure the gap between claim and evidence is visible to independent people, in time, and that keeping a contradicted claim live is a named, recorded decision."*

---

## 16. Testing requirements

Use `pytest`. Minimum:

1. **Unit tests per control test** (`T-LEASTPRIV`, `T-PWDPOLICY`, `T-SECRETS`, `T-VPNDEVICE`, `T-SDLSCAN`) with small fixture snapshots: one PASS, one FAIL, one edge case each (e.g. exactly at threshold = PASS; service accounts excluded from admin share; masked secret output).
2. **Gate rule tests**: one test per rule R0–R8, plus precedence (BLOCK beats ESCALATE; override never yields APPROVE).
3. **Escalation tests**: 30/60/90-day ageing; 14-day unacknowledged promotion; independence skip when all candidates conflicted.
4. **Override tests**: conflicted user rejected (403); reason < 50 chars rejected; expiry triggers level-4.
5. **Audit tests**: chain verifies after a full scenario; modifying any payload breaks verification at the right `seq`.
6. **Scenario test**: run CP1 → CP9 programmatically and assert every "Expected" bullet in §15.
7. **Permission tests**: no endpoint can modify `test_result`; each role blocked from at least one forbidden action.

Frontend: a smoke test (Playwright) that loads each screen per role and clicks through CP1–CP4.

---

## 17. Build order (milestones)

1. **M1 – Skeleton:** monorepo layout exactly as §4.2, tooling as §4.1, Makefile (§4.3), `.env.example`, CI workflow (§4.5). FastAPI + SQLModel models, SQLite, React app shell with role switcher and clock display, `make types` working. `make install && make seed && make dev` works.
2. **M2 – Evidence:** snapshot generator, five control tests, `POST /tests/run`, Control Health screen.
3. **M3 – Gate:** claims, mappings, gate rules R0–R7, re-evaluation triggers, Claim Registry screen.
4. **M4 – Accountability:** escalations + ageing + independence, overrides (R8) with expiry, Escalation Inbox, Gate Review screen.
5. **M5 – Audit:** hash-chained log on every mutation, verify endpoint, Internal Audit screen.
6. **M6 – Replay & oversight:** checkpoints CP1–CP9, Oversight dashboard, comparison panel, About page.
7. **M7 – Tests & polish:** full test suite (§16), README with run instructions and demo script.
8. **M8 – Stretch:** incident linker, severity sign-off, report export.

Do not start a milestone until the previous one's tests pass.

---

## 18. Acceptance criteria (definition of done)

- [ ] `make install && make seed && make dev` runs locally from the repo root with no external services or network calls.
- [ ] Repo matches the layout in §4.2; tools match §4.1; lockfiles committed.
- [ ] `make lint` passes and CI (§4.5) is green, including the generated-types check.
- [ ] All CP1–CP6 expected results in §15 reproduce exactly (CP7–CP8 if stretch built).
- [ ] Every gate decision shows human-readable reasons and links to the evidence behind them.
- [ ] A published claim is re-flagged automatically when new evidence contradicts it (drift).
- [ ] Escalations skip conflicted people and say why.
- [ ] Overrides require an independent committee member, a reason and conditions, and expire.
- [ ] No UI or API path can edit test results or delete audit events.
- [ ] `/audit/verify` passes after a full replay; tamper demo shows failure on a copy.
- [ ] `make test` passes.
- [ ] README explains setup, roles, checkpoints and the limitation statement.
- [ ] No real company names, logos or real data in the app.

---

## 19. Framework traceability (for the report and the About page)

| Prototype feature | Gap | Lecture framework link |
|---|---|---|
| Automated control tests, "never tested" rule | G4 | COSO ICF – Monitoring Activities & Control Activities; COBIT MEA02; NIST 800-53 |
| Claim Registry + Consistency Gate + drift re-check | G1 | COSO – Information & Communication; SOX objective "accuracy and reliability of corporate disclosures"; BCBS P12 Disclosure & transparency (benchmark) |
| Independent escalation, conflict skip, override rules | G2, G3 | Three Lines of Defence; COBIT Principle 4 (governance distinct from management); MAS segregation of duties (benchmark – Barings case) |
| Ageing escalation to Audit Committee | G2 | Board oversight duty; MAS Audit guideline – audit committee monitors follow-up (benchmark) |
| Risk Acceptance Ledger with cost-benefit note | G5 | L5 ERM risk treatment – acceptance must be assessed and documented |
| Incident Pattern Linker | G6 | L4 Compliance Challenges #3 – network-based vs individual analysis; L5 risk interactions |
| Hash-chained audit trail | all | Agency theory – reduce information asymmetry / verification cost; 3rd-line assurance |
| Internal Audit role with read-all & test review | G4 | Three Lines of Defence – 3rd line independent assurance |

---

## 20. Glossary

- **Claim** – a public statement about security practice (website, filings, questionnaires).
- **Control** – an internal requirement that, if operating, supports a claim.
- **Evidence** – an automated test result or attested manual note, dated.
- **Finding** – a recorded weakness in a control.
- **Drift** – a published claim that was supported but no longer is.
- **Override** – a recorded, time-limited decision by an independent committee member to keep or publish a claim despite a BLOCK.
- **Independence skip** – routing past a person who has a conflict of interest.
- **Three Lines of Defence** – 1st line owns risk, 2nd line oversees risk, 3rd line (internal audit) gives independent assurance.
