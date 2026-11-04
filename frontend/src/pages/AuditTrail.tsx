import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import api from "../api/client";
import Card, { CardBody } from "../components/Card";

interface AuditEvent {
  seq: number;
  ts_sim: string;
  actor_id: string;
  actor_name: string;
  action: string;
  subject_type: string;
  subject_id: string;
  payload: Record<string, unknown> | null;
  hash: string;
}

const ACTION_LABELS: Record<string, string> = {
  check_run:                  "Check run",
  finding_opened:             "Case opened",
  finding_closed:             "Case closed",
  case_status_changed:        "Case status changed",
  case_assigned:              "Case assigned",
  case_note_added:            "Case note added",
  case_escalated:             "Case escalated",
  escalation_acked:           "Escalation acknowledged",
  escalation_resolved:        "Escalation resolved",
  committee_response:         "Committee response recorded",
  change_request_submitted:   "Change request submitted",
  change_request_approved:    "Change request approved",
  change_request_rejected:    "Change request rejected",
  cr_note_added:              "Change request note added",
  scc_deprecated:             "SCC deprecated",
  scc_version_activated:      "SCC version activated",
  checkpoint_applied:         "Checkpoint applied",
  clock_set:                  "Simulation clock set",
  collector_submitted:        "Collector submitted",
  collector_approved:         "Collector approved",
};

const ACTION_COLORS: Record<string, string> = {
  finding_opened:             "text-red-600",
  finding_closed:             "text-slate-500",
  case_status_changed:        "text-blue-600",
  case_assigned:              "text-teal-600",
  case_note_added:            "text-slate-600",
  case_escalated:             "text-purple-600",
  escalation_acked:           "text-purple-500",
  escalation_resolved:        "text-purple-500",
  committee_response:         "text-purple-700",
  change_request_submitted:   "text-amber-600",
  change_request_approved:    "text-emerald-600",
  change_request_rejected:    "text-red-600",
  cr_note_added:              "text-slate-600",
  scc_deprecated:             "text-orange-600",
  checkpoint_applied:         "text-slate-400",
  check_run:                  "text-slate-400",
  clock_set:                  "text-slate-400",
};

const FILTER_GROUPS = [
  {
    label: "Cases",
    actions: ["finding_opened", "finding_closed", "case_status_changed", "case_assigned", "case_note_added", "case_escalated"],
  },
  {
    label: "Escalations",
    actions: ["escalation_acked", "escalation_resolved", "committee_response"],
  },
  {
    label: "Change Requests",
    actions: ["change_request_submitted", "change_request_approved", "change_request_rejected", "cr_note_added"],
  },
  {
    label: "Checks",
    actions: ["check_run"],
  },
  {
    label: "System",
    actions: ["checkpoint_applied", "clock_set", "scc_deprecated", "collector_submitted", "collector_approved"],
  },
];

function payloadSummary(action: string, payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  if (action === "case_status_changed") return `${payload.from} → ${payload.to}`;
  if (action === "case_assigned") return `→ ${payload.name ?? payload.assigned_to}`;
  if (action === "case_escalated") return `Level ${payload.level}`;
  if (action === "committee_response") return `${payload.decision}`;
  if (action === "change_request_submitted") return `${payload.type} · ${payload.scc_id}`;
  if (action === "change_request_approved") return `${payload.type} · ${payload.scc_id}`;
  if (action === "change_request_rejected") return `${String(payload.note ?? "").slice(0, 60)}`;
  if (action === "case_note_added" || action === "cr_note_added") return `"${String(payload.preview ?? "").slice(0, 60)}"`;
  if (action === "finding_opened") return `${payload.severity} · ${payload.control_id}`;
  if (action === "finding_closed") return String(payload.reason ?? "");
  if (action === "clock_set") return `${payload.from} → ${payload.to}`;
  if (action === "scc_deprecated") return `effective ${payload.effective_on}`;
  return "";
}

export default function AuditTrail() {
  const [search, setSearch] = useState("");
  const [activeGroups, setActiveGroups] = useState<Set<string>>(new Set());

  const { data: events = [], isLoading } = useQuery<AuditEvent[]>({
    queryKey: ["audit"],
    queryFn: () => api.get("/audit").then(r => r.data),
    staleTime: 0,
  });

  const toggleGroup = (label: string) => {
    setActiveGroups(prev => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  };

  const activeActions = activeGroups.size > 0
    ? new Set(FILTER_GROUPS.filter(g => activeGroups.has(g.label)).flatMap(g => g.actions))
    : null;

  const q = search.toLowerCase();
  const filtered = events.filter(ev => {
    if (activeActions && !activeActions.has(ev.action)) return false;
    if (q && !ev.actor_name.toLowerCase().includes(q) &&
            !ev.actor_id.toLowerCase().includes(q) &&
            !ev.action.toLowerCase().includes(q) &&
            !ev.subject_id.toLowerCase().includes(q)) return false;
    return true;
  });

  if (isLoading) return <div className="text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Audit Trail</h1>
        <p className="text-sm text-slate-500">Hash-chained append-only log of all system actions.</p>
      </div>

      {/* Search + filter */}
      <div className="space-y-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by actor, action, or subject ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-slate-200 rounded-lg pl-9 pr-4 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-400"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400">Filter:</span>
          {FILTER_GROUPS.map(g => (
            <button
              key={g.label}
              onClick={() => toggleGroup(g.label)}
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                activeGroups.has(g.label)
                  ? "bg-blue-100 text-blue-700 border-blue-300"
                  : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"
              }`}
            >
              {g.label}
            </button>
          ))}
          {(activeGroups.size > 0 || search) && (
            <button
              onClick={() => { setActiveGroups(new Set()); setSearch(""); }}
              className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1"
            >
              Clear
            </button>
          )}
          <span className="text-xs text-slate-400 ml-auto">{filtered.length} event{filtered.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            {filtered.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-400">No events match the current filters.</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-4 py-2 text-slate-500 font-medium">#</th>
                    <th className="text-left px-4 py-2 text-slate-500 font-medium">Date</th>
                    <th className="text-left px-4 py-2 text-slate-500 font-medium">Actor</th>
                    <th className="text-left px-4 py-2 text-slate-500 font-medium">Action</th>
                    <th className="text-left px-4 py-2 text-slate-500 font-medium">Subject</th>
                    <th className="text-left px-4 py-2 text-slate-500 font-medium">Detail</th>
                    <th className="text-left px-4 py-2 text-slate-500 font-medium font-mono">Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(ev => {
                    const label = ACTION_LABELS[ev.action] ?? ev.action;
                    const color = ACTION_COLORS[ev.action] ?? "text-slate-600";
                    const detail = payloadSummary(ev.action, ev.payload);
                    const isSystem = ev.action === "check_run" || ev.action === "clock_set" || ev.action === "checkpoint_applied";
                    return (
                      <tr key={ev.seq} className={`border-b border-slate-50 last:border-0 hover:bg-slate-50 ${isSystem ? "opacity-50" : ""}`}>
                        <td className="px-4 py-2 font-mono text-slate-400">{ev.seq}</td>
                        <td className="px-4 py-2 font-mono text-slate-500 whitespace-nowrap">{ev.ts_sim?.slice(0, 10)}</td>
                        <td className="px-4 py-2 text-slate-700 font-medium whitespace-nowrap">
                          {ev.actor_name}
                        </td>
                        <td className={`px-4 py-2 font-medium ${color}`}>{label}</td>
                        <td className="px-4 py-2 font-mono text-slate-500">{ev.subject_id}</td>
                        <td className="px-4 py-2 text-slate-500 max-w-[220px] truncate">{detail}</td>
                        <td className="px-4 py-2 font-mono text-slate-300">{ev.hash?.slice(0, 8)}…</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
