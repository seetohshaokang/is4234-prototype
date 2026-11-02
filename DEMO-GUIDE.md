# Disclosure Gate — Demo Guide

## What this prototype is

A simulation of a **disclosure control gate**: a checkpoint between a company's internal
security evidence (control test results, findings, incidents) and the security claims it
publishes publicly. Before a claim can go out — and continuously after — the gate asks:
*does the evidence actually support this claim?*

If a mapped control is failing, untested, or has an open HIGH/CRITICAL finding, the claim
is **BLOCKED**. Blocked claims can only proceed via a **documented exception** (an override
or an approved risk acceptance), both of which expire and are logged.

The demo replays a fictional company ("NimbusWatch") across 2017–2020, modelled on the
SolarWinds case, using 100% synthetic data. Its point: the gate surfaces contradictions
between what a company says publicly and what it knows internally — years before an
incident forces the issue.

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
| Create override | Gate Review | BLOCK → ESCALATE (R8). Independence enforced: the claim's owner cannot override it. Expires on a date you set. |
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

## What this prototype deliberately does not do

It is a **governance** control, not malware detection. In the SolarWinds analogy, it would
not have caught the SUNBURST build compromise itself — it would have caught the company
*publishing claims it knew to be false* while incidents were already unfolding. See the
About page in the app.
