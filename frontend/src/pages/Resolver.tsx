import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle, XCircle, Search } from "lucide-react";
import api from "../api/client";
import Card, { CardBody } from "../components/Card";

interface ResolveResult {
  citation_string: string | null;
  sccversion_id: string;
  period_from: string;
  period_to: string;
  computed_uptime_pct: number;
  claimed_uptime_pct: number | null;
  mismatch: boolean;
  target_met: boolean;
  target_uptime_pct: number | null;
  logged_citations: Array<{
    id: string;
    citation_string: string;
    uptime_pct: number;
    issued_by: string;
    issued_on: string;
    target_met: boolean;
    record_hash: string;
  }>;
  note: string | null;
}

export default function Resolver() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [error, setError] = useState("");

  const resolveMut = useMutation({
    mutationFn: (payload: object) => api.post("/resolve", payload).then(r => r.data),
    onSuccess: (data: ResolveResult) => {
      setResult(data);
      setError("");
    },
    onError: (e: any) => {
      setError(e.response?.data?.detail ?? "Resolution failed");
      setResult(null);
    },
  });

  const handleResolve = () => {
    if (!input.trim()) return;
    setResult(null);
    setError("");
    resolveMut.mutate({ citation_string: input.trim() });
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Citation Resolver</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Paste a citation string from a press release or filing to verify it against internal records.
        </p>
      </div>

      {/* Input */}
      <Card>
        <CardBody className="space-y-3">
          <label className="block text-xs font-medium text-slate-600">
            Citation string
          </label>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            rows={3}
            className="w-full text-sm border border-slate-300 rounded-md px-3 py-2 font-mono focus:outline-none focus:border-blue-500"
            placeholder={'e.g. (SCC-01 v1, 2018: 99.0% upheld, target 99% met)'}
          />
          <div className="flex gap-2 items-center">
            <button
              onClick={handleResolve}
              disabled={!input.trim() || resolveMut.isPending}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50 transition-colors"
            >
              <Search size={15} />
              {resolveMut.isPending ? "Resolving…" : "Resolve"}
            </button>
            {input && (
              <button
                onClick={() => { setInput(""); setResult(null); setError(""); }}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <p className="text-xs text-slate-400">
            You can also try searching by SCC version + period — format: <span className="font-mono">sccversion_id/period_from/period_to</span>
          </p>
        </CardBody>
      </Card>

      {/* Error */}
      {error && (
        <div className="rounded-md px-4 py-3 text-sm font-medium bg-red-50 text-red-800 border border-red-200">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-4">
          {/* Match/mismatch banner */}
          <div className={`flex items-center gap-3 rounded-md px-5 py-4 border ${
            result.claimed_uptime_pct == null
              ? "bg-blue-50 text-blue-800 border-blue-200"
              : result.mismatch
              ? "bg-red-50 text-red-800 border-red-200"
              : "bg-emerald-50 text-emerald-800 border-emerald-200"
          }`}>
            {result.claimed_uptime_pct == null ? (
              <Search size={20} className="flex-shrink-0" />
            ) : result.mismatch ? (
              <XCircle size={20} className="flex-shrink-0" />
            ) : (
              <CheckCircle size={20} className="flex-shrink-0" />
            )}
            <div>
              {result.claimed_uptime_pct == null ? (
                <div className="font-semibold">Lookup-only — no uptime claim to compare</div>
              ) : result.mismatch ? (
                <div className="font-semibold">Mismatch detected</div>
              ) : (
                <div className="font-semibold">Citation verified — figures match</div>
              )}
              {result.note && <div className="text-sm mt-0.5 opacity-80">{result.note}</div>}
            </div>
          </div>

          {/* Detail card */}
          <Card>
            <CardBody>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-0.5">SCC Version ID</div>
                  <div className="font-mono text-slate-700">{result.sccversion_id}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-0.5">Period</div>
                  <div className="font-mono text-slate-700">{result.period_from} → {result.period_to}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-0.5">Computed Uptime %</div>
                  <div className={`font-semibold text-lg ${result.target_met ? "text-green-700" : "text-red-600"}`}>
                    {result.computed_uptime_pct.toFixed(2)}%
                  </div>
                </div>
                {result.claimed_uptime_pct != null && (
                  <div>
                    <div className="text-xs font-medium text-slate-500 mb-0.5">Claimed Uptime %</div>
                    <div className={`font-semibold text-lg ${result.mismatch ? "text-red-600" : "text-green-700"}`}>
                      {result.claimed_uptime_pct.toFixed(2)}%
                    </div>
                    {result.mismatch && (
                      <div className="text-xs text-red-600 mt-0.5">
                        Differs by {Math.abs(result.computed_uptime_pct - result.claimed_uptime_pct).toFixed(2)}pp
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-0.5">Target Uptime</div>
                  <div className="text-slate-700">{result.target_uptime_pct != null ? `${result.target_uptime_pct}%` : "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-0.5">Target Met</div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${result.target_met ? "bg-green-100 text-green-700 border-green-200" : "bg-red-100 text-red-700 border-red-200"}`}>
                    {result.target_met ? "Yes" : "No"}
                  </span>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Logged citations for the same period */}
          {result.logged_citations && result.logged_citations.length > 0 && (
            <Card>
              <CardBody className="p-0">
                <div className="px-5 py-3 border-b border-slate-100">
                  <div className="text-sm font-semibold text-slate-700">
                    Logged Citations for this Period ({result.logged_citations.length})
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Citation String</th>
                      <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Uptime %</th>
                      <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Target Met</th>
                      <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Issued By</th>
                      <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Issued On</th>
                      <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Hash (8)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.logged_citations.map(c => (
                      <tr key={c.id} className="border-b border-slate-50 last:border-0">
                        <td className="px-5 py-2.5 font-mono text-xs text-slate-600 max-w-xs truncate">{c.citation_string}</td>
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
                        <td className="px-5 py-2.5 font-mono text-xs text-slate-400">{c.record_hash?.slice(0, 8)}…</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
