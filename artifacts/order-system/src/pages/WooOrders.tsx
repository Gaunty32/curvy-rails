import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ShoppingBasket, Download, CheckCircle2, Clock, ChevronDown, ChevronRight,
  Loader2, RefreshCw, AlertCircle, Package, XCircle
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const API_BASE = "/api";
async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function parseApiError(e: Error) {
  try { return (JSON.parse(e.message) as any).error ?? e.message; } catch { return e.message; }
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatCurrency(v: string | number) {
  return `£${parseFloat(String(v)).toFixed(2)}`;
}

interface WooLineItem {
  id: number;
  name: string;
  sku: string | null;
  quantity: number;
  price: string;
  total: string;
  metaData: { key: string; value: string }[];
  fileUploads: { name: string; url: string }[];
}

interface WooOrder {
  id: number;
  number: string;
  status: string;
  dateCreated: string;
  customerNote: string | null;
  billing: { firstName: string; lastName: string; company: string; email: string; phone: string };
  shipping: { firstName: string; lastName: string; company: string; address1: string; address2: string; city: string; postcode: string; country: string };
  lineItems: WooLineItem[];
  shippingLines: { methodTitle: string; total: string }[];
  total: string;
  currency: string;
  paymentMethodTitle: string | null;
  alreadyImported: boolean;
  importedOrderNumber: string | null;
}

const STATUS_COLOURS: Record<string, string> = {
  processing:  "bg-blue-100 text-blue-800 border-blue-200",
  "on-hold":   "bg-amber-100 text-amber-800 border-amber-200",
  pending:     "bg-gray-100 text-gray-700 border-gray-200",
  completed:   "bg-green-100 text-green-800 border-green-200",
  cancelled:   "bg-red-100 text-red-700 border-red-200",
  refunded:    "bg-purple-100 text-purple-800 border-purple-200",
  failed:      "bg-red-100 text-red-700 border-red-200",
};

function WooOrderRow({ order, onImported }: { order: WooOrder; onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const importMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ orderId: number; orderNumber: string; customerName: string }>(
        `/woo/orders/${order.id}/import`,
        { method: "POST" }
      ),
    onSuccess: (res) => {
      toast({
        title: "Draft order created",
        description: `WooCommerce #${order.number} imported as ${res.orderNumber} — opening it now to add customer, processes and finishes.`,
      });
      onImported();
      navigate(`/orders/${res.orderId}`);
    },
    onError: (e: Error) => {
      const msg = parseApiError(e);
      if (msg.includes("Already imported")) {
        toast({ title: "Already imported", description: msg });
        onImported();
      } else {
        toast({ title: "Import failed", description: msg, variant: "destructive" });
      }
    },
  });

  const dismissMutation = useMutation({
    mutationFn: () => apiFetch(`/woo/orders/${order.id}/dismiss`, { method: "POST" }),
    onSuccess: () => {
      onImported(); // refetch the list
    },
    onError: (e: Error) => {
      toast({ title: "Dismiss failed", description: parseApiError(e), variant: "destructive" });
    },
  });

  const customerName = order.billing.company || [order.billing.firstName, order.billing.lastName].filter(Boolean).join(" ") || "Unknown";
  const shippingTotal = order.shippingLines.reduce((s, l) => s + parseFloat(l.total || "0"), 0);

  return (
    <div className={`rounded-xl border overflow-hidden ${order.alreadyImported ? "border-green-200 bg-green-50/30" : "border-border"}`}>
      {/* Header row */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        {open
          ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
          : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        }
        <Package className="w-4 h-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">#{order.number}</span>
            <span
              className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold capitalize ${STATUS_COLOURS[order.status] ?? "bg-muted text-muted-foreground"}`}
            >
              {order.status.replace(/-/g, " ")}
            </span>
            {order.alreadyImported && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-100 border border-green-200 rounded px-1.5 py-0.5">
                <CheckCircle2 className="w-3 h-3" /> Imported
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {customerName}
            {order.billing.email && <span className="ml-2">· {order.billing.email}</span>}
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <span className="text-xs text-muted-foreground">{formatDate(order.dateCreated)}</span>
          <span className="text-sm font-semibold">{formatCurrency(order.total)}</span>
          {!order.alreadyImported ? (
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={e => { e.stopPropagation(); importMutation.mutate(); }}
                disabled={importMutation.isPending || dismissMutation.isPending}
              >
                {importMutation.isPending
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Download className="w-3 h-3" />
                }
                Import
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-red-600 hover:bg-red-50"
                title="Hide from import queue (does not create a production order)"
                onClick={e => { e.stopPropagation(); dismissMutation.mutate(); }}
                disabled={importMutation.isPending || dismissMutation.isPending}
              >
                {dismissMutation.isPending
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <XCircle className="w-3.5 h-3.5" />
                }
                Dismiss
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-green-600 flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {order.importedOrderNumber ? `Imported as ${order.importedOrderNumber}` : "Done"}
              </span>
            </div>
          )}
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-border px-4 py-3 space-y-4 bg-muted/10">
          {/* Line items */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Items</p>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Product</th>
                    <th className="px-3 py-2 text-left font-medium">SKU</th>
                    <th className="px-3 py-2 text-left font-medium">Options</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lineItems.map(li => (
                    <tr key={li.id} className="border-t border-border/50">
                      <td className="px-3 py-2 font-medium">{li.name}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{li.sku || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {li.metaData.length > 0 && (
                          <span>{li.metaData.map(m => `${m.key}: ${m.value}`).join(" · ")}</span>
                        )}
                        {li.fileUploads.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {li.fileUploads.map((f, fi) => (
                              <a key={fi} href={f.url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-700 hover:bg-blue-100 transition-colors">
                                <Download className="w-3 h-3 shrink-0" />
                                {f.name}
                              </a>
                            ))}
                          </div>
                        )}
                        {li.metaData.length === 0 && li.fileUploads.length === 0 && "—"}
                      </td>
                      <td className="px-3 py-2 text-right">{li.quantity}</td>
                      <td className="px-3 py-2 text-right font-medium">{formatCurrency(li.total)}</td>
                    </tr>
                  ))}
                  {shippingTotal > 0 && (
                    <tr className="border-t border-border/50 bg-muted/20">
                      <td className="px-3 py-2 text-muted-foreground italic" colSpan={4}>
                        Shipping — {order.shippingLines.map(l => l.methodTitle).join(", ")}
                      </td>
                      <td className="px-3 py-2 text-right">{formatCurrency(shippingTotal)}</td>
                    </tr>
                  )}
                  <tr className="border-t border-border font-semibold bg-muted/30">
                    <td className="px-3 py-2" colSpan={4}>Total</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(order.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Shipping + notes */}
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <p className="font-semibold text-muted-foreground uppercase tracking-wide mb-1">Ship to</p>
              <p className="font-medium">{order.shipping.company || [order.shipping.firstName, order.shipping.lastName].filter(Boolean).join(" ")}</p>
              {order.shipping.address1 && <p className="text-muted-foreground">{order.shipping.address1}</p>}
              {order.shipping.address2 && <p className="text-muted-foreground">{order.shipping.address2}</p>}
              {(order.shipping.city || order.shipping.postcode) && (
                <p className="text-muted-foreground">{[order.shipping.city, order.shipping.postcode].filter(Boolean).join(", ")}</p>
              )}
            </div>
            <div>
              <p className="font-semibold text-muted-foreground uppercase tracking-wide mb-1">Details</p>
              {order.billing.email && <p className="text-muted-foreground">{order.billing.email}</p>}
              {order.billing.phone && <p className="text-muted-foreground">{order.billing.phone}</p>}
              {order.paymentMethodTitle && <p className="text-muted-foreground">Paid via {order.paymentMethodTitle}</p>}
              {order.customerNote && (
                <p className="mt-1 text-amber-700 bg-amber-50 rounded px-2 py-1 border border-amber-200">
                  Note: {order.customerNote}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WooOrders() {
  const [statusFilter, setStatusFilter] = useState("processing,on-hold,pending");
  const [page, setPage] = useState(1);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["woo-orders", statusFilter, page],
    queryFn: () =>
      apiFetch<{ orders: WooOrder[]; page: number; perPage: number }>(
        `/woo/orders?status=${encodeURIComponent(statusFilter)}&page=${page}`
      ),
    retry: false,
  });

  const orders = data?.orders ?? [];
  const pendingOrders = orders.filter(o => !o.alreadyImported);
  const pendingCount = pendingOrders.length;

  const dismissAllMutation = useMutation({
    mutationFn: () =>
      apiFetch("/woo/orders/dismiss-all", {
        method: "POST",
        body: JSON.stringify({ wooIds: pendingOrders.map(o => o.id) }),
      }),
    onSuccess: (res: any) => {
      toast({ title: `${res.dismissed} order${res.dismissed !== 1 ? "s" : ""} dismissed` });
      refetch();
    },
    onError: (e: Error) => toast({ title: "Dismiss all failed", description: parseApiError(e), variant: "destructive" }),
  });

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <ShoppingBasket className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">WooCommerce Orders</h1>
              <p className="text-sm text-muted-foreground">
                Browse and import orders from your WooCommerce store
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pendingCount > 0 && (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-200">
                <Clock className="w-3 h-3 mr-1" />
                {pendingCount} to import
              </Badge>
            )}
            {pendingCount > 1 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => {
                  if (confirm(`Dismiss all ${pendingCount} orders on this page from the import queue?`))
                    dismissAllMutation.mutate();
                }}
                disabled={dismissAllMutation.isPending || isFetching}
              >
                {dismissAllMutation.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <XCircle className="w-3.5 h-3.5" />}
                Dismiss All ({pendingCount})
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-56 h-9 text-sm">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="processing,on-hold,pending">Active (Processing, On-hold, Pending)</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="on-hold">On Hold</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {isLoading ? "Loading…" : `${orders.length} order${orders.length !== 1 ? "s" : ""}`}
          </span>
        </div>

        {/* Error */}
        {isError && (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-red-800">Could not load WooCommerce orders</p>
              <p className="text-red-700 mt-0.5">{parseApiError(error as Error)}</p>
              <p className="text-red-600 mt-1 text-xs">
                Check your WooCommerce credentials in{" "}
                <Link href="/settings" className="underline">Settings → WooCommerce</Link>.
              </p>
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 rounded-xl border border-border bg-muted/20 animate-pulse" />
            ))}
          </div>
        )}

        {/* Order list */}
        {!isLoading && !isError && (
          <>
            {orders.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <ShoppingBasket className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No orders found</p>
                <p className="text-sm mt-1">Try a different status filter or check back later.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {orders.map(order => (
                  <WooOrderRow
                    key={order.id}
                    order={order}
                    onImported={() => refetch()}
                  />
                ))}
              </div>
            )}

            {/* Pagination */}
            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1 || isFetching}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">Page {page}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={orders.length < 20 || isFetching}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
