import { useState } from "react";
import { X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { useAppStore } from "../store/useAppStore";
import { can, useCurrentRole } from "../lib/permissions";
import Badge from "./Badge";

interface CaseFinding {
  id: string;
  control_id: string;
  check_id: string | null;
  severity: string;
  status: string;
  opened_on: string;
  closed_on: string | null;
  days_open: number | null;
  source: string;
  title: string;
  description: string;
  root_cause_note: string | null;
  level: number | null;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
}

interface CaseEscalation {
  id: number;
  level: number;
  assigned_to_role: string;
  reason: string;
  created_on: string;
  status: string;
}

interface CaseNote {
  id: number;
  author_id: string;
  author_name: string;
  created_on: string;
  body: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800 border-red-200",
  HIGH:     "bg-orange-100 text-orange-800 border-orange-200",
  MEDIUM:   "bg-yellow-100 text-yellow-800 border-yellow-200",
  LOW:      "bg-gray-100 text-gray-700 border-gray-200",
};

const TRANSITIONS: Record<string, { label: string; next: string; style: string }[]> = {
  OPEN:      [{ label: "Pick up", next: "IN_REVIEW", style: "bg-blue-600 hover:bg-blue-700 text-white" }],
  IN_REVIEW: [
    { label: "Mark resolved", next: "RESOLVED", style: "bg-green-600 hover:bg-green-700 text-white" },
    { label: "Close as false alarm", next: "CLOSED", style: "bg-slate-500 hover:bg-slate-600 text-white" },
  ],
  RESOLVED: [],
  CLOSED:   [],
};

const ESCALATION_LADDER = [
  { level: 1, role: "Control Owner",        action: "Acknowledge and begin remediation" },
  { level: 2, role: "Security Lead",        action: "Review and escalate if needed" },
  { level: 3, role: "Disclosure Committee", action: "Formal decision: REMEDIATE / STOP_CITING / DISCLOSE" },
];

export default function CasePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { actorId } = useAppStore();
  const role = useCurrentRole();
  const qc = useQueryClient();
  const [noteBody, setNoteBody] = useState("");
  const [error, setError] = useState("");

  const { data: finding, isLoading } = useQuery<CaseFinding>({
    queryKey: ["finding", id],
    queryFn: () => api.get(`/findings/${id}`).then(r => r.data),
  });

  const { data: personas = [] } = useQuery<{ id: string; name: string; role: string }[]>({
    queryKey: ["personas"],
    queryFn: () => api.get("/personas").then(r => r.data),
  });

  const { data: caseEscalations = [] } = useQuery<CaseEscalation[]>({
    queryKey: ["case-escalations", id],
    queryFn: () => api.get("/escalations").then(r =>
      (r.data as any[]).filter((e: any) => e.finding_id === id)
    ),
  });

  const { data: notes = [] } = useQuery<CaseNote[]>({
    queryKey: ["case-notes", id],
    queryFn: () => api.get(`/findings/${id}/notes`).then(r => r.data),
  });

  const invalidate = () => {
    setError("");
    qc.invalidateQueries({ queryKey: ["finding", id] });
    qc.invalidateQueries({ queryKey: ["case-escalations", id] });
    qc.invalidateQueries({ queryKey: ["escalations"] });
    qc.invalidateQueries({ queryKey: ["findings"] });
  };
  const onFail = (e: any) => setError(e.response?.data?.detail ?? "Action failed");

  const statusMut = useMutation({
    mutationFn: (status: string) => api.patch(`/findings/${id}/status`, { status }, { params: { actor_id: actorId } }),
    onSuccess: invalidate,
    onError: onFail,
  });

  const levelMut = useMutation({
    mutationFn: (level: number) => api.patch(`/findings/${id}/level`, { level }, { params: { actor_id: actorId } }),
    onSuccess: invalidate,
    onError: onFail,
  });

  const assignMut = useMutation({
    mutationFn: (person_id: string) => api.patch(`/findings/${id}/assign`, { person_id }, { params: { actor_id: actorId } }),
    onSuccess: () => {
      setError("");
      qc.invalidateQueries({ queryKey: ["finding", id] });
      qc.invalidateQueries({ queryKey: ["findings"] });
    },
    onError: onFail,
  });

  const noteMut = useMutation({
    mutationFn: (body: string) => api.post(`/findings/${id}/notes`, { body, author_id: actorId }),
    onSuccess: () => {
      setError("");
      setNoteBody("");
      qc.invalidateQueries({ queryKey: ["case-notes", id] });
    },
    onError: onFail,
  });

  const ackMut = useMutation({
    mutationFn: (escId: number) => api.post(`/escalations/${escId}/ack`, null, { params: { actor_id: actorId } }),
    onSuccess: invalidate,
    onError: onFail,
  });

  const isActive = finding?.status === "OPEN" || finding?.status === "IN_REVIEW";
  const nextLevel = finding?.level != null && finding.level < 3 ? finding.level + 1 : null;
  const canEscalate = isActive && nextLevel !== null && can.escalateTo(role, nextLevel);
  const transitions = finding
    ? (TRANSITIONS[finding.status] ?? []).filter(t =>
        t.next === "IN_REVIEW" ? can.pickUp(role)
        : t.next === "RESOLVED" ? can.resolve(role)
        : can.closeFalse(role))
    : [];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-slate-900/30"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 z-50 h-full w-[560px] bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Panel header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          {finding ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-slate-400">{finding.id}</span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${SEVERITY_COLORS[finding.severity] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
                {finding.severity}
              </span>
              <Badge value={finding.status} />
              {finding.level && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-purple-100 text-purple-700 border-purple-200">
                  L{finding.level}
                </span>
              )}
            </div>
          ) : <div />}
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors ml-4 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        {isLoading || !finding ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Loading…</div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* Title + actions */}
            <div className="px-6 pt-5 pb-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900 mb-3">{finding.title}</h2>
              <div className="flex flex-wrap gap-2">
                {transitions.map(t => (
                  <button
                    key={t.next}
                    onClick={() => statusMut.mutate(t.next)}
                    disabled={statusMut.isPending}
                    className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${t.style}`}
                  >
                    {t.label}
                  </button>
                ))}
                {canEscalate && (
                  <button
                    onClick={() => levelMut.mutate(nextLevel!)}
                    disabled={levelMut.isPending}
                    className="text-xs font-medium px-3 py-1.5 rounded-md border border-purple-300 text-purple-700 hover:bg-purple-50 transition-colors"
                  >
                    Escalate to L{nextLevel}
                  </button>
                )}
              </div>
              {error && (
                <div className="mt-3 rounded-md px-3 py-2 text-sm font-medium bg-red-50 text-red-800 border border-red-200">
                  {error}
                </div>
              )}
            </div>

            {/* Metadata */}
            <div className="px-6 py-4 border-b border-slate-100">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Details</div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
                <div>
                  <dt className="text-xs font-medium text-slate-400 mb-0.5">Check</dt>
                  <dd className="font-mono text-sm text-blue-600">{finding.check_id ?? finding.control_id}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-400 mb-0.5">Source</dt>
                  <dd className="text-sm text-slate-700">{finding.source}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-400 mb-0.5">Opened on</dt>
                  <dd className="text-sm text-slate-700">{finding.opened_on}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-400 mb-0.5">Closed on</dt>
                  <dd className="text-sm text-slate-700">{finding.closed_on ?? "—"}</dd>
                </div>
                {finding.days_open != null && (
                  <div>
                    <dt className="text-xs font-medium text-slate-400 mb-0.5">Days open</dt>
                    <dd className={`text-sm font-medium ${finding.days_open > 60 ? "text-red-600" : "text-slate-700"}`}>
                      {finding.days_open}d
                    </dd>
                  </div>
                )}
                <div className="col-span-2">
                  <dt className="text-xs font-medium text-slate-400 mb-1">Assigned to</dt>
                  <dd className="flex items-center gap-2">
                    <span className="text-sm text-slate-700">
                      {finding.assigned_to_name ?? <span className="text-slate-400 italic">Unassigned</span>}
                    </span>
                    <select
                      value={finding.assigned_to_id ?? ""}
                      onChange={e => assignMut.mutate(e.target.value)}
                      disabled={assignMut.isPending}
                      className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400 text-slate-600"
                    >
                      <option value="">— Assign to —</option>
                      {personas.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </dd>
                </div>
              </dl>
              {finding.description && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <div className="text-xs font-medium text-slate-400 mb-1">Description</div>
                  <p className="text-sm text-slate-700">{finding.description}</p>
                </div>
              )}
            </div>

            {/* Escalation ladder */}
            <div className="px-6 py-4 border-b border-slate-100">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Escalation Level</div>
              <div className="space-y-2">
                {ESCALATION_LADDER.map(row => {
                  const esc = caseEscalations.find(e => e.level === row.level);
                  const isCurrentLevel = finding.level === row.level;
                  const isPastLevel = finding.level !== null && row.level < finding.level;
                  return (
                    <div
                      key={row.level}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border ${
                        isCurrentLevel
                          ? "bg-purple-50 border-purple-200"
                          : isPastLevel
                          ? "bg-slate-50 border-slate-100 opacity-40"
                          : "bg-white border-slate-100"
                      }`}
                    >
                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold border flex-shrink-0 ${
                        isCurrentLevel
                          ? "bg-purple-600 text-white border-purple-600"
                          : isPastLevel
                          ? "bg-slate-200 text-slate-500 border-slate-200"
                          : "bg-white text-slate-400 border-slate-300"
                      }`}>
                        L{row.level}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-700">{row.role}</div>
                        <div className="text-xs text-slate-500">{row.action}</div>
                      </div>
                      {esc && <Badge value={esc.status} />}
                      {esc && esc.status === "OPEN" && isCurrentLevel && can.ack(role, esc.assigned_to_role) && (
                        <button
                          onClick={() => ackMut.mutate(esc.id)}
                          disabled={ackMut.isPending}
                          className="text-xs border border-slate-300 hover:border-slate-500 text-slate-500 hover:text-slate-700 rounded px-2 py-0.5 disabled:opacity-50 transition-colors flex-shrink-0"
                        >
                          Acknowledge
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {!finding.level && (
                <p className="text-xs text-slate-400 mt-2">No escalation level set — pick up the case to begin at L1.</p>
              )}
            </div>

            {/* Notes */}
            <div className="px-6 py-4">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Case Notes</div>
              {notes.length === 0 && (
                <p className="text-sm text-slate-400 mb-3">No notes yet.</p>
              )}
              <div className="space-y-3 mb-4">
                {notes.map(n => (
                  <div key={n.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-slate-700">{n.author_name}</span>
                      <span className="text-xs text-slate-400">{n.created_on}</span>
                    </div>
                    <p className="text-sm text-slate-600 whitespace-pre-wrap">{n.body}</p>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-100 pt-3">
                <textarea
                  value={noteBody}
                  onChange={e => setNoteBody(e.target.value)}
                  placeholder="Add a note…"
                  rows={3}
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 focus:outline-none focus:border-blue-400 resize-none"
                />
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => noteMut.mutate(noteBody)}
                    disabled={!noteBody.trim() || noteMut.isPending}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
                  >
                    Add note
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
