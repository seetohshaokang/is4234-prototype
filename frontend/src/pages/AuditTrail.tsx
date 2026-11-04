import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle, XCircle, ShieldCheck } from "lucide-react";
import api from "../api/client";
import Card, { CardBody } from "../components/Card";

interface AuditEvent {
  seq: number;
  ts_sim: string;
  actor_id: string;
  action: string;
  subject_type: string;
  subject_id: string;
  payload: Record<string, unknown>;
  hash: string;
}

interface VerifyResult {
  valid: boolean;
  message: string;
}

export default function AuditTrail() {
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  const { data: events = [], isLoading } = useQuery<AuditEvent[]>({
    queryKey: ["audit"],
    queryFn: () => api.get("/audit").then(r => r.data),
  });

  const verifyMut = useMutation({
    mutationFn: () => api.get("/audit/verify").then(r => r.data),
    onSuccess: (data: VerifyResult) => setVerifyResult(data),
  });

  if (isLoading) return <div className="text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Trail</h1>
          <p className="text-sm text-slate-500">Hash-chained append-only log of all system actions.</p>
        </div>
        <button
          onClick={() => verifyMut.mutate()}
          disabled={verifyMut.isPending}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50 transition-colors"
        >
          <ShieldCheck size={16} />
          {verifyMut.isPending ? "Verifying…" : "Verify Chain"}
        </button>
      </div>

      {verifyResult && (
        <div className={`flex items-center gap-2 rounded-md px-4 py-3 text-sm font-medium ${
          verifyResult.valid
            ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
            : "bg-red-50 text-red-800 border border-red-200"
        }`}>
          {verifyResult.valid ? <CheckCircle size={16} /> : <XCircle size={16} />}
          {verifyResult.message ?? (verifyResult.valid ? "Chain is valid — no tampering detected." : "Chain integrity check failed.")}
        </div>
      )}

      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            {events.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-400">No audit events yet.</div>
            ) : (
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-4 py-2 text-slate-500 font-medium">#</th>
                    <th className="text-left px-4 py-2 text-slate-500 font-medium">Sim Date</th>
                    <th className="text-left px-4 py-2 text-slate-500 font-medium">Actor</th>
                    <th className="text-left px-4 py-2 text-slate-500 font-medium">Action</th>
                    <th className="text-left px-4 py-2 text-slate-500 font-medium">Subject Type</th>
                    <th className="text-left px-4 py-2 text-slate-500 font-medium">Subject ID</th>
                    <th className="text-left px-4 py-2 text-slate-500 font-medium">Hash (8)</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(ev => (
                    <tr key={ev.seq} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                      <td className="px-4 py-2 text-slate-400">{ev.seq}</td>
                      <td className="px-4 py-2 text-slate-600">{ev.ts_sim?.slice(0, 10)}</td>
                      <td className="px-4 py-2 text-blue-600">{ev.actor_id}</td>
                      <td className="px-4 py-2 text-slate-700">{ev.action}</td>
                      <td className="px-4 py-2 text-slate-500">{ev.subject_type}</td>
                      <td className="px-4 py-2 text-slate-500">{ev.subject_id}</td>
                      <td className="px-4 py-2 text-slate-400">{ev.hash?.slice(0, 8)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
