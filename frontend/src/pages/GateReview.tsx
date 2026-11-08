import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ChevronDown, ChevronUp } from "lucide-react";
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

interface CRNote {
  id: number;
  author_id: string;
  author_name: string;
  created_on: string;
  body: string;
}

const TYPES = ["CREATE", "REEVALUATE", "DEPRECATE"];
const TYPE_LABELS: Record<string, string> = { REEVALUATE: "REVISION" };
const STATUSES = ["PENDING", "APPROVED", "REJECTED"];

const TYPE_COLORS: Record<string, string> = {
  CREATE:     "bg-blue-100 text-blue-700 border-blue-200",
  REEVALUATE: "bg-amber-100 text-amber-700 border-amber-200",
  DEPRECATE:  "bg-red-100 text-red-700 border-red-200",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING:  "bg-amber-100 text-amber-700 border-amber-200",
  APPROVED: "bg-green-100 text-green-700 border-green-200",
  REJECTED: "bg-red-100 text-red-700 border-red-200",
};

const inputCls = "w-full text-sm border border-slate-300 rounded-md px-3 py-1.5 focus:outline-none focus:border-blue-500";

function FilterPill({ label, active, color, onClick }: { label: string; active: boolean; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border transition-opacity ${color} ${active ? "opacity-100" : "opacity-35"}`}
    >
      {label}
    </button>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${TYPE_COLORS[type] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
      {TYPE_LABELS[type] ?? type}
    </span>
  );
}

function CRNotes({ crId, actorId }: { crId: string; actorId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");

  const { data: notes = [] } = useQuery<CRNote[]>({
    queryKey: ["cr-notes", crId],
    queryFn: () => api.get(`/change-requests/${crId}/notes`).then(r => r.data),
  });

  const addNote = useMutation({
    mutationFn: (text: string) => api.post(`/change-requests/${crId}/notes`, { body: text, author_id: actorId }),
    onSuccess: () => { setBody(""); qc.invalidateQueries({ queryKey: ["cr-notes", crId] }); },
  });

  return (
    <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
      <div className="text-xs font-medium text-slate-500">Notes</div>
      {notes.length === 0 && <p className="text-xs text-slate-400">No notes yet.</p>}
      {notes.map(n => (
        <div key={n.id} className="border-b border-slate-100 pb-2 last:border-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-medium text-slate-700">{n.author_name}</span>
            <span className="text-xs text-slate-400">{n.created_on}</span>
          </div>
          <p className="text-xs text-slate-600 whitespace-pre-wrap">{n.body}</p>
        </div>
      ))}
      <div>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Add a note…"
          rows={2}
          className="w-full text-xs border border-slate-200 rounded-md px-3 py-2 focus:outline-none focus:border-blue-400 resize-none"
        />
        <div className="mt-1 flex justify-end">
          <button
            onClick={() => addNote.mutate(body)}
            disabled={!body.trim() || addNote.isPending}
            className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-medium px-3 py-1.5 rounded-md transition-colors"
          >
            Add note
          </button>
        </div>
      </div>
    </div>
  );
}


export default function ChangeRequests() {
  const { actorId } = useAppStore();
  const qc = useQueryClient();

  const [showNewForm, setShowNewForm] = useState(false);
  const [newForm, setNewForm] = useState({ type: "REEVALUATE", scc_id: "", reason: "" });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [approveFor, setApproveFor] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [approveForm, setApproveForm] = useState({
    auditor_note: "", assertion_text: "", target_uptime_pct: "",
    rolling_window_days: "", max_single_downtime_days: "",
    evidence_type: "", pinned_controls: "", effective_on: "",
  });
  const [rejectNote, setRejectNote] = useState("");
  const [error, setError] = useState("");

  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());

  const { data: personas = [] } = useQuery<{ id: string; role: string }[]>({
    queryKey: ["personas"],
    queryFn: () => api.get("/personas").then(r => r.data),
  });
  const currentRole = personas.find(p => p.id === actorId)?.role ?? "public";
  const isSecurityLead = currentRole === "security_lead";
  const isAuditor = currentRole === "independent_auditor";

  const { data: changeRequests = [], isLoading } = useQuery<ChangeRequest[]>({
    queryKey: ["change-requests"],
    queryFn: () => api.get("/change-requests").then(r => r.data),
  });

  const { data: sccs = [] } = useQuery<{ id: string; title: string }[]>({
    queryKey: ["sccs"],
    queryFn: () => api.get("/sccs").then(r => r.data),
  });

  const newMut = useMutation({
    mutationFn: () => api.post("/change-requests", { type: newForm.type, scc_id: newForm.scc_id, reason: newForm.reason }, { params: { actor_id: actorId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["change-requests"] });
      setShowNewForm(false);
      setNewForm({ type: "REEVALUATE", scc_id: "", reason: "" });
      setError("");
    },
    onError: (e: any) => setError(e.response?.data?.detail ?? "Submit failed"),
  });

  const approveMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: object }) =>
      api.post(`/change-requests/${id}/approve`, payload, { params: { actor_id: actorId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["change-requests"] });
      qc.invalidateQueries({ queryKey: ["sccs"] });
      setApproveFor(null);
      setApproveForm({ auditor_note: "", assertion_text: "", target_uptime_pct: "", rolling_window_days: "", max_single_downtime_days: "", evidence_type: "", pinned_controls: "", effective_on: "" });
      setError("");
    },
    onError: (e: any) => setError(e.response?.data?.detail ?? "Approve failed"),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, auditor_note }: { id: string; auditor_note: string }) =>
      api.post(`/change-requests/${id}/reject`, { auditor_note }, { params: { actor_id: actorId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["change-requests"] });
      setRejectFor(null);
      setRejectNote("");
      setError("");
    },
    onError: (e: any) => setError(e.response?.data?.detail ?? "Reject failed"),
  });

  if (isLoading) return <div className="text-slate-400 text-sm">Loading…</div>;

  const toggle = (set: Set<string>, val: string): Set<string> => {
    const next = new Set(set);
    next.has(val) ? next.delete(val) : next.add(val);
    return next;
  };

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
    setApproveFor(null);
    setRejectFor(null);
  };

  const pending = changeRequests.filter(cr => cr.status === "PENDING");
  const decided = changeRequests.filter(cr => cr.status !== "PENDING");

  const filtered = changeRequests.filter(cr => {
    if (typeFilter.size > 0 && !typeFilter.has(cr.type)) return false;
    if (statusFilter.size > 0 && !statusFilter.has(cr.status)) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Change Requests</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Requests to CREATE, REVISE, or DEPRECATE SCC versions. Approved by the independent auditor.
          </p>
        </div>
        {isSecurityLead && (
          <button
            onClick={() => setShowNewForm(v => !v)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
          >
            <Plus size={15} />
            New Request
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md px-4 py-3 text-sm font-medium bg-red-50 text-red-800 border border-red-200">{error}</div>
      )}

      {/* New request form */}
      {showNewForm && isSecurityLead && (
        <Card>
          <CardHeader><h2 className="text-sm font-semibold text-slate-700">New Change Request</h2></CardHeader>
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
                <select value={newForm.type} onChange={e => setNewForm(f => ({ ...f, type: e.target.value }))} className={inputCls}>
                  <option value="REEVALUATE">REVISION</option>
                  <option value="CREATE">CREATE</option>
                  <option value="DEPRECATE">DEPRECATE</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">SCC</label>
                <select value={newForm.scc_id} onChange={e => setNewForm(f => ({ ...f, scc_id: e.target.value }))} className={inputCls}>
                  <option value="">— Select SCC —</option>
                  {sccs.map(s => <option key={s.id} value={s.id}>{s.id} — {s.title}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Reason</label>
                <textarea
                  value={newForm.reason}
                  onChange={e => setNewForm(f => ({ ...f, reason: e.target.value }))}
                  rows={3}
                  className={inputCls}
                  placeholder="Explain why this change is needed…"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => newMut.mutate()}
                disabled={!newForm.scc_id || !newForm.reason || newMut.isPending}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
              >
                {newMut.isPending ? "Submitting…" : "Submit Request"}
              </button>
              <button onClick={() => setShowNewForm(false)} className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2 rounded-md transition-colors">
                Cancel
              </button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Unified table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-700">All Requests</h2>
              <span className="bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 rounded-full border border-amber-200">{pending.length} pending</span>
              {decided.length > 0 && (
                <span className="bg-slate-100 text-slate-500 text-xs font-medium px-2 py-0.5 rounded-full border border-slate-200">{decided.length} decided</span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400 mr-0.5">Type</span>
                {TYPES.map(t => (
                  <FilterPill
                    key={t}
                    label={TYPE_LABELS[t] ?? t}
                    active={typeFilter.size === 0 || typeFilter.has(t)}
                    color={TYPE_COLORS[t]}
                    onClick={() => setTypeFilter(prev => toggle(prev, t))}
                  />
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400 mr-0.5">Status</span>
                {STATUSES.map(s => (
                  <FilterPill
                    key={s}
                    label={s}
                    active={statusFilter.size === 0 || statusFilter.has(s)}
                    color={STATUS_COLORS[s]}
                    onClick={() => setStatusFilter(prev => toggle(prev, s))}
                  />
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400">No change requests match the selected filters.</div>
          ) : (
            <div>
              {filtered.map(cr => {
                const isDecided = cr.status !== "PENDING";
                const isExpanded = expandedId === cr.id;
                return (
                  <div key={cr.id} className={`border-b border-slate-100 last:border-0 ${isDecided ? "opacity-50" : ""}`}>
                    <div
                      className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 cursor-pointer"
                      onClick={() => toggleExpand(cr.id)}
                    >
                      <span className="font-mono text-xs text-slate-400 w-32 flex-shrink-0">{cr.id}</span>
                      <TypeBadge type={cr.type} />
                      <span className="font-mono text-xs text-slate-500 w-16 flex-shrink-0">{cr.scc_id}</span>
                      <span className="text-xs text-slate-600 flex-1 truncate">{cr.reason}</span>
                      <span className="text-xs text-slate-400 flex-shrink-0">{cr.requested_on}</span>
                      <Badge value={cr.status} />
                      {isExpanded ? <ChevronUp size={14} className="text-slate-400 flex-shrink-0" /> : <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />}
                    </div>

                    {isExpanded && (
                      <div className="px-5 pb-4 bg-slate-50 border-t border-slate-100">
                        <div className="pt-3 space-y-1 text-sm">
                          <div><span className="text-xs font-medium text-slate-400">Requested by: </span><span className="text-xs text-slate-600">{cr.requested_by}</span></div>
                          <div><span className="text-xs font-medium text-slate-400">Reason: </span><span className="text-xs text-slate-600">{cr.reason}</span></div>
                          {cr.decided_by && <div><span className="text-xs font-medium text-slate-400">Decided by: </span><span className="text-xs text-slate-600">{cr.decided_by} on {cr.decided_on}</span></div>}
                          {cr.auditor_note && <div><span className="text-xs font-medium text-slate-400">Auditor note: </span><span className="text-xs text-slate-600">{cr.auditor_note}</span></div>}
                        </div>

                        {isAuditor && !isDecided && !approveFor && !rejectFor && (
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={() => { setApproveFor(cr.id); setRejectFor(null); }}
                              className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded px-3 py-1.5 transition-colors"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => { setRejectFor(cr.id); setApproveFor(null); }}
                              className="text-xs bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded px-3 py-1.5 transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        )}

                        {approveFor === cr.id && (
                          <div className="mt-3 p-3 bg-emerald-50 rounded-md border border-emerald-100">
                            <div className="text-xs font-semibold text-slate-700 mb-2">Approve — {cr.id}</div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="col-span-2">
                                <label className="block text-xs font-medium text-slate-600 mb-1">Auditor Note</label>
                                <textarea value={approveForm.auditor_note} onChange={e => setApproveForm(f => ({ ...f, auditor_note: e.target.value }))} rows={2} className={inputCls} placeholder="Approval rationale…" />
                              </div>
                              <div className="col-span-2">
                                <label className="block text-xs font-medium text-slate-600 mb-1">Assertion Text</label>
                                <input value={approveForm.assertion_text} onChange={e => setApproveForm(f => ({ ...f, assertion_text: e.target.value }))} className={inputCls} placeholder="Security assertion text…" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">Target Uptime %</label>
                                <input type="number" value={approveForm.target_uptime_pct} onChange={e => setApproveForm(f => ({ ...f, target_uptime_pct: e.target.value }))} className={inputCls} placeholder="99.0" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">Rolling Window (days)</label>
                                <input type="number" value={approveForm.rolling_window_days} onChange={e => setApproveForm(f => ({ ...f, rolling_window_days: e.target.value }))} className={inputCls} placeholder="365" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">Max Single Downtime (days)</label>
                                <input type="number" value={approveForm.max_single_downtime_days} onChange={e => setApproveForm(f => ({ ...f, max_single_downtime_days: e.target.value }))} className={inputCls} placeholder="7" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">Evidence Type</label>
                                <input value={approveForm.evidence_type} onChange={e => setApproveForm(f => ({ ...f, evidence_type: e.target.value }))} className={inputCls} placeholder="e.g. automated_scan" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">Pinned Controls (comma-sep)</label>
                                <input value={approveForm.pinned_controls} onChange={e => setApproveForm(f => ({ ...f, pinned_controls: e.target.value }))} className={inputCls} placeholder="CTL-01, CTL-02" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">Effective On</label>
                                <input type="date" value={approveForm.effective_on} onChange={e => setApproveForm(f => ({ ...f, effective_on: e.target.value }))} className={inputCls} />
                              </div>
                            </div>
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => {
                                  const payload: Record<string, unknown> = { auditor_note: approveForm.auditor_note, assertion_text: approveForm.assertion_text || undefined, effective_on: approveForm.effective_on || undefined };
                                  if (approveForm.target_uptime_pct) payload.target_uptime_pct = parseFloat(approveForm.target_uptime_pct);
                                  if (approveForm.rolling_window_days) payload.rolling_window_days = parseInt(approveForm.rolling_window_days);
                                  if (approveForm.max_single_downtime_days) payload.max_single_downtime_days = parseInt(approveForm.max_single_downtime_days);
                                  if (approveForm.evidence_type) payload.evidence_type = approveForm.evidence_type;
                                  if (approveForm.pinned_controls) payload.pinned_controls = approveForm.pinned_controls.split(",").map(s => s.trim()).filter(Boolean);
                                  approveMut.mutate({ id: cr.id, payload });
                                }}
                                disabled={approveMut.isPending}
                                className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-3 py-1.5 rounded-md disabled:opacity-50 transition-colors"
                              >
                                {approveMut.isPending ? "Approving…" : "Confirm Approval"}
                              </button>
                              <button onClick={() => setApproveFor(null)} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-3 py-1.5 rounded-md transition-colors">Cancel</button>
                            </div>
                          </div>
                        )}

                        {rejectFor === cr.id && (
                          <div className="mt-3 p-3 bg-red-50 rounded-md border border-red-100">
                            <div className="text-xs font-semibold text-slate-700 mb-2">Reject — {cr.id}</div>
                            <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={2} className={inputCls} placeholder="Rejection reason (required)…" />
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => rejectMut.mutate({ id: cr.id, auditor_note: rejectNote })}
                                disabled={!rejectNote || rejectMut.isPending}
                                className="text-xs bg-red-600 hover:bg-red-700 text-white font-medium px-3 py-1.5 rounded-md disabled:opacity-50 transition-colors"
                              >
                                {rejectMut.isPending ? "Rejecting…" : "Confirm Rejection"}
                              </button>
                              <button onClick={() => setRejectFor(null)} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-3 py-1.5 rounded-md transition-colors">Cancel</button>
                            </div>
                          </div>
                        )}

                        <CRNotes crId={cr.id} actorId={actorId} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
