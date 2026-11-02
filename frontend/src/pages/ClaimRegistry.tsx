import { Fragment, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import api from "../api/client";
import { useAppStore } from "../store/useAppStore";
import Badge from "../components/Badge";
import Card, { CardBody } from "../components/Card";

interface Claim {
  id: string;
  text: string;
  status: string;
  support_state: string;
  owner_id: string;
  mappings: Array<{ control_id: string; approved_by: string }>;
  latest_decision?: { decision: string } | null;
}

export default function ClaimRegistry() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");
  const { actorId } = useAppStore();
  const qc = useQueryClient();

  const { data: claims = [], isLoading } = useQuery<Claim[]>({
    queryKey: ["claims"],
    queryFn: () => api.get("/claims").then(r => r.data),
  });

  const actMut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "publish" | "withdraw" }) =>
      api.post(`/claims/${id}/${action}`, { actor_id: actorId }),
    onSuccess: () => {
      qc.invalidateQueries();
      setError("");
    },
    onError: (e: any) => setError(e.response?.data?.detail ?? "Action failed"),
  });

  if (isLoading) return <div className="text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Claim Registry</h1>
      <p className="text-sm text-slate-500">Public security claims and their evidence linkage status.</p>

      {error && (
        <div className="rounded-md px-4 py-3 text-sm font-medium bg-red-50 text-red-800 border border-red-200">
          {error}
        </div>
      )}

      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="w-8 px-4"></th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">ID</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Title</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Gate Verdict</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Support</th>
              </tr>
            </thead>
            <tbody>
              {claims.map(claim => (
                <Fragment key={claim.id}>
                  <tr
                    className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer"
                    onClick={() => setExpanded(expanded === claim.id ? null : claim.id)}
                  >
                    <td className="px-4 py-3 text-slate-400">
                      {expanded === claim.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{claim.id}</td>
                    <td className="px-4 py-3 text-slate-700 font-medium">{claim.text.slice(0, 60)}</td>
                    <td className="px-4 py-3"><Badge value={claim.status} /></td>
                    <td className="px-4 py-3"><Badge value={claim.latest_decision?.decision ?? "PENDING"} /></td>
                    <td className="px-4 py-3"><Badge value={claim.support_state} /></td>
                  </tr>
                  {expanded === claim.id && (
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <td colSpan={6} className="px-8 py-4">
                        <div className="space-y-3">
                          <div>
                            <div className="text-xs font-medium text-slate-500 mb-1">Claim Text</div>
                            <div className="text-sm text-slate-700 bg-white rounded border border-slate-200 p-3">{claim.text}</div>
                          </div>
                          {claim.mappings?.length > 0 && (
                            <div>
                              <div className="text-xs font-medium text-slate-500 mb-1">Mapped Controls</div>
                              <div className="flex gap-2 flex-wrap">
                                {claim.mappings.map(m => (
                                  <span key={m.control_id} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-0.5 text-xs font-mono">
                                    {m.control_id}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="flex items-center justify-between">
                            <div className="text-xs text-slate-400">Owner: {claim.owner_id}</div>
                            {claim.status === "published" ? (
                              <button
                                onClick={() => actMut.mutate({ id: claim.id, action: "withdraw" })}
                                disabled={actMut.isPending}
                                className="text-xs bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 rounded px-3 py-1.5 font-medium disabled:opacity-50"
                              >
                                Withdraw claim
                              </button>
                            ) : (
                              <button
                                onClick={() => actMut.mutate({ id: claim.id, action: "publish" })}
                                disabled={actMut.isPending}
                                className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded px-3 py-1.5 font-medium disabled:opacity-50"
                              >
                                Publish claim
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
