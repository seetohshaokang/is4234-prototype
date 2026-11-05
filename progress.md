# SCC Library — Implementation Progress

**Branch:** `shaokang/feat`
**Spec:** `one_shot_please.md`
**Goal:** Rebuild Disclosure Gate into the SCC Library prototype.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## What to keep

- `audit.py` — hash chain logic unchanged
- `frontend/src/components/` — AppShell, Badge, Card (restyle as needed)
- `Makefile`, `pyproject.toml`, `uv.lock`
- Vite/Tailwind config, `tsconfig.json`
- Checkpoint/clock infrastructure pattern (rewrite the events)

## What to remove

- `engine/gate.py` → replaced by `engine/scc_state.py` + `engine/sla.py`
- `engine/control_tests.py` → replaced by `engine/checks.py` + `engine/collectors.py`
- `frontend/src/pages/ClaimRegistry.tsx`, `GateReview.tsx`
- All `Claim`, `Override`, `RiskAcceptance`, `GateDecision`, `ClaimControlMap` DB tables and routes

---

## M1 — Data model and seed ✓

**Files:** `db.py`, `seed.py`, `data/snapshots/`, `data/sample_statements/`

### Tables to create
- [x] `checkdefinition` — composite PK (id, version), threshold, params, test_frequency_days, defined_by
- [x] `collector` — id, check_id, version, code_hash, written_by, submitted_on, status, approved_by, approved_on
- [x] `control` — id, name, owner_id, check_id, framework_refs
- [x] `scc` — id, title, owner_id
- [x] `sccversion` — id, scc_id, version, assertion_text, status, active_from, active_to, target_uptime_pct, rolling_window_days, max_single_downtime_days, evidence_type, supersedes_version_id, reason, approved_by, superseded_while_down, deprecated_while_down
- [x] `sccversioncontrol` — sccversion_id, control_id, check_id, check_version
- [x] `testresult` — id, control_id, check_id, check_version, collector_id, collector_approved_at_run, run_on, outcome, measured_value, evidence_summary (immutable)
- [x] `manualevidence` — control_id, attested_by, summary, valid_from, valid_until
- [x] `stateinterval` — id, sccversion_id, state, start, end, detected_at, possibly_since, cause_note
- [x] `finding` — id, control_id, severity, status (OPEN/CLOSED), opened_on, closed_on, root_cause_note
- [x] `changerequest` — id, type, scc_id, requested_by, requested_on, reason, status, decided_by, decided_on, auditor_note, effective_on
- [x] `escalation` — id, sccversion_id, trigger, level, assigned_to_role, assigned_to_id, status, independence_skips, reason, created_on
- [x] `committeeresponse` — id, escalation_id, decision, rationale, due_on, decided_by, decided_on
- [x] `issuedcitation` — id, sccversion_id, kind, period_from, period_to, uptime_pct, unknown_pct, target_met, citation_string, issued_by, issued_on, record_hash
- [x] `auditevent`, `simclock`, `checkpointapplied` — kept

### Enums
- [x] `SCCState`: UPHELD, DOWN, UNKNOWN, NOT_ACTIVE
- [x] `SCCVersionStatus`: PROPOSED, ACTIVE, SUPERSEDED, DEPRECATED, REJECTED
- [x] Old claim/gate enums removed

### Seed data
- [x] 5 personas (P-PRIYA, P-GRANT, P-OKAFOR, P-REYES, P-MORALES)
- [x] 7 SCCs in PROPOSED state, all owned by P-GRANT
- [x] 8 controls, all owned by P-PRIYA
- [x] 8 check definitions (T-PWDPOLICY has v1 and v2 with composite PK), all pre-approved collectors
- [x] CM-01 manual attestations: 90-day windows 2017-12-01 to 2020-06-30

### Snapshot updates
- [x] `mfa_enabled` + `has_remote_access` columns in `directory.csv`
- [x] `sso` boolean in `password_policies.json`; 2018-09-03 snapshot: 11 SSO + billing-ftp non-SSO with min_length=0
- [x] `uptime.json` in every snapshot; Sep 2020 = 99.71%, all others ≥ 99.9%
- [x] New 2018-09-03 snapshot added

### Sample statements
- [x] `data/sample_statements/SD-01.md` — 4 SCC citations without figures + NIST CSF rejected note
- [x] `data/sample_statements/SD-02.md` — false hand-typed citation `(SCC-01 v1, 2018: 99.0% upheld, target 99% met)`

---

## M2 — Check engine ✓

**Files:** `engine/checks.py` (new), `engine/collectors.py` (new), remove `engine/control_tests.py`

### collectors.py (one per control, reads latest snapshot ≤ run date)
- [x] `collect_leastpriv` — `directory.csv`
- [x] `collect_vpndevice` — `vpn_logins.csv` + `managed_devices.csv`
- [x] `collect_mfa` — `directory.csv` (mfa_enabled column)
- [x] `collect_pwdpolicy` — `password_policies.json`
- [x] `collect_secrets` — `repos/`
- [x] `collect_sdlscan` — `pipelines/*.yaml`
- [x] `collect_uptime` — `uptime.json`

### checks.py (pure functions: `run(raw_data, params) -> (outcome, measured_value, evidence_summary)`)
- [x] `T-LEASTPRIV` — admin share ≤ 10% AND no shared accounts; HIGH
- [x] `T-VPNDEVICE` — 0 unmanaged VPN logins in trailing 30 days; HIGH
- [x] `T-MFA` — MFA coverage ≥ 98% of human accounts with remote access; HIGH
- [x] `T-PWDPOLICY v1` — min_length ≥ 8, complexity on, rotation ≤ 90, history ≥ 5; MEDIUM (HIGH if min_length < 6)
- [x] `T-PWDPOLICY v2` — only systems with `sso: false`: min_length ≥ 12, complexity on, history ≥ 5; same severity
- [x] `T-SECRETS` — no credential patterns in repos; mask values (`nim*****`); CRITICAL if public repo, HIGH if private
- [x] `T-SDLSCAN` — all pipelines have security_scan + dependency_check before release; HIGH
- [x] `T-UPTIME` — each completed calendar month ≥ 99.9%; MEDIUM

### services.py
- [x] FAIL auto-opens a finding; PASS on same control auto-closes it (no manual close)
- [x] `run_due_checks(session, as_of)` — iterates every scheduled run date in `[last_run + freq, as_of]` per control, in order

---

## M3 — SCC state engine and SLA ✓

**Files:** `engine/scc_state.py` (new), `engine/sla.py` (new)

### scc_state.py
- [x] `compute_intervals(sccversion, controls, results, manual_evidence, collectors, as_of) -> list[StateInterval]`
- [x] State precedence: DOWN > UNKNOWN > UPHELD; outside active window → NOT_ACTIVE
- [x] UNKNOWN when: never run, stale, collector was PENDING at run time, latest collector currently PENDING, attestation expired
- [x] Downtime window: `detected_at` = first failing result; `possibly_since` = last valid pass before it (or `active_from`)
- [x] Rebuilt from scratch on every trigger — same inputs always give same output

### sla.py
- [x] `uptime_pct(intervals, from, to, active_from, active_to)` → `(uptime_pct, unknown_pct, active_coverage_pct)`
- [x] `target_met(uptime_pct, unknown_pct, max_down_days, target_uptime, max_single_downtime)` → bool
- [x] Rolling SLA: `target_met` over trailing `rolling_window_days`

---

## M4 — SCC lifecycle and change requests ✓

**Files:** `services.py`, `backend/main.py`

### Routes
- [x] `GET /change-requests`, `POST /change-requests` (security_lead)
- [x] `POST /change-requests/{id}/approve`, `POST /change-requests/{id}/reject` (independent_auditor only)
- [x] `GET /collectors`, `POST /collectors` (control_owner)
- [x] `POST /collectors/{id}/approve` (independent_auditor only)
- [x] `GET /checks`

### On CREATE approval
- [x] SCC version → ACTIVE; pins checks in `sccversioncontrol`; catch-up runs fire; intervals rebuilt

### On REEVALUATE approval
- [x] Old version → SUPERSEDED with "superseded while down" flag; new version → ACTIVE

### On DEPRECATE approval
- [x] `effective_on` ≥ decision date; fires via `check_pending_deprecations`

### Remove
- [x] All old `/claims/*`, `/gate/*`, `/overrides`, `/risk-acceptances/*` routes removed

---

## M5 — Citations and resolver ✓

**Files:** routes in `backend/main.py`

- [x] `POST /citations/generate` — refuses PROPOSED/REJECTED; refuses outside active window; logs to `issuedcitation` with `record_hash`
- [x] `GET /citations` — list all issued citations
- [x] `POST /resolve` — parse citation string OR explicit params; returns computed figures, mismatch verdict (±0.1pp), matched logged citation

---

## M6 — Escalation engine rewrite ✓

**Files:** `engine/escalation.py` (rewrite), `services.py`

### Triggers
- [x] ACTIVE SCC enters DOWN → L3 immediately + L1 (committee response required)
- [x] ACTIVE SCC UNKNOWN > 14 days → L2 → independence skip routes to L3
- [x] Escalation unacknowledged 14 days → promote one level

### Independence rule
- [x] Skip anyone who owns the SCC or the control; if all conflicted at a level, jump to next and record `independence_skips`
- [x] Grant owns every SCC → L2 always skips to L3

### Committee response (`POST /escalations/{id}/respond`, disclosure_committee only)
- [x] Rationale ≥ 50 chars; decision: REMEDIATE / STOP_CITING / REQUEST_REEVALUATION / DISCLOSE

---

## M7 — Checkpoint script rewrite ✓

**Files:** `services.py` (`CHECKPOINTS` dict)

- [x] **CP1** (2017-12-01) — Reyes defines checks; Grant submits CREATE SCC-01–07; Reyes approves all except SCC-04 (rejected: not measurable); all ACTIVE SCCs are UNKNOWN
- [x] **CP1b** (2017-12-01) — First runs; SCC-01/02/03/06 → DOWN; L3 escalations; Okafor responds REMEDIATE on SCC-01 (due 2018-03-01)
- [x] **CP2** (2018-03-02) — SCC-01 still DOWN past due; L4 to Morales
- [x] **CP3** (2018-06-04) — 6 unmanaged VPN logins → AC-02 FAIL → second DOWN cause on SCC-01
- [x] **CP4** (2018-09-03) — REEVALUATE SCC-02: v1 → SUPERSEDED while down; v2 → ACTIVE, immediately DOWN (billing-ftp min_length=0)
- [x] **CP5** (2019-08-16 → 2019-09-05) — New OP-01 collector → PENDING → SCC-07 UNKNOWN; Reyes approves on 2019-09-05; 20 days stay UNKNOWN
- [x] **CP6** (2019-11-19) — ftp_pass=nimbus123 in public repo → CRITICAL → SCC-02 v2 new L3
- [x] **CP7** (2020-06-15) — DEPRECATE SCC-05 effective 2020-06-30
- [x] **CP8** (2020-10-14) — Sep 2020 availability 99.71% → SCC-07 DOWN → L3 → Okafor DISCLOSE → NEGATIVE citation; Oct recovers
- [x] **CP9** (2020-12-14) — Resolve SD-02 → mismatch; comparison panel; audit chain verify

---

## M8 — Frontend screens ✓

**Files:** `frontend/src/pages/`

- [x] **SCC Library** (`ClaimRegistry.tsx` → SCCLibrary) — state badges, rolling uptime, links to detail
- [x] **SCC Detail** (`SCCDetail.tsx` new) — version chain, interval timeline bar, superseded/deprecated flags, "Cite this SCC" form
- [x] **Resolver** (`Resolver.tsx` new) — paste citation string, shows computed vs claimed, mismatch banner
- [x] **Checks & Collectors** (`ControlTests.tsx` → ChecksCollectors) — check defs, collectors, latest test results
- [x] **Change Requests** (`GateReview.tsx` → ChangeRequests) — pending/decided split, approve/reject for P-REYES
- [x] **Escalations** (`EscalationsPage.tsx`) — level badges, respond form for L3 (committee decision + rationale)
- [x] **Findings** (`FindingsPage.tsx`) — read-only, severity badges, days open, no close button
- [x] **Audit Trail** (`AuditTrail.tsx`) — verify chain button, event log
- [x] **Dashboard** (`Dashboard.tsx`) — KPI tiles, SCC state summary, open L3/L4 mini-table
- [x] **About** (`AboutPage.tsx`) — SCC Library concept, escalation ladder

### Sidebar
- [x] Persona switcher (5 personas + Public)
- [x] CP1–CP9 buttons, Reset, sim date controls

### Visual rule
- [ ] Consistent state colours everywhere: green = UPHELD, red = DOWN, grey = UNKNOWN, white = NOT_ACTIVE
- [ ] SCC timeline bar is the centrepiece — large on Detail page

---

## M9 — Tests (keep only the ones that prove the core demo story)

**Files:** `tests/test_scenario.py`

- [ ] **Determinism** — CP1→CP9 twice from reset gives identical intervals, SLA figures, audit hashes
- [ ] **No evidence ≠ upheld** — before first run, every ACTIVE SCC is UNKNOWN
- [ ] **Rejected SCC** — SCC-04 is not citable; generator refuses it
- [ ] **Immutability** — no API call modifies an ACTIVE/SUPERSEDED/DEPRECATED version; non-auditor writes return 403
- [ ] **Re-evaluation keeps history** — after CP4: SCC-02 v1 is SUPERSEDED with unchanged downtime; v2 is DOWN with 0 inherited uptime
- [ ] **Collector integrity** — CP5 UNKNOWN window stays after collector approval (history is final)
- [ ] **Direct escalation** — CP1b: DOWN SCC creates L3 immediately without passing L2
- [ ] **Independence skip** — CP5: UNKNOWN > 14 days skips Grant and lands at L3
- [ ] **Citation honesty** — SD-02 resolves as mismatch (0.0% vs 99.0%)
- [ ] **Audit chain** — valid after full replay; tamper demo fails on copy only

---

## Risk flags

- **T-PWDPOLICY v1 → v2 at CP4** — engine must use the check version pinned in `sccversioncontrol`, not the latest. Test explicitly.
- **Snapshot additions** — `mfa_enabled`, `sso`, `uptime.json` must be added before M2 passes.
- **SCC-04 (rejected)** — create/reject flow must not leave orphaned rows that break the library list query.
