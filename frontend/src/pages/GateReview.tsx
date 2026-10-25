import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shield } from "lucide-react";
import api from "../api/client";
import { useAppStore } from "../store/useAppStore";
import Badge from "../components/Badge";
import Card, { CardHeader, CardBody } from "../components/Card";

interface GateResult {
  claim_id: string;
  claim_title: string;
  verdict: string;
  rules_fired: Array<{ rule_id: string; verdict: string; detail: string }>;
  missing_controls: string[];
}

interface Override {
  id: string;
  claim_id: string;
  by_id: string;
  reason: string;
  conditions: string;
  expires_on: string;
  status: string;
}

interface Actor { id: string; name: string; role: string; }

export default function GateReview() {
  const { actorId } = useAppStore();
  const qc = useQueryClient();
  const [selectedClaim, setSelectedClaim] = useState<string | null>(null);
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [overrideForm, setOverrideForm] = useState({ reason: "", conditions: "", expires_on: "" });

  const { data: actors = [] } = useQuery<Actor[]>({ queryKey: ["actors"], queryFn: () => api.get("/actors").then(r => r.data) });
  const { data: claims = [] } = useQuery<Array<{ id: string; title: string }>>({ queryKey: ["claims"], queryFn: () => api.get("/claims").then(r => r.data) });
  const { data: overrides = [] } = useQuery<Override[]>({ queryKey: ["overrides"], queryFn: () => api.get("/overrides").then(r => r.data) });

  const { data: gateResults = [] } = useQuery<GateResult[]>({
    queryKey: ["gate-all"],
    queryFn: () => Promise.all(
      claims.map((c: { id: string }) => api.get(`/gate/evaluate/${c.id}`).then(r => r.data))
    ),
    enabled: claims.length > 0,
  });

  const currentActor = actors.find(a => a.id === actorId);
  const canOverride = ["disclosure_committee", "audit_committee"].includes(currentActor?.role ?? "");

  const overrideMut = useMutation({
    mutationFn: (data: object) => api.post("/overrides", data),
    onSuccess: () => {
      qc.invalidateQueries();
      setShowOverrideForm(false);
      setOverrideForm({ reason: "", conditions: "", expires_on: "" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Gate Review</h1>
          <p className="text-sm text-slate-500">Gate verdicts and override management.</p>
        </div>
        {canOverride && selectedClaim && (
          <button
            onClick={() => setShowOverrideForm(true)}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
          >
            <Shield size={16} /> Create Override
          </button>
        )}
      </div>

      {/* Gate results */}
      <div className="grid gap-3">
        {gateResults.map(result => (
          <Card
            key={result.claim_id}
            className={`cursor-pointer transition-shadow ${selectedClaim === result.claim_id ? "ring-2 ring-blue-500" : ""}`}
          >
            <CardBody>
              <div
                className="flex items-center justify-between"
                onClick={() => setSelectedClaim(selectedClaim === result.claim_id ? null : result.claim_id)}
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-slate-400">{result.claim_id}</span>
                  <span className="font-medium text-slate-800">{result.claim_title}</span>
                </div>
                <Badge value={result.verdict} />
              </div>

              {selectedClaim === result.claim_id && (
                <div className="mt-4 space-y-2">
                  <div className="text-xs font-medium text-slate-500 mb-2">Rules Fired</div>
                  {result.rules_fired.map(r => (
                    <div key={r.rule_id} className="flex items-start gap-3 bg-slate-50 rounded p-2.5 border border-slate-100">
                      <span className="font-mono text-xs font-bold text-slate-600 w-8 flex-shrink-0">{r.rule_id}</span>
                      <Badge value={r.verdict} className="flex-shrink-0" />
                      <span className="text-xs text-slate-600">{r.detail}</span>
                    </div>
                  ))}
                  {result.missing_controls.length > 0 && (
                    <div className="text-xs text-red-600 bg-red-50 rounded p-2 border border-red-100">
                      Missing test data for: {result.missing_controls.join(", ")}
                    </div>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Active overrides */}
      {overrides.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-700">Active Overrides</h2>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Claim</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">By</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Expires</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map(ov => (
                  <tr key={ov.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{ov.claim_id}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-600">{ov.by_id}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-600">{ov.expires_on}</td>
                    <td className="px-5 py-2.5"><Badge value={ov.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {/* Override form */}
      {showOverrideForm && selectedClaim && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-700">New Override for {selectedClaim}</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Reason (min 50 chars)</label>
              <textarea
                value={overrideForm.reason}
                onChange={e => setOverrideForm(f => ({ ...f, reason: e.target.value }))}
                rows={3}
                className="w-full border border-slate-300 rounded-md text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Business justification…"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Conditions / Remediation</label>
              <input
                value={overrideForm.conditions}
                onChange={e => setOverrideForm(f => ({ ...f, conditions: e.target.value }))}
                className="w-full border border-slate-300 rounded-md text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="e.g. Fix AC-01 within 90 days"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Expires On</label>
              <input
                type="date"
                value={overrideForm.expires_on}
                onChange={e => setOverrideForm(f => ({ ...f, expires_on: e.target.value }))}
                className="border border-slate-300 rounded-md text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => overrideMut.mutate({
                  claim_id: selectedClaim,
                  by_id: actorId,
                  ...overrideForm,
                })}
                disabled={overrideMut.isPending}
                className="bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50 transition-colors"
              >
                {overrideMut.isPending ? "Saving…" : "Submit Override"}
              </button>
              <button
                onClick={() => setShowOverrideForm(false)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2 rounded-md transition-colors"
              >
                Cancel
              </button>
            </div>
            {overrideMut.isError && (
              <div className="text-xs text-red-600 bg-red-50 rounded p-2">
                {(overrideMut.error as Error)?.message ?? "Error submitting override"}
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
