import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { XCircle } from "lucide-react";
import api from "../api/client";
import { useAppStore } from "../store/useAppStore";
import Badge from "../components/Badge";
import Card, { CardHeader, CardBody } from "../components/Card";

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
}

export default function FindingsPage() {
  const { actorId } = useAppStore();
  const qc = useQueryClient();

  const { data: findings = [], isLoading } = useQuery<Finding[]>({
    queryKey: ["findings"],
    queryFn: () => api.get("/findings").then(r => r.data),
  });

  const closeMut = useMutation({
    mutationFn: (id: string) => api.post(`/findings/${id}/close`, { actor_id: actorId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["findings"] }),
  });

  const open = findings.filter(f => f.status === "OPEN");
  const closed = findings.filter(f => f.status !== "OPEN");

  if (isLoading) return <div className="text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Findings</h1>
      <p className="text-sm text-slate-500">Security findings from automated and manual tests.</p>

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
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">ID</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Control</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Title</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Severity</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Opened</th>
                  <th className="px-5 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {open.map(f => (
                  <tr key={f.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{f.id}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-blue-600">{f.control_id}</td>
                    <td className="px-5 py-2.5 text-slate-700">{f.title}</td>
                    <td className="px-5 py-2.5"><Badge value={f.severity} /></td>
                    <td className="px-5 py-2.5 text-xs text-slate-400">{f.opened_on}</td>
                    <td className="px-5 py-2.5">
                      <button
                        onClick={() => closeMut.mutate(f.id)}
                        disabled={closeMut.isPending}
                        className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                      >
                        <XCircle size={13} /> Close
                      </button>
                    </td>
                  </tr>
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
