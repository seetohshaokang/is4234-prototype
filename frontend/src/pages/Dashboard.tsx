import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { PlayCircle } from "lucide-react";
import api from "../api/client";
import { useAppStore } from "../store/useAppStore";
import Badge from "../components/Badge";
import Card, { CardHeader, CardBody } from "../components/Card";

interface DashboardData {
  sim_date: string;
  claims_total: number;
  claims_blocked: number;
  open_findings: number;
  active_overrides: number;
  claim_states: Array<{ id: string; title: string; verdict: string; support_state: string }>;
  comparison: Array<{ metric: string; without_gate: string; with_gate: string }>;
}

const VERDICT_COLORS: Record<string, string> = {
  APPROVE: "#10b981", BLOCK: "#ef4444", ESCALATE: "#f59e0b",
};

export default function Dashboard() {
  const { simDate } = useAppStore();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn: () => api.get("/dashboard").then(r => r.data),
  });

  const runAll = useMutation({
    mutationFn: () => api.post("/gate/run-all"),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (isLoading) return <div className="text-slate-400 text-sm">Loading…</div>;
  if (!data) return null;

  const kpis = [
    { label: "Total Claims", value: data.claims_total, color: "text-blue-600" },
    { label: "Blocked Claims", value: data.claims_blocked, color: "text-red-600" },
    { label: "Open Findings", value: data.open_findings, color: "text-amber-600" },
    { label: "Active Overrides", value: data.active_overrides, color: "text-purple-600" },
  ];

  const chartData = data.claim_states.map(c => ({
    name: c.id,
    verdict: c.verdict,
    value: 1,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Oversight Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Sim date: {simDate}</p>
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

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => (
          <Card key={k.label}>
            <CardBody className="text-center">
              <div className={`text-3xl font-bold ${k.color}`}>{k.value}</div>
              <div className="text-xs text-slate-500 mt-1">{k.label}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Claim verdicts chart */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-700">Claim Gate Verdicts</h2>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis hide />
                <Tooltip
                  formatter={(_, __, props) => [props.payload.verdict, "Verdict"]}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={VERDICT_COLORS[entry.verdict] ?? "#94a3b8"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        {/* Comparison panel */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-700">Status Quo vs With Gate</h2>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Metric</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Without Gate</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">With Gate</th>
                </tr>
              </thead>
              <tbody>
                {(data.comparison || []).map((row, i) => (
                  <tr key={i} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-2.5 text-slate-700 font-medium text-xs">{row.metric}</td>
                    <td className="px-5 py-2.5 text-red-600 text-xs">{row.without_gate}</td>
                    <td className="px-5 py-2.5 text-emerald-600 text-xs">{row.with_gate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>

      {/* Claim states table */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-700">All Claims — Current State</h2>
        </CardHeader>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">ID</th>
                <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Title</th>
                <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Gate Verdict</th>
                <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Support State</th>
              </tr>
            </thead>
            <tbody>
              {data.claim_states.map(c => (
                <tr key={c.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{c.id}</td>
                  <td className="px-5 py-2.5 text-slate-700">{c.title}</td>
                  <td className="px-5 py-2.5"><Badge value={c.verdict} /></td>
                  <td className="px-5 py-2.5"><Badge value={c.support_state} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
