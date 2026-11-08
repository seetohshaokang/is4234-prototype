import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import api from "../api/client";
import { useAppStore } from "../store/useAppStore";
import Card, { CardBody, CardHeader } from "../components/Card";

interface SCC {
  id: string;
  title: string;
  owner_id: string;
  current_state: string;
  active_version_id: string | null;
  versions: Array<{ id: string; version: number; status: string }>;
  rolling_uptime_pct: number | null;
}

const COMPANY = "SolarWinds";
const AUDITOR = "Meridian Assurance Group";

const inputCls = "w-full text-sm border border-slate-300 rounded-md px-3 py-1.5 focus:outline-none focus:border-blue-500";

function stateBadgeClass(state: string) {
  switch (state) {
    case "UPHELD":     return "bg-green-100 text-green-700 border-green-200";
    case "DOWN":       return "bg-red-100 text-red-700 border-red-200";
    case "UNKNOWN":    return "bg-gray-100 text-gray-700 border-gray-200";
    case "NOT_ACTIVE": return "bg-slate-100 text-slate-500 border-slate-200";
    default:           return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

function StateBadge({ state }: { state: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${stateBadgeClass(state)}`}>
      {state}
    </span>
  );
}

export default function SCCLibrary() {
  const navigate = useNavigate();
  const { actorId } = useAppStore();
  const qc = useQueryClient();
  const [showNewForm, setShowNewForm] = useState(false);
  const [newForm, setNewForm] = useState({
    scc_id: "", title: "", owner_id: "", assertion_text: "",
    target_uptime_pct: "99.0", rolling_window_days: "365",
    max_single_downtime_days: "7", evidence_type: "TESTED",
  });
  const [error, setError] = useState("");

  const { data: personas = [] } = useQuery<{ id: string; name: string; role: string }[]>({
    queryKey: ["personas"],
    queryFn: () => api.get("/personas").then(r => r.data),
  });
  const isAuditor = personas.find(p => p.id === actorId)?.role === "independent_auditor";

  const { data: sccs = [], isLoading } = useQuery<SCC[]>({
    queryKey: ["sccs"],
    queryFn: () => api.get("/sccs").then(r => r.data),
  });

  const createMut = useMutation({
    mutationFn: () => api.post("/sccs", {
      scc_id: newForm.scc_id,
      title: newForm.title,
      owner_id: newForm.owner_id,
      assertion_text: newForm.assertion_text,
      target_uptime_pct: parseFloat(newForm.target_uptime_pct),
      rolling_window_days: parseInt(newForm.rolling_window_days),
      max_single_downtime_days: parseInt(newForm.max_single_downtime_days),
      evidence_type: newForm.evidence_type,
    }, { params: { actor_id: actorId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sccs"] });
      setShowNewForm(false);
      setNewForm({ scc_id: "", title: "", owner_id: "", assertion_text: "", target_uptime_pct: "99.0", rolling_window_days: "365", max_single_downtime_days: "7", evidence_type: "TESTED" });
      setError("");
    },
    onError: (e: any) => setError(e.response?.data?.detail ?? "Create failed"),
  });

  if (isLoading) return <div className="text-slate-400 text-sm">Loading…</div>;

  const latestVersion = (scc: SCC) => {
    if (!scc.versions || scc.versions.length === 0) return "—";
    const max = Math.max(...scc.versions.map(v => v.version));
    return `v${max}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">SCC Library</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Security Citation Codes — measurable security assertions tracked like SLAs.
          </p>
        </div>
        {isAuditor && (
          <button
            onClick={() => setShowNewForm(v => !v)}
            className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
          >
            <Plus size={15} />
            New SCC
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md px-4 py-3 text-sm font-medium bg-red-50 text-red-800 border border-red-200">{error}</div>
      )}

      {showNewForm && isAuditor && (
        <Card>
          <CardHeader><h2 className="text-sm font-semibold text-slate-700">New SCC</h2></CardHeader>
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">SCC ID <span className="text-slate-400">(e.g. SCC-08)</span></label>
                <input value={newForm.scc_id} onChange={e => setNewForm(f => ({ ...f, scc_id: e.target.value }))} className={inputCls} placeholder="SCC-08" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
                <input value={newForm.title} onChange={e => setNewForm(f => ({ ...f, title: e.target.value }))} className={inputCls} placeholder="Short descriptive title" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Owner</label>
                <select value={newForm.owner_id} onChange={e => setNewForm(f => ({ ...f, owner_id: e.target.value }))} className={inputCls}>
                  <option value="">— Select owner —</option>
                  {personas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Evidence Type</label>
                <select value={newForm.evidence_type} onChange={e => setNewForm(f => ({ ...f, evidence_type: e.target.value }))} className={inputCls}>
                  <option value="TESTED">TESTED</option>
                  <option value="ATTESTED">ATTESTED</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Assertion Text <span className="text-slate-400">(separate criteria with semicolons)</span></label>
                <textarea value={newForm.assertion_text} onChange={e => setNewForm(f => ({ ...f, assertion_text: e.target.value }))} rows={3} className={inputCls} placeholder="Criteria A; Criteria B; Criteria C" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Target Uptime %</label>
                <input type="number" value={newForm.target_uptime_pct} onChange={e => setNewForm(f => ({ ...f, target_uptime_pct: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Rolling Window (days)</label>
                <input type="number" value={newForm.rolling_window_days} onChange={e => setNewForm(f => ({ ...f, rolling_window_days: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Max Single Downtime (days)</label>
                <input type="number" value={newForm.max_single_downtime_days} onChange={e => setNewForm(f => ({ ...f, max_single_downtime_days: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => createMut.mutate()}
                disabled={!newForm.scc_id || !newForm.title || !newForm.assertion_text || !newForm.owner_id || createMut.isPending}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
              >
                {createMut.isPending ? "Creating…" : "Create SCC"}
              </button>
              <button onClick={() => { setShowNewForm(false); setError(""); }} className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2 rounded-md transition-colors">
                Cancel
              </button>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="p-0">
          {sccs.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-400">
              No SCCs found. Apply checkpoint CP1 to populate the library.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-3 text-xs font-medium text-slate-500">SCC ID</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-slate-500">Title</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-slate-500">Current State</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-slate-500">Latest Version</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-slate-500">Rolling Uptime %</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-slate-500">Company</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-slate-500">Audited by</th>
                </tr>
              </thead>
              <tbody>
                {sccs.map(scc => (
                  <tr
                    key={scc.id}
                    className="border-b border-slate-50 last:border-0 hover:bg-slate-50 cursor-pointer"
                    onClick={() => navigate(`/sccs/${scc.id}`)}
                  >
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500 font-medium">{scc.id}</td>
                    <td className="px-5 py-2.5 text-slate-800 font-medium">{scc.title}</td>
                    <td className="px-5 py-2.5"><StateBadge state={scc.current_state} /></td>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{latestVersion(scc)}</td>
                    <td className="px-5 py-2.5 text-slate-600">
                      {scc.rolling_uptime_pct != null ? (
                        <span className={scc.rolling_uptime_pct >= 99 ? "text-green-700 font-medium" : "text-red-600 font-medium"}>
                          {scc.rolling_uptime_pct.toFixed(1)}%
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-slate-600">{COMPANY}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-500">{AUDITOR}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
