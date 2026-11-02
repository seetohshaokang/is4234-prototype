import { Fragment, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { XCircle, Plus, ShieldAlert, ChevronDown, ChevronRight } from "lucide-react";
import api from "../api/client";
import { useAppStore } from "../store/useAppStore";
import Badge from "../components/Badge";
import Card, { CardHeader, CardBody } from "../components/Card";

interface RiskAcceptance {
  id: number;
  status: string;
  rationale: string;
  expires_on: string;
}

interface Finding {
  id: string;
  control_id: string;
  severity: string;
  status: string;
  opened_on: string;
  closed_on?: string;
  title: string;
  description?: string;
  owner_id: string;
  raised_by_id: string;
  risk_acceptances?: RiskAcceptance[];
}

interface Control {
  id: string;
  name: string;
}

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

const inputCls =
  "w-full text-sm border border-slate-300 rounded-md px-3 py-1.5 focus:outline-none focus:border-blue-500";

export default function FindingsPage() {
  const { actorId } = useAppStore();
  const qc = useQueryClient();
  const [showReport, setShowReport] = useState(false);
  const [report, setReport] = useState({ control_id: "", title: "", description: "", severity: "HIGH" });
  const [raFor, setRaFor] = useState<string | null>(null);
  const [ra, setRa] = useState({ rationale: "", cost_benefit_note: "", expires_on: "" });
  const [error, setError] = useState("");

  const { data: findings = [], isLoading } = useQuery<Finding[]>({
    queryKey: ["findings"],
    queryFn: () => api.get("/findings").then(r => r.data),
  });

  const { data: controls = [] } = useQuery<Control[]>({
    queryKey: ["controls"],
    queryFn: () => api.get("/controls").then(r => r.data),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["findings"] });
    qc.invalidateQueries({ queryKey: ["gate"] });
    qc.invalidateQueries({ queryKey: ["claims"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const closeMut = useMutation({
    mutationFn: (id: string) => api.post(`/findings/${id}/close`, { actor_id: actorId }),
    onSuccess: invalidate,
  });

  const createMut = useMutation({
    mutationFn: () => api.post("/findings", { ...report, actor_id: actorId }),
    onSuccess: () => {
      invalidate();
      setShowReport(false);
      setReport({ control_id: "", title: "", description: "", severity: "HIGH" });
      setError("");
    },
    onError: (e: any) => setError(e.response?.data?.detail ?? "Failed to create finding"),
  });

  const proposeMut = useMutation({
    mutationFn: (findingId: string) =>
      api.post(`/findings/${findingId}/risk-acceptance`, { ...ra, actor_id: actorId }),
    onSuccess: () => {
      invalidate();
      setRaFor(null);
      setRa({ rationale: "", cost_benefit_note: "", expires_on: "" });
      setError("");
    },
    onError: (e: any) => setError(e.response?.data?.detail ?? "Failed to propose risk acceptance"),
  });

  const approveMut = useMutation({
    mutationFn: (raId: number) => api.post(`/risk-acceptances/${raId}/approve`, { actor_id: actorId }),
    onSuccess: invalidate,
    onError: (e: any) => setError(e.response?.data?.detail ?? "Failed to approve risk acceptance"),
  });

  const open = findings.filter(f => f.status === "OPEN");
  const closed = findings.filter(f => f.status !== "OPEN");

  if (isLoading) return <div className="text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Findings</h1>
          <p className="text-sm text-slate-500">Security findings from automated and manual tests.</p>
        </div>
        <button
          data-tour="report-finding"
          onClick={() => setShowReport(v => !v)}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
        >
          <Plus size={16} /> Report Finding
        </button>
      </div>

      {error && (
        <div className="rounded-md px-4 py-3 text-sm font-medium bg-red-50 text-red-800 border border-red-200">
          {error}
        </div>
      )}

      {showReport && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-700">Report a finding as {actorId}</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Control</label>
                <select
                  value={report.control_id}
                  onChange={e => setReport({ ...report, control_id: e.target.value })}
                  className={inputCls}
                >
                  <option value="">Select control…</option>
                  {controls.map(c => (
                    <option key={c.id} value={c.id}>{c.id} — {c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Severity</label>
                <select
                  value={report.severity}
                  onChange={e => setReport({ ...report, severity: e.target.value })}
                  className={inputCls}
                >
                  {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Title</label>
              <input
                value={report.title}
                onChange={e => setReport({ ...report, title: e.target.value })}
                placeholder="e.g. Contractor laptops can reach prod DB"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Description</label>
              <textarea
                value={report.description}
                onChange={e => setReport({ ...report, description: e.target.value })}
                rows={2}
                className={inputCls}
              />
            </div>
            <button
              onClick={() => createMut.mutate()}
              disabled={!report.control_id || !report.title || createMut.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50 transition-colors"
            >
              Submit finding
            </button>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Open Findings</h2>
            <span className="bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded-full">{open.length}</span>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {open.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400">No open findings</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="w-8 px-3"></th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">ID</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">Control</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">Title</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">Severity</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">Opened</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {open.map(f => (
                  <Fragment key={f.id}>
                    <tr className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                      <td
                        className="px-3 py-2.5 text-slate-400 cursor-pointer"
                        onClick={() => setRaFor(raFor === f.id ? null : f.id)}
                      >
                        {raFor === f.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{f.id}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-blue-600">{f.control_id}</td>
                      <td className="px-3 py-2.5 text-slate-700">{f.title}</td>
                      <td className="px-3 py-2.5"><Badge value={f.severity} /></td>
                      <td className="px-3 py-2.5 text-xs text-slate-400">{f.opened_on}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-3 justify-end">
                          <button
                            onClick={() => setRaFor(raFor === f.id ? null : f.id)}
                            className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800"
                          >
                            <ShieldAlert size={13} /> Risk
                          </button>
                          <button
                            onClick={() => closeMut.mutate(f.id)}
                            disabled={closeMut.isPending}
                            className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                          >
                            <XCircle size={13} /> Close
                          </button>
                        </div>
                      </td>
                    </tr>
                    {raFor === f.id && (
                      <tr className="bg-amber-50/60 border-b border-slate-100">
                        <td colSpan={7} className="px-8 py-4">
                          <div className="space-y-3">
                            {(f.risk_acceptances ?? []).length > 0 && (
                              <div>
                                <div className="text-xs font-medium text-slate-500 mb-1">Risk acceptances</div>
                                {f.risk_acceptances!.map(r => (
                                  <div key={r.id} className="flex items-center gap-3 bg-white rounded border border-slate-200 px-3 py-2 mb-1">
                                    <Badge value={r.status} />
                                    <span className="text-xs text-slate-600 flex-1">{r.rationale}</span>
                                    <span className="text-xs text-slate-400">expires {r.expires_on}</span>
                                    {r.status === "PROPOSED" && (
                                      <button
                                        onClick={() => approveMut.mutate(r.id)}
                                        disabled={approveMut.isPending}
                                        className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded px-2 py-1 disabled:opacity-50"
                                      >
                                        Approve
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="grid grid-cols-3 gap-3">
                              <div className="col-span-2 space-y-2">
                                <input
                                  value={ra.rationale}
                                  onChange={e => setRa({ ...ra, rationale: e.target.value })}
                                  placeholder="Rationale (e.g. compensating controls in place)"
                                  className={inputCls}
                                />
                                <input
                                  value={ra.cost_benefit_note}
                                  onChange={e => setRa({ ...ra, cost_benefit_note: e.target.value })}
                                  placeholder="Cost-benefit note"
                                  className={inputCls}
                                />
                              </div>
                              <div className="space-y-2">
                                <input
                                  type="date"
                                  value={ra.expires_on}
                                  onChange={e => setRa({ ...ra, expires_on: e.target.value })}
                                  className={inputCls}
                                />
                                <button
                                  onClick={() => proposeMut.mutate(f.id)}
                                  disabled={!ra.rationale || !ra.expires_on || proposeMut.isPending}
                                  className="w-full bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-3 py-1.5 rounded-md disabled:opacity-50 transition-colors"
                                >
                                  Propose risk acceptance
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {closed.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-500">Closed Findings ({closed.length})</h2>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">ID</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Control</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Title</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Severity</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Closed</th>
                </tr>
              </thead>
              <tbody>
                {closed.map(f => (
                  <tr key={f.id} className="border-b border-slate-50 last:border-0 opacity-60">
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-400">{f.id}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-400">{f.control_id}</td>
                    <td className="px-5 py-2.5 text-slate-500">{f.title}</td>
                    <td className="px-5 py-2.5"><Badge value={f.severity} /></td>
                    <td className="px-5 py-2.5 text-xs text-slate-400">{f.closed_on ?? "—"}</td>
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
