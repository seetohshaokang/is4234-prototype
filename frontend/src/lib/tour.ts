import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import type { NavigateFunction } from "react-router-dom";

const STEP_NAV: Record<number, string> = {
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
        "A proof-of-concept Security Citation Code library built around the SolarWinds case study (2017–2020). Checkpoint buttons walk that company's timeline; you can also act as any persona and interact with the system directly.",
      align: "center",
    },
  },
  {
    element: 'a[href="/sccs"]',
    popover: {
      title: "SCC Library",
      description: "All active and historical Security Citation Codes. Each SCC is a measurable security assertion tracked like an SLA — UPHELD, DOWN, or UNKNOWN based on automated evidence.",
      side: "right",
    },
  },
  {
    element: 'a[href="/checks"]',
    popover: {
      title: "Security Checks",
      description: "The automated evidence tests behind each SCC. A failing check puts the mapped SCC DOWN and opens a finding automatically.",
      side: "right",
    },
  },
  {
    element: 'a[href="/checks"]',
    popover: {
      title: "Security Checks",
      description: "Each check has a collector script — the measurement tool itself is versioned and must be approved by the External Auditor before results count.",
      side: "right",
    },
  },
  {
    element: 'a[href="/changes"]',
    popover: {
      title: "Change Requests",
      description: "Any change to an SCC — CREATE, REVISION, or DEPRECATE — goes through a formal change request approved by the External Auditor. The full history is preserved.",
      side: "right",
    },
  },
  {
    element: 'a[href="/findings"]',
    popover: {
      title: "Cases",
      description: "Open security findings. Each is linked to a control and blocks the mapped SCC's uptime while open. Click 'View details' to manage a case — assign it, change status, add notes, or escalate.",
      side: "right",
    },
  },
  {
    element: 'a[href="/escalations"]',
    popover: {
      title: "Escalations",
      description: "Cases climb L1 (control owner) → L2 (security lead) → L3 (disclosure committee). You can only Ack escalations assigned to your current role; at L3 the committee records a formal decision.",
      side: "right",
    },
  },
  {
    element: 'a[href="/audit"]',
    popover: {
      title: "Audit Trail",
      description: "Every action in the system is recorded in a hash-chained append-only log. Filter by category or search by actor and subject to trace any event.",
      side: "right",
    },
  },
  {
    element: "[data-tour='role']",
    popover: {
      title: "Active persona",
      description: "Switch between personas to see role-based access in action. David Ng (External Auditor) can create and revise SCCs. Sharon Wong (Audit Committee) sees committee-level escalations.",
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
