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
  nav?: string;
}

export interface DemoStep {
  cp?: string;
  nav?: string;
  title: string;
  date: string;
  story: string;
  gate: string;
  tries: DemoTry[];
  takeaway: string;
}

export const DEMO_STEPS: DemoStep[] = [
  {
    title: "How to use this guide",
    date: "Intro",
    nav: "/sccs",
    story:
      "This guided demo walks the SolarWinds case study checkpoint by checkpoint — from December 2017 (the first security claims are drafted) to December 2020 (the breach becomes public). At each stop you'll see what happened, what the SCC Library recorded, and things to explore.",
    gate:
      "Nothing is locked — the app stays fully interactive at every step. Explore each page, then press Next when ready.",
    tries: [
      { label: "Open the SCC Library for the current overview", nav: "/sccs" },
      { label: "Or just press Next to start the story at CP1" },
    ],
    takeaway:
      "Checkpoints move the story forward; everything else is you acting as one of the personas — the system reacts the same either way.",
  },
  {
    cp: "CP1",
    title: "CP1 — SCCs drafted, checks run, first failures",
    date: "2017-12-01",
    story:
      "Marcus Tan (Security Lead) submits CREATE change requests for SCC-01 through SCC-07. David Ng (External Auditor) approves six of them — and rejects SCC-04 as 'not measurable'. The first automated checks run immediately.",
    gate:
      "Three checks fail straight away: T-LEASTPRIV (access control), T-PWDPOLICY (password policy), and T-SDLSCAN (secure SDLC). The affected SCCs go DOWN and findings open automatically.",
    tries: [
      { label: "SCC Library → see which SCCs are UPHELD vs DOWN", nav: "/sccs" },
      { label: "Change Requests → see the approved and rejected CRs from CP1", nav: "/changes" },
      { label: "Cases → three findings already open from the failed checks", nav: "/findings" },
      { label: "Security Checks → see the evidence behind each check result", nav: "/checks" },
    ],
    takeaway:
      "The moment checks are wired to SCC versions, false 'all-green' claims become impossible — the library reflects what the evidence actually says.",
  },
  {
    cp: "CP1b",
    title: "CP1b — Findings are live objects, escalations fire",
    date: "2017-12-01",
    story:
      "The failed checks didn't just produce a report — three HIGH findings are now open and escalations have already fired to the control owner (L1) and security lead (L2).",
    gate:
      "Open findings keep their mapped SCCs DOWN. Escalations route around conflicts of interest — the person who filed the finding, or who owns the affected SCC, is bypassed.",
    tries: [
      { label: "Escalations → see the open L2 escalations", nav: "/escalations" },
      { label: "Click 'View case →' on an escalation to open the case panel", nav: "/escalations" },
      { label: "Cases → pick up a case, add a note as Priya Nair (DevSecOps)", nav: "/findings" },
    ],
    takeaway:
      "Escalations arrive automatically — nobody chose to flag the problem. The routing also enforces independence: the owner of a failing SCC can't quietly handle its own alarm.",
  },
  {
    cp: "CP2",
    title: "CP2 — 90 days open, escalation reaches committee level",
    date: "2018-03-02",
    story:
      "SCC-01 has been DOWN for over 90 days with no resolution. Time-based escalation rules push the case to L3 — it now requires the Disclosure Committee's attention.",
    gate:
      "The escalation landed in Rachel Lim's (CFO / Disclosure Committee) inbox. Nobody had to decide to escalate — not resolving the finding is itself the trigger.",
    tries: [
      { label: "Escalations → see the L3 escalation that accumulated", nav: "/escalations" },
      { label: "Switch persona to Rachel Lim → open the case panel → Acknowledge", nav: "/escalations" },
    ],
    takeaway:
      "Oversight arrives on a timer. The longer a problem sits unresolved, the higher up it climbs — automatically.",
  },
  {
    cp: "CP3",
    title: "CP3 — VPN gap detected",
    date: "2018-06-04",
    story:
      "A new network snapshot shows six unmanaged devices connecting to the corporate VPN. T-VPNDEVICE fails. A new finding opens on AC-02, pulling SCC-01 further DOWN.",
    gate:
      "SCC-01 now has two independent reasons to be DOWN: the original access control failure and the new VPN gap. Each is tracked separately.",
    tries: [
      { label: "SCC Library → click SCC-01 to see its state timeline", nav: "/sccs" },
      { label: "Cases → see the new VPN finding alongside the existing ones", nav: "/findings" },
    ],
    takeaway:
      "Multiple independent failures stack — closing one finding doesn't flip the SCC back to UPHELD if another is still open.",
  },
  {
    cp: "CP4",
    title: "CP4 — SCC-02 revised: SSO transition",
    date: "2018-09-03",
    story:
      "Most systems have moved to SSO. Marcus Tan submits a REVISION change request for SCC-02 — the password policy standard should now only apply to non-SSO systems. David Ng approves it.",
    gate:
      "SCC-02 v1 is superseded and a new v2 goes ACTIVE. The revision is on the record: who proposed it, who approved it, and why.",
    tries: [
      { label: "Change Requests → find the REVISION CR for SCC-02", nav: "/changes" },
      { label: "SCC Library → click SCC-02 → see v1 (SUPERSEDED) and v2 (ACTIVE)", nav: "/sccs" },
    ],
    takeaway:
      "Versioning means the old assertion stays on the record. Auditors can always see what was claimed, when it changed, and who approved it.",
  },
  {
    cp: "CP5",
    title: "CP5 — New uptime collector under review",
    date: "2019-08-16",
    story:
      "Priya Nair submits a new OP-01 collector script (v2) after a vendor switch. While it awaits David Ng's approval, SCC-07 flips to UNKNOWN — it cannot be UPHELD without an approved measurement tool.",
    gate:
      "UNKNOWN is distinct from DOWN: the SCC isn't failing, but it can't be verified. David Ng reviews and approves the collector on 2019-09-05, restoring SCC-07 to UPHELD.",
    tries: [
      { label: "Security Checks → find T-UPTIME and its collector status", nav: "/checks" },
      { label: "SCC Library → see SCC-07 in UNKNOWN state", nav: "/sccs" },
    ],
    takeaway:
      "The measurement tool itself is under governance. An unapproved collector means no valid evidence — and no UPHELD claim.",
  },
  {
    cp: "CP6",
    title: "CP6 — Password found in public repo",
    date: "2019-11-19",
    story:
      "The secrets scanner finds 'ftp_pass = nimbus123' committed to a public repository. T-SECRETS fires a CRITICAL finding. SCC-02 v2 goes DOWN — the revised password standard is now contradicted by a critical exposure.",
    gate:
      "A CRITICAL finding opens immediately. Even though SCC-02 was recently revised to be more precise, the new evidence directly contradicts it.",
    tries: [
      { label: "Cases → find the CRITICAL secrets finding", nav: "/findings" },
      { label: "SCC Library → see SCC-02 v2 flip from UPHELD to DOWN", nav: "/sccs" },
      { label: "Audit Trail → find the check_run entry for T-SECRETS", nav: "/audit" },
    ],
    takeaway:
      "Revising the standard doesn't help if the evidence contradicts even the tighter version. The library tracks both.",
  },
  {
    cp: "CP7",
    title: "CP7 — SCC-05 deprecated",
    date: "2020-06-15",
    story:
      "Marcus Tan requests to deprecate SCC-05 (configuration management attestation). The company is no longer maintaining it as a formal SCC. David Ng approves, effective 2020-06-30.",
    gate:
      "SCC-05 goes NOT_ACTIVE from the effective date. It remains on the record as DEPRECATED — citable for periods ending on or before 2020-06-30, but no longer an active claim.",
    tries: [
      { label: "Change Requests → find the DEPRECATE CR for SCC-05", nav: "/changes" },
      { label: "SCC Library → see SCC-05 listed as NOT_ACTIVE", nav: "/sccs" },
    ],
    takeaway:
      "Deprecation is an auditable act — the why, who, and when are recorded. The historical record is preserved even after the SCC is retired.",
  },
  {
    cp: "CP8",
    title: "CP8 — Availability drops below target",
    date: "2020-10-14",
    story:
      "September 2020 availability is measured below the rolling target. SCC-07 flips DOWN for the September window. The case study is approaching its end.",
    gate:
      "The uptime interval is recorded with the precise measurement. SCC states are computed from evidence — not from someone's judgement.",
    tries: [
      { label: "SCC Library → click SCC-07 → inspect the state timeline chart", nav: "/sccs" },
      { label: "Cases → see any findings that opened from the availability breach", nav: "/findings" },
    ],
    takeaway:
      "When the numbers move, the state follows automatically. No one had to decide SCC-07 was failing — the evidence decided.",
  },
  {
    cp: "CP9",
    title: "CP9 — Wrap-up: what the library recorded",
    date: "2020-12-14",
    story:
      "The SolarWinds breach became public in December 2020. Looking back: from the moment the first checks ran in December 2017, the library had a continuous, tamper-evident record of which SCCs were UPHELD, which were DOWN, and why.",
    gate:
      "Every state change, finding, escalation, change request, and approval is in the audit trail — hash-chained so no entry can be silently altered.",
    tries: [
      { label: "Audit Trail → scroll through the full timeline of events", nav: "/audit" },
      { label: "SCC Library → compare which SCCs ended UPHELD vs DOWN by December 2020", nav: "/sccs" },
      { label: "Switch to David Ng (External Auditor) → try creating or revising an SCC", nav: "/sccs" },
    ],
    takeaway:
      "The library doesn't prevent breaches — it makes it impossible to claim 'we didn't know'. Every contradiction between claims and evidence was recorded as it happened.",
  },
];
