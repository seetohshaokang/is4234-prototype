import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import type { NavigateFunction } from "react-router-dom";

const STEP_NAV: Record<number, string> = {
  2: "/sccs",
  3: "/checks",
  4: "/changes",
  5: "/findings",
  6: "/escalations",
  7: "/audit",
};

const steps: DriveStep[] = [
  {
    popover: {
      title: "Welcome to SCC Library",
      description:
        "A proof-of-concept that tracks public security statements as measurable claims. Evidence — not the organisation — decides whether each claim is UPHELD or DOWN. Built around the SolarWinds case study (2017–2020).",
      align: "center",
    },
  },
  {
    element: "[data-tour='role']",
    popover: {
      title: "Pick a persona first",
      description:
        "Each role sees different tabs and powers: DevSecOps works cases, the Security Lead proposes changes, the External Auditor approves them, the Disclosure Committee decides top-level escalations. Public gets the external-stakeholder view — switch to an internal role for the full tour.",
      side: "right",
    },
  },
  {
    element: 'a[href="/sccs"]',
    popover: {
      title: "SCC Library",
      description:
        "Every security assertion with its current state and uptime. State is today's verdict; the percentage is the share of its whole tracked life spent upheld — the two can disagree.",
      side: "right",
    },
  },
  {
    element: 'a[href="/checks"]',
    popover: {
      title: "Security Checks",
      description:
        "The automated evidence tests behind each claim — threshold, cadence, data source, and latest results. Evidence arrives as periodic snapshots of company systems; a failing check puts the mapped claim DOWN.",
      side: "right",
    },
  },
  {
    element: 'a[href="/changes"]',
    popover: {
      title: "Change Requests",
      description:
        "Assertions only change through formal requests — create, re-evaluate, or deprecate. The Security Lead proposes; only the External Auditor can approve. Full version history is preserved.",
      side: "right",
    },
  },
  {
    element: 'a[href="/findings"]',
    popover: {
      title: "Cases",
      description:
        "A failed check opens a case automatically; a passing check closes it. Picking a case up moves it to IN_REVIEW and fires the first escalation — untriaged cases simply wait here.",
      side: "right",
    },
  },
  {
    element: 'a[href="/escalations"]',
    popover: {
      title: "Escalations",
      description:
        "Cases climb L1 (control owner) → L2 (security lead) → L3 (disclosure committee). Raising a level resolves the previous demand; at L3 the committee records a formal decision with a written rationale.",
      side: "right",
    },
  },
  {
    element: 'a[href="/audit"]',
    popover: {
      title: "Audit Trail",
      description:
        "Every action lands in a hash-chained append-only log. Use Verify Chain to prove nothing was altered — each entry cryptographically links to the one before it.",
      side: "right",
    },
  },
  {
    popover: {
      title: "You're set",
      description:
        "That covers the tabs — try a persona switch and work a case end to end: pick it up, escalate it, and watch the audit trail record every move. Reopen this tour anytime with the Feature tour button at the bottom of the sidebar.",
      align: "center",
    },
  },
];

export function startTour(navigate: NavigateFunction) {
  const go = (drv: ReturnType<typeof driver>, targetIdx: number, forward: boolean) => {
    const nav = STEP_NAV[targetIdx];
    if (nav) {
      navigate(nav);
      setTimeout(() => (forward ? drv.moveNext() : drv.movePrevious()), 150);
    } else {
      forward ? drv.moveNext() : drv.movePrevious();
    }
  };

  const drv = driver({
    showProgress: true,
    allowClose: true,
    overlayClickBehavior: "close",
    stagePadding: 6,
    smoothScroll: true,
    steps,
    onNextClick: (_el, _step, { driver: d }) => {
      const idx = d.getActiveIndex() ?? 0;
      go(d, idx + 1, true);
    },
    onPrevClick: (_el, _step, { driver: d }) => {
      const idx = d.getActiveIndex() ?? 0;
      go(d, idx - 1, false);
    },
  });

  drv.drive();
}
