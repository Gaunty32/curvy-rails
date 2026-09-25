import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const styles: Record<string, string> = {
    draft: "bg-slate-100 text-slate-700 border-slate-200/60 shadow-sm",
    quote: "bg-violet-50 text-violet-700 border-violet-200/60 shadow-sm shadow-violet-500/10",
    confirmed: "bg-blue-50 text-blue-700 border-blue-200/60 shadow-sm shadow-blue-500/10",
    shipped: "bg-amber-50 text-amber-700 border-amber-200/60 shadow-sm shadow-amber-500/10",
    delivered: "bg-emerald-50 text-emerald-700 border-emerald-200/60 shadow-sm shadow-emerald-500/10",
    cancelled: "bg-red-50 text-red-700 border-red-200/60 shadow-sm shadow-red-500/10",
    portal_pending: "bg-amber-50 text-amber-700 border-amber-200/60 shadow-sm shadow-amber-500/10",
    website_pending: "bg-cyan-50 text-cyan-700 border-cyan-200/60 shadow-sm shadow-cyan-500/10",
    portal_draft: "bg-slate-100 text-slate-500 border-slate-200/60 shadow-sm",
  };

  const labels: Record<string, string> = {
    portal_pending: "Portal Pending",
    website_pending: "Website Pending",
    portal_draft: "Portal Draft",
  };

  const currentStyle = styles[status.toLowerCase()] ?? styles.draft;
  const label = labels[status] ?? (status.charAt(0).toUpperCase() + status.slice(1).toLowerCase());

  return (
    <span 
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border tracking-wide transition-colors",
        currentStyle,
        className
      )}
    >
      {label}
    </span>
  );
}
