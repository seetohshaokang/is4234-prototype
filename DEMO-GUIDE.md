# Disclosure Gate — Demo Guide

## What this prototype is

A simulation of a **disclosure control gate**: a checkpoint between a company's internal
security evidence (control test results, findings, incidents) and the security claims it
publishes publicly. Before a claim can go out — and continuously after — the gate asks:
*does the evidence actually support this claim?*

If a mapped control is failing, untested, or has an open HIGH/CRITICAL finding, the claim
is **BLOCKED**. Blocked claims can only proceed via a **documented exception** (an override
or an approved risk acceptance), both of which expire and are logged.

This is a **proof of concept** built around the NimbusWatch case study (2017–2020,
modelled on SolarWinds, 100% synthetic data). The checkpoints follow that company's
timeline; the actions you can take between them show how a production version would
behave. Its point: the gate surfaces contradictions between what a company says
publicly and what it knows internally — years before an incident forces the issue.

## The mental model: story spine + your injections

```
CP1 ──► [you inject variables] ──► CP2 ──► [you inject variables] ──► CP3 ──► ...
         ↑ engine reacts                     ↑ engine reacts
```

- **Checkpoints (CP1–CP9)** are scripted story beats — deterministic events on a timeline.
- **Your injections** are actions you take between beats: report findings, grant
  overrides, publish claims, jump time forward, etc.
- **The rules engine is the invariant.** Whether evidence arrives via a checkpoint or via
  you, the same rules re-evaluate every claim, age every finding, and fire escalations.

Click a checkpoint button to jump to that point in the story. Applied checkpoints turn
blue. Jumping **forward** keeps your injections; jumping **backward** rebuilds the story
from scratch (your injections are lost — see "Reset" note below).

## Quick start

```bash
make backend     # FastAPI on :8000   (terminal 1)
make frontend    # Vite dev on :5173  (terminal 2)
```

Open http://localhost:5173. Pick a role in the sidebar ("Active role") — what you're
allowed to do depends on who you are.

## Controls on the story

| Control | Where | What it does |
|---|---|---|
| CP buttons | Sidebar | Jump to a story point. Forward fills in skipped beats; backward replays the story. |
| Reset | Sidebar, "Checkpoints" header | Wipe everything back to before CP1 (2017-11-15). |
| +1 day | Sidebar, "Sim date" | Advance the clock one day (ages findings, expires overrides). |
| Jump (date) | Sidebar, "Sim date" | Jump the clock to any date — re-runs tests & re-evaluates claims. |

> **Important:** jumping backward replays only *scripted* events. Anything you injected —
> overrides, findings, approvals — is gone. The story is deterministic; your edits are not
> saved history.

## Variables you can inject

### Evidence — change what the gate sees

| Action | Where | Engine effect |
|---|---|---|
| Report finding | Findings → "Report Finding" | Open HIGH/CRITICAL finding blocks mapped claims (rule R3) and starts escalation ageing |
| Run all tests | Control Tests / Dashboard → "Run all" | Re-tests all controls against current evidence; FAILs auto-open findings |
| Close finding | Findings → Close | Removes the block; ends that finding's escalation chain |
| Propose risk acceptance | Findings → expand a finding → Risk | Creates a PENDING exception with rationale + expiry |
| Approve risk acceptance | Same panel → Approve | APPROVED RA satisfies the gate — the documented way through a BLOCK |

### Gate & claims — change verdicts / lifecycle

| Action | Where | Engine effect |
|---|---|---|
| Create override | Gate Review → expand a claim → Create Override | BLOCK → ESCALATE (R8). Independence enforced: the claim's owner is rejected. Expires on a date you set. |
| Publish claim | Claim Registry → expand → Publish | Blocked claims refuse to publish. Published claims raise escalation stakes on their controls. |
| Withdraw claim | Claim Registry → expand → Withdraw | Pulls a published claim back |

### Workflow — act on the consequences

| Action | Where | Effect |
|---|---|---|
| Ack / Resolve escalation | Escalations → Your Inbox | Records handling of an escalation (must be assigned to your current role) |
| Tamper demo | Audit Trail → "Tamper Demo" | Corrupts a copy of the audit log; the hash chain detects it |
| Verify chain | Audit Trail → "Verify Chain" | Re-checks integrity of the real log |

## Roles

| Person | Role | What to use them for |
|---|---|---|
| Priya N. | control_owner | Report findings, fix/close them |
| T. Grant | security_lead | Owns the claims — note he **cannot** override his own claims |
| Dana L. | claim_author | Drafts claims |
| M. Okafor | disclosure_committee | Create overrides, approve risk acceptances |
| R. Chen | disclosure_committee | Same as Okafor |
| S. Ibrahim | internal_audit | Audit Trail: verify chain, tamper demo |
| J. Morales | audit_committee | Receives L4 escalations |
| Leo K. | control_owner | Second control owner (SA-01, IA-02, CM-01) |

## Suggested injections per checkpoint

| After clicking | Try injecting | Watch |
|---|---|---|
| CP1 | Create an override on C-01 as **T. Grant** → rejected (independence). Then as **M. Okafor** → allowed | Gate Review: BLOCK → ESCALATE |
| CP1b | Report a CRITICAL finding on IA-02 (No Exposed Credentials) as Priya | C-02 re-blocks; Escalations starts an L1 |
| CP2 | — (scripted: the override expires on its own) | C-01 snaps back to BLOCK |
| CP3 | Propose a risk acceptance on F-2018-VPN; approve it as Okafor | Documented exception path vs override |
| CP4 | Ack the L4 escalation as J. Morales | Inbox records acknowledgement |
| CP5 | Close the new AC-01 finding as Priya, then re-open the story by jumping the clock | Watch claims unblock/re-block |
| CP6 | Try to publish C-02 | Gate refuses — "BLOCKED with no active override" |
| CP7 / CP8 | Jump the sim date +90 days | Escalations pile up to L4 |
| CP9 | Tamper Demo → then Verify Chain | Chain detects corruption on the copy; real chain stays valid |

## Expected outcomes — the gist

When you inject a variable, the engine should react like this. If it doesn't, something
is wrong:

| You inject | Expected result |
|---|---|
| Finding, severity HIGH or CRITICAL, on a control mapped to a claim | Claim → **BLOCK** (rule R3); an L1 escalation opens |
| Finding, severity MEDIUM, on a mapped control | Claim → **ESCALATE** (rule R5) |
| Finding on an unmapped/no-claim control | No verdict change — finding just sits open and ages |
| Close the finding | R3 block lifts; claim returns to whatever other rules say |
| Risk acceptance PROPOSED on the blocking finding | Still **BLOCK** — unapproved exceptions don't count (R6) |
| Risk acceptance APPROVED | BLOCK → **ESCALATE** (R7), never APPROVE — the committee's risk decision is documented but still visible |
| Override on a BLOCKED claim | BLOCK → **ESCALATE** (R8), never APPROVE — overrides buy time, not absolution |
| Override by the claim's owner | **Rejected** — "Independence rule" error |
| Publish a BLOCKED claim | **Rejected** — "Cannot publish: claim is BLOCKED with no active override" |
| Publish an APPROVE claim | Status → published; its controls' findings now escalate via the published-claim path |
| Clock jump past finding age 30/60/90 days | Escalations appear at L2/L3/L4 respectively |
| Override expiry date passes | Override → EXPIRED; claim snaps back to its real verdict |

One subtlety worth knowing: a claim can be blocked by **more than one rule**. Accepting a
finding's risk (R3→R7) does nothing for a claim that is *also* blocked by a failing test
(R2) — e.g. approving an RA on the AC-01 finding leaves C-01 BLOCK, because AC-01's test
still fails. The audit page shows every rule that fired, so always check which rules are
holding a claim down.

## Manual verification checklist

Run these in order to confirm the app works end-to-end. Start from
**Sidebar → Checkpoints → Reset** unless told otherwise.

### V1 — Story spine works both directions
1. Click **CP3**. Expect: sim date `2018-06-04`; CP1–CP3 buttons blue; finding
   `F-2018-VPN` exists on the Findings page.
2. Click **CP1**. Expect: sim date rewinds to `2017-12-01`; only CP1 blue;
   `F-2018-VPN` is gone.
3. Click **CP9**, then **CP1** again. Expect: full apply then full rewind — no errors,
   Findings returns to the 3 seed findings (`F-2017-001`–`003`).

### V2 — Gate evaluates evidence correctly (at CP1)
After clicking **CP1**, check Claim Registry / Gate Review. Expected verdicts:
- C-01, C-02, C-03 → **BLOCK** (failing tests + open findings — rules R2/R3)
- C-04 → **ESCALATE** (no control mapped — rule R0)
- C-05 → **APPROVE** (manual evidence covers CM-01)
- Findings page shows exactly 3 open HIGH findings (AC-01, IA-01, SA-01).

### V3 — Override + independence rule
1. Stay at CP1. As **T. Grant**, Gate Review → expand C-01 → Create Override → submit
   (reason ≥ 50 chars, any future expiry). Expect: **rejected** — "Independence rule:
   P-GRANT owns C-01 and cannot override it."
2. Switch to **M. Okafor**, submit the same override. Expect: created; C-01 verdict
   BLOCK → **ESCALATE** (rule R8).
3. Click **CP2**. Expect: the override auto-expires; C-01 returns to **BLOCK**.

### V4 — Finding injection drives the engine
1. Anywhere in the story: Findings → Report Finding → control **CM-01**, severity
   HIGH, submit.
2. Check C-05. Expect: APPROVE → **BLOCK** (R3).
3. Escalations: an L1 escalation for the new finding is assigned to its owner.

### V5 — Risk acceptance is the documented escape
1. On the injected CM-01 finding: expand → propose a risk acceptance (any rationale +
   future expiry). Expect: C-05 still **BLOCK** (R6 — proposed ≠ approved).
2. Approve it as **M. Okafor**. Expect: C-05 → **ESCALATE** (R7).
3. Close the finding as Priya. Expect: C-05 → **APPROVE**.

### V6 — Publish guard
1. At CP1, expand C-01 in Claim Registry → Publish.
   Expect: rejected — "claim is BLOCKED with no active override".
2. Publish C-05 (when APPROVE). Expect: succeeds; status → published.

### V7 — Escalation ageing
1. After CP3 (F-2018-VPN open): Jump the clock to `2018-09-10`.
   Expect: an **L4** escalation reaches J. Morales's inbox (Audit Committee).

### V8 — Audit chain is tamper-evident
1. Audit Trail → **Verify Chain**. Expect: "Chain is valid".
2. **Tamper Demo**. Expect: "Tamper detected — chain broke at sequence N".
3. **Verify Chain** again. Expect: still valid — the demo corrupted a *copy*.

### V9 — Time injection
1. Sidebar → Jump to `2020-01-01`. Expect: sim date changes; controls re-test
   against the latest snapshot ≤ that date; stale test badges appear.

## What this prototype deliberately does not do

It is a **governance** control, not malware detection. In the SolarWinds analogy, it would
not have caught the SUNBURST build compromise itself — it would have caught the company
*publishing claims it knew to be false* while incidents were already unfolding. See the
About page in the app.
