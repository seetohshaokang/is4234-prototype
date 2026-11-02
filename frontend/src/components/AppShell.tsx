import { type ReactNode, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck, LayoutDashboard, FileText, TestTube2,
  AlertTriangle, GitBranch, ClipboardCheck, BookOpen, Info,
  CalendarDays
} from "lucide-react";
import api from "../api/client";
import { useAppStore } from "../store/useAppStore";
import { cn } from "../lib/utils";

interface Actor { id: string; name: string; role: string; }
interface Checkpoint { id: string; label: string; date: string; description: string; applied?: boolean; }

const NAV = [
  { to: "/",            icon: LayoutDashboard, label: "Dashboard" },
  { to: "/claims",      icon: FileText,        label: "Claim Registry" },
  { to: "/controls",    icon: TestTube2,       label: "Control Tests" },
  { to: "/gate",        icon: ClipboardCheck,  label: "Gate Review" },
  { to: "/findings",    icon: AlertTriangle,   label: "Findings" },
  { to: "/escalations", icon: GitBranch,       label: "Escalations" },
  { to: "/audit",       icon: BookOpen,        label: "Audit Trail" },
  { to: "/about",       icon: Info,            label: "About" },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const { actorId, simDate, setActor, setSimDate } = useAppStore();
  const [jumpDate, setJumpDate] = useState("");
  const qc = useQueryClient();

  const { data: actors = [] } = useQuery<Actor[]>({
    queryKey: ["actors"],
    queryFn: () => api.get("/actors").then(r => r.data),
  });

  const { data: clock } = useQuery<{ date: string }>({
    queryKey: ["clock"],
    queryFn: () => api.get("/clock").then(r => r.data),
  });

  const { data: checkpoints = [] } = useQuery<Checkpoint[]>({
    queryKey: ["checkpoints"],
    queryFn: () => api.get("/checkpoints").then(r => r.data),
  });

  useEffect(() => {
    if (clock?.date) setSimDate(clock.date);
  }, [clock?.date]);

  const advanceMut = useMutation({
    mutationFn: () => api.post("/clock/advance", { days: 1 }),
    onSuccess: (res) => {
      setSimDate(res.data.date);
      qc.invalidateQueries();
    },
  });

  const cpMut = useMutation({
    mutationFn: (cpId: string) => api.post(`/checkpoints/${cpId}/goto`),
    onSuccess: () => {
      qc.invalidateQueries();
      api.get("/clock").then(r => setSimDate(r.data.date));
    },
  });

  const resetMut = useMutation({
    mutationFn: () => api.post("/demo/reset"),
    onSuccess: () => {
      qc.invalidateQueries();
      api.get("/clock").then(r => setSimDate(r.data.date));
    },
  });

  const setClockMut = useMutation({
    mutationFn: (d: string) => api.post("/clock/set", { date: d }),
    onSuccess: (res) => {
      setSimDate(res.data.date);
      qc.invalidateQueries();
    },
  });

  const currentActor = actors.find(a => a.id === actorId);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-slate-900 text-slate-100 flex flex-col overflow-y-auto">
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-5 border-b border-slate-700">
          <ShieldCheck className="text-blue-400" size={22} />
          <span className="font-semibold text-white text-sm">Disclosure Gate</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Sim Clock */}
        <div className="border-t border-slate-700 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
            <CalendarDays size={13} />
            <span>Sim date</span>
          </div>
          <div className="text-white font-mono text-sm mb-2">{simDate}</div>
          <button
            onClick={() => advanceMut.mutate()}
            disabled={advanceMut.isPending}
            className="w-full text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded px-2 py-1 transition-colors disabled:opacity-50"
          >
            +1 day
          </button>
          <div className="flex gap-1 mt-1">
            <input
              type="date"
              value={jumpDate}
              onChange={e => setJumpDate(e.target.value)}
              className="flex-1 min-w-0 bg-slate-800 text-slate-200 text-xs rounded border border-slate-600 px-1.5 py-1 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => jumpDate && setClockMut.mutate(jumpDate)}
              disabled={!jumpDate || setClockMut.isPending}
              className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded px-2 py-1 transition-colors disabled:opacity-50"
            >
              Jump
            </button>
          </div>
        </div>

        {/* Checkpoints */}
        <div className="border-t border-slate-700 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Checkpoints</div>
            <button
              onClick={() => resetMut.mutate()}
              disabled={resetMut.isPending || cpMut.isPending}
              title="Reset demo state (before CP1)"
              className="text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
            >
              Reset
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {checkpoints.map(cp => (
              <button
                key={cp.id}
                onClick={() => cpMut.mutate(cp.id)}
                disabled={cpMut.isPending}
                title={`${cp.date}: ${cp.description}`}
                className={cn(
                  "text-xs rounded px-1.5 py-1 transition-colors disabled:opacity-50",
                  cp.applied
                    ? "bg-blue-700 text-white hover:bg-blue-600"
                    : "bg-slate-700 hover:bg-blue-700 text-slate-300 hover:text-white"
                )}
              >
                {cp.id}
              </button>
            ))}
          </div>
        </div>

        {/* Role switcher */}
        <div className="border-t border-slate-700 px-4 py-3">
          <div className="text-xs text-slate-400 mb-1 font-medium">Active role</div>
          <select
            value={actorId}
            onChange={e => setActor(e.target.value)}
            className="w-full bg-slate-800 text-white text-xs rounded border border-slate-600 px-2 py-1.5 focus:outline-none focus:border-blue-500"
          >
            {actors.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          {currentActor && (
            <div className="mt-1 text-xs text-slate-500">{currentActor.role.replace(/_/g, " ")}</div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 min-h-full">{children}</div>
      </main>
    </div>
  );
}
