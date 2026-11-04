import { useState } from "react";
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

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const STATUSES = ["OPEN", "CLOSED"];

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800 border-red-200",
  HIGH:     "bg-orange-100 text-orange-800 border-orange-200",
  MEDIUM:   "bg-yellow-100 text-yellow-800 border-yellow-200",
  LOW:      "bg-gray-100 text-gray-700 border-gray-200",
};

const STATUS_COLORS: Record<string, string> = {
  OPEN:   "bg-red-100 text-red-700 border-red-200",
  CLOSED: "bg-slate-100 text-slate-500 border-slate-200",
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${SEVERITY_COLORS[severity] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
      {severity}
    </span>
  );
}

function FilterPill({
  label, active, color, onClick,
}: { label: string; active: boolean; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border transition-opacity ${color} ${active ? "opacity-100" : "opacity-35"}`}
    >
      {label}
    </button>
  );
}

export default function FindingsPage() {
  const [severityFilter, setSeverityFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());

  const { data: findings = [], isLoading } = useQuery<Finding[]>({
    queryKey: ["findings"],
    queryFn: () => api.get("/findings").then(r => r.data),
  });

  if (isLoading) return <div className="text-slate-400 text-sm">Loading…</div>;

  const toggle = (set: Set<string>, val: string): Set<string> => {
    const next = new Set(set);
    next.has(val) ? next.delete(val) : next.add(val);
    return next;
  };

  const filtered = findings.filter(f => {
    if (severityFilter.size > 0 && !severityFilter.has(f.severity)) return false;
    if (statusFilter.size > 0 && !statusFilter.has(f.status)) return false;
    return true;
  });

  const open = findings.filter(f => f.status === "OPEN");
  const closed = findings.filter(f => f.status !== "OPEN");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Cases</h1>
        <p className="text-sm text-slate-500 mt-0.5">Security cases from automated and manual evidence tests.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-700">All Cases</h2>
              <span className="bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded-full">{open.length} open</span>
              {closed.length > 0 && (
                <span className="bg-slate-100 text-slate-500 text-xs font-medium px-2 py-0.5 rounded-full">{closed.length} closed</span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400 mr-0.5">Severity</span>
                {SEVERITIES.map(s => (
                  <FilterPill
                    key={s}
                    label={s}
                    active={severityFilter.size === 0 || severityFilter.has(s)}
                    color={SEVERITY_COLORS[s]}
                    onClick={() => setSeverityFilter(prev => toggle(prev, s))}
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
            <div className="px-5 py-8 text-center text-sm text-slate-400">No cases match the selected filters.</div>
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
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Closed On</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Source</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(f => {
                  const isClosed = f.status !== "OPEN";
                  return (
                    <tr key={f.id} className={`border-b border-slate-50 last:border-0 ${isClosed ? "opacity-50" : "hover:bg-slate-50"}`}>
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
                      <td className="px-5 py-2.5 text-xs text-slate-400">{f.closed_on ?? "—"}</td>
                      <td className="px-5 py-2.5 text-xs text-slate-400">{f.source}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
