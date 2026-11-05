# SCC Library — Security Citation Codes · One-Shot Build Spec

**IS4234 Group 6 prototype · NimbusWatch Inc. (fictional) · 100% synthetic data**

> **For the builder.** This file is the only spec. If the existing *Disclosure Gate* codebase is present, refactor it in place. Keep its stack, its pure-function engine, its immutable test results, its hash-chained audit log, and its simulated clock and checkpoints. Remove everything this spec does not describe: statement publishing, the publication gate, overrides and risk acceptance. If no codebase is present, build from scratch.
>
> Sections marked **P1** are optional. Build them only after every P0 item and every acceptance test in §16 passes.

---

## 1. Concept

**One line.** The SCC Library is a library of **Security Citation Codes (SCCs)**: measurable security assertions, each held to an independent auditor's **standard** and tracked like an **SLA**, with an uptime record. When management writes a security statement by hand, it cites SCCs the way a paper cites sources (APA-style). Anyone can **resolve** a citation to check the recorded figures.

**What the prototype focuses on:**
1. **Maintaining the SCC library**: SLA-style uptime per SCC, plus versioning and deprecation that never erase history.
2. **Independent but tailored checks**: the auditor owns *what* is checked and the standard; the company owns only *how* data is collected from its own systems, and each collector version needs auditor approval.
3. **Escalation to the committee**: SCCs are high-level enough for management to use in public statements, so an SCC going down goes **straight to the disclosure committee**.

**Not a feature:** drafting or publishing statements. Statements are written outside the system. The prototype includes two read-only sample statements purely to show citing and resolving.

**The governance failure it targets (SolarWinds, as alleged by the SEC in 2023).**
- Internal documents from 2018 onwards described serious security weaknesses, while the public Security Statement described strong practices.
- The same function that made the public claims controlled the evidence for them, and nobody independent checked.
- Of the SEC's claims, only the Security Statement claim survived the July 2024 ruling, and the SEC dismissed the case in November 2025 without any admission of wrongdoing.
- Present all of this as **allegation**, in the UI and in the docs.

**Explicit non-claims** (also shown on the About page):
- This is a governance control. It would not have detected the SUNBURST build-server malware.
- It makes security assertions checkable and escalates failures. It cannot stop a company from misquoting a citation, but resolving the citation exposes the misquote.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **SCC** | Security Citation Code, e.g. `SCC-06`. A stable identifier for one security assertion. Has versions. |
| **SCC version** | e.g. `SCC-06 v1`. Holds the assertion text, its standard, pinned check versions and its lifecycle status. Immutable once active. |
| **Assertion** | What the company states, e.g. "MFA is enforced on human accounts with remote access." |
| **Standard** | The auditor-set bar the assertion is measured against: check thresholds, plus the SLA target (uptime % over a rolling window) and the maximum single downtime. |
| **Check** | An auditor-defined test with a threshold, e.g. `T-MFA v1: coverage ≥ 98%`. Versioned and locked. |
| **Collector** | Company-written code that pulls raw data from the company's own systems for a check. Versioned; each version needs auditor approval. |
| **Control** | An internal control (e.g. AC-03 MFA) measured by one check. |
| **State** | At any instant, an SCC version is `UPHELD`, `DOWN`, `UNKNOWN` or `NOT_ACTIVE` (outside its active window). |
| **Downtime window** | A period an SCC version was `DOWN`. Stores `possibly_since` and `detected_at`. |
| **Uptime %** | Time `UPHELD` ÷ (period − time `UNKNOWN`). Time `UNKNOWN` is always reported next to it. |
| **Citation** | An APA-style string referencing an SCC version for a period, e.g. `(SCC-06 v1, 2019: 61.0% upheld, target 99% missed)`. |
| **Resolve** | Look up a citation and get the recorded figures for that SCC version and period. |
| **Change request** | A company request to CREATE, REEVALUATE or DEPRECATE an SCC. Only the auditor decides. |

---

## 3. Architecture

### 3.1 Stack (keep)

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python 3.12), uvicorn |
| ORM / DB | SQLModel + SQLite (`scc_library.db`) |
| Frontend | React 18 + TypeScript (strict), Vite 5, Tailwind CSS, TanStack Query, lucide-react |
| Guided tour | driver.js |
| Package managers | uv (Python), npm (Node) |

### 3.2 Module layout

```
prototype/
├── backend/main.py           # FastAPI app, all routes, role checks
├── engine/                   # PURE FUNCTIONS ONLY: no DB access, no side effects
│   ├── checks.py             # 7 check functions (§7)
│   ├── collectors.py         # company-side collectors reading snapshots (§7.2)
│   ├── scc_state.py          # results -> state intervals per SCC version (§8)
│   ├── sla.py                # uptime maths, target and max-downtime evaluation (§8.4)
│   ├── citation.py           # citation string formatting + parsing + resolve (§10)
│   └── escalation.py         # escalation routing + independence rule (§11)
├── services.py               # orchestration; every mutation writes an audit event in the same transaction
├── db.py                     # tables + enums
├── audit.py                  # SHA-256 hash-chained log
├── seed.py                   # seed loader
├── data/snapshots/           # synthetic system state per date (RNG seed 4234) + uptime.json
├── data/sample_statements/   # 2 read-only hand-written statements (§13.5)
└── frontend/src/{pages,components,lib,store}/
```

### 3.3 Invariants (enforce in code and test them)

1. `engine/` modules are pure: data in, results out.
2. Every state change goes through `services.py` and writes an audit event in the same DB transaction.
3. State intervals and uptime figures are **recomputed** from test results at the current simulated date. There is no hidden state.
4. **History is final.** Figures for any period that has already ended never change, because test results are immutable and approvals never apply retroactively.
5. No API endpoint can create, update or delete a `testresult`, a `stateinterval`, or an ACTIVE, SUPERSEDED or DEPRECATED `sccversion`.
6. Only the `independent_auditor` role can create checks or check versions, approve collectors, or decide change requests. The API enforces this, not just the UI.

---

## 4. Data model

### 4.1 Tables

| Table | Key fields | Notes |
|---|---|---|
| `person` | id, name, role, title | 5 personas (§5) |
| `check` | id, version, name, metric, operator, threshold, params (json), test_frequency_days, defined_by, created_on | A new version is a new row; old versions are kept |
| `collector` | id, check_id, version, code_hash, written_by, submitted_on, status (PENDING / APPROVED / REVOKED), approved_by, approved_on | Results from a non-APPROVED collector are not evidence |
| `control` | id, name, owner_id, check_id, framework_refs | One check per control |
| `scc` | id (e.g. `SCC-06`), title, owner_id | Stable identity |
| `sccversion` | id, scc_id, version, assertion_text, status (PROPOSED / ACTIVE / SUPERSEDED / DEPRECATED / REJECTED), active_from, active_to, target_uptime_pct, rolling_window_days, max_single_downtime_days, evidence_type (TESTED / ATTESTED), supersedes_version_id, reason, auditor_note, approved_by | Immutable once ACTIVE; only `status` and `active_to` change, and only through a change request |
| `sccversioncontrol` | sccversion_id, control_id, check_id, check_version | **Pins** exact check versions to an SCC version |
| `testresult` | id, control_id, check_id, check_version, collector_version, run_on, outcome (PASS / FAIL), measured_value, evidence_summary | Immutable |
| `manualevidence` | control_id, attested_by, summary, valid_from, valid_until | For non-automatable controls; shown as "attested, not tested" |
| `stateinterval` | id, sccversion_id, state, start, end (null = ongoing), detected_at, possibly_since, cause_result_ids, cause_note | Derived; rebuilt deterministically |
| `finding` | id, control_id, severity (LOW–CRITICAL), status (OPEN / CLOSED), opened_on, closed_on, root_cause_note | Auto-opened on FAIL; closed only when the check passes again |
| `changerequest` | id, type (CREATE / REEVALUATE / DEPRECATE), scc_id, requested_by, requested_on, reason, proposal (json), status (PENDING / APPROVED / REJECTED), decided_by, decided_on, auditor_note, effective_on | The only way an SCC's lifecycle changes |
| `escalation` | id, sccversion_id, trigger, level, assigned_to_role, assigned_to_id, status (OPEN / ACK / RESOLVED / SUPERSEDED), independence_skips, reason, created_on | |
| `committeeresponse` | id, escalation_id, decision (REMEDIATE / STOP_CITING / REQUEST_REEVALUATION / DISCLOSE), rationale, due_on, decided_by, decided_on | Required for every L3 escalation |
| `issuedcitation` | id, sccversion_id, kind (POSITIVE / NEGATIVE), period_from, period_to, downtime_interval_id, uptime_pct, unknown_pct, target_met, citation_string, issued_by, issued_on, record_hash | A log of every citation generated; hash written to the audit chain |
| `auditevent` | seq, ts_sim, ts_real, actor_id, action, payload, prev_hash, hash | Append-only, hash-chained |
| `simclock` | current_date | Single row |
| `checkpointapplied` | cp_id | |

### 4.2 Enums

`SCCState`: `UPHELD`, `DOWN`, `UNKNOWN`, `NOT_ACTIVE`
`SCCVersionStatus`: `PROPOSED`, `ACTIVE`, `SUPERSEDED`, `DEPRECATED`, `REJECTED`
`ViewerTier`: `PUBLIC`, `AUDITOR`, `INTERNAL`

---

## 5. Roles and views

Five personas with one role each, plus a public view. A sidebar dropdown switches between them; there is no real authentication. The **active persona on first load is P-GRANT**.

| Persona | ID | Role | Tier | Can |
|---|---|---|---|---|
| Priya N. | P-PRIYA | `control_owner` | INTERNAL | Owns all controls; submits collector versions; records root-cause notes; receives L1 |
| T. Grant | P-GRANT | `security_lead` | INTERNAL | **Owns every SCC (a deliberate conflict)**; submits CREATE, REEVALUATE and DEPRECATE requests; generates citations; receives L2 |
| M. Okafor | P-OKAFOR | `disclosure_committee` | INTERNAL | Receives L3; records committee responses; generates citations for statements |
| A. Reyes | P-REYES | `independent_auditor` | AUDITOR | Defines checks and check versions; sets standards; approves or rejects collectors and change requests; verifies the audit chain; notified on L4 |
| J. Morales | P-MORALES | `audit_committee` | INTERNAL (read-only) | Oversight dashboard; receives L4 |
| *(no persona)* | — | `public` | PUBLIC | SCC library, citation generator, resolver |

**What each tier can see:**

| Tier | Visible |
|---|---|
| **PUBLIC** | SCC id, title, assertion text, standard (thresholds, SLA target, max downtime), evidence type (tested or attested), current state (shown as "Upheld", "Not currently upheld" or "Unverified"), trailing-window uptime % against target, version chain with the reasons for each change, deprecation status, the citation generator and the resolver. **Not shown:** downtime window dates (unless resolving a NEGATIVE citation that names one), measured values, root causes, findings. |
| **AUDITOR** | Everything in PUBLIC, plus downtime windows, measured values, test results, collector versions, change requests including rejected ones, and the audit log. |
| **INTERNAL** | Everything. |

---

## 6. Independence with tailoring

| What | Owner | Rule |
|---|---|---|
| Check definition, threshold, frequency | Independent auditor | Locked once created; any change is a new check version |
| Standard (SLA target, rolling window, max single downtime) | Independent auditor | Fixed for the life of an SCC version |
| Which controls and check versions an SCC version uses | Independent auditor | Pinned in `sccversioncontrol` |
| Collector: how data is pulled from NimbusWatch's own systems | Company (control owner) | Each new version records `code_hash` and is `PENDING` until the auditor approves |
| Test results | Engine only | Immutable; no endpoint writes them |

**Consequences:**
- **The company can't change a check, threshold or standard.** The only way to restore a `DOWN` SCC is to fix the root cause so the pinned checks pass again.
- **Collectors are the tailoring point.** NimbusWatch's systems change, so collectors change, but a changed collector produces no evidence until approved. Meanwhile the SCC is `UNKNOWN`, which counts against uptime because it is excluded from upheld time and reported separately.
- **Approval is not retroactive.** Results produced while a collector was `PENDING` stay non-evidence permanently (invariant 4).
- **P1:** an "auditor spot check" action that re-runs a check against the raw snapshot, bypassing the collector, and flags any mismatch with the collector's result.

---

## 7. Check engine

Each check is a pure function: `run(raw_data, params) -> (outcome, measured_value, evidence_summary)`.

A collector, `collect(snapshot_dir, as_of) -> raw_data`, reads the latest snapshot dated on or before the run date.

### 7.1 Checks (version 1 unless noted)

| Check | Control | Passes when | Fail severity |
|---|---|---|---|
| `T-LEASTPRIV` | AC-01 Least privilege | Admin share ≤ 10% of enabled human accounts AND no shared accounts | HIGH |
| `T-VPNDEVICE` | AC-02 Remote access from managed devices | 0 VPN logins from unmanaged devices in the trailing 30 days | HIGH |
| `T-MFA` | AC-03 Multi-factor authentication | MFA enforced on ≥ 98% of human accounts with remote access | HIGH |
| `T-PWDPOLICY` v1 | IA-01 Password policy | Every system: min_length ≥ 8, complexity on, rotation ≤ 90 days, history ≥ 5 | MEDIUM (HIGH if min_length < 6) |
| `T-PWDPOLICY` v2 | IA-01 Password policy | Every system **not behind SSO**: min_length ≥ 12, complexity on, history ≥ 5 (no rotation rule) | MEDIUM (HIGH if min_length < 6) |
| `T-SECRETS` | IA-02 No exposed credentials | No matches for `password=`, `ftp_pass`, `secret` or AWS key patterns in repos | CRITICAL if public repo, else HIGH |
| `T-SDLSCAN` | SA-01 Secure development lifecycle | Every pipeline YAML has `security_scan` and `dependency_check` before `release` | HIGH |
| `T-UPTIME` | OP-01 Platform availability | Each calendar month's Horizon availability ≥ 99.9% | MEDIUM |

CM-01 Change management has no automated check. It uses `manualevidence` and is labelled "attested, not tested" everywhere, including the public view.

**Findings:** a `FAIL` opens a finding if none is open for that control. A finding closes **only** when the same control's check next returns `PASS`; there is no manual close. Mask credential values everywhere (e.g. `nim*****`).

### 7.2 Scheduled runs and catch-up

Each check runs every `test_frequency_days`, starting from the date its control is first mapped to an active SCC version.

When the clock jumps or advances, the engine executes **every scheduled run date in the skipped range, in order**. Each run uses the latest snapshot on or before that run date. This makes the history continuous rather than one point per checkpoint.

`T-UPTIME` is special: it evaluates each completed calendar month from `uptime.json`, with exact month boundaries.

---

## 8. SCC state engine and SLA

### 8.1 State at any instant, per SCC version

1. Outside `[active_from, active_to)` → `NOT_ACTIVE`
2. Any pinned control without valid evidence → `UNKNOWN`. That means: never run, latest result older than `test_frequency_days`, result produced by a collector that wasn't APPROVED at run time, **its latest collector version currently PENDING** (every day pending is UNKNOWN), or attestation expired
3. Any pinned control whose latest valid result is `FAIL` → `DOWN`
4. Otherwise → `UPHELD`

If several apply, the worst wins: `DOWN` > `UNKNOWN` > `UPHELD`.

### 8.2 Downtime window boundaries

- `detected_at` = the run date of the first failing result.
- `possibly_since` = the run date of the last valid passing result before it. If there is none, it's the version's `active_from`.
- **For `T-UPTIME`**, both dates are the first day of the failing month, because the data is complete.

### 8.3 Conservative calculation

Uptime and maximum-downtime calculations treat each DOWN window as starting at `possibly_since`. The UI shows both dates.

### 8.4 SLA evaluation (`engine/sla.py`)

- `uptime_pct(version, from, to)` = time UPHELD ÷ (period − time UNKNOWN), clipped to the version's active window. Also return `unknown_pct`, and `active_coverage_pct` (the share of the requested period that the version was active).
- `target_met(version, from, to)` = uptime ≥ `target_uptime_pct` AND no single DOWN window longer than `max_single_downtime_days` AND `unknown_pct` ≤ 10%.
- **Rolling SLA status** = `target_met` over the trailing `rolling_window_days`, or since `active_from` if the version is younger than that.

Rebuild intervals from scratch on every trigger. The same inputs must give the same intervals.

---

## 9. SCC lifecycle: create, re-evaluate, deprecate

All lifecycle changes go through a **change request** from `security_lead` and a decision by `independent_auditor`. Both are written to the audit chain.

### 9.1 CREATE

- Grant proposes an assertion. Reyes decides whether it is measurable.
- **Approved:** v1 becomes ACTIVE from the decision date, with the standard and pinned checks set by Reyes.
- **Rejected** (e.g. "We follow the NIST CSF" is not measurable): the SCC exists with only a `REJECTED` v1. It can't be cited, and it appears only in the AUDITOR tier.

### 9.2 REEVALUATE: new version

Used when the standard no longer fits the software, e.g. the company moved most systems to SSO.

- Grant submits the reason and proposed criteria.
- On approval, Reyes sets the new standard and check versions:
  - The old version is **frozen**: status `SUPERSEDED`, `active_to` = decision date. Its history, including any open downtime, closes and stays permanently.
  - The new version becomes ACTIVE from the same date, with **its own fresh history**. It never inherits uptime.
- **No backdating:** `active_from` is never earlier than the decision date.
- **Superseded while down:** if the old version was DOWN at supersession, its last window ends at the supersession date and the version chain shows **"superseded while down"** in every tier, including PUBLIC.
- The public version chain shows each version's active dates and the auditor's reason.

### 9.3 DEPRECATE

The company no longer wants to maintain the SCC.

- Grant submits the request. Reyes approves with an `effective_on` date that is on or after the decision date.
- At `effective_on`: status `DEPRECATED`, `active_to = effective_on`, and scheduled runs stop.
- **Never deleted.** It stays citable for **periods ending on or before `active_to`**.
- If it was DOWN at deprecation, the final state is recorded as DOWN, and the chain shows **"deprecated while down"**.

### 9.4 Citation rules by status

| Version status | Can be cited for |
|---|---|
| ACTIVE | Any period inside its active window, including "to date" |
| SUPERSEDED or DEPRECATED | Only periods inside its former active window |
| PROPOSED or REJECTED | Never |

If a citation's period extends outside the version's active window, the generator refuses it. The resolver reports it as `period_outside_active_window`.

---

## 10. Citations and resolving

### 10.1 Formats (APA-like)

**POSITIVE, in-text form:**
`(SCC-06 v1, 2019: 61.0% upheld, target 99% missed)`
or, for an arbitrary period:
`(SCC-07 v1, 2019-10-01–2020-09-30: 91.8% upheld, target 90% met)`

**POSITIVE, reference-list form:**
> NimbusWatch Security Citation Code SCC-06, v1. *MFA is enforced on ≥ 98% of human accounts with remote access.* Upheld 61.0% of 1 Jan–31 Dec 2019 (target 99%, missed; unknown 0.0%). Standard set by A. Reyes, independent auditor. Retrieved 15 Jan 2020. scc.nimbuswatch.example/SCC-06/v1

**NEGATIVE (disclosing a specific downtime window; lower frequency):**
`(SCC-07 v1, downtime 2020-09-01–2020-09-30)`

Rules for the strings:
- A POSITIVE citation **always includes target met or missed**. A string that omits it doesn't parse.
- "Attested, not tested" is appended for ATTESTED SCCs.
- If `unknown_pct` > 0, add `, unknown X%`.

### 10.2 Generating a citation

The "Cite this SCC" panel lets you pick a version, then a period (calendar year, a custom range, or "to date"), or a downtime window for a NEGATIVE citation (internal and auditor tiers only).

The engine computes the figures and writes the string; **the figures can't be edited**. Each generated citation is logged in `issuedcitation`, with a `record_hash` written to the audit chain.

### 10.3 Resolving a citation

`POST /resolve` accepts either a citation string or `{scc_id, version, from, to}` and returns:
- the recorded figures: uptime %, unknown %, target met, active coverage %;
- the version status and active window;
- whether the period sits inside the active window;
- whether the quoted figures match (uptime within ±0.1 percentage points, target met/missed identical);
- whether the string matches an `issuedcitation` record, and if so its `record_hash`.

For a NEGATIVE citation, it confirms whether a DOWN window with those dates exists. Resolving is available to **all tiers, including PUBLIC**. It is how anyone checks a hand-written statement.

---

## 11. Escalation to the committee

### 11.1 Levels

| Level | Assigned role | Meaning |
|---|---|---|
| L1 | `control_owner` | Fix the root cause or the evidence feed |
| L2 | `security_lead` | Second-line oversight |
| L3 | `disclosure_committee` | Affects what management may say publicly |
| L4 | `audit_committee`, with `independent_auditor` notified | Board-level oversight |

### 11.2 Triggers

| Condition | Action |
|---|---|
| Check FAIL (finding opened) | L1 notice to the control owner |
| **An ACTIVE SCC version enters `DOWN`** | **L3 immediately**, plus an L1 notice. A committee response is required |
| An ACTIVE SCC version has been `UNKNOWN` for more than 14 days | L2 (the independence rule usually routes this to L3; see §11.3) |
| Rolling SLA target missed, OR a single DOWN window exceeds `max_single_downtime_days` | L4 |
| No committee response 14 days after an L3 escalation | L4 |
| Escalation unacknowledged for 14 days | Promote one level |
| Change request approved for an SCC with an open escalation | Escalations on the old version are RESOLVED with the note "superseded or deprecated", and its history stays |

When a higher level is created, earlier open escalations for the same SCC version and trigger become `SUPERSEDED`. Deduplicate on `(sccversion_id, trigger, level)`.

### 11.3 Independence rule

When assigning an escalation, skip anyone who owns the SCC or the control involved. If every candidate at a level is conflicted, jump to the next level and record it in `independence_skips`. Each inbox item shows **"Why you are seeing this"**.

Grant owns every SCC, so L2 items about SCCs skip him and go to the committee.

### 11.4 Committee response (required for every L3)

| Decision | Meaning |
|---|---|
| `REMEDIATE` | Track the fix; `due_on` is required |
| `STOP_CITING` | Management will not cite this SCC until it's upheld; shown as an internal banner |
| `REQUEST_REEVALUATION` | Creates a REEVALUATE change request for the auditor |
| `DISCLOSE` | Management will disclose the downtime; prompts generation of a NEGATIVE citation |

- The rationale must be at least 50 characters.
- The decision, the decider and the time go to the audit chain.
- **The engine never decides what to disclose; it proves the committee knew, and what it chose.**

---

## 12. Audit trail (keep)

- Append-only `auditevent`; no update or delete path.
- `hash = SHA-256(prev_hash + canonical_json(seq, ts_sim, actor_id, action, payload))`, with the first event's `prev_hash = "GENESIS"`.
- `GET /audit/verify-chain` returns `{valid, broken_at}`.
- `POST /audit/tamper-demo` copies the DB, changes one payload in the copy, and verifies the copy, which fails. It then deletes the copy. The live DB is never touched.
- **Logged events:**
  - check versions;
  - collector submissions and decisions;
  - test runs, including catch-up runs as one summarised event per run batch;
  - interval rebuilds (a summary diff);
  - findings opened and closed;
  - change requests and decisions;
  - escalations and committee responses;
  - issued citations (with `record_hash`);
  - resolve calls (P1);
  - clock changes;
  - role switches.

---

## 13. Simulated clock, checkpoints and seed data

### 13.1 Clock and navigation

A single `simclock` row holds the current date; all "today" logic uses it.

- **Forward:** apply missing checkpoints in order, running catch-up runs (§7.2). Manual actions are preserved.
- **Backward:** reseed and replay deterministically. Manual actions are lost.
- **Reset:** return to the pre-CP1 state (2017-11-15).

### 13.2 Checkpoints

| CP | Sim date | Scripted events |
|---|---|---|
| CP1 | 2017-12-01 | Reyes defines the v1 checks. Grant submits CREATE requests for SCC-01 to SCC-07. Reyes approves all except **SCC-04 (NIST CSF), rejected as not measurable**. Before any run, every active SCC is `UNKNOWN`. Sample statement SD-01 (§13.5) is dated today |
| CP1b | 2017-12-01 | First runs: SCC-01, SCC-02, SCC-03 and SCC-06 go **DOWN** → four L3 escalations. Okafor responds to SCC-01 with `REMEDIATE` (due 2018-03-01) |
| CP2 | 2018-03-02 | SCC-01 is still DOWN past its due date. DOWN windows exceed 7 days → **L4** to Morales, with Reyes notified |
| CP3 | 2018-06-04 | New snapshot: 6 of 40 VPN logins from unmanaged devices → AC-02 FAIL, a second cause on SCC-01 |
| CP4 | 2018-09-03 | **Re-evaluation:** Grant requests SCC-02 v2 because most systems moved to SSO. Reyes approves `T-PWDPOLICY` v2 (min 12, systems not behind SSO). **v1 is superseded while down** and keeps its history. One legacy system outside SSO still has min_length=0, **so v2 is DOWN too**. Re-versioning didn't escape the downtime |
| CP5 | 2019-08-16 → 2019-09-05 | New snapshot. NimbusWatch switches monitoring vendor, so Priya submits a new OP-01 collector version → PENDING → **SCC-07 `UNKNOWN`**. On 2019-08-30 (more than 14 days), the L2 item skips Grant and reaches Okafor. The checkpoint script then advances the clock to 2019-09-05, when Reyes approves the collector. The 20 pending days stay UNKNOWN |
| CP6 | 2019-11-19 | `ftp_pass = nimbus123` appears in a public repo → T-SECRETS CRITICAL → SCC-02 v2 gets a second cause and a new L3 |
| CP7 | 2020-06-15 | **Deprecation:** Grant requests deprecation of SCC-05 (change management, attestation only), effective 2020-06-30. Reyes approves. It stays citable for 2017-12-01 to 2020-06-30 |
| CP8 | 2020-10-14 | Monthly availability for September 2020 = 99.71% → SCC-07 DOWN for exactly September → L3 → Okafor responds `DISCLOSE` and generates the NEGATIVE citation. October is ≥ 99.9%, so SCC-07 recovers. Its rolling target (90%) is still met |
| CP9 | 2020-12-14 | Wrap-up: the comparison panel, an audit chain verify, and resolving the quoted citation in sample SD-02 → **recorded 0.0% against a quoted 99%: mismatch** |

### 13.3 SCCs (all owned by P-GRANT)

| SCC | v1 assertion | Pinned controls | Standard: target / rolling window / max single downtime | Evidence |
|---|---|---|---|---|
| SCC-01 | Admin accounts are ≤ 10% of enabled human accounts, none are shared, and remote access comes only from managed devices. | AC-01, AC-02 | 99% / 365 d / 7 d | TESTED |
| SCC-02 | Every system enforces passwords of ≥ 8 characters with complexity, and no credentials are exposed in code repositories. (v2 from CP4: systems not behind SSO enforce ≥ 12 characters; no exposed credentials.) | IA-01, IA-02 | 99% / 365 d / 7 d | TESTED |
| SCC-03 | Every release pipeline runs security scanning and dependency checks before release. | SA-01 | 99% / 365 d / 7 d | TESTED |
| SCC-04 | NimbusWatch follows the NIST Cybersecurity Framework. | — | — (**REJECTED**: not measurable) | — |
| SCC-05 | Changes to production systems are reviewed, approved and monitored. | CM-01 | 95% / 365 d / 30 d | ATTESTED (deprecated 2020-06-30) |
| SCC-06 | MFA is enforced on ≥ 98% of human accounts with remote access. | AC-03 | 99% / 365 d / 7 d | TESTED |
| SCC-07 | Horizon platform availability is ≥ 99.9% each calendar month. | OP-01 | 90% / 365 d / 31 d | TESTED |

### 13.4 Controls and snapshots

**Controls** (all owned by P-PRIYA):

| ID | Name | Check | Frequency |
|---|---|---|---|
| AC-01 | Least privilege | T-LEASTPRIV | 30 days |
| AC-02 | Remote access from managed devices | T-VPNDEVICE | 30 days |
| AC-03 | MFA | T-MFA | 30 days |
| IA-01 | Password policy | T-PWDPOLICY | 30 days |
| IA-02 | No exposed credentials | T-SECRETS | 7 days |
| SA-01 | Secure development lifecycle | T-SDLSCAN | 30 days |
| OP-01 | Platform availability | T-UPTIME | monthly |
| CM-01 | Change management | *(manual)* | 90 days |

**Snapshots** (deterministic, RNG seed 4234):

| Date | Admin share | MFA coverage | Password policy / SSO | Repos | VPN (unmanaged / total) | Pipelines |
|---|---|---|---|---|---|---|
| 2017-12-01 | 72% (150 accts) | 41% | 1 system min_length=0, no complexity; no SSO | Clean | 0 / 0 | `horizon-telemetry.yaml` missing `security_scan` |
| 2018-06-04 | 70% (180) | 52% | Unchanged | Clean | 6 / 40 | Unchanged |
| 2018-09-03 | 70% (185) | 55% | SSO covers 11 of 12 systems; legacy `billing-ftp` outside SSO with min_length=0 | Clean | 5 / 42 | Unchanged |
| 2019-08-16 | 68% (220) | 60% | Unchanged | Clean | 9 / 55 | Unchanged |
| 2019-11-19 | Unchanged | Unchanged | Unchanged | `public/config.ini` has `ftp_pass = nimbus123` | Unchanged | Unchanged |
| 2020-06-15 | 65% (240) | 63% | Unchanged | Unchanged | 7 / 60 | Unchanged |

**Other seed data:**
- **`uptime.json`:** monthly availability from 2017-12 to 2020-11. Every month is ≥ 99.9% (between 99.91% and 99.98%) except **September 2020 = 99.71%**.
- **CM-01 attestations:** continuous 90-day attestations by P-PRIYA from 2017-12-01 to 2020-06-30.

### 13.5 Sample statements (read-only fixtures, not a feature)

Store these as Markdown in `data/sample_statements/`. Render them on a "Sample Statements" page with each citation clickable to resolve.

- **SD-01 — Website Security Statement (2017-12-01).** Five sentences:
  - four citing SCCs in APA style, written as the company drafted them before any run, so with no figures, e.g. `(SCC-01 v1)`;
  - one NIST CSF sentence with the marker *[no SCC: assertion rejected as not measurable]*.
- **SD-02 — Customer security questionnaire (2018-10-01).** Includes a hand-typed citation `(SCC-01 v1, 2018: 99.0% upheld, target 99% met)`. **This is false: resolving it shows 0.0%, target missed.** It shows what a misquote looks like, and that resolving catches it.

---

## 14. API

All routes are at `http://localhost:8000`; CORS allows `http://localhost:5173` only.

Every mutating route checks the active role server-side (header `X-Actor-Id`). If the role isn't allowed, it returns 403 with a plain-English reason and writes nothing.

| Group | Method + path | Purpose |
|---|---|---|
| Clock | `GET /clock` · `POST /clock/set` · `POST /clock/advance` | Each change runs catch-up runs and rebuilds intervals |
| Checkpoints | `GET /checkpoints` · `POST /checkpoints/{id}/goto` · `POST /demo/reset` | |
| Checks (auditor writes) | `GET /checks` · `POST /checks` · `POST /checks/{id}/versions` | |
| Collectors | `GET /collectors` · `POST /collectors/{check_id}/versions` (control owner) · `POST /collectors/{id}/approve` · `POST /collectors/{id}/reject` (auditor) | |
| Controls | `GET /controls` · `POST /checks/run-due` | Latest result, staleness, SCCs affected |
| SCC library | `GET /scc` · `GET /scc/{id}` · `GET /scc/{id}/versions/{v}/timeline?from&to` · `GET /scc/{id}/versions/{v}/sla?from&to` | Responses are filtered by tier |
| Change requests | `GET /change-requests` · `POST /change-requests` (security lead) · `POST /change-requests/{id}/approve` · `POST /change-requests/{id}/reject` (auditor) | |
| Findings | `GET /findings` · `POST /findings/{id}/root-cause-note` | No manual close |
| Escalations | `GET /escalations` · `POST /escalations/{id}/ack` · `POST /escalations/{id}/respond` (committee) | |
| Citations | `POST /citations/generate` · `GET /citations/issued` · `POST /resolve` | `/resolve` is public |
| Samples | `GET /samples` · `GET /samples/{id}` | Read-only fixtures |
| Audit | `GET /audit` · `GET /audit/verify-chain` · `POST /audit/tamper-demo` | |
| Dashboard | `GET /dashboard` · `GET /actors` | |

---

## 15. Frontend screens

| Screen | Main role | Key features |
|---|---|---|
| **SCC Library** | All | One row per SCC: id, title, current state badge, a **timeline bar** across the whole simulated period (green UPHELD, red DOWN, grey UNKNOWN, blank NOT_ACTIVE, with version boundaries marked), rolling uptime against target, and SLA met/missed. Tiers filter what is shown |
| **SCC Detail** | All | Assertion and standard per version; the **version chain** (v1 → v2, with dates, the auditor's reason, and "superseded or deprecated while down" flags); a large timeline; downtime windows (AUDITOR/INTERNAL only); pinned checks and collectors; the **Cite this SCC** panel with a copy button |
| **Resolver** | All, including Public | Paste a citation or pick an SCC, version and period. Shows recorded figures and a match/mismatch verdict against the quoted figures |
| **Sample Statements** | All | SD-01 and SD-02, with clickable citations that resolve inline |
| **Checks & Collectors** | independent_auditor, control_owner | Check definitions and versions (auditor-editable only); collector versions with code hash and approval status; latest runs and staleness |
| **Change Requests** | security_lead, independent_auditor | Submit CREATE, REEVALUATE or DEPRECATE; the auditor's approval queue with required notes; rejected requests visible to the AUDITOR tier |
| **Inbox** | All roles | Escalations for the active role, with "Why you are seeing this" and independence skips; committee response form |
| **Findings** | control_owner | Open/closed, days open, root-cause notes; no close button |
| **Audit Trail** | independent_auditor | Paginated log, verify chain, tamper demo |
| **Oversight Dashboard** | audit_committee | KPI tiles: SCCs by state, SLA missed, open L3/L4 items, pending change requests, pending collectors. A **"Status quo vs With SCC Library"** comparison panel |
| **About** | All | Gap table, framework traceability (§17), non-claims (§1) |

**Sidebar:** persona switcher (including "Public"), checkpoint buttons CP1–CP9 (blue = applied), the current simulated date with +1 day and jump-to-date, Reset, and the guided tour.

**Visual rule:** state colours mean the same on every screen. The SCC timeline bar is the app's main visual; make it large and readable.

---

## 16. Acceptance tests (definition of done)

Write these as `pytest` scenario tests. All must pass.

1. **Determinism:** replaying CP1→CP9 twice from reset produces identical intervals, SLA figures and audit-chain hashes.
2. **No evidence ≠ upheld:** before any run, every ACTIVE SCC is `UNKNOWN`, never `UPHELD`.
3. **Rejected SCC:** SCC-04 has only a REJECTED version. The generator refuses it, and resolve returns `not_citable`.
4. **Catch-up runs:** jumping from CP1b to CP2 executes every scheduled run in between. There are no UNKNOWN gaps caused by the jump alone.
5. **Conservative windows:** every DOWN window has `possibly_since ≤ detected_at`, and the uptime maths uses `possibly_since`.
6. **Immutability:** no API call changes an ACTIVE, SUPERSEDED or DEPRECATED version's assertion, standard or pinned checks. Non-auditor attempts to change checks, collectors or change requests return 403 and write nothing.
7. **Re-evaluation keeps history:** after CP4, SCC-02 v1 is SUPERSEDED, its downtime is unchanged, and it is flagged "superseded while down". v2 starts with no inherited uptime and is DOWN.
8. **No backdating:** a REEVALUATE approval with `active_from` before the decision date is rejected.
9. **Deprecation:** after CP7's effective date, SCC-05 has no new runs. A citation for 2018 generates and resolves; a citation for "to date" or any period after 2020-06-30 is refused.
10. **Collector integrity:** at CP5, SCC-07 is UNKNOWN from 2019-08-16 to 2019-09-05 while the OP-01 collector is PENDING. Approval doesn't change those past UNKNOWN days (history is final).
11. **Direct escalation:** at CP1b, each SCC going DOWN creates an L3 for Okafor immediately, without passing through L2.
12. **Independence skip:** at CP5, the SCC-07 UNKNOWN > 14 days L2 item (raised 2019-08-30) skips Grant and lands at L3, with `independence_skips` recorded.
13. **SLA maths:** at CP9, SCC-07 v1 for 2019-10-01 to 2020-09-30 resolves to about 91.8% upheld, target 90% met, a single 30-day window (within 31). Hand-check the figure in the test.
14. **Citation honesty:** the generated POSITIVE string always contains "target … met" or "target … missed". The resolver flags SD-02's quoted citation as a mismatch (0.0% recorded against 99.0% quoted).
15. **Public tier:** responses to PUBLIC contain no downtime window dates (except when resolving a NEGATIVE citation that names one), no measured values, no root causes and no rejected requests.
16. **Audit chain:** `verify-chain` is valid after the full replay. The tamper demo reports a broken chain on the copy, and the live chain stays valid.
17. **Headline:** at CP9, SCC-01 v1 has 0.0% uptime from 2017-12-01 to 2020-12-14.

---

## 17. Framework traceability (About page)

| Feature | Course concept | Lecture |
|---|---|---|
| SCC library with versions and deprecation | Compliance register; integrated control library | L2 |
| Auditor-owned checks and standards; collector approval | Independent assurance (third line); COBIT Principle 4 (governance distinct from management) | L2, L3 |
| Continuous checks, immutable results, final history | COSO control activities and monitoring activities | L3 |
| SLA target, uptime, max downtime | Risk criteria and tolerance thresholds; key risk monitoring | L2, L5 |
| Escalation straight to the committee; independence skip | Three Lines of Defence; COSO information and communication; board oversight | L2, L3 |
| Citations and resolving | Regulatory interaction framework (who says what externally, and how it is verified) | L2 |
| Hash-chained audit trail | Evidence for internal and external audit | L2, L3 |

---

## 18. Out of scope (present as future work)

- **Drafting or publishing statements.** These are written outside the system; the samples are fixtures only.
- **Malware or intrusion detection, and build-integrity verification** (e.g. reproducible builds). Mention them as complementary technical controls.
- **Real integrations** (identity provider, CI, monitoring) and real authentication.
- **Signed collectors and remote attestation.** The P0 here is code-hash approval only.
- **Auditor spot checks** (P1, §6) and logging every resolve call (P1, §12).
- **Automatic extraction of assertions from documents** using NLP.

---

## 19. Running it

```bash
uv sync && uv run python seed.py
cd frontend && npm install && cd ..
make backend    # uvicorn :8000
make frontend   # vite :5173
uv run pytest   # all §16 scenarios
```

Open http://localhost:5173. Start at Reset → CP1 and follow the guided tour.
