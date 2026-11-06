import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import api from "../api/client";
import { useAppStore } from "../store/useAppStore";
import Badge from "../components/Badge";
import Card, { CardHeader, CardBody } from "../components/Card";
import { can, useCurrentRole, CLOSE_REASON_MIN } from "../lib/permissions";

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
}

interface CaseEscalation {
  id: number;
  level: number;
  assigned_to_role: string;
  reason: string;
  created_on: string;
  status: string;
  responses: unknown[];
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

type Transition = { label: string; next: string; style: string };

const TRANSITIONS: Record<string, Transition[]> = {
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

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { actorId } = useAppStore();
  const role = useCurrentRole();
  const qc = useQueryClient();
  const [noteBody, setNoteBody] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [error, setError] = useState("");

  const { data: finding, isLoading } = useQuery<CaseFinding>({
    queryKey: ["finding", id],
    queryFn: () => api.get(`/findings/${id}`).then(r => r.data),
  });

  const { data: caseEscalations = [] } = useQuery<CaseEscalation[]>({
    queryKey: ["case-escalations", id],
    queryFn: () => api.get("/escalations").then(r =>
      (r.data as any[]).filter((e: any) => e.finding_id === id)
    ),
    enabled: !!id,
  });

  const { data: notes = [] } = useQuery<CaseNote[]>({
    queryKey: ["case-notes", id],
    queryFn: () => api.get(`/findings/${id}/notes`).then(r => r.data),
    enabled: !!id,
  });

  const refreshCase = () => {
    setError("");
    qc.invalidateQueries({ queryKey: ["finding", id] });
    qc.invalidateQueries({ queryKey: ["case-escalations", id] });
    qc.invalidateQueries({ queryKey: ["case-notes", id] });
    qc.invalidateQueries({ queryKey: ["escalations"] });
  };
  const onFail = (e: any) => setError(e.response?.data?.detail ?? "Action failed");

  const statusMut = useMutation({
    mutationFn: ({ status, reason }: { status: string; reason?: string }) =>
      api.patch(`/findings/${id}/status`, { status, reason }, { params: { actor_id: actorId } }),
    onSuccess: () => {
      setClosing(false);
      setCloseReason("");
      refreshCase();
    },
    onError: onFail,
  });

  const levelMut = useMutation({
    mutationFn: (level: number) =>
      api.patch(`/findings/${id}/level`, { level }, { params: { actor_id: actorId } }),
    onSuccess: refreshCase,
    onError: onFail,
  });

  const noteMut = useMutation({
    mutationFn: (body: string) =>
      api.post(`/findings/${id}/notes`, { body, author_id: actorId }),
    onSuccess: () => {
      setNoteBody("");
      qc.invalidateQueries({ queryKey: ["case-notes", id] });
    },
    onError: onFail,
  });

  if (isLoading || !finding) return <div className="text-slate-400 text-sm">Loading…</div>;

  const isActive = finding.status === "OPEN" || finding.status === "IN_REVIEW";
  const nextLevel = finding.level !== null && finding.level < 3 ? finding.level + 1 : null;
  const hasCommitteeResponse = caseEscalations.some(e => e.level === 3 && e.responses?.length > 0);
  const awaitingCommittee = finding.level === 3 && !hasCommitteeResponse;

  const allowed = (t: Transition) =>
    t.next === "IN_REVIEW" ? can.pickUp(role)
    : t.next === "RESOLVED" ? can.resolve(role)
    : can.closeFalse(role);
  const transitions = (TRANSITIONS[finding.status] ?? []).filter(allowed);
  const canEscalate = isActive && nextLevel !== null && can.escalateTo(role, nextLevel);
  const readOnly = !can.pickUp(role) && !can.closeFalse(role) && !can.addNote(role);

  const onTransition = (t: Transition) => {
    if (t.next === "CLOSED") { setClosing(true); return; }
    statusMut.mutate({ status: t.next });
  };

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
      >
        <ArrowLeft size={15} />
        Back to Cases
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
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
          <h1 className="text-xl font-bold text-slate-900">{finding.title}</h1>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {transitions.map(t => {
            const blocked = t.next === "RESOLVED" && awaitingCommittee;
            return (
              <button
                key={t.next}
                onClick={() => onTransition(t)}
                disabled={statusMut.isPending || blocked}
                title={blocked ? "L3 cases need a formal committee response before they can be resolved" : undefined}
                className={`text-sm font-medium px-4 py-2 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${t.style}`}
              >
                {t.label}
              </button>
            );
          })}
          {canEscalate && (
            <button
              onClick={() => levelMut.mutate(nextLevel)}
              disabled={levelMut.isPending}
              className="text-sm font-medium px-4 py-2 rounded-md border border-purple-300 text-purple-700 hover:bg-purple-50 transition-colors"
            >
              Escalate to L{nextLevel}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md px-4 py-3 text-sm font-medium bg-red-50 text-red-800 border border-red-200">
          {error}
        </div>
      )}

      {readOnly && (
        <div className="rounded-md px-4 py-3 text-sm bg-slate-50 text-slate-600 border border-slate-200">
          Read-only view — your role can see this case but not change it.
        </div>
      )}

      {awaitingCommittee && isActive && can.resolve(role) && (
        <div className="rounded-md px-4 py-3 text-sm bg-purple-50 text-purple-800 border border-purple-200">
          This case is at L3 — it can be resolved once the disclosure committee records a formal response.
        </div>
      )}

      {closing && (
        <Card>
          <CardBody className="space-y-3">
            <div className="text-sm font-semibold text-slate-700">Close as false alarm</div>
            <p className="text-xs text-slate-500">
              Explain why this isn't a real problem. The reason is saved as a case note and in the audit trail.
            </p>
            <textarea
              value={closeReason}
              onChange={e => setCloseReason(e.target.value)}
              rows={3}
              placeholder="Why is this a false alarm?"
              className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 focus:outline-none focus:border-blue-400 resize-none"
            />
            <div className="flex items-center justify-between">
              <span className={`text-xs ${closeReason.trim().length >= CLOSE_REASON_MIN ? "text-green-600" : "text-slate-400"}`}>
                {closeReason.trim().length}/{CLOSE_REASON_MIN} characters minimum
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => { setClosing(false); setCloseReason(""); }}
                  className="text-sm px-4 py-2 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => statusMut.mutate({ status: "CLOSED", reason: closeReason.trim() })}
                  disabled={closeReason.trim().length < CLOSE_REASON_MIN || statusMut.isPending}
                  className="text-sm font-medium px-4 py-2 rounded-md bg-slate-600 hover:bg-slate-700 text-white disabled:opacity-40"
                >
                  Confirm close
                </button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Metadata */}
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-xs font-medium text-slate-400 mb-0.5">Check</dt>
              <dd className="font-mono text-blue-600">{finding.check_id ?? finding.control_id}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-400 mb-0.5">Source</dt>
              <dd className="text-slate-700">{finding.source}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-400 mb-0.5">Opened on</dt>
              <dd className="text-slate-700">{finding.opened_on}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-400 mb-0.5">Closed on</dt>
              <dd className="text-slate-700">{finding.closed_on ?? "—"}</dd>
            </div>
            {finding.days_open != null && (
              <div>
                <dt className="text-xs font-medium text-slate-400 mb-0.5">Days open</dt>
                <dd className={`font-medium ${finding.days_open > 60 ? "text-red-600" : "text-slate-700"}`}>
                  {finding.days_open}d
                </dd>
              </div>
            )}
          </dl>
          {finding.description && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <div className="text-xs font-medium text-slate-400 mb-1">Description</div>
              <p className="text-sm text-slate-700">{finding.description}</p>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Escalation ladder */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-700">Escalation Level</h2>
        </CardHeader>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <tbody>
              {ESCALATION_LADDER.map(row => {
                const esc = caseEscalations.find(e => e.level === row.level);
                const isCurrentLevel = finding.level === row.level;
                const isPastLevel = finding.level !== null && row.level < finding.level;
                return (
                  <tr
                    key={row.level}
                    className={`border-b border-slate-100 last:border-0 ${
                      isCurrentLevel ? "bg-purple-50" : isPastLevel ? "opacity-40" : ""
                    }`}
                  >
                    <td className="px-5 py-3 w-12">
                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold border ${
                        isCurrentLevel
                          ? "bg-purple-600 text-white border-purple-600"
                          : isPastLevel
                          ? "bg-slate-200 text-slate-500 border-slate-200"
                          : "bg-white text-slate-400 border-slate-300"
                      }`}>
                        L{row.level}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-700">{row.role}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{row.action}</td>
                    <td className="px-4 py-3 text-right">
                      {esc && <Badge value={esc.status} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!finding.level && (
            <div className="px-5 py-3 text-xs text-slate-400 border-t border-slate-100">
              No escalation level set — pick up the case to begin at L1.
            </div>
          )}
        </CardBody>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-700">Case Notes</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          {notes.length === 0 && (
            <p className="text-sm text-slate-400">No notes yet.</p>
          )}
          {notes.map(n => (
            <div key={n.id} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-slate-700">{n.author_name}</span>
                <span className="text-xs text-slate-400">{n.created_on}</span>
              </div>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{n.body}</p>
            </div>
          ))}

          {/* Add note form */}
          {can.addNote(role) && (
          <div className="pt-2 border-t border-slate-100">
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
          )}
        </CardBody>
      </Card>
    </div>
  );
}
