import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import PortalLayout from "@/components/Layout";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";
import { cn, formatCurrency } from "@/lib/utils";
import { useLocation } from "wouter";
import { Loader2, TrendingUp, Users, Package, BarChart3, Trophy, ChevronDown, ChevronUp, ChevronsUpDown, ShoppingBag, Boxes, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReportEmployee {
  id: number;
  name: string;
  email: string | null;
  department: string | null;
  jobTitle: string | null;
  managerId: number | null;
  managerName: string | null;
  allowance: number | null;
  orderedSpend: number;
  stockValue: number;
  totalSpend: number;
  itemsOrdered: number;
  stockIssued: number;
  orderCount: number;
}

interface ReportProduct {
  productName: string;
  colour: string | null;
  size: string | null;
  orderedQty: number;
  issuedQty: number;
  totalQty: number;
  orderedValue: number;
  issuedValue: number;
  totalValue: number;
}

interface ReportSupervisor {
  supervisorId: number | null;
  supervisorName: string | null;
  totalSpend: number;
  orderedSpend: number;
  stockValue: number;
  memberCount: number;
  members: Array<{ employeeId: number; name: string; totalSpend: number }>;
}

interface UsageReport {
  period: { from: string; to: string };
  summary: {
    totalSpend: number;
    orderedSpend: number;
    stockValue: number;
    orderCount: number;
    totalItemsOrdered: number;
    totalStockIssued: number;
    activeEmployees: number;
    avgSpendPerEmployee: number;
    avgOrderValue: number;
  };
  employees: ReportEmployee[];
  products: ReportProduct[];
  supervisors: ReportSupervisor[];
}

// ─── Period helpers ───────────────────────────────────────────────────────────

function currentFY(): { from: string; to: string } {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: `${year}-04-01`, to: `${year + 1}-03-31` };
}

function lastFY(): { from: string; to: string } {
  const fy = currentFY();
  const y = parseInt(fy.from.slice(0, 4)) - 1;
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}

function monthsAgo(n: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - n);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

const PRESETS = [
  { label: "This FY", ...currentFY() },
  { label: "Last FY", ...lastFY() },
  { label: "Last 12 months", ...monthsAgo(12) },
  { label: "Last 6 months", ...monthsAgo(6) },
  { label: "Last 3 months", ...monthsAgo(3) },
];

// ─── Subcomponents ─────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon: Icon, colour }: {
  label: string; value: string; sub?: string;
  icon: React.ComponentType<{ className?: string }>; colour: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 flex items-start gap-3">
      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", colour)}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground font-medium">{label}</div>
        <div className="text-xl font-bold text-foreground leading-tight">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

type SortDir = "asc" | "desc";

function useSortable<T>(items: T[], defaultKey: keyof T, defaultDir: SortDir = "desc") {
  const [key, setKey] = useState<keyof T>(defaultKey);
  const [dir, setDir] = useState<SortDir>(defaultDir);

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const av = a[key] as any;
      const bv = b[key] as any;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv) : (av as number) - (bv as number);
      return dir === "asc" ? cmp : -cmp;
    });
  }, [items, key, dir]);

  function toggle(k: keyof T) {
    if (k === key) setDir(d => (d === "asc" ? "desc" : "asc"));
    else { setKey(k); setDir("desc"); }
  }

  function Th({ col, children, className }: { col: keyof T; children: React.ReactNode; className?: string }) {
    const active = col === key;
    return (
      <th
        className={cn("px-3 py-2 text-left text-xs font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground whitespace-nowrap", active && "text-foreground", className)}
        onClick={() => toggle(col)}
      >
        <span className="flex items-center gap-1">
          {children}
          {active
            ? dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
            : <ChevronsUpDown className="w-3 h-3 opacity-40" />}
        </span>
      </th>
    );
  }

  return { sorted, Th, sortKey: key, sortDir: dir };
}

// ── By Employee tab ───────────────────────────────────────────────────────────

function EmployeeTab({ employees }: { employees: ReportEmployee[] }) {
  const { sorted, Th } = useSortable(employees, "totalSpend");
  const [search, setSearch] = useState("");
  const filtered = sorted.filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) ||
    (e.department ?? "").toLowerCase().includes(search.toLowerCase())
  );
  const maxSpend = Math.max(...employees.map(e => e.totalSpend), 1);

  if (employees.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <Users className="w-10 h-10 mx-auto mb-3 opacity-20" />
        <p className="font-medium">No employee activity in this period</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Input
        placeholder="Search by name or department…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="max-w-xs h-8 text-sm"
      />
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground w-6">#</th>
              <Th col="name">Employee</Th>
              <Th col="department" className="hidden md:table-cell">Department</Th>
              <Th col="managerName" className="hidden lg:table-cell">Supervisor</Th>
              <Th col="orderCount">Orders</Th>
              <Th col="itemsOrdered">Items</Th>
              <Th col="stockIssued" className="hidden sm:table-cell">Store Issued</Th>
              <Th col="orderedSpend">Ordered £</Th>
              <Th col="stockValue" className="hidden sm:table-cell">Store £</Th>
              <Th col="totalSpend">Total £</Th>
              <Th col="allowance" className="hidden lg:table-cell">Allowance</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {filtered.map((emp, i) => {
              const pct = maxSpend > 0 ? (emp.totalSpend / maxSpend) * 100 : 0;
              const overAllowance = emp.allowance != null && emp.totalSpend > emp.allowance;
              return (
                <tr key={emp.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">{emp.name}</div>
                    {emp.email && <div className="text-xs text-muted-foreground">{emp.email}</div>}
                    {/* Spend bar */}
                    <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden w-24 hidden sm:block">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct.toFixed(0)}%` }} />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">{emp.department ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">{emp.managerName ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums text-center">{emp.orderCount}</td>
                  <td className="px-3 py-2 tabular-nums text-center">{emp.itemsOrdered}</td>
                  <td className="px-3 py-2 tabular-nums text-center hidden sm:table-cell">{emp.stockIssued}</td>
                  <td className="px-3 py-2 tabular-nums text-right">{formatCurrency(emp.orderedSpend)}</td>
                  <td className="px-3 py-2 tabular-nums text-right hidden sm:table-cell">{formatCurrency(emp.stockValue)}</td>
                  <td className="px-3 py-2 tabular-nums text-right font-semibold">{formatCurrency(emp.totalSpend)}</td>
                  <td className="px-3 py-2 hidden lg:table-cell">
                    {emp.allowance != null ? (
                      <span className={cn("text-xs font-medium", overAllowance ? "text-red-600" : "text-muted-foreground")}>
                        {formatCurrency(emp.allowance)}{overAllowance && <> ⚠</>}
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{filtered.length} of {employees.length} employees shown</p>
    </div>
  );
}

// ── By Product tab ────────────────────────────────────────────────────────────

function ProductTab({ products }: { products: ReportProduct[] }) {
  const { sorted, Th } = useSortable(products, "totalValue");
  const [search, setSearch] = useState("");
  const filtered = sorted.filter(p =>
    !search || p.productName.toLowerCase().includes(search.toLowerCase()) ||
    (p.colour ?? "").toLowerCase().includes(search.toLowerCase())
  );

  if (products.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <Package className="w-10 h-10 mx-auto mb-3 opacity-20" />
        <p className="font-medium">No product activity in this period</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Input
        placeholder="Search by product or colour…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="max-w-xs h-8 text-sm"
      />
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b">
            <tr>
              <Th col="productName">Product</Th>
              <Th col="colour" className="hidden sm:table-cell">Colour</Th>
              <Th col="size" className="hidden sm:table-cell">Size</Th>
              <Th col="orderedQty">Ordered qty</Th>
              <Th col="issuedQty" className="hidden sm:table-cell">Issued qty</Th>
              <Th col="totalQty">Total qty</Th>
              <Th col="orderedValue">Ordered £</Th>
              <Th col="issuedValue" className="hidden sm:table-cell">Issued £</Th>
              <Th col="totalValue">Total £</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {filtered.map((p, i) => (
              <tr key={i} className="hover:bg-muted/30 transition-colors">
                <td className="px-3 py-2 font-medium max-w-[200px] truncate">{p.productName}</td>
                <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell capitalize">{p.colour ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{p.size ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums text-center">
                  <span className="flex items-center justify-center gap-1">
                    <ShoppingBag className="w-3 h-3 text-primary opacity-60" />{p.orderedQty}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums text-center hidden sm:table-cell">
                  <span className="flex items-center justify-center gap-1">
                    <Boxes className="w-3 h-3 text-amber-500 opacity-80" />{p.issuedQty}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums text-center font-semibold">{p.totalQty}</td>
                <td className="px-3 py-2 tabular-nums text-right">{formatCurrency(p.orderedValue)}</td>
                <td className="px-3 py-2 tabular-nums text-right hidden sm:table-cell">{formatCurrency(p.issuedValue)}</td>
                <td className="px-3 py-2 tabular-nums text-right font-semibold">{formatCurrency(p.totalValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{filtered.length} of {products.length} product variants shown</p>
    </div>
  );
}

// ── By Supervisor tab ─────────────────────────────────────────────────────────

function SupervisorTab({ supervisors }: { supervisors: ReportSupervisor[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const sorted = [...supervisors].sort((a, b) => b.totalSpend - a.totalSpend);

  if (supervisors.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <Users className="w-10 h-10 mx-auto mb-3 opacity-20" />
        <p className="font-medium">No supervisor activity in this period</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sorted.map((sup, i) => {
        const key = sup.supervisorId?.toString() ?? "none";
        const open = expanded.has(key);
        const membersSorted = [...sup.members].sort((a, b) => b.totalSpend - a.totalSpend);
        return (
          <div key={key} className="rounded-lg border bg-card overflow-hidden">
            <button
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
              onClick={() => {
                const next = new Set(expanded);
                open ? next.delete(key) : next.add(key);
                setExpanded(next);
              }}
            >
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{sup.supervisorName ?? "No supervisor assigned"}</div>
                <div className="text-xs text-muted-foreground">
                  {sup.memberCount} member{sup.memberCount !== 1 ? "s" : ""} · {formatCurrency(sup.orderedSpend)} ordered · {formatCurrency(sup.stockValue)} from stores
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-bold text-sm">{formatCurrency(sup.totalSpend)}</div>
                <div className="text-xs text-muted-foreground">total</div>
              </div>
              {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
            </button>
            {open && (
              <div className="border-t bg-muted/20 divide-y divide-border/40">
                {membersSorted.map(m => (
                  <div key={m.employeeId} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm">{m.name}</span>
                    <span className="text-sm font-medium tabular-nums">{formatCurrency(m.totalSpend)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Rankings tab ─────────────────────────────────────────────────────────────

function RankingsTab({ employees, summary, period }: {
  employees: ReportEmployee[];
  summary: UsageReport["summary"];
  period: UsageReport["period"];
}) {
  const sorted = [...employees].sort((a, b) => b.totalSpend - a.totalSpend);
  const top10 = sorted.slice(0, 10);
  const bottom10 = [...sorted].reverse().slice(0, 10).filter(e => e.totalSpend > 0);

  // Days in period → years fraction for avg annual calculation
  const fromD = new Date(period.from);
  const toD = new Date(period.to);
  const periodDays = Math.max(1, (toD.getTime() - fromD.getTime()) / 86400000);
  const periodYears = periodDays / 365.25;

  const activeCount = employees.filter(e => e.totalSpend > 0).length;
  const avgPerPersonPerYear = activeCount > 0 && periodYears > 0
    ? (summary.totalSpend / activeCount) / periodYears
    : 0;

  return (
    <div className="space-y-6">
      {/* Key stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card p-3 text-center">
          <div className="text-xs text-muted-foreground">Active spenders</div>
          <div className="text-2xl font-bold">{activeCount}</div>
        </div>
        <div className="rounded-lg border bg-card p-3 text-center">
          <div className="text-xs text-muted-foreground">Avg spend per person</div>
          <div className="text-2xl font-bold">{formatCurrency(activeCount > 0 ? summary.totalSpend / activeCount : 0)}</div>
          <div className="text-[10px] text-muted-foreground">over this period</div>
        </div>
        <div className="rounded-lg border bg-card p-3 text-center">
          <div className="text-xs text-muted-foreground">Avg per person / year</div>
          <div className="text-2xl font-bold">{formatCurrency(avgPerPersonPerYear)}</div>
          <div className="text-[10px] text-muted-foreground">annualised</div>
        </div>
        <div className="rounded-lg border bg-card p-3 text-center">
          <div className="text-xs text-muted-foreground">Avg order value</div>
          <div className="text-2xl font-bold">{formatCurrency(summary.avgOrderValue)}</div>
          <div className="text-[10px] text-muted-foreground">{summary.orderCount} orders</div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        {/* Top spenders */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="w-4 h-4 text-amber-500" />
            <h3 className="font-semibold text-sm">Top spenders</h3>
          </div>
          <div className="space-y-1.5">
            {top10.map((emp, i) => {
              const maxV = top10[0]?.totalSpend ?? 1;
              const pct = maxV > 0 ? (emp.totalSpend / maxV) * 100 : 0;
              return (
                <div key={emp.id} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{emp.name}</div>
                    <div className="mt-0.5 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct.toFixed(0)}%` }} />
                    </div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums shrink-0">{formatCurrency(emp.totalSpend)}</span>
                </div>
              );
            })}
            {top10.length === 0 && <p className="text-sm text-muted-foreground">No data</p>}
          </div>
        </div>

        {/* Bottom spenders (with any spend) */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Lowest spenders (with any activity)</h3>
          </div>
          <div className="space-y-1.5">
            {bottom10.map((emp, i) => {
              const maxV = bottom10[bottom10.length - 1]?.totalSpend ?? 1;
              const pct = maxV > 0 ? Math.max(10, (emp.totalSpend / maxV) * 100) : 10;
              return (
                <div key={emp.id} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{emp.name}</div>
                    <div className="mt-0.5 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-blue-300" style={{ width: `${pct.toFixed(0)}%` }} />
                    </div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums shrink-0">{formatCurrency(emp.totalSpend)}</span>
                </div>
              );
            })}
            {bottom10.length === 0 && <p className="text-sm text-muted-foreground">No data</p>}
          </div>
        </div>
      </div>

      {/* Employees with zero spend */}
      {(() => {
        const zero = employees.filter(e => e.totalSpend === 0);
        if (zero.length === 0) return null;
        return (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm">{zero.length} employee{zero.length !== 1 ? "s" : ""} with no spend this period</h3>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {zero.map(e => (
                <Badge key={e.id} variant="outline" className="text-xs text-muted-foreground">{e.name}</Badge>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: "employee", label: "By Employee", icon: Users },
  { id: "product", label: "By Product", icon: Package },
  { id: "supervisor", label: "By Supervisor", icon: TrendingUp },
  { id: "rankings", label: "Rankings", icon: Trophy },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function Reports() {
  const { isManager, isPreview } = useAuth();
  const [, setLocation] = useLocation();

  // Period state
  const [period, setPeriod] = useState<{ from: string; to: string }>(currentFY());
  const [customFrom, setCustomFrom] = useState(period.from);
  const [customTo, setCustomTo] = useState(period.to);
  const [activePreset, setActivePreset] = useState<string>("This FY");
  const [activeTab, setActiveTab] = useState<TabId>("employee");

  const { data: report, isLoading, isError } = useQuery<UsageReport>({
    queryKey: ["portal-usage-report", period.from, period.to],
    queryFn: () => apiFetch(`/portal/reports/usage?from=${period.from}&to=${period.to}`),
    staleTime: 5 * 60_000,
    enabled: !!period.from && !!period.to,
  });

  // Redirect non-managers
  if (!isManager && !isPreview) {
    setLocation("/orders");
    return null;
  }

  function selectPreset(preset: typeof PRESETS[number]) {
    setActivePreset(preset.label);
    setPeriod({ from: preset.from, to: preset.to });
    setCustomFrom(preset.from);
    setCustomTo(preset.to);
  }

  function applyCustom() {
    if (customFrom && customTo && customFrom <= customTo) {
      setActivePreset("custom");
      setPeriod({ from: customFrom, to: customTo });
    }
  }

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Usage &amp; Spend Report</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Uniform usage, ordering activity and budget breakdown for your team.
          </p>
        </div>

        {/* Period selector */}
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(p => (
              <Button
                key={p.label}
                size="sm"
                variant={activePreset === p.label ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => selectPreset(p)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="h-7 text-xs w-36"
            />
            <span className="text-muted-foreground text-xs">to</span>
            <Input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="h-7 text-xs w-36"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={applyCustom}
              disabled={!customFrom || !customTo || customFrom > customTo}
            >
              Apply
            </Button>
            {period.from && (
              <span className="text-xs text-muted-foreground">
                {new Date(period.from).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                {" – "}
                {new Date(period.to).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            )}
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}

        {isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> Failed to load report. Please try again.
          </div>
        )}

        {report && (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiCard label="Total spend" value={formatCurrency(report.summary.totalSpend)} sub={`${report.summary.orderCount} orders`} icon={TrendingUp} colour="bg-primary" />
              <KpiCard label="Ordered (new)" value={formatCurrency(report.summary.orderedSpend)} sub={`${report.summary.totalItemsOrdered} items`} icon={ShoppingBag} colour="bg-blue-500" />
              <KpiCard label="From stores" value={formatCurrency(report.summary.stockValue)} sub={`${report.summary.totalStockIssued} items`} icon={Boxes} colour="bg-amber-500" />
              <KpiCard label="Active employees" value={String(report.summary.activeEmployees)} sub={`avg ${formatCurrency(report.summary.avgSpendPerEmployee)}/person`} icon={Users} colour="bg-green-500" />
            </div>

            {/* Tabs */}
            <div>
              <div className="flex gap-1 border-b mb-4 overflow-x-auto">
                {TABS.map(tab => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
                        activeTab === tab.id
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {activeTab === "employee" && <EmployeeTab employees={report.employees} />}
              {activeTab === "product" && <ProductTab products={report.products} />}
              {activeTab === "supervisor" && <SupervisorTab supervisors={report.supervisors} />}
              {activeTab === "rankings" && <RankingsTab employees={report.employees} summary={report.summary} period={report.period} />}
            </div>
          </>
        )}
      </div>
    </PortalLayout>
  );
}
