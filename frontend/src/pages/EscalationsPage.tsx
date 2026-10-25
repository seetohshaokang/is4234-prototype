import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import { useAppStore } from "../store/useAppStore";
import Badge from "../components/Badge";
import Card, { CardHeader, CardBody } from "../components/Card";

interface Escalation {
  id: number;
  subject_id: string;
  subject_type: string;
  subject_label: string;
  level: number;
  assigned_to_id: string;
  reason: string;
  status: string;
  created_on: string;
  independence_skips: number;
}

const LEVEL_LABELS: Record<number, string> = {
  1: "L1 — Control Owner",
  2: "L2 — Security Lead",
  3: "L3 — Disclosure Committee",
  4: "L4 — Audit Committee",
};

export default function EscalationsPage() {
  const { actorId } = useAppStore();

  const { data: escalations = [], isLoading } = useQuery<Escalation[]>({
    queryKey: ["escalations"],
    queryFn: () => api.get("/escalations").then(r => r.data),
  });

  const mine = escalations.filter(e => e.assigned_to_id === actorId);
  const all = escalations;

  if (isLoading) return <div className="text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Escalation Inbox</h1>
      <p className="text-sm text-slate-500">Ageing escalations — L1→L4 over 30/60/90 days.</p>

      {mine.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-700">Your Inbox</h2>
              <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full">{mine.length}</span>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Level</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Finding</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Reason</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Created</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {mine.map(e => (
                  <tr key={e.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-2.5">
                      <span className="text-xs font-semibold text-blue-600">{LEVEL_LABELS[e.level] ?? `L${e.level}`}</span>
                      {e.independence_skips > 0 && (
                        <div className="text-xs text-amber-600 mt-0.5">Independence skip</div>
                      )}
                    </td>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{e.subject_id}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-600 max-w-xs truncate">{e.reason}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-400">{e.created_on}</td>
                    <td className="px-5 py-2.5"><Badge value={e.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-700">All Escalations ({all.length})</h2>
        </CardHeader>
        <CardBody className="p-0">
          {all.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400">No escalations</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Level</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Finding</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">To</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Reason</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Created</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {all.map(e => (
                  <tr key={e.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-2.5 text-xs font-semibold text-blue-600">L{e.level}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{e.subject_id}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{e.assigned_to_id}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-600 max-w-xs">{e.reason}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-400">{e.created_on}</td>
                    <td className="px-5 py-2.5"><Badge value={e.status} /></td>
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
