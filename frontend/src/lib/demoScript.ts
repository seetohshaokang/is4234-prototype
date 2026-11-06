/**
 * Guided demo script — a step-by-step walkthrough of the SCC Library app.
 *
 * Entering a step navigates the app to the page it describes (`nav`), so the
 * user is always looking at the screen being explained. The seeded world is a
 * finished timeline (sim date 2020-12-14): SCC-07 is DOWN right now — the one
 * live failure to explore — with its case open on the Cases page.
 *
 * Fields:
 *   nav      — route the app jumps to when this step opens
 *   story    — what you're looking at
 *   gate     — what you can change on this screen
 *   tries    — suggested exercises (nav jumps within the step's section)
 *   takeaway — why this piece exists
 */

export interface DemoTry {
  label: string;
  nav?: string; // optional page to jump to for this action
  hint?: string;
}

export interface DemoStep {
  cp?: string;      // checkpoint applied when this step is entered (unused)
  nav?: string;     // route to open when this step is entered
  title: string;
  date: string;     // short tag shown top-right of the step
  story: string;    // what you're looking at
  gate: string;     // what you can change on this screen
  tries: DemoTry[]; // suggested exercises
  takeaway: string; // the "so what"
}

export const DEMO_STEPS: DemoStep[] = [
  {
    title: "How to use this guide",
    date: "Intro",
    nav: "/sccs",
    story:
      "The SCC Library tracks security assertions the way SLAs track uptime: each Security Citation Code is a measurable claim ('admin accounts are under 10%', 'every completed month ≥ 99.9% availability') with its state computed from evidence — not declared by anyone. The data is inspired by the SolarWinds case and 100% synthetic.",
    gate:
      "Each step jumps you to the page it explains — you're on the Library now. The persona switcher at the bottom of the sidebar decides your role; buttons and permissions follow it.",
    tries: [
      { label: "Watch the persona switcher as you go — it changes what you're allowed to touch" },
    ],
    takeaway:
      "A claim isn't believed or disbelieved here — it's measured, and the measurement is always on display.",
  },
  {
    title: "The Library — the claims themselves",
    date: "This page",
    nav: "/sccs",
    story:
      "One row per assertion. Read Current State against Rolling Uptime %: state is what the claim is right now, while the percentage is the share of its whole tracked life spent UPHELD — that's why they can disagree. SCC-07 is DOWN today yet its 94.6% is still the library's best: it spent almost three years fully green before September 2020's 99.71% broke the every-month rule — and a failed month never leaves the record, so every check since has failed too. Meanwhile SCC-01/02/03 read UPHELD on ~3% — passing right now, after spending almost their entire record failing.",
    gate:
      "This page is read-only — deliberately. Nobody edits a claim's state directly; states are computed from evidence. What you can change is which row you open to inspect.",
    tries: [
      { label: "Open SCC-07 — the only claim failing right now", nav: "/sccs/SCC-07" },
      { label: "Notice SCC-04 is missing entirely — the auditor rejected it as unmeasurable at creation" },
    ],
    takeaway:
      "State is a snapshot; uptime is the résumé. You can fail today with a clean history — or pass today after years of lying.",
  },
  {
    title: "SCC detail — a claim you can watch failing",
    date: "This page",
    nav: "/sccs/SCC-07",
    story:
      "Everything about one assertion: the exact wording, the version chain, a day-by-day uptime heatmap, and state intervals with cause notes. SCC-07's rule is ≥99.9% in each completed month — September 2020 came in at 99.71%, so the claim went DOWN on Oct-16 and can't recover — the check re-reads every completed month, and the bad one is permanent. That's why 2020 turns red mid-October and every year after is a solid red wall.",
    gate:
      "Also read-only — it's the record. But watch what it records: when a claim is reworded, a new version starts and the old one keeps its history — including whether it was failing when it was replaced.",
    tries: [
      { label: "Open SCC-02 — v1 is SUPERSEDED and carries the permanent red 'superseded while DOWN' flag", nav: "/sccs/SCC-02" },
      { label: "Open SCC-05 — DEPRECATED: a wall of grey, UNKNOWN its whole life — an attestation that was never measurable", nav: "/sccs/SCC-05" },
    ],
    takeaway:
      "Versioning lets claims evolve honestly — you can change the wording, never the track record.",
  },
  {
    title: "Security Checks — where evidence comes from",
    date: "This page",
    nav: "/checks",
    story:
      "Checks are the automated tests behind each control: a threshold, a cadence, a data source. Open T-UPTIME — its latest result is the FAIL that keeps SCC-07 DOWN: the availability rule requires every completed month at 99.9%, September's 99.71% never leaves the record, so every run since has failed.",
    gate:
      "Nothing here is editable — checks and collectors are the measurement machinery, fixed by the auditor's approval, not by the team being measured.",
    tries: [
      { label: "Open T-UPTIME → read the pass rule and the failing September value" },
      { label: "Compare T-VPNDEVICE and T-LEASTPRIV — the checks that kept SCC-01 down for years before passing in November" },
    ],
    takeaway:
      "Claims rest on checkable measurements — and no one can quietly swap in a friendlier ruler.",
  },
  {
    title: "Change Requests — editing the library properly",
    date: "This page",
    nav: "/changes",
    story:
      "Every change to the library is a formal request: CREATE a new version, REEVALUATE an existing one, DEPRECATE it. Observe who's allowed to do what — the security lead proposes, but only the independent auditor (Meridian Assurance Group) decides.",
    gate:
      "Read the decisions on record: SCC-04's CREATE was REJECTED as unmeasurable, SCC-05's DEPRECATE was approved with a future effective date, and SCC-02's REEVALUATE produced v2 — which immediately failed on its own evidence.",
    tries: [
      { label: "Read the SCC-04 rejection note — 'NIST CSF adherence' refused because it can't be measured" },
      { label: "Find CR-SCC-05-DEPRECATE — a retirement scheduled in advance, not a quiet deletion" },
    ],
    takeaway:
      "Whoever owns the claim can never approve their own edit — independence isn't a policy here, it's the workflow.",
  },
  {
    title: "Cases — failures become owned work",
    date: "This page",
    nav: "/findings",
    story:
      "When a check fails, a case opens by itself; when it passes again, the case closes by itself. CASE_2020_007 is OPEN right now — it's the availability failure, and it's exactly why SCC-07 shows DOWN in the Library: the case is the claim's red badge made into work.",
    gate:
      "Open a case to work it: change its status, add a note, raise its escalation level. Watch what happens when you set one IN_REVIEW — an L1 escalation fires to the control owner automatically. Who can do what depends on your persona: the control owner and security lead work cases, only the security lead can push to L3, and closing as a false alarm needs a written reason. The Audit Committee and Meridian only read.",
    tries: [
      { label: "Open CASE_2020_007 → 'Pick up' → IN_REVIEW → check Escalations for the L1 that just fired", nav: "/findings/CASE_2020_007" },
      { label: "Inspect CASE_2019_006 — a CRITICAL case mid-review (a credential found in a public repo)", nav: "/findings/CASE_2019_006" },
    ],
    takeaway:
      "Cases aren't filed by people arguing something went wrong — the evidence opens them, and closing requires the evidence to pass again.",
  },
  {
    title: "Escalations — forcing a decision",
    date: "This page",
    nav: "/escalations",
    story:
      "Work that isn't getting handled climbs: L1 goes to the control owner, L2 to the security lead, L3 to the disclosure committee. Observe the open items on this page — each one is a demand for someone's attention or decision, tied to a live case.",
    gate:
      "You can only acknowledge items routed to your role — and at L3, the disclosure committee responds with a formal decision (REMEDIATE, STOP_CITING, REQUEST_REEVALUATION or DISCLOSE) plus a written rationale that goes on the permanent record.",
    tries: [
      { label: "Switch to Disclosure Committee → respond to the open L3 with a decision + rationale" },
      { label: "Or switch to Security Lead and on CASE_2019_006 raise its level to L3 — the old demand moves to Closed and a new one arrives: the closed list records the climb", nav: "/findings/CASE_2019_006" },
    ],
    takeaway:
      "Escalation isn't a notification that gets ignored — at the top level, someone with authority has to write down a decision.",
  },
  {
    title: "Audit Trail — nothing is forgotten",
    date: "This page",
    nav: "/audit",
    story:
      "Every action in the app is appended to a hash-chained event log: activations, approvals, status changes, committee decisions — including the ones you just made.",
    gate:
      "Nothing here is editable — that's the point. The one thing you can do is Verify Chain, which re-walks every hash link and would report the first tampered entry.",
    tries: [
      { label: "Hit Verify Chain → confirm 'valid'" },
      { label: "Scroll and find your own actions from this session, sealed in order" },
    ],
    takeaway:
      "Governance needs a memory that can't be quietly edited — if anyone rewrites history, the chain breaks.",
  },
  {
    title: "Wrap-up — the loop and the limit",
    date: "Done",
    nav: "/about",
    story:
      "You've seen the full loop: evidence → checks → states → cases → escalations → governance. Each persona owns exactly one job in it. The API also exposes citations — tamper-evident statements of a claim's uptime for a period — plus a resolver that checks quoted figures against the record (see /api/docs).",
    gate:
      "One last observation: switch to Public (no role) and watch the sidebar shrink — that's the external stakeholder's view. Everything else is internal governance.",
    tries: [
      { label: "Switch to Public → navigate around — notice what an outsider can see vs insiders" },
      { label: "Read the limitation panel on this page before you demo it", nav: "/about" },
    ],
    takeaway:
      "This governs claims, not malware — it wouldn't catch a SUNBURST, but it would make false statements visible. SCC-07 is still DOWN as you leave: the record doesn't forget.",
  },
];
