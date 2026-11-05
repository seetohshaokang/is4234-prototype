import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import type { NavigateFunction } from "react-router-dom";

// Steps that live on a specific page get an entry here: step index -> route to
// navigate to before highlighting. Sidebar elements need no navigation.
const STEP_NAV: Record<number, string> = {
  4: "/controls",
  7: "/findings",
  10: "/audit",
  14: "/",
};

const steps: DriveStep[] = [
  {
    popover: {
      title: "Welcome to Disclosure Gate",
      description:
        "A proof-of-concept disclosure gate built around the NimbusWatch case study (2017–2020). Checkpoint buttons walk that company's timeline; everything else lets you inject your own events — a preview of how a production version would behave.",
    },
  },
  {
    element: 'a[href="/"]',
    popover: {
      title: "Dashboard",
      description: "Overview: claim verdicts, open findings, active overrides, and the 'status quo vs with gate' comparison.",
      side: "right",
    },
  },
  {
    element: 'a[href="/claims"]',
    popover: {
      title: "Claim Registry",
      description: "The public security claims. Expand a row to inject: Publish (blocked claims refuse) or Withdraw.",
      side: "right",
    },
  },
  {
    element: 'a[href="/controls"]',
    popover: {
      title: "Control Tests",
      description: "The automated evidence tests behind the claims. Never tested = BLOCK.",
      side: "right",
    },
  },
  {
    element: "[data-tour='run-tests']",
    popover: {
      title: "Inject: run tests",
      description: "Re-runs every control test against the current snapshot. New failures auto-open findings and re-block claims.",
      side: "bottom",
    },
  },
  {
    element: 'a[href="/gate"]',
    popover: {
      title: "Gate Review",
      description: "Per-claim verdicts with the rules that fired. Disclosure-committee roles can inject an Override here — BLOCK downgrades to ESCALATE until it expires. The claim's owner cannot override it (independence rule).",
      side: "right",
    },
  },
  {
    element: 'a[href="/findings"]',
    popover: {
      title: "Findings",
      description: "Open security findings. They block mapped claims and age toward escalation.",
      side: "right",
    },
  },
  {
    element: "[data-tour='report-finding']",
    popover: {
      title: "Inject: report a finding",
      description: "File your own finding against any control with any severity. HIGH/CRITICAL immediately blocks linked claims and starts escalation ageing. Expand a finding's row to propose/approve a risk acceptance.",
      side: "bottom",
    },
  },
  {
    element: 'a[href="/escalations"]',
    popover: {
      title: "Escalations",
      description: "Unfixed findings escalate L1→L4 over 30/60/90 days. Your Inbox shows items assigned to your current role — Ack or Resolve them there.",
      side: "right",
    },
  },
  {
    element: 'a[href="/audit"]',
    popover: {
      title: "Audit Trail",
      description: "Hash-chained log of every action in the system.",
      side: "right",
    },
  },
  {
    element: "[data-tour='tamper-demo']",
    popover: {
      title: "Inject: tamper demo",
      description: "Corrupts a copy of the audit log and re-verifies — the hash chain catches it. Verify Chain checks the real log.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='clock']",
    popover: {
      title: "Sim clock",
      description: "Inject time: +1 day ages findings and expires overrides. Jump takes you to any date and re-evaluates everything.",
      side: "right",
    },
  },
  {
    element: "[data-tour='checkpoints']",
    popover: {
      title: "Checkpoints — the story",
      description: "Click any CP to jump there. Blue = applied. Forward jumps keep your injections; backward jumps replay the story and wipe them. Reset returns to before CP1.",
      side: "right",
    },
  },
  {
    element: "[data-tour='role']",
    popover: {
      title: "Active role",
      description: "Who you are right now. Permissions follow the person — try creating an override as T. Grant (claim owner) vs M. Okafor (disclosure committee).",
      side: "right",
    },
  },
  {
    popover: {
      title: "You're set",
      description: "Start at CP1 and walk the story, injecting as you go. The full playbook — including a verification checklist — is in DEMO-GUIDE.md. Reopen this tour anytime with the ? button at the bottom of the sidebar.",
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
