import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import api from "../api/client";
import Card, { CardHeader, CardBody } from "../components/Card";

interface Interval {
  start: string;
  end: string | null;
  state: string;
  detected_at: string | null;
  possibly_since: string | null;
  cause_note: string | null;
}

interface SCCVersion {
  id: string;
  version: number;
  status: string;
  active_from: string;
  active_to: string | null;
  uptime_pct: number | null;
  target_uptime_pct: number | null;
  assertion_text: string | null;
  evidence_type: string | null;
  rolling_window_days: number | null;
  superseded_while_down: boolean;
  deprecated_while_down: boolean;
  intervals: Interval[];
  controls: Array<{ id: string; name: string; last_outcome: string | null }>;
}

interface SCCDetail {
  id: string;
  title: string;
  owner_id: string;
  versions: SCCVersion[];
}

const STATE_COLOR: Record<string, string> = {
  UPHELD:     "#16a34a",
  DOWN:       "#dc2626",
  UNKNOWN:    "#9ca3af",
  NOT_ACTIVE: "#e2e8f0",
};

const STATE_LABEL: Record<string, string> = {
  UPHELD:     "Upheld",
  DOWN:       "Down",
  UNKNOWN:    "Unknown",
  NOT_ACTIVE: "Not active",
};

function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Dominant state for a single day
function stateForDay(day: string, intervals: Interval[], today: string): string {
  for (const s of ["DOWN", "UNKNOWN", "UPHELD", "NOT_ACTIVE"]) {
    if (intervals.some(iv => iv.state === s && iv.start <= day && (iv.end ?? today) >= day))
      return s;
  }
  return "NOT_ACTIVE";
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const COLS = 53;
// Viewbox units — cells are 1 unit wide with 0.15 gap
const CW = 1;    // cell width in viewBox units
const CH = 1.4;  // cell height
const CG = 0.18; // gap between cells
const LABEL_H = 1.6; // top label row height

interface DayCell { date: string; state: string }

function UptimeHeatmap({ intervals, today }: { intervals: Interval[]; today: string }) {
  const active = intervals.filter(i => i.state !== "NOT_ACTIVE");
  if (active.length === 0) return null;

  const firstYear = parseInt(active[0].start.slice(0, 4));
  const lastYear  = parseInt((active[active.length - 1].end ?? today).slice(0, 4));
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i);

  const [selectedYear, setSelectedYear] = useState(lastYear);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; cell: DayCell } | null>(null);

  const jan1   = `${selectedYear}-01-01`;
  const dec31  = `${selectedYear}-12-31`;
  const startDow = new Date(jan1).getUTCDay(); // 0=Sun

  const grid: (DayCell | null)[][] = Array.from({ length: COLS }, () => Array(7).fill(null));
  let dayOffset = -startDow;
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < 7; row++) {
      const d = addDays(jan1, dayOffset++);
      grid[col][row] = (d >= jan1 && d <= dec31)
        ? { date: d, state: stateForDay(d, intervals, today) }
        : { date: d, state: "OUT_OF_YEAR" };
    }
  }

  // Month label positions
  const monthLabels: { label: string; col: number }[] = [];
  for (let m = 0; m < 12; m++) {
    const first = `${selectedYear}-${String(m + 1).padStart(2, "0")}-01`;
    const col = Math.floor((daysBetween(jan1, first) + startDow) / 7);
    if (col < COLS) monthLabels.push({ label: MONTHS[m], col });
  }

  const vbW = COLS * (CW + CG);
  const vbH = LABEL_H + 7 * (CH + CG);

  const hoverInterval = (tooltip && tooltip.cell.state !== "OUT_OF_YEAR")
    ? intervals.find(iv => iv.start <= tooltip.cell.date && (iv.end ?? today) >= tooltip.cell.date)
    : null;

  return (
    <div className="select-none">
      {/* Year dropdown */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-slate-500">Year</span>
        <select
          value={selectedYear}
          onChange={e => setSelectedYear(Number(e.target.value))}
          className="text-xs bg-white border border-slate-200 rounded px-2 py-1 text-slate-700 focus:outline-none focus:border-blue-400"
        >
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Heatmap — fluid width via viewBox */}
      <div className="relative w-full">
        <svg
          viewBox={`0 0 ${vbW} ${vbH}`}
          preserveAspectRatio="xMinYMid meet"
          className="w-full"
          onMouseLeave={() => setTooltip(null)}
        >
          {/* Month labels */}
          {monthLabels.map(({ label, col }) => (
            <text
              key={label}
              x={col * (CW + CG)}
              y={LABEL_H - 0.3}
              fontSize={0.9}
              fill="#94a3b8"
            >
              {label}
            </text>
          ))}

          {/* Cells */}
          {grid.map((col, ci) =>
            col.map((cell, ri) => {
              const x = ci * (CW + CG);
              const y = LABEL_H + ri * (CH + CG);
              if (!cell) return null;
              if (cell.state === "OUT_OF_YEAR") return (
                <rect
                  key={`${ci}-${ri}`}
                  x={x} y={y} width={CW} height={CH} rx={0.2}
                  fill="none"
                  stroke="#cbd5e1"
                  strokeWidth={0.12}
                />
              );
              return (
                <rect
                  key={`${ci}-${ri}`}
                  x={x} y={y} width={CW} height={CH} rx={0.2}
                  fill={STATE_COLOR[cell.state] ?? "#e2e8f0"}
                  opacity={0.88}
                  onMouseEnter={(e) => {
                    const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                    setTooltip({ x: e.clientX - r.left, y: e.clientY - r.top, cell });
                  }}
                />
              );
            })
          )}
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="pointer-events-none absolute z-20 bg-slate-900 text-white text-xs rounded px-2.5 py-2 shadow-lg whitespace-nowrap"
            style={{ left: tooltip.x + 12, top: Math.max(0, tooltip.y - 8) }}
          >
            <div className="flex items-center gap-1.5 font-semibold mb-0.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: STATE_COLOR[tooltip.cell.state] }}
              />
              {STATE_LABEL[tooltip.cell.state] ?? tooltip.cell.state}
            </div>
            <div className="text-slate-300">{formatDate(tooltip.cell.date)}</div>
            {hoverInterval?.cause_note && (
              <div className="text-slate-400 mt-1 border-t border-slate-700 pt-1 max-w-[200px] whitespace-normal">
                {hoverInterval.cause_note}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function versionStatusBadge(status: string) {
  const cls = status === "ACTIVE"
    ? "bg-green-100 text-green-700 border-green-200"
    : status === "SUPERSEDED"
    ? "bg-amber-100 text-amber-700 border-amber-200"
    : status === "DEPRECATED"
    ? "bg-slate-100 text-slate-500 border-slate-200"
    : "bg-blue-100 text-blue-700 border-blue-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {status}
    </span>
  );
}

export default function SCCDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);

  const { data: scc, isLoading, error } = useQuery<SCCDetail>({
    queryKey: ["scc", id],
    queryFn: () => api.get(`/sccs/${id}`).then(r => r.data),
    enabled: !!id,
  });

  if (isLoading) return <div className="text-slate-400 text-sm">Loading…</div>;
  if (error || !scc) return (
    <div className="text-red-600 text-sm">
      Failed to load SCC {id}. {(error as any)?.message}
    </div>
  );

  const sortedVersions = [...scc.versions].sort((a, b) => a.version - b.version);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => navigate("/sccs")}
          className="mt-1 text-slate-400 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-slate-400">{scc.id}</span>
            <ChevronRight size={14} className="text-slate-300" />
            <h1 className="text-2xl font-bold text-slate-900">{scc.title}</h1>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">Owner: {scc.owner_id}</p>
        </div>
      </div>

      {/* Version chain */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-slate-700">Version Chain</h2>
        {sortedVersions.map((ver, idx) => (
          <Card key={ver.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold text-slate-700">v{ver.version}</span>
                  {versionStatusBadge(ver.status)}
                  {ver.superseded_while_down && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-red-50 text-red-700 border-red-200">
                      superseded while DOWN
                    </span>
                  )}
                  {ver.deprecated_while_down && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-red-50 text-red-700 border-red-200">
                      deprecated while DOWN
                    </span>
                  )}
                </div>
                {idx < sortedVersions.length - 1 && (
                  <span className="text-xs text-slate-400 italic">superseded by v{sortedVersions[idx + 1].version}</span>
                )}
              </div>
              <div className="flex gap-6 mt-2 text-xs text-slate-500">
                <span>Active: {ver.active_from} → {ver.active_to ?? "present"}</span>
                {ver.uptime_pct != null && (
                  <span className={ver.uptime_pct >= (ver.target_uptime_pct ?? 99) ? "text-green-700 font-medium" : "text-red-600 font-medium"}>
                    Uptime: {ver.uptime_pct.toFixed(2)}%{ver.target_uptime_pct != null && ` (target ${ver.target_uptime_pct}%)`}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardBody>
              {ver.assertion_text && (
                <div className="mb-4">
                  <div className="text-xs font-medium text-slate-500 mb-1.5">Acceptance criteria</div>
                  <ul className="space-y-1">
                    {ver.assertion_text.split(";").map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                        {c.trim()}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Uptime timeline */}
              {ver.intervals && ver.intervals.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-slate-500">Uptime timeline</span>
                    <div className="flex items-center gap-3">
                      {Object.entries(STATE_LABEL).map(([k, label]) => (
                        <span key={k} className="flex items-center gap-1 text-xs text-slate-400">
                          <span className="inline-block w-2.5 h-2.5 rounded-sm border border-slate-200" style={{ backgroundColor: STATE_COLOR[k] }} />
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <UptimeHeatmap intervals={ver.intervals} today={today} />
                </div>
              )}

              {/* Pinned controls */}
              {ver.controls && ver.controls.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs text-slate-500 mb-1">Pinned controls</div>
                  <div className="flex gap-2 flex-wrap">
                    {ver.controls.map(ctl => (
                      <span
                        key={ctl.id}
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-mono border ${
                          ctl.last_outcome === "PASS"
                            ? "bg-green-50 text-green-700 border-green-200"
                            : ctl.last_outcome === "FAIL"
                            ? "bg-red-50 text-red-700 border-red-200"
                            : "bg-slate-50 text-slate-600 border-slate-200"
                        }`}
                        title={ctl.name}
                      >
                        {ctl.id}
                        {ctl.last_outcome && <span className="text-xs opacity-70">({ctl.last_outcome})</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
