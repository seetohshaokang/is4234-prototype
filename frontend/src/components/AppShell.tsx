import { type ReactNode, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Library, FlaskConical,
  AlertTriangle, GitBranch, BookOpen, Info,
  CircleHelp, GitPullRequest,
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
  { to: "/about",       icon: Info,            label: "About" },
  { to: "/sccs",        icon: Library,         label: "SCC Library" },
  { to: "/checks",      icon: FlaskConical,    label: "Security Checks" },
  { to: "/changes",     icon: GitPullRequest,  label: "Change Requests" },
  { to: "/findings",    icon: AlertTriangle,   label: "Findings" },
  { to: "/escalations", icon: GitBranch,       label: "Escalations" },
  { to: "/audit",       icon: BookOpen,        label: "Audit Trail" },
];

const TOUR_KEY = "scc-tour-seen";
const COACH_KEY = "scc-coach-step";

const ROLE_THEME: Record<string, {
  sidebar: string;
  logo: string;
  navActive: string;
  navHover: string;
  border: string;
}> = {
  public:               { sidebar: "bg-slate-900",   logo: "text-blue-400",   navActive: "bg-blue-600",    navHover: "hover:bg-slate-800",   border: "border-slate-700" },
  control_owner:        { sidebar: "bg-teal-900",    logo: "text-teal-300",   navActive: "bg-teal-600",    navHover: "hover:bg-teal-800",    border: "border-teal-700" },
  security_lead:        { sidebar: "bg-blue-950",    logo: "text-blue-300",   navActive: "bg-blue-600",    navHover: "hover:bg-blue-900",    border: "border-blue-800" },
  disclosure_committee: { sidebar: "bg-purple-950",  logo: "text-purple-300", navActive: "bg-purple-600",  navHover: "hover:bg-purple-900",  border: "border-purple-800" },
  independent_auditor:  { sidebar: "bg-amber-950",   logo: "text-amber-300",  navActive: "bg-amber-600",   navHover: "hover:bg-amber-900",   border: "border-amber-800" },
  audit_committee:      { sidebar: "bg-rose-950",    logo: "text-rose-300",   navActive: "bg-rose-600",    navHover: "hover:bg-rose-900",    border: "border-rose-800" },
};

export default function AppShell({ children }: { children: ReactNode }) {
  const { actorId, setActor } = useAppStore();
  const [showWelcome, setShowWelcome] = useState(
    () => !localStorage.getItem(TOUR_KEY)
  );
  const [coachStep, setCoachStep] = useState<number | null>(() => {
    const saved = localStorage.getItem(COACH_KEY);
    return saved !== null ? Number(saved) : null;
  });
  const navigate = useNavigate();

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

  const allPersonas: Array<{ id: string; name: string; role: string; title: string }> = [
    { id: "PUBLIC", name: "Public (no role)", role: "public", title: "" },
    ...personas,
  ];

  const currentPersona = allPersonas.find(p => p.id === actorId);
  const isPublic = actorId === "PUBLIC";
  const nav = isPublic ? NAV_PUBLIC : NAV_INTERNAL;
  const theme = ROLE_THEME[currentPersona?.role ?? "public"] ?? ROLE_THEME.public;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className={cn("w-60 flex-shrink-0 text-slate-100 flex flex-col overflow-y-auto transition-colors duration-300", theme.sidebar)}>
        {/* Logo */}
        <div className={cn("flex items-center gap-2 px-4 py-5 border-b", theme.border)}>
          <Library className={theme.logo} size={22} />
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
                    ? cn(theme.navActive, "text-white")
                    : cn("text-slate-400 hover:text-white", theme.navHover)
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Persona switcher */}
        <div data-tour="role" className={cn("border-t px-4 py-3", theme.border)}>
          <div className="text-xs text-slate-400 mb-1 font-medium">Active persona</div>
          <select
            value={actorId}
            onChange={e => setActor(e.target.value)}
            className="w-full bg-black/20 text-white text-xs rounded border border-white/10 px-2 py-1.5 focus:outline-none focus:border-white/30"
          >
            {allPersonas.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {currentPersona && currentPersona.role !== "public" && (
            <div className="mt-1 text-xs text-slate-400">{currentPersona.role.replace(/_/g, " ")}</div>
          )}
          {currentPersona?.title && (
            <div className="mt-0.5 text-xs text-slate-500 truncate">{currentPersona.title}</div>
          )}
        </div>

        {/* Guided demo relaunch */}
        <button
          onClick={() => setCoach(0)}
          title="Start the guided demo"
          className={cn("flex items-center justify-center gap-1.5 border-t px-4 py-2.5 text-xs text-slate-400 hover:text-white transition-colors", theme.border, theme.navHover)}
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
              This POC is built around the SolarWinds case study — the data walks that company's
              security posture timeline, and the actions you can take show how a production version
              would behave.
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
