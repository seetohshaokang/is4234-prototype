import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import api from "../api/client";
import { useAppStore } from "../store/useAppStore";
import Badge from "../components/Badge";
import Card, { CardHeader, CardBody } from "../components/Card";

interface EscalationResponse {
  decision: string;
  rationale: string;
  due_on: string | null;
  decided_by: string;
  decided_on: string;
}

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
  responses: EscalationResponse[];
}

const DECISIONS = [
  { value: "REMEDIATE",            label: "REMEDIATE — Fix the underlying issue" },
  { value: "STOP_CITING",          label: "STOP_CITING — Withdraw the SCC from use" },
  { value: "REQUEST_REEVALUATION", label: "REQUEST_REEVALUATION — Ask auditor to re-examine" },
  { value: "DISCLOSE",             label: "DISCLOSE — Publicly disclose the downtime" },
];

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

function EscalationTable({
  escalations,
  onRespond,
  respondFor,
  dimmed,
}: {
  escalations: Escalation[];
  onRespond?: (id: number) => void;
  respondFor?: number | null;
  dimmed?: boolean;
}) {
  const { actorId } = useAppStore();
  const qc = useQueryClient();

  const ackMut = useMutation({
    mutationFn: (id: number) => api.post(`/escalations/${id}/ack`, null, { params: { actor_id: actorId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["escalations"] }),
  });

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
          {!dimmed && <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Actions</th>}
        </tr>
      </thead>
      <tbody>
        {escalations.map(e => (
          <tr key={e.id} className={`border-b border-slate-50 last:border-0 ${dimmed ? "opacity-50" : "hover:bg-slate-50"}`}>
            <td className="px-5 py-2.5">
              <Link to={`/findings/${e.finding_id}`} className="font-mono text-xs text-blue-600 hover:text-blue-800 font-medium">
                {e.finding_id}
              </Link>
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
                <div className="flex flex-col gap-1.5 items-start">
                  <Link
                    to={`/findings/${e.finding_id}`}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    View case →
                  </Link>
                  <div className="flex gap-1.5">
                    {e.status === "OPEN" && (
                      <button
                        onClick={() => ackMut.mutate(e.id)}
                        disabled={ackMut.isPending}
                        className="text-xs border border-slate-200 hover:border-slate-400 text-slate-500 hover:text-slate-700 rounded px-2 py-0.5 disabled:opacity-50 transition-colors"
                      >
                        Acknowledge
                      </button>
                    )}
                    {e.level === 3 && onRespond && (
                      <button
                        onClick={() => onRespond(e.id)}
                        className="text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded px-2 py-0.5 transition-colors"
                      >
                        Respond
                      </button>
                    )}
                  </div>
                </div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function EscalationsPage() {
  const { actorId } = useAppStore();
  const qc = useQueryClient();
  const [respondFor, setRespondFor] = useState<number | null>(null);
  const [form, setForm] = useState({ decision: "REMEDIATE", rationale: "", due_on: "" });
  const [error, setError] = useState("");

  const { data: escalations = [], isLoading } = useQuery<Escalation[]>({
    queryKey: ["escalations"],
    queryFn: () => api.get("/escalations").then(r => r.data),
  });

  const respondMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: object }) =>
      api.post(`/escalations/${id}/respond`, payload, { params: { actor_id: actorId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["escalations"] });
      setRespondFor(null);
      setForm({ decision: "REMEDIATE", rationale: "", due_on: "" });
      setError("");
    },
    onError: (e: any) => setError(e.response?.data?.detail ?? "Respond failed"),
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
          Cases escalated for senior review. L3 escalations require a formal committee decision.
        </p>
      </div>

      {error && (
        <div className="rounded-md px-4 py-3 text-sm font-medium bg-red-50 text-red-800 border border-red-200">
          {error}
        </div>
      )}

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
            <EscalationTable
              escalations={l3Open}
              onRespond={id => setRespondFor(respondFor === id ? null : id)}
              respondFor={respondFor}
            />
            {respondFor !== null && l3Open.some(e => e.id === respondFor) && (
              <div className="border-t border-slate-100 px-5 py-4 bg-purple-50">
                <div className="text-sm font-semibold text-slate-700 mb-3">
                  Formal Response to Escalation #{respondFor}
                </div>
                <div className="space-y-3 max-w-xl">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Decision</label>
                    <select
                      value={form.decision}
                      onChange={e => setForm(f => ({ ...f, decision: e.target.value }))}
                      className="w-full text-sm border border-slate-300 rounded-md px-3 py-1.5 focus:outline-none focus:border-blue-500"
                    >
                      {DECISIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Rationale <span className="text-slate-400">(min 50 chars)</span>
                    </label>
                    <textarea
                      value={form.rationale}
                      onChange={e => setForm(f => ({ ...f, rationale: e.target.value }))}
                      rows={3}
                      className="w-full text-sm border border-slate-300 rounded-md px-3 py-2 focus:outline-none focus:border-blue-500"
                      placeholder="Explain the basis for this decision…"
                    />
                    {form.rationale.length > 0 && form.rationale.length < 50 && (
                      <div className="text-xs text-amber-600 mt-1">{50 - form.rationale.length} more characters required</div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Due On</label>
                    <input
                      type="date"
                      value={form.due_on}
                      onChange={e => setForm(f => ({ ...f, due_on: e.target.value }))}
                      className="text-sm border border-slate-300 rounded-md px-3 py-1.5 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => respondMut.mutate({
                        id: respondFor,
                        payload: { decision: form.decision, rationale: form.rationale, due_on: form.due_on || undefined },
                      })}
                      disabled={form.rationale.length < 50 || respondMut.isPending}
                      className="bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50 transition-colors"
                    >
                      {respondMut.isPending ? "Submitting…" : "Submit Response"}
                    </button>
                    <button
                      onClick={() => setRespondFor(null)}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2 rounded-md transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
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
            <EscalationTable escalations={l2Open} />
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
    </div>
  );
}
