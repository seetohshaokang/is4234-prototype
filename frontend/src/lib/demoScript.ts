export interface DemoTry {
  label: string;
  nav?: string; // optional page to jump to for this action
  hint?: string;
}

export interface DemoStep {
  cp?: string;      // checkpoint applied when this step is entered
  title: string;
  date: string;
  story: string;    // what just happened in the case study
  gate: string;     // what the gate did about it
  tries: DemoTry[]; // suggested things for the user to play with
  takeaway: string; // the "so what"
}

export const DEMO_STEPS: DemoStep[] = [
  {
    title: "Welcome — how this works",
    date: "Before the story",
    story:
      "This guided demo walks the NimbusWatch case study checkpoint by checkpoint. At each stop you'll see what happened, what the gate caught, and a few things to play around with.",
    gate:
      "Nothing blocks you — the app stays fully interactive. Explore each page, inject events, then press Next when ready.",
    tries: [
      { label: "Open the Dashboard for the current overview", nav: "/" },
      { label: "Or just press Next to start the story (CP1)" },
    ],
    takeaway:
      "Rule of thumb: checkpoints move the story; everything else is you injecting — the engine reacts the same either way.",
  },
  {
    cp: "CP1",
    title: "CP1 — Claims drafted, first tests fail",
    date: "2017-12-01",
    story:
      "Five security claims are drafted for the public website. The gate runs its first evidence tests — and AC-01 (least privilege), IA-01 (password policy) and SA-01 (secure SDLC) all FAIL.",
    gate:
      "C-01, C-02, C-03 are BLOCKED by failing tests and auto-opened findings. C-04 is ESCALATE (no control mapped). Only C-05 approves, covered by manual evidence.",
    tries: [
      {
        label: "Try to override C-01 as T. Grant — watch it get rejected (he owns the claim)",
        nav: "/gate",
      },
      {
        label: "Switch role to M. Okafor, retry the override — it succeeds (BLOCK → ESCALATE)",
      },
      { label: "Check the 3 auto-opened findings", nav: "/findings" },
    ],
    takeaway:
      "In the real case, claims like this went public anyway. Here they can't get past the gate without a documented, independent exception.",
  },
  {
    cp: "CP1b",
    title: "CP1b — Findings are now live objects",
    date: "2017-12-01",
    story:
      "The failed tests didn't just produce a report — three HIGH findings are now open, and escalations have already fired to the control owner (L1) and security lead (L2).",
    gate:
      "Open findings block their mapped claims (rule R3) and start ageing toward higher escalation levels.",
    tries: [
      {
        label:
          "Escalations → note F-2017-003 has TWO L2 rows: one is its L1 bumped up — Priya raised the finding and Leo owns it, so every control owner was conflicted (independence skip); the other is the normal L2 to Grant",
        nav: "/escalations",
      },
      {
        label: "Compare F-2017-001/002: their L1 went to Leo because only Priya was conflicted",
        nav: "/escalations",
      },
      {
        label: "Findings → expand one → propose a risk acceptance; approve it as M. Okafor",
        nav: "/findings",
      },
    ],
    takeaway:
      "Escalations route around conflicts of interest: whoever raised or owns the problem never gets to quietly handle its alarm.",
  },
  {
    cp: "CP2",
    title: "CP2 — The override expires",
    date: "2018-03-02",
    story:
      "Time passes. Whatever override was granted on C-01 reaches its expiry date.",
    gate:
      "Expired overrides lose their effect — C-01 snaps straight back to BLOCK. Nothing needed to 'decide' to re-block it; the exception was time-boxed.",
    tries: [
      { label: "Gate Review → watch C-01's verdict flip back to BLOCK", nav: "/gate" },
      {
        label: "Make your own override with a short expiry, then Jump the clock past it and watch it expire",
      },
    ],
    takeaway:
      "Overrides buy time, not absolution — every exception has a sunset and the gate enforces it.",
  },
  {
    cp: "CP3",
    title: "CP3 — The VPN gap is reported",
    date: "2018-06-04",
    story:
      "An engineer reports that unmanaged devices can connect to the corporate VPN — finding F-2018-VPN opens on AC-02.",
    gate:
      "The escalation routing skips T. Grant entirely — he owns the affected claims, so the 'independence skip' sends it around him instead of to him.",
    tries: [
      {
        label: "Escalations → find the 'Independence skip' note — that's the routing bypassing Grant",
        nav: "/escalations",
      },
      { label: "Report your own finding on any control and watch its claim re-block", nav: "/findings" },
    ],
    takeaway:
      "The escalation path routes around the person with the most reason to bury the finding.",
  },
  {
    cp: "CP4",
    title: "CP4 — 90 days, still no fix",
    date: "2018-09-03",
    story:
      "The VPN finding has sat unresolved for over 90 days.",
    gate:
      "Automatic ageing pushes the escalation to L4 — it lands in the Audit Committee chair's inbox (J. Morales).",
    tries: [
      {
        label: "Switch role to J. Morales → Escalations → Your Inbox → Ack the L4",
        nav: "/escalations",
      },
      { label: "Try +1 day or Jump on other findings and watch them climb L1→L4" },
    ],
    takeaway:
      "Oversight arrives on a timer — nobody had to choose to escalate; not fixing things is itself the trigger.",
  },
  {
    cp: "CP5",
    title: "CP5 — Internal review confirms the problem",
    date: "2019-08-16",
    story:
      "A quarterly access review concludes: access to critical systems is inappropriate. A new HIGH finding opens on AC-01.",
    gate:
      "The claim stays blocked — and now there are two independent reasons (the failing test AND the review finding).",
    tries: [
      {
        label: "Close the AC-01 finding as Priya — notice C-01 stays BLOCK: the failing test result still holds",
        nav: "/findings",
      },
    ],
    takeaway:
      "Closing the paperwork doesn't fix the evidence — findings and test results are independent signals.",
  },
  {
    cp: "CP6",
    title: "CP6 — Password leaked in a public repo",
    date: "2019-11-19",
    story:
      "The secrets scanner finds 'ftp_pass = nimbus123' sitting in a public repository — a CRITICAL finding on IA-02.",
    gate:
      "C-02's claim about password policy is now contradicted by a critical public exposure.",
    tries: [
      {
        label: "Claim Registry → try to Publish C-02 — the gate refuses outright",
        nav: "/claims",
      },
      { label: "Control Tests → see the secrets scan evidence for yourself", nav: "/controls" },
    ],
    takeaway:
      "When the evidence got worse, the claims couldn't quietly carry on — the gate kept them honest.",
  },
  {
    cp: "CP7",
    title: "CP7 — Incident 1: a customer notices",
    date: "2020-06-15",
    story:
      "Customer A — a government agency — reports Horizon is contacting unknown external domains.",
    gate:
      "The incident is written to the hash-chained audit log. The claims it should have raised alarms about have been blocked for years.",
    tries: [
      { label: "Dashboard → see where the company stands as incidents begin", nav: "/" },
      { label: "Audit Trail → find the incident_reported entry in the chain", nav: "/audit" },
    ],
    takeaway:
      "By the time customers noticed, the gate had been flagging the contradiction for two and a half years.",
  },
  {
    cp: "CP8",
    title: "CP8 — Incident 2 confirms the pattern",
    date: "2020-10-14",
    story:
      "Customer B — a security firm — reports Horizon downloading a malicious file. A second incident is logged.",
    gate:
      "Same product, same component, logged the same way — the pattern is now on the record.",
    tries: [
      {
        label: "Jump the clock forward and watch unresolved findings keep escalating",
      },
      { label: "Escalations → count how many L4 items have accumulated", nav: "/escalations" },
    ],
    takeaway:
      "The evidence trail exists before the breach becomes public — governance makes it usable.",
  },
  {
    cp: "CP9",
    title: "CP9 — Wrap-up: what the gate bought",
    date: "2020-12-14",
    story:
      "The timeline ends. Time to compare: what happened with the gate vs what happened without it.",
    gate:
      "The Dashboard's comparison panel sums it up — every contradiction was flagged, escalated, and logged instead of published.",
    tries: [
      { label: "Dashboard → 'Status quo vs With Gate' comparison panel", nav: "/" },
      {
        label: "Audit Trail → Tamper Demo: corrupt the log on a copy and watch the chain catch it",
        nav: "/audit",
      },
      {
        label: "Verify Chain — confirm the real log is still intact",
      },
    ],
    takeaway:
      "Honest limitation for the demo: this is governance, not malware detection — it wouldn't have caught SUNBURST. It would have caught the false claims.",
  },
];
