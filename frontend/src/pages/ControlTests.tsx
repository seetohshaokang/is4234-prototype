import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { X } from "lucide-react";
import api from "../api/client";
import Badge from "../components/Badge";

interface Check {
  id: string;
  version: number;
  name: string;
  threshold_desc: string;
  test_frequency_days: number;
  defined_by: string;
  params: Record<string, unknown>;
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


interface CheckTags {
  category: string;
  severity: string;
  frequency: string;
}

// Static mapping: check_id -> SCC IDs it validates
const CHECK_SCCS: Record<string, string[]> = {
  "T-LEASTPRIV": ["SCC-01"],
  "T-VPNDEVICE":  ["SCC-01"],
  "T-MFA":        ["SCC-06"],
  "T-PWDPOLICY":  ["SCC-02"],
  "T-SECRETS":    ["SCC-02"],
  "T-SDLSCAN":    ["SCC-03"],
  "T-UPTIME":     ["SCC-07"],
};

const CHECK_TAGS: Record<string, CheckTags> = {
  "T-LEASTPRIV": { category: "Identity",   severity: "High",     frequency: "Monthly" },
  "T-VPNDEVICE":  { category: "Network",    severity: "High",     frequency: "Monthly" },
  "T-MFA":        { category: "Identity",   severity: "Critical", frequency: "Monthly" },
  "T-PWDPOLICY":  { category: "Identity",   severity: "High",     frequency: "Monthly" },
  "T-SECRETS":    { category: "Code",       severity: "Critical", frequency: "Weekly"  },
  "T-SDLSCAN":    { category: "Code",       severity: "High",     frequency: "Monthly" },
  "T-UPTIME":     { category: "Operations", severity: "Medium",   frequency: "Monthly" },
};

const TAG_COLORS: Record<string, string> = {
  // category
  Identity:   "bg-blue-100 text-blue-700",
  Network:    "bg-teal-100 text-teal-700",
  Code:       "bg-purple-100 text-purple-700",
  Operations: "bg-orange-100 text-orange-700",
  // severity
  Critical: "bg-red-100 text-red-700",
  High:     "bg-amber-100 text-amber-700",
  Medium:   "bg-yellow-100 text-yellow-700",
  // frequency
  Weekly:  "bg-slate-100 text-slate-600",
  Monthly: "bg-slate-100 text-slate-600",
};

function Tag({ label }: { label: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TAG_COLORS[label] ?? "bg-slate-100 text-slate-600"}`}>
      {label}
    </span>
  );
}

interface CheckDetail {
  dataSource: string;
  method: string;
  passCondition: string[];
  failCondition: string[];
  notes?: string;
}

const CHECK_DETAILS: Record<string, CheckDetail> = {
  "T-LEASTPRIV": {
    dataSource: "directory.csv snapshot (latest ≤ run date)",
    method: "Counts enabled human accounts flagged as admin; identifies accounts shared across multiple users.",
    passCondition: [
      "Admin accounts ≤ 10% of all enabled human accounts",
      "Zero shared admin accounts exist",
    ],
    failCondition: [
      "Admin share exceeds 10%",
      "One or more shared accounts detected",
    ],
  },
  "T-VPNDEVICE": {
    dataSource: "vpn_logins.csv + managed_devices.csv snapshots",
    method: "Joins VPN login records against the managed device registry for the trailing 30-day window. Any login from a device not in the managed registry is flagged.",
    passCondition: [
      "Zero VPN logins from unmanaged devices in the trailing 30 days",
    ],
    failCondition: [
      "One or more VPN logins from devices not in the managed device registry",
    ],
  },
  "T-MFA": {
    dataSource: "directory.csv snapshot (mfa_enabled + has_remote_access columns)",
    method: "Filters human accounts that have remote access enabled, then computes the percentage with MFA enabled.",
    passCondition: [
      "MFA coverage ≥ 98% of human accounts with remote access",
    ],
    failCondition: [
      "MFA coverage falls below 98%",
    ],
  },
  "T-PWDPOLICY": {
    dataSource: "password_policies.json snapshot",
    method: "v1: Checks all systems — min_length ≥ 8, complexity enabled, rotation ≤ 90 days, history ≥ 5. v2: Checks only systems where sso=false — min_length ≥ 12, complexity enabled, history ≥ 5 (no rotation requirement for SSO-exempt systems).",
    passCondition: [
      "All in-scope systems meet every password policy threshold",
    ],
    failCondition: [
      "Any in-scope system violates at least one threshold (min_length, complexity, rotation, or history)",
    ],
    notes: "v2 was introduced after SSO rollout to reflect that SSO-backed systems are exempt from local password rotation requirements.",
  },
  "T-SECRETS": {
    dataSource: "repos/ directory snapshot (source file contents)",
    method: "Scans all source files for credential patterns using regex (API keys, passwords, tokens). Matches in public repositories are rated CRITICAL; matches in private repositories are HIGH. Matched values are masked in the evidence summary.",
    passCondition: [
      "No credential patterns found in any scanned repository",
    ],
    failCondition: [
      "One or more credential patterns detected in source files",
    ],
    notes: "Masked output format: nim***** (first 3 chars retained). Severity escalates to CRITICAL if the repository is public.",
  },
  "T-SDLSCAN": {
    dataSource: "pipelines/*.yaml snapshot",
    method: "Parses each pipeline definition and checks for the presence of a security_scan stage and a dependency_check stage that must both appear before any release stage.",
    passCondition: [
      "All pipelines include security_scan before release",
      "All pipelines include dependency_check before release",
    ],
    failCondition: [
      "Any pipeline is missing security_scan or dependency_check",
      "Any pipeline has a release stage that precedes the security checks",
    ],
  },
  "T-UPTIME": {
    dataSource: "uptime.json snapshot (monthly availability figures)",
    method: "Reads the recorded availability percentage for each completed calendar month. Each month is evaluated independently against the 99.9% threshold.",
    passCondition: [
      "Every completed calendar month shows ≥ 99.9% availability",
    ],
    failCondition: [
      "Any completed calendar month falls below 99.9% availability",
    ],
  },
};

function CheckModal({ check, onClose }: { check: Check; onClose: () => void }) {
  const detail = CHECK_DETAILS[check.id];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold text-blue-600">{check.id}</span>
              <span className="text-xs text-slate-400">v{check.version}</span>
            </div>
            <h2 className="text-base font-bold text-slate-900 mt-0.5">{check.name}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors mt-0.5">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Threshold</div>
            <p className="text-sm text-slate-700">{check.threshold_desc}</p>
          </div>

          {detail ? (
            <>
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Data source</div>
                <p className="text-sm text-slate-700">{detail.dataSource}</p>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">How it works</div>
                <p className="text-sm text-slate-700">{detail.method}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-1">Pass when</div>
                  <ul className="space-y-1">
                    {detail.passCondition.map((c, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-sm text-slate-600">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1">Fail when</div>
                  <ul className="space-y-1">
                    {detail.failCondition.map((c, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-sm text-slate-600">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {detail.notes && (
                <div className="bg-amber-50 border border-amber-200 rounded-md px-4 py-3">
                  <div className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Note</div>
                  <p className="text-sm text-amber-800">{detail.notes}</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-400 italic">No implementation details available.</p>
          )}

          {Object.keys(check.params).length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Parameters</div>
              <div className="bg-slate-50 rounded border border-slate-200 px-3 py-2 font-mono text-xs text-slate-600">
                {Object.entries(check.params).map(([k, v]) => (
                  <div key={k}>{k}: {JSON.stringify(v)}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const ALL_CATEGORIES = ["Identity", "Network", "Code", "Operations"];
const ALL_SEVERITIES  = ["Critical", "High", "Medium"];
const ALL_FREQUENCIES = ["Weekly", "Monthly"];

export default function ChecksCollectors() {
  const [selectedCheck, setSelectedCheck] = useState<Check | null>(null);
  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  const { data: checks = [], isLoading: checksLoading } = useQuery<Check[]>({
    queryKey: ["checks"],
    queryFn: () => api.get("/checks").then(r => r.data),
  });

  const { data: testResults = [], isLoading: resultsLoading } = useQuery<TestResult[]>({
    queryKey: ["test-results"],
    queryFn: () => api.get("/test-results").then(r => r.data),
  });

  if (checksLoading || resultsLoading) {
    return <div className="text-slate-400 text-sm">Loading…</div>;
  }

  // Deduplicate: keep latest version per check id
  const dedupedChecks = [...checks.reduce((map, c) => {
    const existing = map.get(c.id);
    if (!existing || c.version > existing.version) map.set(c.id, c);
    return map;
  }, new Map<string, Check>()).values()];

  // Build check_id -> latest test result
  const latestResultByCheck = new Map<string, TestResult>();
  for (const r of [...testResults].sort((a, b) => a.run_on.localeCompare(b.run_on))) {
    latestResultByCheck.set(r.check_id, r);
  }


  const toggleFilter = (tag: string) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      next.has(tag) ? next.delete(tag) : next.add(tag);
      return next;
    });
  };

  const filtered = dedupedChecks.filter(c => {
    const tags = CHECK_TAGS[c.id];
    const q = search.toLowerCase();
    const matchesSearch = !q || c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.threshold_desc.toLowerCase().includes(q);
    const matchesTags = activeFilters.size === 0 || (tags && [...activeFilters].every(f =>
      f === tags.category || f === tags.severity || f === tags.frequency
    ));
    return matchesSearch && matchesTags;
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Security Checks</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Automated tests that verify each SCC's assertions against live evidence.
        </p>
      </div>

      {/* Search + filters */}
      <div className="space-y-3">
        <input
          type="text"
          placeholder="Search by name, ID or threshold…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-400"
        />
        <div className="flex flex-wrap gap-1.5">
          {[...ALL_CATEGORIES, ...ALL_SEVERITIES, ...ALL_FREQUENCIES].map(tag => (
            <button
              key={tag}
              onClick={() => toggleFilter(tag)}
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                activeFilters.has(tag)
                  ? `${TAG_COLORS[tag]} border-current opacity-100`
                  : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"
              }`}
            >
              {tag}
            </button>
          ))}
          {activeFilters.size > 0 && (
            <button
              onClick={() => setActiveFilters(new Set())}
              className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Results count */}
      <div className="text-xs text-slate-400">{filtered.length} check{filtered.length !== 1 ? "s" : ""}</div>

      {/* Check rows */}
      {filtered.length === 0 ? (
        <div className="text-sm text-slate-400 py-10 text-center">No checks match your search.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[160px_1fr_200px_160px_100px_100px] gap-4 px-5 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
            <div>Check</div>
            <div>Name / Threshold</div>
            <div>Tags</div>
            <div>Validates</div>
            <div>Last result</div>
            <div />
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-100">
            {filtered.map(check => {
              const tags = CHECK_TAGS[check.id];
              const latestResult = latestResultByCheck.get(check.id);
              const validatesSccs = CHECK_SCCS[check.id] ?? [];

              return (
                <div key={`${check.id}-${check.version}`} className="grid grid-cols-[160px_1fr_200px_160px_100px_100px] gap-4 px-5 py-3.5 items-center hover:bg-slate-50 transition-colors">
                  {/* Check ID */}
                  <div>
                    <div className="font-mono text-xs font-semibold text-blue-600">{check.id}</div>
                    <div className="text-xs text-slate-400">v{check.version}</div>
                  </div>

                  {/* Name + threshold */}
                  <div className="min-w-0">
                    <div className="font-medium text-sm text-slate-800">{check.name}</div>
                    <div className="text-xs text-slate-500 truncate">{check.threshold_desc}</div>
                  </div>

                  {/* Tags */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {tags && <>
                      <Tag label={tags.category} />
                      <Tag label={tags.severity} />
                      <Tag label={tags.frequency} />
                    </>}
                  </div>

                  {/* Validates SCCs */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {validatesSccs.map(sccId => (
                      <span key={sccId} className="font-mono text-xs bg-slate-100 text-slate-600 border border-slate-200 rounded px-1.5 py-0.5">
                        {sccId}
                      </span>
                    ))}
                  </div>

                  {/* Latest result */}
                  <div>
                    {latestResult
                      ? <div className="flex flex-col gap-0.5">
                          <Badge value={latestResult.outcome} />
                          <span className="text-xs text-slate-400">{latestResult.run_on}</span>
                        </div>
                      : <span className="text-xs text-slate-400 italic">no runs</span>
                    }
                  </div>

                  {/* View details */}
                  <div>
                    <button
                      onClick={() => setSelectedCheck(check)}
                      className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 rounded px-3 py-1.5 transition-colors whitespace-nowrap"
                    >
                      View details
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Check detail modal */}
      {selectedCheck && (
        <CheckModal check={selectedCheck} onClose={() => setSelectedCheck(null)} />
      )}
    </div>
  );
}
