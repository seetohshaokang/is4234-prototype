import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import Badge from "../components/Badge";
import Card, { CardHeader, CardBody } from "../components/Card";
import CasePanel from "../components/CasePanel";
import { can, useCurrentRole } from "../lib/permissions";

interface Escalation {
  id: number;
  finding_id: string;
  finding_title: string | null;
  finding_status: string | null;
  check_id: string | null;
  level: number;
  assigned_to_role: string;
  assigned_to_name: string | null;
  reason: string;
  days_open: number | null;
  created_on: string;
  acknowledged_on: string | null;
  resolved_on: string | null;
  status: string;
}

function LevelBadge({ level }: { level: number }) {
  const cls = level === 3
    ? "bg-purple-100 text-purple-700 border-purple-200"
    : "bg-orange-100 text-orange-700 border-orange-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${cls}`}>
      L{level}
    </span>
  );
}

function EscalationTable({ escalations, dimmed, onSelect }: { escalations: Escalation[]; dimmed?: boolean; onSelect?: (id: string) => void }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-100">
          <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Case</th>
          <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Check</th>
          <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Level</th>
          <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Assigned To</th>
          <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Reason for Escalation</th>
          <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Days Open</th>
          <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Esc. Status</th>
          {!dimmed && <th className="text-left px-5 py-2 text-xs font-medium text-slate-500"></th>}
        </tr>
      </thead>
      <tbody>
        {escalations.map(e => (
          <tr key={e.id} className={`border-b border-slate-50 last:border-0 ${dimmed ? "opacity-50" : "hover:bg-slate-50"}`}>
            <td className="px-5 py-2.5">
              <span className="font-mono text-xs text-slate-600 font-medium">{e.finding_id}</span>
              {e.finding_title && (
                <div className="text-xs text-slate-500 mt-0.5 max-w-[180px] truncate">{e.finding_title}</div>
              )}
            </td>
            <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{e.check_id ?? "—"}</td>
            <td className="px-5 py-2.5"><LevelBadge level={e.level} /></td>
            <td className="px-5 py-2.5 text-xs text-slate-600">{e.assigned_to_name ?? <span className="text-slate-300">—</span>}</td>
            <td className="px-5 py-2.5 text-xs text-slate-500 max-w-xs">{e.reason}</td>
            <td className="px-5 py-2.5 text-xs text-slate-500">
              {e.days_open != null ? (
                <span className={e.days_open > 60 ? "text-red-600 font-medium" : ""}>{e.days_open}d</span>
              ) : "—"}
            </td>
            <td className="px-5 py-2.5"><Badge value={e.status} /></td>
            {!dimmed && (
              <td className="px-5 py-2.5">
                <button
                  onClick={() => onSelect?.(e.finding_id)}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  View case →
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function EscalationsPage() {
  const role = useCurrentRole();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: escalations = [], isLoading } = useQuery<Escalation[]>({
    queryKey: ["escalations"],
    queryFn: () => api.get("/escalations").then(r => r.data),
  });

  if (isLoading) return <div className="text-slate-400 text-sm">Loading…</div>;

  // Only show L2+ escalations — L1 is operational, not for senior visibility
  const relevant = escalations.filter(e => e.level >= 2);
  const l3Open = relevant.filter(e => e.level === 3 && e.status !== "RESOLVED");
  const l2Open = relevant.filter(e => e.level === 2 && e.status !== "RESOLVED");
  const resolved = relevant.filter(e => e.status === "RESOLVED");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Escalations</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Cases escalated for senior review. Open a case to acknowledge or add notes.
        </p>
      </div>

      {/* L3 — Disclosure Committee */}
      {l3Open.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-700">L3 — Disclosure Committee</h2>
              <span className="bg-purple-100 text-purple-700 text-xs font-medium px-2 py-0.5 rounded-full border border-purple-200">{l3Open.length} open</span>
              <span className="text-xs text-slate-400">Formal decision required</span>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <EscalationTable escalations={l3Open} onSelect={setSelectedId} />
          </CardBody>
        </Card>
      )}

      {/* L2 — Security Lead */}
      {l2Open.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-700">L2 — Security Lead</h2>
              <span className="bg-orange-100 text-orange-700 text-xs font-medium px-2 py-0.5 rounded-full border border-orange-200">{l2Open.length} open</span>
              <span className="text-xs text-slate-400">Review and escalate if needed</span>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <EscalationTable escalations={l2Open} onSelect={setSelectedId} />
          </CardBody>
        </Card>
      )}

      {l3Open.length === 0 && l2Open.length === 0 && (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-400 text-center py-6">No open escalations requiring senior review.</p>
          </CardBody>
        </Card>
      )}

      {/* Resolved */}
      {resolved.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-500">Resolved Escalations ({resolved.length})</h2>
          </CardHeader>
          <CardBody className="p-0">
            <EscalationTable escalations={resolved} dimmed />
          </CardBody>
        </Card>
      )}
      {selectedId && <CasePanel id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
