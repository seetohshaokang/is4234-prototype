import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import Badge from "../components/Badge";
import Card, { CardHeader, CardBody } from "../components/Card";

interface Check {
  id: string;
  version: number;
  name: string;
  threshold_desc: string;
  test_frequency_days: number;
  defined_by: string;
  params: Record<string, unknown>;
}

interface Collector {
  id: string;
  check_id: string;
  version: number;
  status: string;
  written_by: string;
  submitted_on: string;
  approved_by: string | null;
  approved_on: string | null;
}

interface TestResult {
  id: string;
  control_id: string;
  check_id: string;
  check_version: number;
  run_on: string;
  outcome: string;
  evidence_summary: string;
  measured_value: number | null;
}

export default function ChecksCollectors() {
  const { data: checks = [], isLoading: checksLoading } = useQuery<Check[]>({
    queryKey: ["checks"],
    queryFn: () => api.get("/checks").then(r => r.data),
  });

  const { data: collectors = [], isLoading: collectorsLoading } = useQuery<Collector[]>({
    queryKey: ["collectors"],
    queryFn: () => api.get("/collectors").then(r => r.data),
  });

  const { data: testResults = [], isLoading: resultsLoading } = useQuery<TestResult[]>({
    queryKey: ["test-results"],
    queryFn: () => api.get("/test-results").then(r => r.data),
  });

  if (checksLoading || collectorsLoading || resultsLoading) {
    return <div className="text-slate-400 text-sm">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Checks &amp; Collectors</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Checks define what to measure; collectors are the approved scripts that run them.
        </p>
      </div>

      {/* Checks table */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-700">Checks ({checks.length})</h2>
        </CardHeader>
        <CardBody className="p-0">
          {checks.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400">No checks defined.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Check ID</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Version</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Name</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Threshold</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Frequency</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Defined By</th>
                </tr>
              </thead>
              <tbody>
                {checks.map(c => (
                  <tr key={`${c.id}-${c.version}`} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{c.id}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-400">v{c.version}</td>
                    <td className="px-5 py-2.5 text-slate-700 font-medium">{c.name}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-600 max-w-xs">{c.threshold_desc}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-500">every {c.test_frequency_days}d</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-400">{c.defined_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {/* Collectors table */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-700">Collectors ({collectors.length})</h2>
        </CardHeader>
        <CardBody className="p-0">
          {collectors.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400">No collectors submitted.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Collector ID</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Check ID</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Version</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Status</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Submitted On</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Approved By</th>
                </tr>
              </thead>
              <tbody>
                {collectors.map(col => (
                  <tr key={col.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{col.id}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-blue-600">{col.check_id}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-400">v{col.version}</td>
                    <td className="px-5 py-2.5"><Badge value={col.status} /></td>
                    <td className="px-5 py-2.5 text-xs text-slate-500">{col.submitted_on ?? "—"}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-400">{col.approved_by ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {/* Latest test results */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-700">Latest Test Results ({testResults.length})</h2>
        </CardHeader>
        <CardBody className="p-0">
          {testResults.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400">No test results yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Control ID</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Check ID</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Run On</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Outcome</th>
                  <th className="text-left px-5 py-2 text-xs font-medium text-slate-500">Evidence Summary</th>
                </tr>
              </thead>
              <tbody>
                {testResults.map(r => (
                  <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{r.control_id}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-blue-600">{r.check_id}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-500">{r.run_on}</td>
                    <td className="px-5 py-2.5"><Badge value={r.outcome} /></td>
                    <td className="px-5 py-2.5 text-xs text-slate-600 max-w-sm truncate">{r.evidence_summary}</td>
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
