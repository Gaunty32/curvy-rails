import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import PortalLayout from "@/components/Layout";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";
import { useLocation } from "wouter";
import {
  Loader2, ClipboardList, Search, X, Package, User, Building2,
  UserCheck, Hash, Calendar, ChevronDown, ChevronUp,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoresLogEntry {
  id: number;
  quantity: number;
  reference: string | null;
  recipient_name: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
  item_name: string;
  colour: string | null;
  size: string | null;
  product_name: string | null;
  department: string | null;
  job_title: string | null;
  supervisor_name: string | null;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function thisMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    from: from.toISOString().slice(0, 10),
    to:   now.toISOString().slice(0, 10),
  };
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, icon: Icon, sub }: { label: string; value: string | number; icon: React.ElementType; sub?: string }) {
  return (
    <div className="bg-card border rounded-xl p-4 flex items-start gap-3">
      <div className="p-2 rounded-lg bg-muted shrink-0">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold leading-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function StoresLog() {
  const { isManager } = useAuth();
  const [, setLocation] = useLocation();

  const defaultRange = thisMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to,   setTo]   = useState(defaultRange.to);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<"created_at" | "recipient_name" | "item_name" | "department">("created_at");
  const [sortDir, setSortDir]     = useState<"asc" | "desc">("desc");

  // Redirect non-managers
  if (!isManager) {
    setLocation("/orders");
    return null;
  }

  const params = new URLSearchParams({ from, to });
  if (search) params.set("q", search);

  const { data = [], isLoading, refetch } = useQuery<StoresLogEntry[]>({
    queryKey: ["stores-log", from, to, search],
    queryFn: () => apiFetch(`/portal/admin/stores-log?${params.toString()}`),
    staleTime: 30_000,
  });

  // Derived sort
  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      let va: string | number = "";
      let vb: string | number = "";
      if (sortField === "created_at") { va = a.created_at; vb = b.created_at; }
      else if (sortField === "recipient_name") { va = a.recipient_name ?? ""; vb = b.recipient_name ?? ""; }
      else if (sortField === "item_name") { va = a.item_name ?? ""; vb = b.item_name ?? ""; }
      else if (sortField === "department") { va = a.department ?? ""; vb = b.department ?? ""; }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [data, sortField, sortDir]);

  // Summary stats
  const totalIssued = data.reduce((s, r) => s + Number(r.quantity || 0), 0);
  const uniqueRecipients = new Set(data.map(r => r.recipient_name?.toLowerCase()?.trim()).filter(Boolean)).size;
  const uniqueItems = new Set(data.map(r => r.item_name)).size;

  function toggleSort(field: typeof sortField) {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  }

  function SortIcon({ field }: { field: typeof sortField }) {
    if (sortField !== field) return <ChevronDown className="w-3.5 h-3.5 opacity-30" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-3.5 h-3.5 text-primary" />
      : <ChevronDown className="w-3.5 h-3.5 text-primary" />;
  }

  return (
    <PortalLayout>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ClipboardList className="w-6 h-6 text-primary" />
              Stores Allocation Log
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              A record of every item issued from your store — who received it, their department and supervisor.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="shrink-0">
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="bg-card border rounded-xl p-4 flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="w-36 h-8 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="w-36 h-8 text-sm" />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-40">
            <label className="text-xs font-medium text-muted-foreground">Search</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Name, item, department, reference…"
                className="pl-8 pr-8 h-8 text-sm"
              />
              {search && (
                <button onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Summary cards */}
        {data.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <SummaryCard icon={Package}  label="Items issued"     value={totalIssued}     sub="units across all lines" />
            <SummaryCard icon={User}     label="Recipients"        value={uniqueRecipients} sub="unique staff members" />
            <SummaryCard icon={ClipboardList} label="Transactions" value={data.length}    sub="store picks recorded" />
          </div>
        )}

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No allocations found</p>
            <p className="text-sm mt-1">Try adjusting the date range or search filter.</p>
          </div>
        ) : (
          <div className="border rounded-xl overflow-hidden">
            {/* Mobile: card list */}
            <div className="sm:hidden divide-y">
              {sorted.map(row => (
                <div key={row.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-sm leading-snug">
                      {row.item_name}
                      {(row.colour || row.size) && (
                        <span className="font-normal text-muted-foreground">
                          {" — "}{[row.colour, row.size].filter(Boolean).join(", ")}
                        </span>
                      )}
                    </div>
                    <Badge variant="secondary" className="shrink-0">×{row.quantity}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3 shrink-0" />
                      {row.recipient_name ?? <em>Unknown</em>}
                    </span>
                    {row.department && (
                      <span className="flex items-center gap-1">
                        <Building2 className="w-3 h-3 shrink-0" />
                        {row.department}
                      </span>
                    )}
                    {row.supervisor_name && (
                      <span className="flex items-center gap-1 col-span-2">
                        <UserCheck className="w-3 h-3 shrink-0" />
                        {row.supervisor_name}
                      </span>
                    )}
                    {row.reference && (
                      <span className="flex items-center gap-1">
                        <Hash className="w-3 h-3 shrink-0" />
                        {row.reference}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3 shrink-0" />
                      {formatDate(row.created_at)} {formatTime(row.created_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: full table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground">
                      <button
                        onClick={() => toggleSort("created_at")}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Date / Time <SortIcon field="created_at" />
                      </button>
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground">
                      <button
                        onClick={() => toggleSort("item_name")}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Item <SortIcon field="item_name" />
                      </button>
                    </th>
                    <th className="text-center px-4 py-3 font-medium text-xs text-muted-foreground w-12">Qty</th>
                    <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground">
                      <button
                        onClick={() => toggleSort("recipient_name")}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Recipient <SortIcon field="recipient_name" />
                      </button>
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground">
                      <button
                        onClick={() => toggleSort("department")}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Department <SortIcon field="department" />
                      </button>
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground">Supervisor</th>
                    <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground">Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sorted.map(row => (
                    <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                      {/* Date */}
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="block">{formatDate(row.created_at)}</span>
                        <span className="text-xs opacity-70">{formatTime(row.created_at)}</span>
                      </td>

                      {/* Item */}
                      <td className="px-4 py-3 max-w-[200px]">
                        <span className="font-medium leading-snug block">{row.item_name}</span>
                        {(row.colour || row.size) && (
                          <span className="text-xs text-muted-foreground">
                            {[row.colour, row.size].filter(Boolean).join(", ")}
                          </span>
                        )}
                      </td>

                      {/* Qty */}
                      <td className="px-4 py-3 text-center">
                        <Badge variant="secondary">×{row.quantity}</Badge>
                      </td>

                      {/* Recipient */}
                      <td className="px-4 py-3">
                        {row.recipient_name
                          ? <span className="font-medium">{row.recipient_name}</span>
                          : <span className="text-muted-foreground italic text-xs">—</span>
                        }
                        {row.job_title && (
                          <span className="block text-xs text-muted-foreground">{row.job_title}</span>
                        )}
                      </td>

                      {/* Department */}
                      <td className="px-4 py-3">
                        {row.department
                          ? <span className="inline-flex items-center gap-1"><Building2 className="w-3 h-3 text-muted-foreground shrink-0" />{row.department}</span>
                          : <span className="text-muted-foreground italic text-xs">—</span>
                        }
                      </td>

                      {/* Supervisor */}
                      <td className="px-4 py-3">
                        {row.supervisor_name
                          ? <span className="inline-flex items-center gap-1"><UserCheck className="w-3 h-3 text-muted-foreground shrink-0" />{row.supervisor_name}</span>
                          : <span className="text-muted-foreground italic text-xs">—</span>
                        }
                      </td>

                      {/* Reference */}
                      <td className="px-4 py-3">
                        {row.reference
                          ? <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{row.reference}</span>
                          : <span className="text-muted-foreground italic text-xs">—</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-2 border-t bg-muted/20 text-xs text-muted-foreground">
              Showing {sorted.length} {sorted.length === 500 ? "(limit reached — narrow the date range to see more)" : "allocations"}
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
