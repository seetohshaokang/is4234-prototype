import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import Badge from "../components/Badge";
import Card, { CardHeader, CardBody } from "../components/Card";

interface Finding {
  id: string;
  control_id: string;
  severity: string;
  status: string;
  opened_on: string;
  closed_on: string | null;
  days_open: number | null;
  source: string;
  title: string;
  description: string;
}

function severityBadgeClass(severity: string) {
  switch (severity) {
    case "CRITICAL": return "bg-red-100 text-red-800 border-red-200";
    case "HIGH":     return "bg-orange-100 text-orange-800 border-orange-200";
    case "MEDIUM":   return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "LOW":      return "bg-gray-100 text-gray-700 border-gray-200";
    default:         return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${severityBadgeClass(severity)}`}>
      {severity}
    </span>
  );
}

export default function FindingsPage() {
  const { data: findings = [], isLoading } = useQuery<Finding[]>({
    queryKey: ["findings"],
    queryFn: () => api.get("/findings").then(r => r.data),
  });

  if (isLoading) return <div className="text-slate-400 text-sm">Loading…</div>;

  const open = findings.filter(f => f.status === "OPEN");
  const closed = findings.filter(f => f.status !== "OPEN");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Findings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Security findings from automated and manual evidence tests.</p>
      </div>

      {/* Open findings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Open Findings</h2>
            <span className="bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded-full">{open.length}</span>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {open.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400">No open findings.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">ID</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Control</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Title</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Severity</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Status</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Days Open</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Opened On</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Source</th>
                </tr>
              </thead>
              <tbody>
                {open.map(f => (
                  <tr key={f.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{f.id}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-blue-600">{f.control_id}</td>
                    <td className="px-5 py-2.5 text-slate-700 font-medium">{f.title}</td>
                    <td className="px-5 py-2.5"><SeverityBadge severity={f.severity} /></td>
                    <td className="px-5 py-2.5"><Badge value={f.status} /></td>
                    <td className="px-5 py-2.5 text-xs text-slate-500">
                      {f.days_open != null ? (
                        <span className={f.days_open > 60 ? "text-red-600 font-medium" : ""}>{f.days_open}d</span>
                      ) : "—"}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-slate-400">{f.opened_on}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-400">{f.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {/* Closed findings */}
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
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Closed On</th>
                </tr>
              </thead>
              <tbody>
                {closed.map(f => (
                  <tr key={f.id} className="border-b border-slate-50 last:border-0 opacity-60">
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-400">{f.id}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-400">{f.control_id}</td>
                    <td className="px-5 py-2.5 text-slate-500">{f.title}</td>
                    <td className="px-5 py-2.5"><SeverityBadge severity={f.severity} /></td>
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
