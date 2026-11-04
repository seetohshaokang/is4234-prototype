import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight } from "lucide-react";
import api from "../api/client";
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

  const { data: scc, isLoading, error } = useQuery<SCCDetail>({
    queryKey: ["scc", id],
    queryFn: () => api.get(`/sccs/${id}`).then(r => r.data),
    enabled: !!id,
  });

  if (isLoading) return <div className="text-slate-400 text-sm">Loading…</div>;
  if (error || !scc) return (
    <div className="text-red-600 text-sm">
      Failed to load SCC {id}. {(error as any)?.message}
    </div>
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

    </div>
  );
}
