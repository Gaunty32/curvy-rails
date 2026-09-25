import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import Layout from "@/components/Layout";
import { formatCurrency } from "@/lib/utils";

const API_BASE = "/api";
async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers: { "Content-Type": "application/json", ...opts?.headers } });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  return res.json();
}
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  BarChart2, Mail, Phone, ChevronDown, ChevronRight, Clock, AlertCircle,
  ExternalLink, RefreshCw, ShoppingCart, Users, ShoppingBag, Package, TrendingUp,
  TrendingDown, ArrowUp, ArrowDown, Calendar,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type PendingOrder = {
  id: number;
  orderNumber: string;
  status: string;
  portalStatus: string;
  totalAmount: number;
  orderDate: string | null;
  createdAt: string;
  requiredDate: string | null;
  submittedByName: string | null;
  submittedByEmail: string | null;
  itemCount: number;
  notes: string | null;
};

type PendingCustomer = {
  customerId: number;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  orders: PendingOrder[];
  totalValue: number;
  oldestOrderDate: string;
};

type ReportData = {
  customers: PendingCustomer[];
  totalOrders: number;
};

type ActiveBasket = {
  id: number;
  portalUserId: number;
  customerId: number;
  customerName: string;
  customerPhone: string | null;
  userEmail: string | null;
  userDisplayName: string;
  itemCount: number;
  estimatedTotal: number;
  mode: string | null;
  step: number;
  updatedAt: string;
  createdAt: string;
};

type BasketReportData = {
  baskets: ActiveBasket[];
  total: number;
};

type GpOrder = {
  id: number;
  orderNumber: string;
  customerName: string;
  orderDate: string | null;
  requiredDate: string | null;
  status: string;
  revenue: number;
  garmentCost: number;
  processCost: number;
  totalCost: number;
  gp: number | null;
};

type GpReportData = { orders: GpOrder[] };

type DayTotal = { day: string; total: number; cnt: number };
type WeekTrend = { weekMon: string; total: number; cnt: number };
type WeeklySalesData = {
  thisWeekTotal: number;
  thisWeekCnt: number;
  lastWeekTotal: number;
  lastWeekCnt: number;
  thisWeekStart: string;
  lastWeekStart: string;
  daily: DayTotal[];
  trend: WeekTrend[];
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtShortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function WeeklySalesCard({ data }: { data: WeeklySalesData }) {
  const { thisWeekTotal, thisWeekCnt, lastWeekTotal, lastWeekCnt, thisWeekStart, daily, trend } = data;

  const pctChange = lastWeekTotal > 0
    ? ((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100
    : null;

  // Build full Mon-Sun array (fill gaps with zero)
  const weekStartDate = new Date(thisWeekStart + "T00:00:00");
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStartDate);
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const found = daily.find(x => x.day?.slice(0, 10) === iso);
    return { label: DAY_LABELS[i], iso, total: found?.total ?? 0, cnt: found?.cnt ?? 0 };
  });

  const todayIso = new Date().toISOString().slice(0, 10);
  const dayMax = Math.max(...days.map(d => d.total), 1);

  // 8-week trend — fill any missing weeks with 0
  const trendMax = Math.max(...(trend ?? []).map(w => w.total), 1);

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" />
              Weekly Sales
            </CardTitle>
            <CardDescription className="mt-1">
              Mon–Sun · {fmtShortDate(thisWeekStart)} – {fmtShortDate(
                new Date(new Date(thisWeekStart).getTime() + 6 * 86400000).toISOString()
              )}
            </CardDescription>
          </div>

          <div className="flex items-end gap-4">
            <div className="text-right">
              <p className="text-3xl font-bold tabular-nums tracking-tight">{formatCurrency(thisWeekTotal)}</p>
              <div className="flex items-center justify-end gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground">{thisWeekCnt} order{thisWeekCnt !== 1 ? "s" : ""}</span>
                {pctChange !== null && (
                  <span className={cn(
                    "inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded",
                    pctChange >= 0
                      ? "text-green-700 bg-green-50"
                      : "text-red-600 bg-red-50"
                  )}>
                    {pctChange >= 0
                      ? <ArrowUp className="w-3 h-3" />
                      : <ArrowDown className="w-3 h-3" />}
                    {Math.abs(pctChange).toFixed(0)}% vs last week
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* Day-by-day bars */}
        <div className="flex items-end gap-1.5 h-20 mb-1">
          {days.map(day => {
            const isToday = day.iso === todayIso;
            const heightPct = dayMax > 0 ? (day.total / dayMax) * 100 : 0;
            const isFuture = day.iso > todayIso;
            return (
              <div key={day.iso} className="flex-1 flex flex-col items-center justify-end gap-1 h-full group relative">
                {day.total > 0 && (
                  <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="bg-popover border shadow-md rounded px-2 py-1 text-xs whitespace-nowrap text-center">
                      <span className="font-semibold">{formatCurrency(day.total)}</span>
                      <span className="text-muted-foreground ml-1">· {day.cnt} order{day.cnt !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                )}
                <div
                  className={cn(
                    "w-full rounded-t transition-all",
                    isToday ? "bg-primary" : isFuture ? "bg-muted/40" : "bg-primary/40",
                    day.total === 0 && "min-h-[3px]"
                  )}
                  style={{ height: day.total > 0 ? `${Math.max(heightPct, 6)}%` : "3px" }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex gap-1.5">
          {days.map(day => (
            <div key={day.iso} className={cn(
              "flex-1 text-center text-[10px]",
              day.iso === todayIso ? "font-bold text-primary" : "text-muted-foreground"
            )}>
              {day.label}
            </div>
          ))}
        </div>

        {/* 8-week trend */}
        {trend && trend.length > 1 && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-[11px] text-muted-foreground font-medium mb-2 uppercase tracking-wide">8-week trend</p>
            <div className="flex items-end gap-1 h-10">
              {trend.map((w, i) => {
                const isCurrentWeek = w.weekMon?.slice(0, 10) === thisWeekStart?.slice(0, 10);
                const heightPct = trendMax > 0 ? (w.total / trendMax) * 100 : 0;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                    <div
                      className={cn(
                        "w-full rounded-t",
                        isCurrentWeek ? "bg-primary" : "bg-primary/25"
                      )}
                      style={{ height: w.total > 0 ? `${Math.max(heightPct, 8)}%` : "2px" }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-1 mt-1">
              {trend.map((w, i) => {
                const isCurrentWeek = w.weekMon?.slice(0, 10) === thisWeekStart?.slice(0, 10);
                return (
                  <div key={i} className={cn(
                    "flex-1 text-center text-[9px]",
                    isCurrentWeek ? "font-bold text-primary" : "text-muted-foreground"
                  )}>
                    {isCurrentWeek ? "Now" : new Date(w.weekMon).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Last week comparison row */}
        <div className="mt-4 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
          <span>Last week ({fmtShortDate(data.lastWeekStart)} – {fmtShortDate(
            new Date(new Date(data.lastWeekStart).getTime() + 6 * 86400000).toISOString()
          )})</span>
          <span className="tabular-nums font-medium text-foreground">
            {formatCurrency(lastWeekTotal)}
            <span className="text-muted-foreground font-normal ml-1">· {lastWeekCnt} order{lastWeekCnt !== 1 ? "s" : ""}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function gpColor(gp: number) {
  if (gp >= 70) return { badge: "text-green-700 bg-green-50 border-green-200", row: "" };
  if (gp >= 30) return { badge: "text-amber-700 bg-amber-50 border-amber-200", row: "" };
  return { badge: "text-red-700 bg-red-50 border-red-200", row: "bg-red-50/40" };
}

function portalStatusLabel(s: string): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  switch (s) {
    case "pending_review": return { label: "Awaiting manager", variant: "secondary" };
    case "submitted":      return { label: "Awaiting confirmation",     variant: "default" };
    case "portal_draft":   return { label: "Draft",            variant: "outline" };
    default:               return { label: s,                  variant: "outline" };
  }
}

function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function AgeBadge({ dateStr }: { dateStr: string }) {
  const days = daysSince(dateStr);
  if (days >= 7) return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-destructive bg-destructive/10 rounded px-1.5 py-0.5">
      <AlertCircle className="w-3 h-3" /> {days}d ago
    </span>
  );
  if (days >= 3) return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">
      <Clock className="w-3 h-3" /> {days}d ago
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-muted rounded px-1.5 py-0.5">
      <Clock className="w-3 h-3" /> {days}d ago
    </span>
  );
}

function CustomerRow({ customer }: { customer: PendingCustomer }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const oldestDate = customer.orders.reduce((oldest, o) => {
    return o.createdAt < oldest ? o.createdAt : oldest;
  }, customer.orders[0]?.createdAt ?? "");

  const awaitingSBS = customer.orders.filter(o => o.portalStatus === "submitted").length;
  const awaitingManager = customer.orders.filter(o => o.portalStatus === "pending_review").length;

  const copyEmail = () => {
    if (!customer.customerEmail) return;
    navigator.clipboard.writeText(customer.customerEmail);
    toast({ title: "Email copied", description: customer.customerEmail });
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <TableRow className="cursor-pointer hover:bg-muted/40 transition-colors">
          <TableCell className="w-6 py-3">
            {open
              ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
              : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </TableCell>
          <TableCell className="font-medium py-3">
            <div className="flex items-center gap-2">
              <Link
                href={`/customers/${customer.customerId}`}
                onClick={e => e.stopPropagation()}
                className="hover:underline text-primary flex items-center gap-1"
              >
                {customer.customerName}
                <ExternalLink className="w-3 h-3 opacity-50" />
              </Link>
            </div>
            {(customer.customerEmail || customer.customerPhone) && (
              <div className="flex items-center gap-3 mt-0.5">
                {customer.customerEmail && (
                  <span className="text-[11px] text-muted-foreground truncate max-w-[180px]">{customer.customerEmail}</span>
                )}
                {customer.customerPhone && (
                  <span className="text-[11px] text-muted-foreground">{customer.customerPhone}</span>
                )}
              </div>
            )}
          </TableCell>
          <TableCell className="py-3 text-center">
            <span className="font-semibold tabular-nums">{customer.orders.length}</span>
          </TableCell>
          <TableCell className="py-3">
            <div className="flex flex-wrap gap-1">
              {awaitingSBS > 0 && (
                <Badge variant="default" className="text-[10px] px-1.5 py-0 h-5">
                  {awaitingSBS} awaiting confirmation
                </Badge>
              )}
              {awaitingManager > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                  {awaitingManager} awaiting manager
                </Badge>
              )}
            </div>
          </TableCell>
          <TableCell className="py-3 text-right tabular-nums font-medium">
            {customer.totalValue > 0 ? formatCurrency(customer.totalValue) : "—"}
          </TableCell>
          <TableCell className="py-3">
            <AgeBadge dateStr={oldestDate} />
          </TableCell>
          <TableCell className="py-3">
            <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
              {customer.customerEmail && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={copyEmail}
                >
                  <Mail className="w-3 h-3" /> Copy email
                </Button>
              )}
              {customer.customerEmail && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  asChild
                >
                  <a href={`mailto:${customer.customerEmail}?subject=Your%20pending%20order`}>
                    <Mail className="w-3 h-3" /> Send nudge
                  </a>
                </Button>
              )}
            </div>
          </TableCell>
        </TableRow>
      </CollapsibleTrigger>

      <CollapsibleContent asChild>
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={7} className="p-0 border-b">
            <div className="bg-muted/20 px-8 py-3 border-t">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left font-medium pb-1.5">Order</th>
                    <th className="text-left font-medium pb-1.5">Status</th>
                    <th className="text-left font-medium pb-1.5">Submitted by</th>
                    <th className="text-right font-medium pb-1.5">Items</th>
                    <th className="text-right font-medium pb-1.5">Value</th>
                    <th className="text-left font-medium pb-1.5 pl-4">Required by</th>
                    <th className="text-left font-medium pb-1.5 pl-4">Submitted</th>
                    <th className="text-right font-medium pb-1.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {customer.orders.map(order => {
                    const ps = portalStatusLabel(order.portalStatus);
                    return (
                      <tr key={order.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-2 font-mono text-xs font-semibold text-primary">
                          {order.orderNumber}
                        </td>
                        <td className="py-2">
                          <Badge variant={ps.variant} className="text-[10px] px-1.5 py-0 h-5">
                            {ps.label}
                          </Badge>
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {order.submittedByName ?? "—"}
                        </td>
                        <td className="py-2 text-right tabular-nums text-xs">
                          {order.itemCount}
                        </td>
                        <td className="py-2 text-right tabular-nums text-xs font-medium">
                          {order.totalAmount > 0 ? formatCurrency(order.totalAmount) : "—"}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground pl-4">
                          {order.requiredDate
                            ? new Date(order.requiredDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                            : "—"}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground pl-4">
                          <AgeBadge dateStr={order.createdAt} />
                        </td>
                        <td className="py-2 text-right">
                          <Link href={`/orders/${order.id}`}>
                            <Button variant="ghost" size="sm" className="h-6 text-xs px-2">
                              View <ExternalLink className="w-3 h-3 ml-1" />
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {customer.orders.some(o => o.notes) && (
                <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                  <span className="font-medium">Notes: </span>
                  {customer.orders.find(o => o.notes)?.notes}
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function Reports() {
  const { data, isLoading, refetch, isRefetching } = useQuery<ReportData>({
    queryKey: ["reports-portal-pending"],
    queryFn: () => apiFetch("/reports/portal-pending"),
    staleTime: 1000 * 60 * 2,
  });

  const { data: basketData, isLoading: basketsLoading } = useQuery<BasketReportData>({
    queryKey: ["reports-portal-baskets"],
    queryFn: () => apiFetch("/reports/portal-baskets"),
    staleTime: 1000 * 60 * 2,
  });

  const { data: gpData, isLoading: gpLoading } = useQuery<GpReportData>({
    queryKey: ["reports-gp-summary"],
    queryFn: () => apiFetch("/reports/gp-summary"),
    staleTime: 1000 * 60 * 2,
  });

  const { data: weeklySales, isLoading: weeklySalesLoading } = useQuery<WeeklySalesData>({
    queryKey: ["reports-weekly-sales"],
    queryFn: () => apiFetch("/reports/weekly-sales"),
    staleTime: 1000 * 60 * 5,
  });

  const customers = data?.customers ?? [];
  const totalOrders = data?.totalOrders ?? 0;
  const baskets = basketData?.baskets ?? [];

  const awaitingSBS = customers.reduce(
    (n, c) => n + c.orders.filter(o => o.portalStatus === "submitted").length, 0
  );
  const awaitingManager = customers.reduce(
    (n, c) => n + c.orders.filter(o => o.portalStatus === "pending_review").length, 0
  );
  const totalValue = customers.reduce((s, c) => s + c.totalValue, 0);

  return (
    <Layout>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-primary" />
            Reports
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Operational summaries and actionable insights</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", isRefetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* ── Weekly Sales ────────────────────────────────────────────────────── */}
      {weeklySalesLoading ? (
        <Card className="mb-6">
          <CardContent className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading weekly sales…
          </CardContent>
        </Card>
      ) : weeklySales ? (
        <WeeklySalesCard data={weeklySales} />
      ) : null}

      {/* ── Portal Pending Orders ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-primary" />
                Unconfirmed Portal Orders
              </CardTitle>
              <CardDescription className="mt-1">
                Customers who have submitted orders through the portal that haven't been confirmed yet —
                a good list for a friendly nudge or a quick confirmation.
              </CardDescription>
            </div>
            {!isLoading && customers.length > 0 && (
              <div className="flex gap-3 shrink-0 text-right">
                <div className="text-center px-3 py-1.5 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold tabular-nums">{customers.length}</p>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" /> customers</p>
                </div>
                <div className="text-center px-3 py-1.5 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold tabular-nums">{totalOrders}</p>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1"><ShoppingCart className="w-3 h-3" /> orders</p>
                </div>
                {totalValue > 0 && (
                  <div className="text-center px-3 py-1.5 rounded-lg bg-primary/10">
                    <p className="text-lg font-bold tabular-nums text-primary">{formatCurrency(totalValue)}</p>
                    <p className="text-[11px] text-muted-foreground">total value</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {!isLoading && (awaitingSBS > 0 || awaitingManager > 0) && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {awaitingSBS > 0 && (
                <Badge variant="default" className="text-xs">
                  {awaitingSBS} awaiting confirmation
                </Badge>
              )}
              {awaitingManager > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {awaitingManager} awaiting manager approval
                </Badge>
              )}
            </div>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" /> Loading report…
            </div>
          ) : customers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-3">
                <ShoppingCart className="w-6 h-6 text-green-600" />
              </div>
              <p className="font-medium text-sm">All clear!</p>
              <p className="text-muted-foreground text-sm mt-1">No unconfirmed portal orders at the moment.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-6"></TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-center w-20">Orders</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Waiting since</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map(customer => (
                    <CustomerRow key={customer.customerId ?? customer.customerName} customer={customer} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      {/* ── Gross Profit by Order ─────────────────────────────────────────────── */}
      <Card className="mt-6">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                Gross Profit by Order
              </CardTitle>
              <CardDescription className="mt-1">
                Active orders where supplier cost is known. GP% = (Revenue − Garment − Process cost) ÷ Revenue.
              </CardDescription>
            </div>
            {/* Colour key */}
            <div className="flex items-center gap-2 text-xs shrink-0 flex-wrap">
              <span className="text-muted-foreground font-medium">Key:</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-green-700 bg-green-50 border-green-200 font-semibold">≥ 70% Good</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-amber-700 bg-amber-50 border-amber-200 font-semibold">30–69% Watch</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-red-700 bg-red-50 border-red-200 font-semibold">&lt; 30% Low</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {gpLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" /> Loading report…
            </div>
          ) : !gpData?.orders.length ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <TrendingUp className="w-6 h-6 text-muted-foreground/50" />
              </div>
              <p className="font-medium text-sm">No data yet</p>
              <p className="text-muted-foreground text-sm mt-1">Add supplier prices to products to see GP analysis.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right w-[80px]">GP%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gpData.orders.map(order => {
                    const colors = order.gp != null ? gpColor(order.gp) : null;
                    return (
                      <TableRow key={order.id} className={cn("hover:bg-muted/40 transition-colors", colors?.row)}>
                        <TableCell className="py-2.5">
                          <Link href={`/orders/${order.id}`} className="font-mono text-xs font-semibold text-primary hover:underline flex items-center gap-1">
                            {order.orderNumber}
                            <ExternalLink className="w-3 h-3 opacity-50" />
                          </Link>
                          <span className="text-[10px] text-muted-foreground capitalize">{order.status}</span>
                        </TableCell>
                        <TableCell className="py-2.5 text-sm">{order.customerName ?? "—"}</TableCell>
                        <TableCell className="py-2.5 text-xs text-muted-foreground">
                          {order.requiredDate
                            ? new Date(order.requiredDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                            : "—"}
                        </TableCell>
                        <TableCell className="py-2.5 text-right tabular-nums text-sm font-medium">
                          {formatCurrency(order.revenue)}
                        </TableCell>
                        <TableCell className="py-2.5 text-right tabular-nums text-sm text-muted-foreground">
                          <span title={`Garment: ${formatCurrency(order.garmentCost)}${order.processCost > 0 ? ` · Process: ${formatCurrency(order.processCost)}` : ""}`}>
                            {formatCurrency(order.totalCost)}
                          </span>
                        </TableCell>
                        <TableCell className="py-2.5 text-right">
                          {order.gp != null && colors ? (
                            <span className={`inline-block text-xs font-semibold tabular-nums px-2 py-0.5 rounded border ${colors.badge}`}>
                              {order.gp.toFixed(0)}%
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/40">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {/* Summary footer */}
              {(() => {
                const orders = gpData.orders;
                const totalRev = orders.reduce((s, o) => s + o.revenue, 0);
                const totalCost = orders.reduce((s, o) => s + o.totalCost, 0);
                const overallGp = totalRev > 0 ? ((totalRev - totalCost) / totalRev) * 100 : null;
                const colors = overallGp != null ? gpColor(overallGp) : null;
                return (
                  <div className="p-4 bg-muted/20 border-t border-border/40 flex justify-end items-center gap-6 flex-wrap text-sm">
                    <span className="text-muted-foreground">{orders.length} orders</span>
                    <span className="text-muted-foreground">Revenue: <span className="font-semibold text-foreground tabular-nums">{formatCurrency(totalRev)}</span></span>
                    <span className="text-muted-foreground">Cost: <span className="font-semibold text-foreground tabular-nums">{formatCurrency(totalCost)}</span></span>
                    {overallGp != null && colors && (
                      <span className="text-muted-foreground">Overall GP:
                        <span className={`ml-2 inline-block text-sm font-bold tabular-nums px-2 py-0.5 rounded border ${colors.badge}`}>
                          {overallGp.toFixed(0)}%
                        </span>
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Active Customer Baskets ────────────────────────────────────────────── */}
      <Card className="mt-6">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-primary" />
                Active Customer Baskets
              </CardTitle>
              <CardDescription className="mt-1">
                Customers who have items in their basket but haven't submitted an order yet —
                a gentle nudge at the right moment could help turn these into confirmed orders.
              </CardDescription>
            </div>
            {!basketsLoading && baskets.length > 0 && (
              <div className="flex gap-3 shrink-0 text-right">
                <div className="text-center px-3 py-1.5 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold tabular-nums">{baskets.length}</p>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" /> customers</p>
                </div>
                <div className="text-center px-3 py-1.5 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold tabular-nums">{baskets.reduce((s, b) => s + b.itemCount, 0)}</p>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Package className="w-3 h-3" /> items</p>
                </div>
                {baskets.some(b => b.estimatedTotal > 0) && (
                  <div className="text-center px-3 py-1.5 rounded-lg bg-primary/10">
                    <p className="text-lg font-bold tabular-nums text-primary">
                      {formatCurrency(baskets.reduce((s, b) => s + b.estimatedTotal, 0))}
                    </p>
                    <p className="text-[11px] text-muted-foreground">est. value</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {basketsLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" /> Loading report…
            </div>
          ) : baskets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-3">
                <ShoppingBag className="w-6 h-6 text-green-600" />
              </div>
              <p className="font-medium text-sm">No active baskets</p>
              <p className="text-muted-foreground text-sm mt-1">No customers currently have items saved in their basket.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Customer</TableHead>
                    <TableHead>Portal user</TableHead>
                    <TableHead className="text-center w-16">Items</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Est. value</TableHead>
                    <TableHead>Last active</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baskets.map(basket => (
                    <BasketRow key={basket.id} basket={basket} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </Layout>
  );
}

function BasketRow({ basket }: { basket: ActiveBasket }) {
  const { toast } = useToast();
  const copyEmail = () => {
    if (!basket.userEmail) return;
    navigator.clipboard.writeText(basket.userEmail);
    toast({ title: "Email copied", description: basket.userEmail });
  };

  return (
    <TableRow className="hover:bg-muted/40 transition-colors">
      <TableCell className="py-3 font-medium">
        <div className="flex items-center gap-1">
          <Link
            href={`/customers/${basket.customerId}`}
            className="hover:underline text-primary flex items-center gap-1"
          >
            {basket.customerName}
            <ExternalLink className="w-3 h-3 opacity-50" />
          </Link>
        </div>
        {basket.customerPhone && (
          <span className="text-[11px] text-muted-foreground">{basket.customerPhone}</span>
        )}
      </TableCell>
      <TableCell className="py-3">
        <span className="text-sm">{basket.userDisplayName}</span>
        {basket.userEmail && basket.userEmail !== basket.userDisplayName && (
          <div className="text-[11px] text-muted-foreground truncate max-w-[200px]">{basket.userEmail}</div>
        )}
      </TableCell>
      <TableCell className="py-3 text-center tabular-nums font-semibold">
        {basket.itemCount}
      </TableCell>
      <TableCell className="py-3">
        {basket.mode ? (
          <Badge variant="outline" className="text-[10px] capitalize px-1.5 py-0 h-5">
            {basket.mode}
          </Badge>
        ) : "—"}
      </TableCell>
      <TableCell className="py-3 text-right tabular-nums text-sm font-medium">
        {basket.estimatedTotal > 0 ? formatCurrency(basket.estimatedTotal) : "—"}
      </TableCell>
      <TableCell className="py-3">
        <AgeBadge dateStr={basket.updatedAt} />
      </TableCell>
      <TableCell className="py-3">
        <div className="flex items-center gap-1.5">
          {basket.userEmail && (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={copyEmail}>
              <Mail className="w-3 h-3" /> Copy email
            </Button>
          )}
          {basket.userEmail && (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" asChild>
              <a href={`mailto:${basket.userEmail}?subject=Your%20saved%20basket`}>
                <Mail className="w-3 h-3" /> Send nudge
              </a>
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
