import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import PortalLayout from "@/components/Layout";
import { apiFetch } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Loader2, Search, ShoppingBag, Clock, CheckCircle2, XCircle,
  AlertCircle, Package, ArrowRight, User, Hash, PackageOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getPortalOrderLifecycle } from "@/lib/order-status";

interface PortalOrder {
  id: number;
  order_number: string | null;
  status: string;
  portal_status: string | null;
  total_amount: string | null;
  order_date: string | null;
  required_date: string | null;
  po_number: string | null;
  portal_submitted_by_name: string | null;
  portal_submitted_at: string | null;
  portal_approved_by_name: string | null;
  portal_approved_at: string | null;
  item_count: string | number;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, portalStatus }: { status: string; portalStatus?: string | null }) {
  const lifecycle = getPortalOrderLifecycle(status, portalStatus);
  if (lifecycle === "pending_approval") {
    return <Badge variant="outline" className="border-orange-300 text-orange-700 bg-orange-50 gap-1 shrink-0"><AlertCircle className="w-3 h-3" />Awaiting approval</Badge>;
  }
  if (lifecycle === "pending_sbs") {
    return <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 gap-1 shrink-0"><Clock className="w-3 h-3" />Pending review</Badge>;
  }
  if (lifecycle === "submitted") {
    return <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 gap-1 shrink-0"><Clock className="w-3 h-3" />Submitted to supplier</Badge>;
  }
  if (lifecycle === "rejected") {
    return <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50 gap-1 shrink-0"><XCircle className="w-3 h-3" />Rejected</Badge>;
  }
  if (lifecycle === "confirmed") return <Badge variant="outline" className="border-green-300 text-green-700 bg-green-50 shrink-0">In production</Badge>;
  if (lifecycle === "part_shipped") return <Badge className="bg-indigo-100 text-indigo-800 border-transparent shrink-0">Part shipped</Badge>;
  if (lifecycle === "shipped") return <Badge className="bg-blue-100 text-blue-800 border-transparent shrink-0">Shipped</Badge>;
  if (lifecycle === "delivered") return <Badge className="bg-green-100 text-green-800 border-transparent shrink-0">Delivered</Badge>;
  return <Badge variant="outline" className="shrink-0">{status}</Badge>;
}

// ─── Filter label helper ──────────────────────────────────────────────────────

type FilterKey = "all" | "pending" | "in_progress" | "completed" | "rejected";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all",         label: "All" },
  { key: "pending",     label: "Pending" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed",   label: "Shipped / Delivered" },
  { key: "rejected",    label: "Rejected" },
];

function matchesFilter(order: PortalOrder, filter: FilterKey): boolean {
  if (filter === "all") return true;
  const lifecycle = getPortalOrderLifecycle(order.status, order.portal_status);
  if (filter === "pending") return ["pending_approval", "pending_sbs"].includes(lifecycle);
  if (filter === "in_progress") return ["submitted", "confirmed", "part_shipped"].includes(lifecycle);
  if (filter === "completed") return ["shipped", "delivered"].includes(lifecycle);
  if (filter === "rejected") return lifecycle === "rejected";
  return true;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OrderHistory() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [outstandingOrder, setOutstandingOrder] = useState<PortalOrder | null>(null);

  const { data: orders = [], isLoading } = useQuery<PortalOrder[]>({
    queryKey: ["portal-orders"],
    queryFn: () => apiFetch("/portal/orders"),
    refetchInterval: 15_000,
  });
  const { data: outstandingDetail, isLoading: outstandingLoading } = useQuery<any>({
    queryKey: ["portal-order-outstanding", outstandingOrder?.id],
    queryFn: () => apiFetch(`/portal/orders/${outstandingOrder!.id}`),
    enabled: outstandingOrder != null,
  });
  const outstandingItems = (outstandingDetail?.items ?? []).filter(
    (item: any) => !item.dispatched_at && !item.is_service,
  );

  const filtered = useMemo(() => {
    let list = orders.filter(o => matchesFilter(o, filter));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(o =>
        o.order_number?.toLowerCase().includes(q) ||
        o.po_number?.toLowerCase().includes(q) ||
        o.portal_submitted_by_name?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [orders, filter, search]);

  // Summary counts
  const counts = useMemo(() => ({
    total:       orders.length,
    pending:     orders.filter(o => matchesFilter(o, "pending")).length,
    in_progress: orders.filter(o => matchesFilter(o, "in_progress")).length,
    completed:   orders.filter(o => matchesFilter(o, "completed")).length,
    rejected:    orders.filter(o => matchesFilter(o, "rejected")).length,
  }), [orders]);

  return (
    <PortalLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Order History</h1>
          <p className="text-sm text-muted-foreground mt-1">
            A full record of every order placed through the portal.
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : orders.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <ShoppingBag className="w-10 h-10 text-muted-foreground/30" />
              <p className="font-medium text-muted-foreground">No orders yet</p>
              <p className="text-sm text-muted-foreground/70 max-w-xs">
                Your orders will appear here once you've placed them.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card>
                <CardContent className="py-4 px-5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total Orders</p>
                  <p className="text-2xl font-bold mt-1">{counts.total}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4 px-5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Pending</p>
                  <p className="text-2xl font-bold mt-1 text-amber-600">{counts.pending}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4 px-5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">In Progress</p>
                  <p className="text-2xl font-bold mt-1 text-blue-600">{counts.in_progress}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4 px-5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Shipped / Delivered</p>
                  <p className="text-2xl font-bold mt-1 text-green-600">{counts.completed}</p>
                </CardContent>
              </Card>
            </div>

            {/* Search + filter bar */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search by order number, PO or name…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <div className="flex gap-1 flex-wrap">
                {FILTERS.map(f => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                      filter === f.key
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    {f.label}
                    {f.key !== "all" && counts[f.key] > 0 && (
                      <span className={cn(
                        "ml-1.5 text-xs rounded-full px-1.5 py-0.5",
                        filter === f.key ? "bg-white/20" : "bg-muted text-muted-foreground"
                      )}>
                        {counts[f.key]}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Order list */}
            {filtered.length === 0 ? (
              <div className="rounded-xl border bg-card py-16 text-center text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="font-medium">No orders match your search</p>
                <p className="text-sm mt-1">Try adjusting the filter or search term.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map(order => (
                  <div
                    key={order.id}
                    role="button"
                    tabIndex={0}
                    className="w-full text-left"
                    onClick={() => setLocation(`/orders/${order.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") setLocation(`/orders/${order.id}`);
                    }}
                  >
                    <Card className="hover:shadow-sm hover:border-primary/30 transition-all">
                      <CardContent className="py-4 px-5">
                        <div className="flex items-center gap-4">
                          {/* Icon */}
                          <div className="hidden sm:flex h-10 w-10 rounded-lg bg-primary/10 items-center justify-center shrink-0">
                            <ShoppingBag className="w-5 h-5 text-primary" />
                          </div>

                          {/* Main info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-foreground">
                                {order.order_number ?? `Order #${order.id}`}
                              </span>
                              <StatusBadge status={order.status} portalStatus={order.portal_status} />
                              {getPortalOrderLifecycle(order.status, order.portal_status) === "part_shipped" && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 text-xs border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setOutstandingOrder(order);
                                  }}
                                >
                                  <PackageOpen className="w-3.5 h-3.5 mr-1" />
                                  Outstanding items
                                </Button>
                              )}
                            </div>

                            <div className="flex items-center gap-x-3 gap-y-0.5 mt-1 text-sm text-muted-foreground flex-wrap">
                              {order.portal_submitted_at && (
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3 shrink-0" />
                                  {formatDate(order.portal_submitted_at)}
                                </span>
                              )}
                              {order.portal_submitted_by_name && (
                                <span className="flex items-center gap-1">
                                  <User className="w-3 h-3 shrink-0" />
                                  {order.portal_submitted_by_name}
                                </span>
                              )}
                              {order.po_number && (
                                <span className="flex items-center gap-1">
                                  <Hash className="w-3 h-3 shrink-0" />
                                  PO: {order.po_number}
                                </span>
                              )}
                              <span className="flex items-center gap-1">
                                <Package className="w-3 h-3 shrink-0" />
                                {Number(order.item_count)} item{Number(order.item_count) !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </div>

                          {/* Total + arrow */}
                          <div className="flex items-center gap-3 shrink-0">
                            {order.total_amount && parseFloat(order.total_amount) > 0 && (
                              <span className="font-semibold text-foreground tabular-nums hidden sm:block">
                                {formatCurrency(parseFloat(order.total_amount))}
                              </span>
                            )}
                            <ArrowRight className="w-4 h-4 text-muted-foreground" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <Dialog open={outstandingOrder != null} onOpenChange={(open) => { if (!open) setOutstandingOrder(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Outstanding items — {outstandingOrder?.order_number ?? `Order #${outstandingOrder?.id}`}</DialogTitle>
            <DialogDescription>Items still to be shipped to you.</DialogDescription>
          </DialogHeader>
          {outstandingLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : outstandingItems.length > 0 ? (
            <div className="max-h-[55vh] overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 font-medium">Colour / Size</th>
                    <th className="px-4 py-3 font-medium">For</th>
                    <th className="px-4 py-3 font-medium text-right">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {outstandingItems.map((item: any) => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">{item.product_name ?? "Item"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{[item.colour, item.size].filter(Boolean).join(" / ") || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{item.recipient_name ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-semibold">{item.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-md border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              No outstanding items remain on this order.
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOutstandingOrder(null)}>Close</Button>
            {outstandingOrder && (
              <Button onClick={() => setLocation(`/orders/${outstandingOrder.id}`)}>View full order</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}
