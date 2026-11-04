import { type ReactNode, useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Library, LayoutDashboard, FlaskConical,
  AlertTriangle, GitBranch, BookOpen, Info,
  CalendarDays, CircleHelp, GitPullRequest, Search, RotateCcw,
} from "lucide-react";
import api from "../api/client";
import { useAppStore } from "../store/useAppStore";
import { cn } from "../lib/utils";
import { startTour } from "../lib/tour";
import DemoCoach from "./DemoCoach";

interface Persona { id: string; name: string; role: string; title: string; }

const NAV_PUBLIC = [
  { to: "/sccs", icon: Library, label: "Library" },
];

const NAV_INTERNAL = [
  { to: "/",            icon: LayoutDashboard, label: "Dashboard" },
  { to: "/sccs",        icon: Library,         label: "SCC Library" },
  { to: "/checks",      icon: FlaskConical,    label: "Checks & Collectors" },
  { to: "/changes",     icon: GitPullRequest,  label: "Change Requests" },
  { to: "/findings",    icon: AlertTriangle,   label: "Findings" },
  { to: "/escalations", icon: GitBranch,       label: "Escalations" },
  { to: "/resolver",    icon: Search,          label: "Resolver" },
  { to: "/audit",       icon: BookOpen,        label: "Audit Trail" },
  { to: "/about",       icon: Info,            label: "About" },
];

const TOUR_KEY = "scc-tour-seen";
const COACH_KEY = "scc-coach-step";

export default function AppShell({ children }: { children: ReactNode }) {
  const { actorId, simDate, setActor, setSimDate } = useAppStore();
  const [jumpDate, setJumpDate] = useState("");
  const [showWelcome, setShowWelcome] = useState(
    () => !localStorage.getItem(TOUR_KEY)
  );
  const [coachStep, setCoachStep] = useState<number | null>(() => {
    const saved = localStorage.getItem(COACH_KEY);
    return saved !== null ? Number(saved) : null;
  });
  const navigate = useNavigate();
  const qc = useQueryClient();

  const setCoach = (i: number | null) => {
    setCoachStep(i);
    if (i === null) localStorage.removeItem(COACH_KEY);
    else localStorage.setItem(COACH_KEY, String(i));
  };

  const beginTour = () => {
    localStorage.setItem(TOUR_KEY, "1");
    setShowWelcome(false);
    startTour(navigate);
  };

  const beginDemo = () => {
    localStorage.setItem(TOUR_KEY, "1");
    setShowWelcome(false);
    setCoach(0);
  };

  const dismissWelcome = () => {
    localStorage.setItem(TOUR_KEY, "1");
    setShowWelcome(false);
  };

  const { data: personas = [] } = useQuery<Persona[]>({
    queryKey: ["personas"],
    queryFn: () => api.get("/personas").then(r => r.data),
  });

  const { data: clock } = useQuery<{ date: string }>({
    queryKey: ["clock"],
    queryFn: () => api.get("/clock").then(r => r.data),
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

  const resetMut = useMutation({
    mutationFn: () => api.post("/reset"),
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

  // Build persona list including PUBLIC option
  const allPersonas: Array<{ id: string; name: string; role: string; title: string }> = [
    { id: "PUBLIC", name: "Public (no role)", role: "public", title: "" },
    ...personas,
  ];

  const currentPersona = allPersonas.find(p => p.id === actorId);
  const isPublic = actorId === "PUBLIC";
  const nav = isPublic ? NAV_PUBLIC : NAV_INTERNAL;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-slate-900 text-slate-100 flex flex-col overflow-y-auto">
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-5 border-b border-slate-700">
          <Library className="text-blue-400" size={22} />
          <span className="font-semibold text-white text-sm">SCC Library</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {nav.map(({ to, icon: Icon, label }) => (
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

        {/* Sim Clock + Reset — internal only */}
        {!isPublic && (
          <div data-tour="clock" className="border-t border-slate-700 px-4 py-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <CalendarDays size={13} />
                <span>Sim date</span>
              </div>
              <button
                onClick={() => resetMut.mutate()}
                disabled={resetMut.isPending}
                title="Reset and re-seed database"
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
              >
                <RotateCcw size={11} />
                Reset
              </button>
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
        )}

        {/* Persona switcher */}
        <div data-tour="role" className="border-t border-slate-700 px-4 py-3">
          <div className="text-xs text-slate-400 mb-1 font-medium">Active persona</div>
          <select
            value={actorId}
            onChange={e => setActor(e.target.value)}
            className="w-full bg-slate-800 text-white text-xs rounded border border-slate-600 px-2 py-1.5 focus:outline-none focus:border-blue-500"
          >
            {allPersonas.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {currentPersona && currentPersona.role !== "public" && (
            <div className="mt-1 text-xs text-slate-500">{currentPersona.role.replace(/_/g, " ")}</div>
          )}
          {currentPersona?.title && (
            <div className="mt-0.5 text-xs text-slate-600 truncate">{currentPersona.title}</div>
          )}
        </div>

        {/* Guided demo relaunch */}
        <button
          onClick={() => setCoach(0)}
          title="Start the guided demo"
          className="flex items-center justify-center gap-1.5 border-t border-slate-700 px-4 py-2.5 text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <CircleHelp size={14} />
          Guided demo
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 min-h-full">{children}</div>
      </main>

      {/* First-visit welcome */}
      {showWelcome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50">
          <div className="bg-white rounded-lg shadow-xl max-w-sm mx-4 p-6">
            <h2 className="text-lg font-bold text-slate-900">Welcome to SCC Library</h2>
            <p className="mt-2 text-sm text-slate-600">
              A proof-of-concept of a Security Citation Code (SCC) library: measurable security
              assertions tracked like SLAs, with automated evidence collection and citation generation.
            </p>
            <p className="mt-2 text-sm text-slate-600">
              This POC is built around the NimbusWatch case study — the checkpoints walk
              that company's timeline from 2017 to 2020, and the actions you can take along
              the way show how a production version would behave.
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Want a guided demo of the case study, or a quick tour of each tab?
            </p>
            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={dismissWelcome}
                className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2"
              >
                Skip
              </button>
              <button
                onClick={beginTour}
                className="text-sm text-slate-600 hover:text-slate-800 border border-slate-300 px-3 py-2 rounded-md transition-colors"
              >
                Feature tour
              </button>
              <button
                onClick={beginDemo}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
              >
                Guided demo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Guided demo coach panel */}
      {coachStep !== null && (
        <DemoCoach
          step={coachStep}
          onStep={setCoach}
          onFeatureTour={beginTour}
        />
      )}
    </div>
  );
}
