import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { useAppStore } from "../store/useAppStore";
import Badge from "../components/Badge";
import Card, { CardHeader, CardBody } from "../components/Card";

interface ChangeRequest {
  id: string;
  type: string;
  scc_id: string;
  requested_by: string;
  requested_on: string;
  reason: string;
  status: string;
  decided_by: string | null;
  decided_on: string | null;
  auditor_note: string | null;
  effective_on: string | null;
}

const inputCls =
  "w-full text-sm border border-slate-300 rounded-md px-3 py-1.5 focus:outline-none focus:border-blue-500";

const ALLOWED_ROLES = ["security_lead", "independent_auditor", "disclosure_committee", "audit_committee"];

export default function ChangeRequests() {
  const { actorId } = useAppStore();
  const qc = useQueryClient();
  const [approveFor, setApproveFor] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [approveForm, setApproveForm] = useState({
    auditor_note: "",
    assertion_text: "",
    target_uptime_pct: "",
    rolling_window_days: "",
    max_single_downtime_days: "",
    evidence_type: "",
    pinned_controls: "",
    effective_on: "",
  });
  const [rejectNote, setRejectNote] = useState("");
  const [error, setError] = useState("");

  const { data: changeRequests = [], isLoading } = useQuery<ChangeRequest[]>({
    queryKey: ["change-requests"],
    queryFn: () => api.get("/change-requests").then(r => r.data),
  });

  const isAuditor = actorId === "P-REYES";

  const approveMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: object }) =>
      api.post(`/change-requests/${id}/approve`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["change-requests"] });
      qc.invalidateQueries({ queryKey: ["sccs"] });
      setApproveFor(null);
      setApproveForm({
        auditor_note: "",
        assertion_text: "",
        target_uptime_pct: "",
        rolling_window_days: "",
        max_single_downtime_days: "",
        evidence_type: "",
        pinned_controls: "",
        effective_on: "",
      });
      setError("");
    },
    onError: (e: any) => setError(e.response?.data?.detail ?? "Approve failed"),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, auditor_note }: { id: string; auditor_note: string }) =>
      api.post(`/change-requests/${id}/reject`, { auditor_note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["change-requests"] });
      setRejectFor(null);
      setRejectNote("");
      setError("");
    },
    onError: (e: any) => setError(e.response?.data?.detail ?? "Reject failed"),
  });

  if (actorId === "P-PRIYA") return (
    <div className="flex items-center justify-center h-64">
      <p className="text-sm text-slate-400">You do not have access to Change Requests.</p>
    </div>
  );

  if (isLoading) return <div className="text-slate-400 text-sm">Loading…</div>;

  const pending = changeRequests.filter(cr => cr.status === "PENDING");
  const decided = changeRequests.filter(cr => cr.status !== "PENDING");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Change Requests</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Requests to CREATE, REEVALUATE, or DEPRECATE SCC versions. Approved by the independent auditor.
        </p>
      </div>

      {error && (
        <div className="rounded-md px-4 py-3 text-sm font-medium bg-red-50 text-red-800 border border-red-200">
          {error}
        </div>
      )}

      {/* Pending */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Pending</h2>
            <span className="bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 rounded-full">{pending.length}</span>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {pending.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400">No pending change requests.</div>
          ) : (
            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">ID</th>
                    <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Type</th>
                    <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">SCC</th>
                    <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Requested By</th>
                    <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Requested On</th>
                    <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Reason</th>
                    {isAuditor && <th className="px-5 py-2 text-xs font-medium text-slate-500">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {pending.map(cr => (
                    <tr key={cr.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{cr.id}</td>
                      <td className="px-5 py-2.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-blue-50 text-blue-700 border-blue-200">
                          {cr.type}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{cr.scc_id}</td>
                      <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{cr.requested_by}</td>
                      <td className="px-5 py-2.5 text-xs text-slate-500">{cr.requested_on}</td>
                      <td className="px-5 py-2.5 text-xs text-slate-600 max-w-xs truncate">{cr.reason}</td>
                      {isAuditor && (
                        <td className="px-5 py-2.5">
                          <div className="flex gap-2">
                            <button
                              onClick={() => { setApproveFor(cr.id); setRejectFor(null); }}
                              className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded px-2 py-1 transition-colors"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => { setRejectFor(cr.id); setApproveFor(null); }}
                              className="text-xs bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded px-2 py-1 transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Approve form */}
              {approveFor && isAuditor && (
                <div className="border-t border-slate-100 px-5 py-4 bg-emerald-50">
                  <div className="text-sm font-semibold text-slate-700 mb-3">
                    Approve change request {approveFor}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Auditor Note</label>
                      <textarea
                        value={approveForm.auditor_note}
                        onChange={e => setApproveForm(f => ({ ...f, auditor_note: e.target.value }))}
                        rows={2}
                        className={inputCls}
                        placeholder="Auditor's approval rationale…"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Assertion Text</label>
                      <input
                        value={approveForm.assertion_text}
                        onChange={e => setApproveForm(f => ({ ...f, assertion_text: e.target.value }))}
                        className={inputCls}
                        placeholder="Security assertion text…"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Target Uptime %</label>
                      <input
                        type="number"
                        value={approveForm.target_uptime_pct}
                        onChange={e => setApproveForm(f => ({ ...f, target_uptime_pct: e.target.value }))}
                        className={inputCls}
                        placeholder="99.0"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Rolling Window (days)</label>
                      <input
                        type="number"
                        value={approveForm.rolling_window_days}
                        onChange={e => setApproveForm(f => ({ ...f, rolling_window_days: e.target.value }))}
                        className={inputCls}
                        placeholder="365"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Max Single Downtime (days)</label>
                      <input
                        type="number"
                        value={approveForm.max_single_downtime_days}
                        onChange={e => setApproveForm(f => ({ ...f, max_single_downtime_days: e.target.value }))}
                        className={inputCls}
                        placeholder="7"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Evidence Type</label>
                      <input
                        value={approveForm.evidence_type}
                        onChange={e => setApproveForm(f => ({ ...f, evidence_type: e.target.value }))}
                        className={inputCls}
                        placeholder="e.g. automated_scan"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Pinned Controls (comma-sep)</label>
                      <input
                        value={approveForm.pinned_controls}
                        onChange={e => setApproveForm(f => ({ ...f, pinned_controls: e.target.value }))}
                        className={inputCls}
                        placeholder="CTL-01, CTL-02"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Effective On</label>
                      <input
                        type="date"
                        value={approveForm.effective_on}
                        onChange={e => setApproveForm(f => ({ ...f, effective_on: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => {
                        const payload: Record<string, unknown> = {
                          auditor_note: approveForm.auditor_note,
                          assertion_text: approveForm.assertion_text || undefined,
                          effective_on: approveForm.effective_on || undefined,
                        };
                        if (approveForm.target_uptime_pct) payload.target_uptime_pct = parseFloat(approveForm.target_uptime_pct);
                        if (approveForm.rolling_window_days) payload.rolling_window_days = parseInt(approveForm.rolling_window_days);
                        if (approveForm.max_single_downtime_days) payload.max_single_downtime_days = parseInt(approveForm.max_single_downtime_days);
                        if (approveForm.evidence_type) payload.evidence_type = approveForm.evidence_type;
                        if (approveForm.pinned_controls) payload.pinned_controls = approveForm.pinned_controls.split(",").map(s => s.trim()).filter(Boolean);
                        approveMut.mutate({ id: approveFor, payload });
                      }}
                      disabled={approveMut.isPending}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50 transition-colors"
                    >
                      {approveMut.isPending ? "Approving…" : "Confirm Approval"}
                    </button>
                    <button
                      onClick={() => setApproveFor(null)}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2 rounded-md transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Reject form */}
              {rejectFor && isAuditor && (
                <div className="border-t border-slate-100 px-5 py-4 bg-red-50">
                  <div className="text-sm font-semibold text-slate-700 mb-3">
                    Reject change request {rejectFor}
                  </div>
                  <textarea
                    value={rejectNote}
                    onChange={e => setRejectNote(e.target.value)}
                    rows={3}
                    className={inputCls}
                    placeholder="Rejection reason (required)…"
                  />
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => rejectMut.mutate({ id: rejectFor, auditor_note: rejectNote })}
                      disabled={!rejectNote || rejectMut.isPending}
                      className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50 transition-colors"
                    >
                      {rejectMut.isPending ? "Rejecting…" : "Confirm Rejection"}
                    </button>
                    <button
                      onClick={() => setRejectFor(null)}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2 rounded-md transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Decided */}
      {decided.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-500">Decided ({decided.length})</h2>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">ID</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Type</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">SCC</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Status</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Requested On</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Decided On</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Auditor Note</th>
                </tr>
              </thead>
              <tbody>
                {decided.map(cr => (
                  <tr key={cr.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 opacity-80">
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{cr.id}</td>
                    <td className="px-5 py-2.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-slate-50 text-slate-600 border-slate-200">
                        {cr.type}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{cr.scc_id}</td>
                    <td className="px-5 py-2.5"><Badge value={cr.status} /></td>
                    <td className="px-5 py-2.5 text-xs text-slate-400">{cr.requested_on}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-400">{cr.decided_on ?? "—"}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-500 max-w-xs truncate">{cr.auditor_note ?? "—"}</td>
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
