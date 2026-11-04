import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import api from "../api/client";
import { useAppStore } from "../store/useAppStore";
import Badge from "../components/Badge";
import Card, { CardHeader, CardBody } from "../components/Card";

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

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { actorId } = useAppStore();
  const qc = useQueryClient();
  const [noteBody, setNoteBody] = useState("");

  const { data: finding, isLoading } = useQuery<CaseFinding>({
    queryKey: ["finding", id],
    queryFn: () => api.get(`/findings/${id}`).then(r => r.data),
  });

  const { data: notes = [] } = useQuery<CaseNote[]>({
    queryKey: ["case-notes", id],
    queryFn: () => api.get(`/findings/${id}/notes`).then(r => r.data),
    enabled: !!id,
  });

  const statusMut = useMutation({
    mutationFn: (status: string) => api.patch(`/findings/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finding", id] }),
  });

  const noteMut = useMutation({
    mutationFn: (body: string) =>
      api.post(`/findings/${id}/notes`, { body, author_id: actorId }),
    onSuccess: () => {
      setNoteBody("");
      qc.invalidateQueries({ queryKey: ["case-notes", id] });
    },
  });

  if (isLoading || !finding) return <div className="text-slate-400 text-sm">Loading…</div>;

  const transitions = TRANSITIONS[finding.status] ?? [];

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
          </div>
          <h1 className="text-xl font-bold text-slate-900">{finding.title}</h1>
        </div>
        {transitions.length > 0 && (
          <div className="flex gap-2 flex-shrink-0">
            {transitions.map(t => (
              <button
                key={t.next}
                onClick={() => statusMut.mutate(t.next)}
                disabled={statusMut.isPending}
                className={`text-sm font-medium px-4 py-2 rounded-md transition-colors ${t.style}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

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
        </CardBody>
      </Card>
    </div>
  );
}
