import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight } from "lucide-react";
import api from "../api/client";
import { useAppStore } from "../store/useAppStore";
import Card, { CardHeader, CardBody } from "../components/Card";

interface Interval {
  from: string;
  to: string | null;
  state: string;
  days: number;
}

interface SCCVersion {
  id: string;
  version: number;
  status: string;
  active_from: string;
  active_to: string | null;
  uptime_pct: number | null;
  target_uptime_pct: number | null;
  assertion_text: string | null;
  evidence_type: string | null;
  rolling_window_days: number | null;
  superseded_while_down: boolean;
  deprecated_while_down: boolean;
  intervals: Interval[];
  controls: Array<{ id: string; name: string; last_outcome: string | null }>;
}

interface SCCDetail {
  id: string;
  title: string;
  owner_id: string;
  versions: SCCVersion[];
}

interface Citation {
  id: string;
  sccversion_id: string;
  kind: string;
  period_from: string;
  period_to: string;
  uptime_pct: number;
  unknown_pct: number;
  target_met: boolean;
  citation_string: string;
  issued_by: string;
  issued_on: string;
  record_hash: string;
}

function stateColor(state: string) {
  switch (state) {
    case "UPHELD":     return "#16a34a"; // green-600
    case "DOWN":       return "#dc2626"; // red-600
    case "UNKNOWN":    return "#9ca3af"; // gray-400
    case "NOT_ACTIVE": return "#e2e8f0"; // slate-200
    default:           return "#e2e8f0";
  }
}

function IntervalBar({ intervals }: { intervals: Interval[] }) {
  const total = intervals.reduce((acc, i) => acc + (i.days || 1), 0);
  if (total === 0) return null;

  return (
    <div className="flex h-5 rounded overflow-hidden border border-slate-200 mt-2" title="Timeline of SCC states">
      {intervals.map((seg, idx) => {
        const widthPct = ((seg.days || 1) / total) * 100;
        return (
          <div
            key={idx}
            style={{ width: `${widthPct}%`, backgroundColor: stateColor(seg.state), minWidth: "2px" }}
            title={`${seg.state}: ${seg.from} → ${seg.to ?? "present"} (${seg.days}d)`}
          />
        );
      })}
    </div>
  );
}

function versionStatusBadge(status: string) {
  const cls = status === "ACTIVE"
    ? "bg-green-100 text-green-700 border-green-200"
    : status === "SUPERSEDED"
    ? "bg-amber-100 text-amber-700 border-amber-200"
    : status === "DEPRECATED"
    ? "bg-slate-100 text-slate-500 border-slate-200"
    : "bg-blue-100 text-blue-700 border-blue-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {status}
    </span>
  );
}

export default function SCCDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { actorId } = useAppStore();
  const [citeForm, setCiteForm] = useState({ sccversion_id: "", period_from: "", period_to: "", kind: "ANNUAL" });
  const [citeResult, setCiteResult] = useState<Citation | null>(null);
  const [citeError, setCiteError] = useState("");

  const { data: scc, isLoading, error } = useQuery<SCCDetail>({
    queryKey: ["scc", id],
    queryFn: () => api.get(`/sccs/${id}`).then(r => r.data),
    enabled: !!id,
  });

  const { data: citations = [] } = useQuery<Citation[]>({
    queryKey: ["citations"],
    queryFn: () => api.get("/citations").then(r => r.data),
  });

  const citeMut = useMutation({
    mutationFn: (payload: object) => api.post("/citations/generate", payload).then(r => r.data),
    onSuccess: (data: Citation) => {
      setCiteResult(data);
      setCiteError("");
    },
    onError: (e: any) => setCiteError(e.response?.data?.detail ?? "Citation generation failed"),
  });

  if (isLoading) return <div className="text-slate-400 text-sm">Loading…</div>;
  if (error || !scc) return (
    <div className="text-red-600 text-sm">
      Failed to load SCC {id}. {(error as any)?.message}
    </div>
  );

  const sccCitations = citations.filter(c =>
    scc.versions.some(v => v.id === c.sccversion_id)
  );

  const sortedVersions = [...scc.versions].sort((a, b) => a.version - b.version);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => navigate("/sccs")}
          className="mt-1 text-slate-400 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-slate-400">{scc.id}</span>
            <ChevronRight size={14} className="text-slate-300" />
            <h1 className="text-2xl font-bold text-slate-900">{scc.title}</h1>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">Owner: {scc.owner_id}</p>
        </div>
      </div>

      {/* Version chain */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-slate-700">Version Chain</h2>
        {sortedVersions.map((ver, idx) => (
          <Card key={ver.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold text-slate-700">v{ver.version}</span>
                  {versionStatusBadge(ver.status)}
                  {ver.superseded_while_down && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-red-50 text-red-700 border-red-200">
                      superseded while DOWN
                    </span>
                  )}
                  {ver.deprecated_while_down && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-red-50 text-red-700 border-red-200">
                      deprecated while DOWN
                    </span>
                  )}
                </div>
                {idx < sortedVersions.length - 1 && (
                  <span className="text-xs text-slate-400 italic">superseded by v{sortedVersions[idx + 1].version}</span>
                )}
              </div>
              <div className="flex gap-6 mt-2 text-xs text-slate-500">
                <span>Active: {ver.active_from} → {ver.active_to ?? "present"}</span>
                {ver.uptime_pct != null && (
                  <span className={ver.uptime_pct >= (ver.target_uptime_pct ?? 99) ? "text-green-700 font-medium" : "text-red-600 font-medium"}>
                    Uptime: {ver.uptime_pct.toFixed(2)}% {ver.target_uptime_pct != null && `(target ${ver.target_uptime_pct}%)`}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardBody>
              {ver.assertion_text && (
                <p className="text-sm text-slate-600 italic mb-3">"{ver.assertion_text}"</p>
              )}

              {/* Interval timeline bar */}
              {ver.intervals && ver.intervals.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs text-slate-500 mb-1">State timeline</div>
                  <IntervalBar intervals={ver.intervals} />
                  <div className="flex gap-3 mt-1.5 text-xs text-slate-500">
                    {["UPHELD", "DOWN", "UNKNOWN", "NOT_ACTIVE"].map(s => (
                      <span key={s} className="flex items-center gap-1">
                        <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: stateColor(s) }} />
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Interval detail table */}
              {ver.intervals && ver.intervals.length > 0 && (
                <div className="mt-2">
                  <div className="text-xs text-slate-500 mb-1">Interval breakdown</div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left py-1 pr-4 font-medium text-slate-400">From</th>
                        <th className="text-left py-1 pr-4 font-medium text-slate-400">To</th>
                        <th className="text-left py-1 pr-4 font-medium text-slate-400">State</th>
                        <th className="text-left py-1 font-medium text-slate-400">Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ver.intervals.map((seg, i) => (
                        <tr key={i} className="border-b border-slate-50 last:border-0">
                          <td className="py-1 pr-4 font-mono text-slate-500">{seg.from}</td>
                          <td className="py-1 pr-4 font-mono text-slate-500">{seg.to ?? "—"}</td>
                          <td className="py-1 pr-4">
                            <span className="inline-flex items-center gap-1">
                              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: stateColor(seg.state) }} />
                              {seg.state}
                            </span>
                          </td>
                          <td className="py-1 text-slate-500">{seg.days}d</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pinned controls */}
              {ver.controls && ver.controls.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs text-slate-500 mb-1">Pinned controls</div>
                  <div className="flex gap-2 flex-wrap">
                    {ver.controls.map(ctl => (
                      <span
                        key={ctl.id}
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-mono border ${
                          ctl.last_outcome === "PASS"
                            ? "bg-green-50 text-green-700 border-green-200"
                            : ctl.last_outcome === "FAIL"
                            ? "bg-red-50 text-red-700 border-red-200"
                            : "bg-slate-50 text-slate-600 border-slate-200"
                        }`}
                        title={ctl.name}
                      >
                        {ctl.id}
                        {ctl.last_outcome && <span className="text-xs opacity-70">({ctl.last_outcome})</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Cite this SCC */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-700">Cite this SCC</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">SCC Version</label>
              <select
                value={citeForm.sccversion_id}
                onChange={e => setCiteForm(f => ({ ...f, sccversion_id: e.target.value }))}
                className="w-full text-sm border border-slate-300 rounded-md px-3 py-1.5 focus:outline-none focus:border-blue-500"
              >
                <option value="">Select version…</option>
                {scc.versions.map(v => (
                  <option key={v.id} value={v.id}>{v.id} (v{v.version}, {v.status})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Kind</label>
              <select
                value={citeForm.kind}
                onChange={e => setCiteForm(f => ({ ...f, kind: e.target.value }))}
                className="w-full text-sm border border-slate-300 rounded-md px-3 py-1.5 focus:outline-none focus:border-blue-500"
              >
                <option value="ANNUAL">ANNUAL</option>
                <option value="QUARTERLY">QUARTERLY</option>
                <option value="CUSTOM">CUSTOM</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Period From</label>
              <input
                type="date"
                value={citeForm.period_from}
                onChange={e => setCiteForm(f => ({ ...f, period_from: e.target.value }))}
                className="w-full text-sm border border-slate-300 rounded-md px-3 py-1.5 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Period To</label>
              <input
                type="date"
                value={citeForm.period_to}
                onChange={e => setCiteForm(f => ({ ...f, period_to: e.target.value }))}
                className="w-full text-sm border border-slate-300 rounded-md px-3 py-1.5 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <button
            onClick={() => citeMut.mutate({
              sccversion_id: citeForm.sccversion_id,
              period_from: citeForm.period_from,
              period_to: citeForm.period_to,
              kind: citeForm.kind,
              issued_by: actorId,
            })}
            disabled={!citeForm.sccversion_id || !citeForm.period_from || !citeForm.period_to || citeMut.isPending}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50 transition-colors"
          >
            {citeMut.isPending ? "Generating…" : "Generate Citation"}
          </button>

          {citeError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {citeError}
            </div>
          )}

          {citeResult && (
            <div className="bg-slate-50 border border-slate-200 rounded-md p-4">
              <div className="text-xs font-medium text-slate-500 mb-1">Citation string</div>
              <div className="font-mono text-sm text-slate-800 select-all">{citeResult.citation_string}</div>
              <div className="mt-2 flex gap-6 text-xs text-slate-500">
                <span>Uptime: <strong className={citeResult.target_met ? "text-green-700" : "text-red-600"}>{citeResult.uptime_pct.toFixed(2)}%</strong></span>
                <span>Target met: <strong className={citeResult.target_met ? "text-green-700" : "text-red-600"}>{citeResult.target_met ? "Yes" : "No"}</strong></span>
                <span>Issued by: {citeResult.issued_by}</span>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Existing citations for this SCC */}
      {sccCitations.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-700">Issued Citations ({sccCitations.length})</h2>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Citation</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Period</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Uptime %</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Target Met</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Issued By</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Issued On</th>
                </tr>
              </thead>
              <tbody>
                {sccCitations.map(c => (
                  <tr key={c.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-600 max-w-xs truncate">{c.citation_string}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-500">{c.period_from} → {c.period_to}</td>
                    <td className="px-5 py-2.5 text-xs font-medium">
                      <span className={c.target_met ? "text-green-700" : "text-red-600"}>{c.uptime_pct.toFixed(2)}%</span>
                    </td>
                    <td className="px-5 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${c.target_met ? "bg-green-100 text-green-700 border-green-200" : "bg-red-100 text-red-700 border-red-200"}`}>
                        {c.target_met ? "Yes" : "No"}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-400">{c.issued_by}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-400">{c.issued_on}</td>
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
