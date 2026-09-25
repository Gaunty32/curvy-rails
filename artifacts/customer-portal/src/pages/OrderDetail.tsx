import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { useState } from "react";
import PortalLayout from "@/components/Layout";
import { apiFetch } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, Clock, CheckCircle2, XCircle, AlertCircle, Hash, Pencil, Check, X, Search, Trash2, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { getPortalOrderLifecycle } from "@/lib/order-status";

function PortalStatusBadge({ status, portalStatus }: { status: string; portalStatus?: string }) {
  const lifecycle = getPortalOrderLifecycle(status, portalStatus);
  if (lifecycle === "pending_approval") {
    return <Badge variant="outline" className="border-orange-300 text-orange-700 bg-orange-50 gap-1.5 text-sm px-3 py-1"><AlertCircle className="w-3.5 h-3.5" />Awaiting approval</Badge>;
  }
  if (lifecycle === "pending_sbs") {
    return <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 gap-1.5 text-sm px-3 py-1"><Clock className="w-3.5 h-3.5" />Pending review</Badge>;
  }
  if (lifecycle === "submitted") {
    return <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 gap-1.5 text-sm px-3 py-1"><Clock className="w-3.5 h-3.5" />Submitted to supplier</Badge>;
  }
  if (lifecycle === "rejected") {
    return <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50 gap-1.5 text-sm px-3 py-1"><XCircle className="w-3.5 h-3.5" />Rejected</Badge>;
  }
  if (lifecycle === "confirmed") return <Badge variant="outline" className="border-green-300 text-green-700 bg-green-50 gap-1.5 text-sm px-3 py-1"><CheckCircle2 className="w-3.5 h-3.5" />In production</Badge>;
  if (lifecycle === "part_shipped") return <Badge className="bg-indigo-100 text-indigo-800 border-transparent text-sm px-3 py-1">Part shipped</Badge>;
  if (lifecycle === "shipped") return <Badge className="bg-blue-100 text-blue-800 border-transparent text-sm px-3 py-1">Shipped</Badge>;
  if (lifecycle === "delivered") return <Badge className="bg-green-100 text-green-800 border-transparent text-sm px-3 py-1">Delivered</Badge>;
  return <Badge variant="outline" className="text-sm px-3 py-1">{status}</Badge>;
}

export default function OrderDetailPage() {
  const { canSeePricing, canApproveOrders } = useAuth();
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [editingPo, setEditingPo] = useState(false);
  const [poInput, setPoInput] = useState("");
  const [lineFilter, setLineFilter] = useState("");

  // Per-item qty overrides: { [itemId]: quantity }; 0 = marked for deletion
  const [editDraft, setEditDraft] = useState<Record<number, number>>({});

  // Reject panel
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const { data: order, isLoading, error } = useQuery<any>({
    queryKey: ["portal-order", id],
    queryFn: () => apiFetch(`/portal/orders/${id}`),
    enabled: !!id,
  });

  const poMutation = useMutation({
    mutationFn: (poNumber: string) =>
      apiFetch(`/portal/orders/${id}/po`, { method: "PATCH", body: JSON.stringify({ poNumber }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-order", id] });
      qc.invalidateQueries({ queryKey: ["portal-orders"] });
      setEditingPo(false);
      toast({ title: "PO number saved" });
    },
    onError: () => toast({ title: "Failed to save PO number", variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const allItemsList: any[] = order?.items ?? [];
      const keptItems = allItemsList
        .filter(i => (editDraft[i.id] ?? i.quantity) > 0)
        .map(i => ({ id: i.id, quantity: editDraft[i.id] ?? i.quantity }));
      if (keptItems.length === 0) throw new Error("Cannot remove all items from an order");
      const hasChanges = allItemsList.some(i => {
        const d = editDraft[i.id];
        return d !== undefined && d !== i.quantity;
      });
      if (hasChanges) {
        await apiFetch(`/portal/manager/orders/${id}/items`, {
          method: "PATCH",
          body: JSON.stringify({ items: keptItems }),
        });
      }
      await apiFetch(`/portal/manager/orders/${id}/submit`, {
        method: "POST",
        body: JSON.stringify({ poNumber: order?.po_number ?? null }),
      });
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["portal-orders"] });
      qc.invalidateQueries({ queryKey: ["portal-manager-pending"] });
      toast({
        title: data?.allFromStock
          ? "Order fulfilled from store stock"
          : "Order approved and submitted to supplier",
      });
      setLocation("/");
    },
    onError: (err: any) => toast({ title: err?.message ?? "Failed to approve order", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: (reason: string) =>
      apiFetch(`/portal/manager/orders/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: reason || null }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-orders"] });
      qc.invalidateQueries({ queryKey: ["portal-manager-pending"] });
      toast({ title: "Order rejected" });
      setLocation("/");
    },
    onError: (err: any) => toast({ title: err?.message ?? "Failed to reject order", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <PortalLayout>
        <div className="flex justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      </PortalLayout>
    );
  }

  if (error || !order) {
    return (
      <PortalLayout>
        <div className="text-center py-20">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-3" />
          <p className="font-medium text-lg">Order not found</p>
          <Button variant="outline" className="mt-4" onClick={() => setLocation("/orders")}>Back to orders</Button>
        </div>
      </PortalLayout>
    );
  }

  const isPendingReview = order.portal_status === "pending_review";
  const canEdit = canApproveOrders && isPendingReview;

  const allItems: any[] = order.items ?? [];

  const hasChanges = allItems.some(i => {
    const d = editDraft[i.id];
    return d !== undefined && d !== i.quantity;
  });
  const deletedCount = allItems.filter(i => editDraft[i.id] === 0).length;

  // When manager is reviewing, suppress the filter so no lines are hidden
  const q = canEdit ? "" : lineFilter.toLowerCase().trim();
  const displayItems: any[] = !q ? allItems : allItems.filter((item: any) =>
    item.product_name?.toLowerCase().includes(q) ||
    item.recipient_name?.toLowerCase().includes(q) ||
    item.colour?.toLowerCase().includes(q) ||
    item.size?.toLowerCase().includes(q)
  );

  const effectiveItems = canEdit
    ? allItems
        .filter(i => (editDraft[i.id] ?? i.quantity) > 0)
        .map(i => {
          const qty = editDraft[i.id] ?? i.quantity;
          return { ...i, quantity: qty, line_total: (parseFloat(i.unit_price ?? "0") * qty).toFixed(2) };
        })
    : allItems;

  const itemsSubtotal = effectiveItems.reduce((s: number, i: any) => s + parseFloat(i.line_total ?? "0"), 0);
  const carriageAmount = parseFloat(order.carriage_amount ?? "0");
  const vatAmount = (itemsSubtotal + carriageAmount) * 0.2;
  const grandTotal = itemsSubtotal + carriageAmount + vatAmount;

  return (
    <PortalLayout>
      <div className="mb-5">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => setLocation("/orders")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> All orders
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary">{order.order_number}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Placed {formatDate(order.order_date)}</p>
          {/* PO Number */}
          <div className="flex items-center gap-2 mt-2">
            <Hash className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            {editingPo ? (
              <form
                className="flex items-center gap-1.5"
                onSubmit={e => { e.preventDefault(); poMutation.mutate(poInput); }}
              >
                <Input
                  autoFocus
                  value={poInput}
                  onChange={e => setPoInput(e.target.value)}
                  placeholder="Enter PO number"
                  className="h-7 text-sm w-48"
                  maxLength={100}
                />
                <Button type="submit" size="icon" className="h-7 w-7" disabled={poMutation.isPending}>
                  <Check className="w-3.5 h-3.5" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7"
                  onClick={() => setEditingPo(false)}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </form>
            ) : (
              <button
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground group"
                onClick={() => { setPoInput(order.po_number ?? ""); setEditingPo(true); }}
              >
                {order.po_number
                  ? <span className="font-medium text-foreground">PO: {order.po_number}</span>
                  : <span className="italic">Add PO number</span>
                }
                <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <PortalStatusBadge status={order.status} portalStatus={order.portal_status} />
        </div>
      </div>

      {order.linkedOrders?.length > 0 && (
        <Card className="mb-5 border-violet-200 bg-violet-50/40">
          <CardContent className="py-3.5 px-4">
            <p className="text-sm font-semibold text-violet-900">
              This submission is being fulfilled as {order.linkedOrders.length + 1} delivery-address orders
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {order.linkedOrders.map((linkedOrder: any) => (
                <Button
                  key={linkedOrder.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 border-violet-200 bg-white text-violet-800 hover:bg-violet-100"
                  onClick={() => setLocation(`/orders/${linkedOrder.id}`)}
                >
                  <MapPin className="w-3.5 h-3.5 mr-1" />
                  {linkedOrder.order_number}
                  {linkedOrder.delivery_address_label ? ` — ${linkedOrder.delivery_address_label}` : ""}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Manager approval action panel ─────────────────────────────── */}
      {canEdit && (
        <Card className="mb-5 border-orange-200 bg-orange-50/40">
          <CardContent className="py-4 px-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1">
                <p className="text-sm font-semibold text-orange-900">Awaiting your approval</p>
                <p className="text-xs text-orange-700 mt-0.5">
                  Adjust quantities or remove lines below, then approve to forward for fulfilment.
                  {deletedCount > 0 && (
                    <span className="ml-1 font-medium text-red-700">
                      {deletedCount} line{deletedCount !== 1 ? "s" : ""} marked for removal.
                    </span>
                  )}
                  {hasChanges && !deletedCount && (
                    <span className="ml-1">Changes will be saved on approval.</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-300 text-red-700 hover:bg-red-50 gap-1.5"
                  onClick={() => { setRejectOpen(o => !o); setRejectReason(""); }}
                  disabled={approveMutation.isPending || rejectMutation.isPending}
                >
                  <XCircle className="w-3.5 h-3.5" /> Reject
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 bg-green-700 hover:bg-green-800 text-white"
                  onClick={() => approveMutation.mutate()}
                  disabled={approveMutation.isPending || rejectMutation.isPending || deletedCount === allItems.length}
                >
                  {approveMutation.isPending
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Check className="w-3.5 h-3.5" />}
                  Approve &amp; submit for fulfilment
                </Button>
              </div>
            </div>

            {/* Inline reject panel */}
            {rejectOpen && (
              <div className="mt-3 pt-3 border-t border-orange-200">
                <p className="text-sm font-medium text-red-700 mb-2">Reason for rejection <span className="text-muted-foreground font-normal">(optional)</span></p>
                <div className="flex gap-2 flex-wrap">
                  <Input
                    autoFocus
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    placeholder="Optional reason for the team member…"
                    className="text-sm h-8 flex-1 min-w-[200px]"
                    onKeyDown={e => { if (e.key === "Escape") setRejectOpen(false); }}
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    className="gap-1"
                    onClick={() => rejectMutation.mutate(rejectReason)}
                    disabled={rejectMutation.isPending}
                  >
                    {rejectMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Confirm reject
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRejectOpen(false)} disabled={rejectMutation.isPending}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Status banner for team members (non-manager) */}
      {!canEdit && isPendingReview && (
        <Card className="mb-5 border-amber-200 bg-amber-50/50">
          <CardContent className="py-3 px-5 flex items-start gap-2.5">
            <Clock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800">Your order has been submitted and is awaiting review by your manager.</p>
          </CardContent>
        </Card>
      )}

      {order.portal_status === "rejected" && (
        <Card className="mb-5 border-red-200 bg-red-50/50">
          <CardContent className="py-3 px-5 flex items-start gap-2.5">
            <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
            <p className="text-sm text-red-800">This order was not accepted. Please contact your account manager for more information.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="py-4 px-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Order date</p>
            <p className="font-medium">{formatDate(order.order_date)}</p>
          </CardContent>
        </Card>
        {order.required_date && (
          <Card>
            <CardContent className="py-4 px-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Required by</p>
              <p className="font-medium">{formatDate(order.required_date)}</p>
            </CardContent>
          </Card>
        )}
        {canSeePricing && (
          <Card>
            <CardContent className="py-4 px-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total (inc. VAT)</p>
              <p className="font-semibold text-lg">{formatCurrency(grandTotal)}</p>
              {canEdit && (hasChanges || deletedCount > 0) && <p className="text-xs text-orange-600 mt-0.5">Live estimate</p>}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Audit trail */}
      {(order.portal_submitted_by_name || order.portal_approved_by_name) && (
        <Card className="mb-5">
          <CardContent className="py-4 px-5 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Order history</p>
            {order.portal_submitted_by_name && (
              <div className="flex items-start gap-2 text-sm">
                <span className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                <span>
                  <span className="font-medium">{order.portal_submitted_by_name}</span>
                  {" submitted this order"}
                  {order.portal_submitted_at && (
                    <span className="text-muted-foreground"> — {new Date(order.portal_submitted_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
                  )}
                </span>
              </div>
            )}
            {order.portal_approved_by_name && (
              <div className="flex items-start gap-2 text-sm">
                <span className="w-2 h-2 rounded-full bg-green-500 mt-1.5 shrink-0" />
                <span>
                  <span className="font-medium">{order.portal_approved_by_name}</span>
                  {" approved and forwarded for fulfilment"}
                  {order.portal_approved_at && (
                    <span className="text-muted-foreground"> — {new Date(order.portal_approved_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
                  )}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {order.portal_notes && (
        <Card className="mb-5">
          <CardContent className="py-4 px-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Your notes</p>
            <p className="text-sm whitespace-pre-line">{order.portal_notes}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="py-3 px-5 border-b">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base">
              Order items
              {!canEdit && lineFilter.trim() && displayItems.length !== allItems.length && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">({displayItems.length} of {allItems.length})</span>
              )}
              {canEdit && deletedCount > 0 && (
                <span className="ml-2 text-sm font-normal text-red-600">({allItems.length - deletedCount} of {allItems.length} kept)</span>
              )}
            </CardTitle>
            {!canEdit && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  placeholder="Filter by name or product…"
                  value={lineFilter}
                  onChange={e => setLineFilter(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring w-52"
                />
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Product</TableHead>
                  <TableHead>Colour / Size</TableHead>
                  <TableHead>Finish</TableHead>
                  <TableHead>For</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  {canSeePricing && <TableHead className="text-right">Unit price</TableHead>}
                  {canSeePricing && <TableHead className="text-right">Total</TableHead>}
                  {canEdit && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayItems.map((item: any) => {
                  const isDeleted = editDraft[item.id] === 0;
                  const qty = editDraft[item.id] ?? item.quantity;
                  const lineTotal = canEdit
                    ? parseFloat(item.unit_price ?? "0") * (isDeleted ? 0 : qty)
                    : parseFloat(item.line_total ?? "0");

                  return (
                    <TableRow
                      key={item.id}
                      className={isDeleted ? "opacity-40 bg-red-50/40" : undefined}
                    >
                      <TableCell className={`font-medium${isDeleted ? " line-through" : ""}`}>{item.product_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {[item.colour, item.size].filter(Boolean).join(" / ") || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{item.finish_name || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.recipient_name || (item.recipient_type === "stock" ? "Stock" : "—")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {canEdit && !isDeleted ? (
                          <input
                            type="number"
                            min={1}
                            max={999}
                            value={qty}
                            onChange={e => {
                              const v = Math.max(1, parseInt(e.target.value, 10) || 1);
                              setEditDraft(d => ({ ...d, [item.id]: v }));
                            }}
                            className="w-16 text-right border border-input rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
                          />
                        ) : (
                          qty
                        )}
                      </TableCell>
                      {canSeePricing && (
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(item.unit_price)}
                        </TableCell>
                      )}
                      {canSeePricing && (
                        <TableCell className="text-right tabular-nums font-medium">
                          {isDeleted ? "—" : formatCurrency(lineTotal)}
                        </TableCell>
                      )}
                      {canEdit && (
                        <TableCell className="text-right">
                          {isDeleted ? (
                            <button
                              title="Restore this line"
                              onClick={() => setEditDraft(d => { const n = { ...d }; delete n[item.id]; return n; })}
                              className="text-blue-600 hover:text-blue-800 p-1 rounded"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              title="Remove this line"
                              onClick={() => setEditDraft(d => ({ ...d, [item.id]: 0 }))}
                              className="text-muted-foreground hover:text-red-600 p-1 rounded transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {canSeePricing && (
            <div className="border-t">
              <div className="px-5 py-2 flex justify-end">
                <div className="text-right space-y-1 min-w-[220px]">
                  {!canEdit && lineFilter.trim() && displayItems.length !== allItems.length && (
                    <div className="flex justify-between gap-8 text-sm font-medium">
                      <span>Filtered subtotal</span>
                      <span>{formatCurrency(displayItems.reduce((s: number, i: any) => s + parseFloat(i.line_total ?? "0"), 0))}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-8 text-sm text-muted-foreground">
                    <span>Subtotal (exc. VAT)</span>
                    <span>{formatCurrency(itemsSubtotal)}</span>
                  </div>
                  {carriageAmount > 0 && (
                    <div className="flex justify-between gap-8 text-sm text-muted-foreground">
                      <span>Carriage</span>
                      <span>{formatCurrency(carriageAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-8 text-sm text-muted-foreground">
                    <span>VAT (20%)</span>
                    <span>{formatCurrency(vatAmount)}</span>
                  </div>
                  <div className="flex justify-between gap-8 pt-1.5 border-t font-bold text-base">
                    <span>Total (inc. VAT)</span>
                    <span>{formatCurrency(grandTotal)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </PortalLayout>
  );
}
