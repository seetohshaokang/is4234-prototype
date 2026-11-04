import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import Card, { CardBody } from "../components/Card";

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

  const { data: sccs = [], isLoading } = useQuery<SCC[]>({
    queryKey: ["sccs"],
    queryFn: () => api.get("/sccs").then(r => r.data),
  });

  if (isLoading) return <div className="text-slate-400 text-sm">Loading…</div>;

  const latestVersion = (scc: SCC) => {
    if (!scc.versions || scc.versions.length === 0) return "—";
    const max = Math.max(...scc.versions.map(v => v.version));
    return `v${max}`;
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">SCC Library</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Security Citation Codes — measurable security assertions tracked like SLAs.
        </p>
      </div>

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
