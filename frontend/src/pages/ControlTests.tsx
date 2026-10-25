import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PlayCircle, Clock } from "lucide-react";
import api from "../api/client";
import Badge from "../components/Badge";
import Card, { CardBody } from "../components/Card";

interface Control {
  id: string;
  name: string;
  test_id: string;
  test_frequency_days: number;
  latest_result?: {
    run_on: string;
    outcome: string;
    evidence_summary: string;
    severity?: string;
    metrics?: Record<string, unknown>;
  };
}

export default function ControlTests() {
  const qc = useQueryClient();
  const { data: controls = [], isLoading } = useQuery<Control[]>({
    queryKey: ["controls"],
    queryFn: () => api.get("/controls").then(r => r.data),
  });

  const runAll = useMutation({
    mutationFn: () => api.post("/gate/run-all"),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (isLoading) return <div className="text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Control Tests</h1>
          <p className="text-sm text-slate-500">Automated evidence tests — never tested = BLOCK.</p>
        </div>
        <button
          onClick={() => runAll.mutate()}
          disabled={runAll.isPending}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50 transition-colors"
        >
          <PlayCircle size={16} />
          {runAll.isPending ? "Running…" : "Run All Tests"}
        </button>
      </div>

      <div className="grid gap-4">
        {controls.map(ctrl => (
          <Card key={ctrl.id}>
            <CardBody>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-slate-400">{ctrl.id}</span>
                    <span className="font-medium text-slate-800">{ctrl.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{ctrl.test_id}</span>
                    <span className="flex items-center gap-1">
                      <Clock size={11} /> every {ctrl.test_frequency_days}d
                    </span>
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  {ctrl.latest_result ? (
                    <div className="space-y-1">
                      <Badge value={ctrl.latest_result.outcome} />
                      {ctrl.latest_result.severity && (
                        <div className="mt-1"><Badge value={ctrl.latest_result.severity} /></div>
                      )}
                      <div className="text-xs text-slate-400">{ctrl.latest_result.run_on}</div>
                    </div>
                  ) : (
                    <Badge value="NEVER TESTED" className="bg-slate-100 text-slate-500 border-slate-200" />
                  )}
                </div>
              </div>
              {ctrl.latest_result?.evidence_summary && (
                <div className="mt-3 text-xs text-slate-600 bg-slate-50 rounded p-2.5 border border-slate-100">
                  {ctrl.latest_result.evidence_summary}
                </div>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
