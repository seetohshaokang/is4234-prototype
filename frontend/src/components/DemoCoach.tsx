import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, FlaskConical, Loader2 } from "lucide-react";
import api from "../api/client";
import { useAppStore } from "../store/useAppStore";
import { DEMO_STEPS } from "../lib/demoScript";

interface Props {
  step: number;
  onStep: (i: number | null) => void;
  onFeatureTour: () => void;
}

export default function DemoCoach({ step, onStep, onFeatureTour }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { setSimDate } = useAppStore();
  const [busy, setBusy] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const s = DEMO_STEPS[step];
  const last = DEMO_STEPS.length - 1;

  // Apply the checkpoint whenever a step with one is entered.
  // Backward jumps rewind deterministically via the /goto endpoint.
  useEffect(() => {
    if (!s?.cp) return;
    let cancelled = false;
    setBusy(true);
    api.post(`/checkpoints/${s.cp}/goto`)
      .then(() => api.get("/clock"))
      .then(r => { if (!cancelled) setSimDate(r.data.date); })
      .catch(() => {})
      .finally(() => { if (!cancelled) { qc.invalidateQueries(); setBusy(false); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  if (!s) return null;

  if (minimized) {
    return (
      <div className="fixed bottom-16 right-4 z-40 flex items-center gap-1 bg-slate-900 text-white rounded-full shadow-2xl border border-slate-700 pl-4 pr-1.5 py-1.5">
        <button
          onClick={() => setMinimized(false)}
          className="flex items-center gap-2 text-xs font-medium hover:text-blue-300 transition-colors"
          title="Expand guided demo"
        >
          Guided demo · {step + 1}/{DEMO_STEPS.length}
          <ChevronUp size={14} />
        </button>
        <button
          onClick={() => onStep(null)}
          className="text-slate-400 hover:text-white transition-colors p-1"
          title="Exit guided demo"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-16 right-4 z-40 w-[380px] max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900 text-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            Guided demo · {step + 1} of {DEMO_STEPS.length}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMinimized(true)}
              className="text-slate-400 hover:text-white transition-colors"
              title="Minimize — keep playing with the app"
            >
              <ChevronDown size={16} />
            </button>
            <button
              onClick={() => onStep(null)}
              className="text-slate-400 hover:text-white transition-colors"
              title="Close guided demo"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="mt-1.5 h-1 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${((step + 1) / DEMO_STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3 max-h-[55vh] overflow-y-auto">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900">{s.title}</h3>
            <span className="text-xs font-mono text-slate-400 flex-shrink-0">{s.date}</span>
          </div>
          {busy && (
            <div className="flex items-center gap-1.5 text-xs text-blue-600 mt-1">
              <Loader2 size={12} className="animate-spin" /> Applying checkpoint…
            </div>
          )}
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">What happened</div>
          <p className="text-xs text-slate-700 leading-relaxed">{s.story}</p>
        </div>

        <div>
          <div className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-0.5">What the gate did</div>
          <p className="text-xs text-slate-700 leading-relaxed">{s.gate}</p>
        </div>

        {s.tries.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1 flex items-center gap-1">
              <FlaskConical size={11} /> Play around
            </div>
            <ul className="space-y-1">
              {s.tries.map((t, i) => (
                <li key={i}>
                  <button
                    onClick={() => t.nav && navigate(t.nav)}
                    className={`text-left text-xs leading-relaxed rounded px-2 py-1 -ml-2 w-full transition-colors ${
                      t.nav
                        ? "text-blue-700 hover:bg-blue-50 cursor-pointer"
                        : "text-slate-600 cursor-default"
                    }`}
                  >
                    {t.nav ? "→ " : "• "}{t.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="bg-emerald-50 border border-emerald-100 rounded-md px-3 py-2">
          <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-0.5">Takeaway</div>
          <p className="text-xs text-emerald-900 leading-relaxed">{s.takeaway}</p>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-slate-100 px-4 py-2.5 flex items-center justify-between">
        <button
          onClick={() => step > 0 && onStep(step - 1)}
          disabled={step === 0}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-30 transition-colors"
        >
          <ChevronLeft size={14} /> Prev
        </button>
        <button
          onClick={onFeatureTour}
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
        >
          Feature tour
        </button>
        {step < last ? (
          <button
            onClick={() => onStep(step + 1)}
            className="flex items-center gap-1 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-1.5 transition-colors"
          >
            Next <ChevronRight size={14} />
          </button>
        ) : (
          <button
            onClick={() => onStep(null)}
            className="text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded px-3 py-1.5 transition-colors"
          >
            Finish
          </button>
        )}
      </div>
    </div>
  );
}
