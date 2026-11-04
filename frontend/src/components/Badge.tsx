import { cn } from "../lib/utils";

const variants = {
  APPROVE:  "bg-emerald-100 text-emerald-800 border-emerald-200",
  BLOCK:    "bg-red-100 text-red-800 border-red-200",
  ESCALATE: "bg-amber-100 text-amber-800 border-amber-200",
  PASS:     "bg-emerald-100 text-emerald-800 border-emerald-200",
  FAIL:     "bg-red-100 text-red-800 border-red-200",
  ERROR:    "bg-slate-100 text-slate-600 border-slate-200",
  OPEN:      "bg-red-100 text-red-700 border-red-200",
  IN_REVIEW: "bg-blue-100 text-blue-700 border-blue-200",
  RESOLVED:  "bg-green-100 text-green-700 border-green-200",
  CLOSED:    "bg-slate-100 text-slate-500 border-slate-200",
  CRITICAL: "bg-red-100 text-red-800 border-red-200",
  HIGH:     "bg-orange-100 text-orange-800 border-orange-200",
  MEDIUM:   "bg-amber-100 text-amber-800 border-amber-200",
  LOW:      "bg-slate-100 text-slate-600 border-slate-200",
  ACTIVE:   "bg-blue-100 text-blue-800 border-blue-200",
  PENDING:  "bg-amber-100 text-amber-800 border-amber-200",
  APPROVED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  ACCEPTED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  REJECTED: "bg-red-100 text-red-700 border-red-200",
  default:  "bg-slate-100 text-slate-700 border-slate-200",
};

export default function Badge({ value, className }: { value: string; className?: string }) {
  const style = variants[value as keyof typeof variants] ?? variants.default;
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border", style, className)}>
      {value}
    </span>
  );
}
