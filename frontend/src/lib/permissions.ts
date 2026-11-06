import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import { useAppStore } from "../store/useAppStore";

// Mirrors the role checks in backend/main.py — the backend is the source of truth;
// these only decide which buttons to show.

export type Role =
  | "control_owner"
  | "security_lead"
  | "disclosure_committee"
  | "independent_auditor"
  | "audit_committee"
  | "public";

interface Persona { id: string; name: string; role: string; title: string; }

export function useCurrentRole(): Role {
  const { actorId } = useAppStore();
  const { data: personas = [] } = useQuery<Persona[]>({
    queryKey: ["personas"],
    queryFn: () => api.get("/personas").then(r => r.data),
  });
  return (personas.find(p => p.id === actorId)?.role as Role) ?? "public";
}

export const can = {
  pickUp:     (r: Role) => r === "control_owner" || r === "security_lead",
  resolve:    (r: Role) => r === "control_owner" || r === "security_lead",
  closeFalse: (r: Role) => r === "security_lead" || r === "disclosure_committee",
  addNote:    (r: Role) => r === "control_owner" || r === "security_lead" || r === "disclosure_committee",
  escalateTo: (r: Role, level: number) =>
    level === 2 ? r === "control_owner" || r === "security_lead"
    : level === 3 ? r === "security_lead"
    : false,
  ack:        (r: Role, assignedRole: string) => r === assignedRole,
  respond:    (r: Role) => r === "disclosure_committee",
};

export const CLOSE_REASON_MIN = 20;
