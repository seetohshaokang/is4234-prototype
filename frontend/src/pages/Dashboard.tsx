import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import { useAppStore } from "../store/useAppStore";
import Badge from "../components/Badge";
import Card, { CardHeader, CardBody } from "../components/Card";

interface SCC {
  id: string;
  title: string;
  owner_id: string;
  current_state: string;
  active_version_id: string | null;
  rolling_uptime_pct: number | null;
}

interface Finding {
  id: string;
  status: string;
}

interface Escalation {
  id: number;
  level: number;
  status: string;
}

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

export default function Dashboard() {
  const { simDate } = useAppStore();
  const navigate = useNavigate();

  const { data: sccs = [], isLoading: sccsLoading } = useQuery<SCC[]>({
    queryKey: ["sccs"],
    queryFn: () => api.get("/sccs").then(r => r.data),
  });

  const { data: findings = [] } = useQuery<Finding[]>({
    queryKey: ["findings"],
    queryFn: () => api.get("/findings").then(r => r.data),
  });

  const { data: escalations = [] } = useQuery<Escalation[]>({
    queryKey: ["escalations"],
    queryFn: () => api.get("/escalations").then(r => r.data),
  });

  if (sccsLoading) return <div className="text-slate-400 text-sm">Loading…</div>;

  const upheldCount  = sccs.filter(s => s.current_state === "UPHELD").length;
  const downCount    = sccs.filter(s => s.current_state === "DOWN").length;
  const unknownCount = sccs.filter(s => s.current_state === "UNKNOWN").length;
  const openFindings = findings.filter(f => f.status === "OPEN").length;
  const highEscalations = escalations.filter(e => (e.level === 3 || e.level === 4) && e.status === "OPEN").length;

  const kpis = [
    { label: "Total SCCs",      value: sccs.length,    color: "text-blue-600" },
    { label: "UPHELD",          value: upheldCount,    color: "text-green-600" },
    { label: "DOWN",            value: downCount,      color: "text-red-600" },
    { label: "UNKNOWN",         value: unknownCount,   color: "text-gray-600" },
    { label: "Open Findings",   value: openFindings,   color: "text-amber-600" },
    { label: "L3/L4 Escalations (Open)", value: highEscalations, color: "text-purple-600" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Oversight Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">Sim date: {simDate}</p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpis.map(k => (
          <Card key={k.label}>
            <CardBody className="text-center py-5">
              <div className={`text-3xl font-bold ${k.color}`}>{k.value}</div>
              <div className="text-xs text-slate-500 mt-1 leading-tight">{k.label}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* SCC state summary table */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-700">SCC State Summary</h2>
        </CardHeader>
        <CardBody className="p-0">
          {sccs.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400">No SCCs yet. Apply checkpoint CP1 to begin.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">SCC ID</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Title</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">State</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Rolling Uptime</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Active Version</th>
                </tr>
              </thead>
              <tbody>
                {sccs.map(scc => (
                  <tr
                    key={scc.id}
                    className="border-b border-slate-50 last:border-0 hover:bg-slate-50 cursor-pointer"
                    onClick={() => navigate(`/sccs/${scc.id}`)}
                  >
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{scc.id}</td>
                    <td className="px-5 py-2.5 text-slate-700 font-medium">{scc.title}</td>
                    <td className="px-5 py-2.5"><StateBadge state={scc.current_state} /></td>
                    <td className="px-5 py-2.5 text-sm text-slate-600">
                      {scc.rolling_uptime_pct != null ? `${scc.rolling_uptime_pct.toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-400">
                      {scc.active_version_id ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {/* Open high-severity escalations */}
      {highEscalations > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-700">Open L3/L4 Escalations</h2>
              <span className="bg-purple-100 text-purple-700 text-xs font-medium px-2 py-0.5 rounded-full">{highEscalations}</span>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">ID</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Level</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {escalations
                  .filter(e => (e.level === 3 || e.level === 4) && e.status === "OPEN")
                  .map(e => (
                    <tr key={e.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{e.id}</td>
                      <td className="px-5 py-2.5">
                        <span className="text-xs font-semibold text-purple-600">L{e.level}</span>
                      </td>
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
