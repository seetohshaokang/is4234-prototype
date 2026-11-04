import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { useAppStore } from "../store/useAppStore";
import Badge from "../components/Badge";
import Card, { CardHeader, CardBody } from "../components/Card";

interface EscalationResponse {
  decision: string;
  rationale: string;
  due_on: string;
  decided_by: string;
  decided_on: string;
}

interface Escalation {
  id: number;
  sccversion_id: string;
  trigger: string;
  level: number;
  assigned_to_role: string;
  assigned_to_id: string;
  reason: string;
  created_on: string;
  status: string;
  independence_skips: string[];
  responses: EscalationResponse[];
}

const DECISIONS = [
  { value: "REMEDIATE",           label: "REMEDIATE — Fix the underlying issue" },
  { value: "STOP_CITING",         label: "STOP_CITING — Withdraw the SCC from use" },
  { value: "REQUEST_REEVALUATION",label: "REQUEST_REEVALUATION — Ask auditor to re-examine" },
  { value: "DISCLOSE",            label: "DISCLOSE — Publicly disclose the downtime" },
];

function levelBadge(level: number) {
  const cls = level >= 3
    ? "bg-purple-100 text-purple-700 border-purple-200"
    : "bg-blue-100 text-blue-700 border-blue-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${cls}`}>
      L{level}
    </span>
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

  const invalidate = () => qc.invalidateQueries({ queryKey: ["escalations"] });

  const ackMut = useMutation({
    mutationFn: (id: number) => api.post(`/escalations/${id}/ack`),
    onSuccess: invalidate,
  });

  const respondMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: object }) =>
      api.post(`/escalations/${id}/respond`, payload),
    onSuccess: () => {
      invalidate();
      setRespondFor(null);
      setForm({ decision: "REMEDIATE", rationale: "", due_on: "" });
      setError("");
    },
    onError: (e: any) => setError(e.response?.data?.detail ?? "Respond failed"),
  });

  if (isLoading) return <div className="text-slate-400 text-sm">Loading…</div>;

  const openEscalations = escalations.filter(e => e.status === "OPEN");
  const closedEscalations = escalations.filter(e => e.status !== "OPEN");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Escalations</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Automatic escalations triggered when SCCs remain DOWN. L3+ require a formal decision.
        </p>
      </div>

      {error && (
        <div className="rounded-md px-4 py-3 text-sm font-medium bg-red-50 text-red-800 border border-red-200">
          {error}
        </div>
      )}

      {/* Open escalations */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Open Escalations</h2>
            <span className="bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded-full">{openEscalations.length}</span>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {openEscalations.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400">No open escalations.</div>
          ) : (
            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">ID</th>
                    <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">SCC Version</th>
                    <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Level</th>
                    <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Assigned Role</th>
                    <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Trigger</th>
                    <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Reason</th>
                    <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Created On</th>
                    <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {openEscalations.map(e => (
                    <tr key={e.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{e.id}</td>
                      <td className="px-5 py-2.5 font-mono text-xs text-blue-600">{e.sccversion_id}</td>
                      <td className="px-5 py-2.5">{levelBadge(e.level)}</td>
                      <td className="px-5 py-2.5 text-xs text-slate-500">{e.assigned_to_role?.replace(/_/g, " ")}</td>
                      <td className="px-5 py-2.5 text-xs text-slate-500">{e.trigger}</td>
                      <td className="px-5 py-2.5 text-xs text-slate-600 max-w-xs truncate">{e.reason}</td>
                      <td className="px-5 py-2.5 text-xs text-slate-400">{e.created_on}</td>
                      <td className="px-5 py-2.5">
                        <div className="flex gap-2">
                          <button
                            onClick={() => ackMut.mutate(e.id)}
                            disabled={ackMut.isPending}
                            className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
                          >
                            Ack
                          </button>
                          {e.level === 3 && (
                            <button
                              onClick={() => setRespondFor(respondFor === e.id ? null : e.id)}
                              className="text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded px-2 py-0.5 transition-colors"
                            >
                              Respond
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Respond form for L3 */}
              {respondFor !== null && (
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
                        {DECISIONS.map(d => (
                          <option key={d.value} value={d.value}>{d.label}</option>
                        ))}
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
                        <div className="text-xs text-amber-600 mt-1">
                          {50 - form.rationale.length} more characters required
                        </div>
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
            </div>
          )}
        </CardBody>
      </Card>

      {/* All escalations history */}
      {closedEscalations.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-500">Closed Escalations ({closedEscalations.length})</h2>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">ID</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">SCC Version</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Level</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Assigned Role</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Reason</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Created On</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {closedEscalations.map(e => (
                  <tr key={e.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 opacity-70">
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{e.id}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-400">{e.sccversion_id}</td>
                    <td className="px-5 py-2.5">{levelBadge(e.level)}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-500">{e.assigned_to_role?.replace(/_/g, " ")}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-600 max-w-xs truncate">{e.reason}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-400">{e.created_on}</td>
                    <td className="px-5 py-2.5"><Badge value={e.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
