import { useState, useEffect } from "react";
import { printDpdLabelHtml } from "@/utils/printDpdLabel";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Truck, Package, CheckCircle, AlertTriangle, Clock, Printer, User,
  RefreshCw, ChevronDown, ChevronRight, FileText, Tag, Send,
  History, Search, X, ExternalLink, RotateCcw, Pencil, Check,
} from "lucide-react";
import ZebraLabels from "@/components/ZebraLabels";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";
import { formatDate } from "@/lib/utils";

const API_BASE = "/api";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as { error?: string };
      throw new Error(parsed.error || text);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(text);
      throw error;
    }
  }
  if (res.status === 204) return null as T;
  return res.json();
}

interface Employee {
  id: number; firstName: string; lastName: string | null;
  jobTitle: string | null; department: string | null;
}
interface DispatchItem {
  id: number; orderId: number; productName: string; productSku: string | null;
  colour: string | null;
  size: string | null; quantity: number; recipientType: string;
  recipientName: string | null; recipientEmployeeId: number | null;
  finishName: string | null; unitPrice: number; lineTotal: number;
  stockStatus: string | null; purchaseRequired: boolean | null;
  dispatchedAt: string | null;
  blockedByPo?: boolean;
  isService?: boolean;
  employee: Employee | null;
}

function isItemReady(i: Pick<DispatchItem, "stockStatus" | "isService">): boolean {
  return i.isService === true || i.stockStatus === "complete" || i.stockStatus === "allocated";
}
interface Worksheet {
  id: number; worksheetNumber: string; status: string;
  completedAt: string | null;
}
interface DeliveryAddress {
  id: number; label: string | null; line1: string | null; line2: string | null;
  city: string | null; county: string | null; postcode: string | null; country: string | null;
}
interface DispatchOrder {
  id: number; orderNumber: string; customerName: string | null; customerId: number | null;
  status: string; totalAmount: number; notes: string | null;
  orderDate: string; requiredDate: string | null; dispatchedAt: string | null;
  shippingMethod: string | null;
  trackingNumber: string | null;
  dpdConsignmentId: string | null;
  attentionOf: string | null;
  productionComplete: boolean;
  worksheets: Worksheet[];
  items: DispatchItem[];
  deliveryAddress: DeliveryAddress | null;
  deliveryAddressConflict: boolean;
}
interface ManagerPackingGroup {
  customerId: number;
  customerName: string;
  managerId: number | null;
  manager: { firstName: string; lastName: string | null; jobTitle: string | null } | null;
  teams: string[];
  employees: string[];
  orderNumbers: string[];
  itemIds: number[];
  items: { id: number; orderNumber: string; productName: string; colour: string | null; size: string | null; quantity: number; employeeName: string | null; teamName: string | null; department: string | null }[];
  deliveryAddress: DeliveryAddress | null;
}
interface ShippedOrder {
  id: number; orderNumber: string; customerName: string | null;
  status: string; totalAmount: number;
  orderDate: string; requiredDate: string | null; dispatchedAt: string | null;
  shippingMethod: string | null;
  trackingNumber: string | null;
  dpdConsignmentId: string | null;
  attentionOf: string | null;
  items: DispatchItem[];
  deliveryAddress: DeliveryAddress | null;
}

const SHIPPING_LABELS: Record<string, string> = {
  free_local: "Free Local Delivery",
  local_delivery: "Local Delivery",
  office_collection: "Office Collection",
  warehouse_collection: "Warehouse Collection",
  courier: "Courier",
  dpd: "DPD Courier",
  dpd_next_day: "Courier",
};

function shippingLabel(method: string | null): string {
  if (!method) return "Not specified";
  return SHIPPING_LABELS[method] ?? method;
}

function recipientFullName(item: DispatchItem): string {
  if (item.employee) {
    return [item.employee.firstName, item.employee.lastName].filter(Boolean).join(" ");
  }
  return item.recipientName ?? "Unknown";
}

function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isPast(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

function openWearerLabels(orderId: number, opts?: { includeDeliveryLabel?: boolean; recipient?: string; dispatchedItemIds?: number[] }) {
  const params = new URLSearchParams();
  if (opts?.includeDeliveryLabel) params.set("includeDeliveryLabel", "1");
  if (opts?.recipient) params.set("recipient", opts.recipient);
  if (opts?.dispatchedItemIds && opts.dispatchedItemIds.length > 0) params.set("dispatchedItemIds", opts.dispatchedItemIds.join(","));
  window.open(`/api/orders/${orderId}/wearer-labels?${params}`, "_blank");
}

const LOCAL_DELIVERY_METHODS = new Set(["free_local", "local_delivery"]);

function openDeliveryNote(orderId: number, shippingMethod?: string | null, dispatchedItemIds?: number[]) {
  const params = dispatchedItemIds && dispatchedItemIds.length > 0
    ? `?dispatchedItemIds=${dispatchedItemIds.join(",")}`
    : "";
  window.open(`/api/orders/${orderId}/delivery-note${params}`, "_blank");
  if (shippingMethod && LOCAL_DELIVERY_METHODS.has(shippingMethod)) {
    setTimeout(() => window.open(`/api/orders/${orderId}/shipping-label`, "_blank"), 300);
  }
}

function RequiredDateBadge({ requiredDate }: { requiredDate: string | null }) {
  if (!requiredDate) return null;
  const today = isToday(requiredDate);
  const past = isPast(requiredDate) && !today;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${
      past ? "bg-red-100 text-red-700 border-red-300" :
      today ? "bg-amber-100 text-amber-700 border-amber-300" :
      "bg-muted text-muted-foreground border-border"
    }`}>
      <Clock className="w-3 h-3" />
      {today ? "Due today" : past ? `Overdue — ${formatDate(requiredDate)}` : formatDate(requiredDate)}
    </span>
  );
}

function ManagerPackingCard({ group, onDone }: { group: ManagerPackingGroup; onDone: () => void }) {
  const [parcels, setParcels] = useState(1);
  const [printedSheet, setPrintedSheet] = useState("");
  const [printedLabels, setPrintedLabels] = useState("");
  const [packed, setPacked] = useState(false);
  const itemIdsKey = group.itemIds.join(",");
  const packIsCurrent = printedSheet === `${itemIdsKey}:${parcels}` && printedLabels === `${itemIdsKey}:${parcels}`;
  useEffect(() => { setPacked(false); }, [itemIdsKey, parcels]);
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: () => apiFetch<{ deliveryNoteUrl: string }>(
      `/dispatch/customers/${group.customerId}/manager-groups/${group.managerId ?? "unassigned"}/dispatch`,
      { method: "POST", body: JSON.stringify({ itemIds: group.itemIds, numberOfParcels: parcels, packedForManager: true }) },
    ),
    onSuccess: data => {
      toast({ title: "Manager-grouped delivery dispatched", description: `${managerName} — packing sheet and package labels are ready to print again if needed.` });
      onDone();
    },
    onError: (e: Error) => toast({ title: "Grouped dispatch failed", description: e.message, variant: "destructive" }),
  });
  const managerName = group.manager ? [group.manager.firstName, group.manager.lastName].filter(Boolean).join(" ") : "Supervisor not assigned";
  const openPackingPrint = (labelsOnly: boolean) => {
    const url = `/api/dispatch/customers/${group.customerId}/manager-groups/${group.managerId}/packing-print?itemIds=${itemIdsKey}&parcels=${parcels}${labelsOnly ? "&labels=1" : ""}`;
    const preview = window.open(url, "_blank");
    if (!preview) {
      toast({ title: "Allow pop-ups to open the packing printout", variant: "destructive" });
      return;
    }
    if (labelsOnly) setPrintedLabels(`${itemIdsKey}:${parcels}`);
    else setPrintedSheet(`${itemIdsKey}:${parcels}`);
  };
  return (
    <div className="rounded-xl border border-indigo-200 bg-card shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 bg-indigo-50/60">
        <div>
          <div className="flex items-center gap-2"><User className="w-4 h-4 text-indigo-600" /><span className="font-bold">{managerName}</span><Badge variant="outline">{group.customerName}</Badge>{!group.manager && <Badge variant="outline" className="text-amber-700 border-amber-300">Assignment required</Badge>}</div>
          <p className="text-xs text-muted-foreground mt-1">{group.teams.length ? `Teams: ${group.teams.join(", ")}` : "No team recorded"} · {group.itemIds.length} ready item lines · Orders: {group.orderNumbers.join(", ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {group.manager ? <>
            <label className="text-xs text-muted-foreground" htmlFor={`manager-parcels-${group.customerId}-${group.managerId}`}>Bags / boxes</label>
            <Input id={`manager-parcels-${group.customerId}-${group.managerId}`} className="w-20 h-8" type="number" min={1} max={50} value={parcels} onChange={e => setParcels(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} />
            <Button size="sm" variant="outline" className="gap-1" onClick={() => openPackingPrint(false)}><Printer className="w-3.5 h-3.5" /> Packing sheet</Button>
            <Button size="sm" variant="outline" className="gap-1" onClick={() => openPackingPrint(true)}><Tag className="w-3.5 h-3.5" /> Package labels (4 × 6 in)</Button>
            <Button size="sm" className="gap-1.5 bg-indigo-600 hover:bg-indigo-700" disabled={mutation.isPending || !packed || !packIsCurrent} onClick={() => {
              if (window.confirm(`Confirm ${parcels} separately labelled package${parcels === 1 ? "" : "s"} for ${managerName} are packed, then mark ${group.itemIds.length} items dispatched?`)) mutation.mutate();
            }}><Send className="w-3.5 h-3.5" /> Dispatch supervisor</Button>
          </> : (
            <a className="text-sm text-indigo-700 underline" href={`/order-system/customers/${group.customerId}?tab=employees`}>Assign supervisors in employee details</a>
          )}
        </div>
      </div>
      {group.manager && (
        <label className="flex items-center gap-2 px-5 py-3 text-sm border-b border-indigo-100 cursor-pointer">
          <input type="checkbox" checked={packed && packIsCurrent} disabled={!packIsCurrent} onChange={e => setPacked(e.target.checked)} />
          I have packed only {managerName}’s team into {parcels} separately labelled bag{parcels === 1 ? "" : "s"} or box{parcels === 1 ? "" : "es"}.
          {!packIsCurrent && <span className="text-amber-700">Open the current packing sheet and package labels first.</span>}
        </label>
      )}
      <div className="px-5 py-3 grid gap-1 sm:grid-cols-2">
        {group.items.map(item => <div key={item.id} className="text-sm flex items-center gap-2 rounded bg-muted/30 px-3 py-2"><Package className="w-3.5 h-3.5 text-indigo-500" /><span className="font-medium">{item.productName}</span><span className="text-muted-foreground">{[item.colour, item.size].filter(Boolean).join(" / ")}</span><span className="ml-auto">×{item.quantity}</span><span className="text-xs text-muted-foreground">{item.employeeName ?? "Unassigned"}{item.department ? ` · ${item.department}` : ""}</span><span className="text-[10px] text-muted-foreground">{item.orderNumber}</span></div>)}
      </div>
    </div>
  );
}

interface DispatchResponse {
  order: DispatchOrder;
  dispatchedItemIds: number[];
  dpd: { consignmentNumber: string; trackingUrl: string; labelHtml: string | null } | null;
  dpdError: string | null;
  dpdConfigured: boolean;
  invoiceEmailSentTo: string | null;
  invoiceEmailError: string | null;
}

function DispatchCard({ order, onDispatched }: { order: DispatchOrder; onDispatched: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [numberOfParcels, setNumberOfParcels] = useState(1);
  const [totalWeightKg, setTotalWeightKg] = useState<number | "">("");
  const [packageType, setPackageType] = useState<"parcel" | "bag">("parcel");
  const [editItemId, setEditItemId] = useState<number | null>(null);
  const [editItemQty, setEditItemQty] = useState<string>("");
  const [bypassDpd, setBypassDpd] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const serviceOnly = order.items.length > 0 && order.items.every(item => item.isService === true);
  const DPD_METHODS = new Set(["dpd", "dpd_next_day", "courier"]);
  const isDpdShipping = !!order.shippingMethod && DPD_METHODS.has(order.shippingMethod);
  const willBookDpd = isDpdShipping && !serviceOnly && !bypassDpd;
  const deliveryMethodLabel = shippingLabel(order.shippingMethod);

  function openDispatchModal() {
    setNumberOfParcels(1);
    setTotalWeightKg("");
    setBypassDpd(false);
    setDispatchOpen(true);
  }

  const returnMutation = useMutation({
    mutationFn: () => apiFetch(`/dispatch/orders/${order.id}/return`, { method: "POST" }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["dispatch-orders"] });
      queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
      toast({ title: "Returned to purchasing", description: `${data.returned} item line${data.returned !== 1 ? "s" : ""} reset` });
    },
    onError: (e: Error) => toast({ title: "Cannot return", description: e.message, variant: "destructive" }),
  });

  const reduceQtyMutation = useMutation({
    mutationFn: ({ itemId, newQuantity }: { itemId: number; newQuantity: number }) =>
      apiFetch(`/dispatch/orders/${order.id}/items/${itemId}/reduce`, {
        method: "POST",
        body: JSON.stringify({ newQuantity }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatch-orders"] });
      queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
      setEditItemId(null);
      setEditItemQty("");
      toast({ title: "Quantity updated", description: "Backorder created for the shortfall — it will re-enter the purchasing queue." });
    },
    onError: (e: Error) => toast({ title: "Could not update quantity", description: e.message, variant: "destructive" }),
  });

  const dispatchMutation = useMutation({
    mutationFn: () => apiFetch<DispatchResponse>(`/dispatch/orders/${order.id}/dispatch`, {
      method: "PATCH",
      body: JSON.stringify({
        numberOfParcels,
        totalWeightKg: totalWeightKg === "" ? undefined : totalWeightKg,
        bookDpd: willBookDpd,
        networkCode: packageType === "bag" ? "2^32" : "2^12",
      }),
    }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["dispatch-orders"] });
      setDispatchOpen(false);

      // Always print the delivery note first — pass the just-dispatched IDs so
      // the note shows "Items Delivered Now" + "Items To Follow" for partial dispatches
      openDeliveryNote(order.id, order.shippingMethod, data.dispatchedItemIds);

      const isPartShipped = data.order.status === "part_shipped";

      if (data.dpd) {
        const emailNote = data.invoiceEmailSentTo
          ? ` Invoice emailed to ${data.invoiceEmailSentTo}.`
          : data.invoiceEmailError
            ? ` Invoice email failed: ${data.invoiceEmailError}`
            : "";
        toast({
          title: isPartShipped ? `${order.orderNumber} part-dispatched via DPD` : `${order.orderNumber} dispatched via DPD`,
          description: `Consignment: ${data.dpd.consignmentNumber}${isPartShipped ? " — remaining items to follow" : ""}${emailNote}`,
        });
        if (data.dpd.labelHtml) {
          setTimeout(() => printDpdLabelHtml(data.dpd.labelHtml!), 400);
        }
        const namedCount = order.items.filter(
          (i) => i.recipientType === "person" && (i.recipientName || i.recipientEmployeeId)
        ).length;
        if (namedCount > 0) {
          setTimeout(() => openWearerLabels(order.id, { includeDeliveryLabel: true, dispatchedItemIds: data.dispatchedItemIds }), 800);
        }
      } else if (data.dpdError) {
        toast({ title: `DPD booking failed — ${order.orderNumber} dispatched`, description: `${data.dpdError}. Open the order and use the "Book DPD" button to retry.`, variant: "destructive", duration: 10000 });
      } else if (isPartShipped) {
        toast({ title: "Part dispatched", description: `${order.orderNumber} — remaining items will follow when ready.` });
      } else {
        toast({ title: "Order dispatched", description: `${order.orderNumber} marked as shipped.` });
      }
      // For non-DPD dispatches, also open wearer labels when named recipients exist
      if (!data.dpd) {
        const namedItemCount = order.items.filter(i => i.recipientType === "person" && (i.recipientName || i.recipientEmployeeId)).length;
        if (namedItemCount > 0) {
          setTimeout(() => openWearerLabels(order.id, { dispatchedItemIds: data.dispatchedItemIds }), 800);
        }
      }
      onDispatched();
    },
    onError: (e: Error) => toast({ title: "Dispatch failed", description: e.message, variant: "destructive" }),
  });

  const totalWs = order.worksheets.length;
  const completeWs = order.worksheets.filter((w) => w.status === "complete").length;
  const dueToday = isToday(order.requiredDate);
  const overdue = isPast(order.requiredDate) && !dueToday;
  const namedCount = order.items.filter((i) => i.recipientType === "person" && (i.recipientName || i.recipientEmployeeId)).length;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-bold text-base">{order.orderNumber}</span>
              <span className="text-muted-foreground font-medium">{order.customerName}</span>
              {order.status === "part_shipped" && (
                <Badge className="text-xs bg-amber-100 text-amber-800 border-amber-300 gap-1">
                  <Package className="w-3 h-3" /> Part Shipped
                </Badge>
              )}
              <RequiredDateBadge requiredDate={order.requiredDate} />
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
              {order.status === "part_shipped" ? (
                <span className={`flex items-center gap-1 font-medium ${order.productionComplete ? "text-green-600" : "text-amber-600"}`}>
                  {order.productionComplete ? <CheckCircle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                  {order.productionComplete ? "Remaining items ready" : "Awaiting remaining items"}
                </span>
              ) : (
                <span className={`flex items-center gap-1 font-medium ${order.productionComplete ? "text-green-600" : "text-amber-600"}`}>
                  {order.productionComplete ? <CheckCircle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                  {completeWs}/{totalWs} worksheets complete
                </span>
              )}
              <span>{order.items.length} item lines</span>
              {namedCount > 0 && <span>{namedCount} named recipients</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <ZebraLabels orderId={order.id} orderNumber={order.orderNumber} hasNamedRecipients={order.items.some((i) => i.recipientType === "person" && (i.recipientName || i.recipientEmployeeId))} />
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs text-amber-700 border-amber-300 hover:bg-amber-50"
            disabled={returnMutation.isPending}
            onClick={() => {
              if (confirm(`Return ${order.orderNumber} from dispatch? Items without a completed worksheet will be sent back to purchasing.`)) {
                returnMutation.mutate();
              }
            }}
          >
            <RotateCcw className="w-3.5 h-3.5" /> Return
          </Button>
          <Button
            size="sm"
            className={`gap-1.5 text-xs text-white ${order.status === "part_shipped" ? "bg-amber-600 hover:bg-amber-700" : "bg-green-600 hover:bg-green-700"}`}
            onClick={openDispatchModal}
          >
            <Send className="w-3.5 h-3.5" />
            {order.status === "part_shipped" ? "Dispatch Remaining" : "Dispatch"}
          </Button>
        </div>
      </div>

      {order.status === "part_shipped" && order.productionComplete && (
        <div className="mx-5 mb-3 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          <span className="font-medium">Remaining items in stock</span> — ready to dispatch the follow-up shipment.
        </div>
      )}
      {order.status === "part_shipped" && !order.productionComplete && (
        <div className="mx-5 mb-3 flex items-center justify-between gap-2 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 flex-shrink-0" />
            <span><span className="font-medium">Part dispatched</span> — {order.items.filter(i => !i.dispatchedAt).length} item line(s) awaiting delivery before follow-up shipment.</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1 border-amber-300 text-amber-800 hover:bg-amber-100 flex-shrink-0"
            onClick={() => openDeliveryNote(order.id, order.shippingMethod, order.items.filter(i => i.dispatchedAt).map(i => i.id))}
          >
            <FileText className="w-3 h-3" /> Delivery Note
          </Button>
        </div>
      )}
      {order.status !== "part_shipped" && order.productionComplete && (
        <div className="mx-5 mb-3 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          <span className="font-medium">All production complete</span> — ready to dispatch whenever you are.
        </div>
      )}
      {!order.productionComplete && order.status !== "part_shipped" && (dueToday || overdue) && (
        <div className="mx-5 mb-3 flex items-center justify-between px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span><span className="font-medium">{overdue ? "Overdue" : "Due today"}</span> — production not yet complete.</span>
          </div>
          <div className="flex gap-2 flex-shrink-0 ml-3">
            {(() => {
              const readyIds = order.items.filter(i => isItemReady(i)).map(i => i.id);
              if (readyIds.length === 0) return null;
              const hasNamed = order.items.filter(i => readyIds.includes(i.id)).some(i => i.recipientType === "person" && (i.recipientName || i.recipientEmployeeId));
              return (
                <>
                  {hasNamed && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-amber-300 text-amber-800 hover:bg-amber-100" onClick={() => openWearerLabels(order.id, { dispatchedItemIds: readyIds })}>
                      <Printer className="w-3 h-3" /> Labels
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-amber-300 text-amber-800 hover:bg-amber-100" onClick={() => openDeliveryNote(order.id, order.shippingMethod, readyIds)}>
                    <FileText className="w-3 h-3" /> Note
                  </Button>
                </>
              );
            })()}
            <Button size="sm" className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white gap-1" onClick={openDispatchModal}>
              <Send className="w-3 h-3" /> Send Now
            </Button>
          </div>
        </div>
      )}
      {!order.productionComplete && order.status !== "part_shipped" && !dueToday && !overdue && (() => {
        const readyLines = order.items.filter(i => isItemReady(i));
        const outstandingLines = order.items.filter(i => !isItemReady(i));
        if (readyLines.length === 0) return null;
        const readyIds = readyLines.map(i => i.id);
        const hasNamed = readyLines.some(i => i.recipientType === "person" && (i.recipientName || i.recipientEmployeeId));
        return (
          <div className="mx-5 mb-3 flex items-center justify-between px-4 py-2.5 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 flex-shrink-0" />
              <span>
                <span className="font-medium">{readyLines.length} item line{readyLines.length !== 1 ? "s" : ""} ready</span>
                {" "}— {outstandingLines.length} still outstanding. Dispatch ready items now, remainder follows when complete.
              </span>
            </div>
            <div className="flex gap-2 flex-shrink-0 ml-3">
              {hasNamed && (
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-blue-300 text-blue-700 hover:bg-blue-100" onClick={() => openWearerLabels(order.id, { dispatchedItemIds: readyIds })}>
                  <Printer className="w-3 h-3" /> Labels
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-blue-300 text-blue-700 hover:bg-blue-100" onClick={() => openDeliveryNote(order.id, order.shippingMethod, readyIds)}>
                <FileText className="w-3 h-3" /> Note
              </Button>
              <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1" onClick={openDispatchModal}>
                <Send className="w-3 h-3" /> Part Dispatch
              </Button>
            </div>
          </div>
        );
      })()}

      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-4">
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Worksheets</h4>
            <div className="flex flex-wrap gap-2">
              {order.worksheets.map((ws) => (
                <Badge key={ws.id} className={`text-xs gap-1 ${
                  ws.status === "complete" ? "bg-green-100 text-green-800 border-green-300" :
                  ws.status === "wip" ? "bg-blue-100 text-blue-800 border-blue-300" :
                  "bg-slate-100 text-slate-700 border-slate-300"
                }`}>
                  {ws.status === "complete" ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                  {ws.worksheetNumber} — {ws.status === "pre_wip" ? "Pre-Production" : ws.status === "wip" ? "WIP" : "Complete"}
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Items</h4>
            {(() => {
              const dispItems = order.items.filter(i => i.dispatchedAt);
              const readyItems = order.items.filter(i => !i.dispatchedAt && isItemReady(i));
              const pendItems = order.items.filter(i => !i.dispatchedAt && !isItemReady(i));
              const showGroups = readyItems.length > 0 && pendItems.length > 0;

              const renderItem = (item: typeof order.items[0], tone: "ready" | "pending" | "done") => {
                const isEditing = editItemId === item.id;
                const statusEl = tone === "done"
                  ? <span className="text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 whitespace-nowrap">Dispatched</span>
                  : tone === "ready"
                  ? <span className="text-xs font-medium text-green-700 bg-green-100 border border-green-300 rounded px-1.5 py-0.5 whitespace-nowrap flex items-center gap-0.5"><CheckCircle className="w-2.5 h-2.5" /> Ready</span>
                  : item.blockedByPo
                  ? <span className="text-xs font-medium text-amber-700 bg-amber-100 border border-amber-300 rounded px-1.5 py-0.5 whitespace-nowrap">Awaiting stock</span>
                  : <span className="text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 whitespace-nowrap">Outstanding</span>;

                const qtySection = tone === "done" ? (
                  <Badge variant="secondary" className="text-xs">×{item.quantity}</Badge>
                ) : isEditing ? (
                  <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    <input
                      type="number"
                      min={1}
                      max={item.quantity - 1}
                      value={editItemQty}
                      onChange={e => setEditItemQty(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          const n = parseInt(editItemQty, 10);
                          if (n >= 1 && n < item.quantity) reduceQtyMutation.mutate({ itemId: item.id, newQuantity: n });
                        }
                        if (e.key === "Escape") { setEditItemId(null); setEditItemQty(""); }
                      }}
                      className="w-14 h-6 text-xs border border-border rounded px-1.5 text-center bg-background"
                      autoFocus
                    />
                    <span className="text-xs text-muted-foreground">of {item.quantity}</span>
                    <button
                      className="h-6 w-6 flex items-center justify-center rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                      disabled={reduceQtyMutation.isPending}
                      onClick={() => {
                        const n = parseInt(editItemQty, 10);
                        if (n >= 1 && n < item.quantity) reduceQtyMutation.mutate({ itemId: item.id, newQuantity: n });
                      }}
                    ><Check className="w-3 h-3" /></button>
                    <button
                      className="h-6 w-6 flex items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground"
                      onClick={() => { setEditItemId(null); setEditItemQty(""); }}
                    ><X className="w-3 h-3" /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge variant="secondary" className="text-xs">×{item.quantity}</Badge>
                    <button
                      title="Reduce quantity — creates a backorder for the difference"
                      className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={e => { e.stopPropagation(); setEditItemId(item.id); setEditItemQty(String(item.quantity - 1)); }}
                    ><Pencil className="w-3 h-3" /></button>
                  </div>
                );

                return (
                  <div key={item.id} className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${
                    tone === "done" ? "bg-muted/20 opacity-60" :
                    tone === "ready" ? "bg-green-50 border border-green-100" :
                    item.blockedByPo ? "bg-amber-50 border border-amber-200" : "bg-muted/30"
                  }`}>
                    <Package className={`w-3.5 h-3.5 flex-shrink-0 ${tone === "ready" ? "text-green-500" : item.blockedByPo ? "text-amber-500" : "text-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{item.productName}</span>
                      {item.productSku && <span className="font-mono text-xs text-indigo-500 ml-1.5">{item.productSku}</span>}
                      {(item.colour || item.size) && <span className="text-muted-foreground ml-2">{[item.colour, item.size].filter(Boolean).join(" / ")}</span>}
                    </div>
                    {statusEl}
                    <span className="text-muted-foreground text-xs">
                      {item.recipientType === "person" && (item.recipientName || item.employee) ? recipientFullName(item) : "Stock"}
                    </span>
                    {qtySection}
                  </div>
                );
              };

              return (
                <div className="space-y-1">
                  {showGroups && <p className="text-[10px] font-bold text-green-700 uppercase tracking-wide px-1 pb-0.5">Dispatching Now</p>}
                  {readyItems.map(i => renderItem(i, "ready"))}
                  {showGroups && <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide px-1 pt-2 pb-0.5">Items to Follow</p>}
                  {pendItems.map(i => renderItem(i, "pending"))}
                  {dispItems.length > 0 && <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide px-1 pt-2 pb-0.5">Already Dispatched</p>}
                  {dispItems.map(i => renderItem(i, "done"))}
                </div>
              );
            })()}
          </div>

          {(() => {
            const recipientMap = new Map<string, number>();
            for (const item of order.items) {
              if (item.recipientType === "person" && (item.recipientName || item.employee)) {
                const name = recipientFullName(item);
                recipientMap.set(name, (recipientMap.get(name) ?? 0) + item.quantity);
              }
            }
            const recipients = Array.from(recipientMap.entries()).sort(([a], [b]) => a.localeCompare(b));
            if (recipients.length === 0) return null;
            return (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Named Recipients</h4>
                <div className="space-y-1">
                  {recipients.map(([name, qty]) => (
                    <div key={name} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 text-sm">
                      <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="font-medium truncate flex-1">{name}</span>
                      <span className="text-muted-foreground text-xs">{qty} item{qty !== 1 ? "s" : ""}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">Use the <strong>Labels</strong> button above to print wearer labels directly to the Zebra printer.</p>
              </div>
            );
          })()}

          {order.deliveryAddress && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Delivery Address</h4>
              <p className="text-sm text-muted-foreground">
                {[order.deliveryAddress.line1, order.deliveryAddress.line2, order.deliveryAddress.city, order.deliveryAddress.postcode]
                  .filter(Boolean).join(", ")}
              </p>
            </div>
          )}
          {order.deliveryAddressConflict && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              <span className="font-semibold">Multiple delivery addresses:</span> this order must be split before DPD dispatch.
            </div>
          )}
        </div>
      )}

      <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5" />
              Dispatch {order.orderNumber}
            </DialogTitle>
            <DialogDescription>
              Confirm the parcel details below, then press Dispatch.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
              willBookDpd ? "border-blue-200 bg-blue-50" : "border-border bg-muted/30"
            }`}>
              <Truck className={`w-5 h-5 flex-shrink-0 ${willBookDpd ? "text-blue-600" : "text-muted-foreground"}`} />
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Delivery method</p>
                <p className="font-semibold text-sm mt-0.5">{deliveryMethodLabel}</p>
              </div>
              {willBookDpd ? (
                <span className="ml-auto text-xs font-medium text-blue-700 bg-blue-100 border border-blue-200 rounded-full px-2.5 py-0.5">
                  Auto-booked via DPD API
                </span>
              ) : isDpdShipping && (
                <span className="ml-auto text-xs font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-0.5">
                  DPD booking skipped
                </span>
              )}
            </div>

            {isDpdShipping && !serviceOnly && (
              <label className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-4 py-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-border"
                  checked={bypassDpd}
                  onChange={(e) => setBypassDpd(e.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium">Bypass DPD booking</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Dispatch without booking a courier automatically — use this if you're booking DPD manually or shipping another way.
                  </span>
                </span>
              </label>
            )}

            {order.deliveryAddress && (
              <div className="rounded-lg bg-muted/40 border border-border px-4 py-3 text-sm">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Delivering to</p>
                <p className="font-medium">{order.customerName}</p>
                <p className="text-muted-foreground text-xs">
                  {[order.deliveryAddress.line1, order.deliveryAddress.line2, order.deliveryAddress.city, order.deliveryAddress.postcode]
                    .filter(Boolean).join(", ")}
                </p>
              </div>
            )}

            {order.deliveryAddressConflict && willBookDpd && (
              <div className="flex items-start gap-2 text-xs text-red-800 bg-red-50 border border-red-300 rounded-lg px-3 py-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span><strong>DPD booking blocked.</strong> The ready items resolve to different delivery addresses. Split them into separate orders before dispatching.</span>
              </div>
            )}

            {!order.deliveryAddress && willBookDpd && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                No complete delivery address could be resolved — DPD booking will be blocked.
              </p>
            )}

            {willBookDpd && (
              <div className="space-y-1.5">
                <Label>Package type</Label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { value: "parcel", label: "📦 Box / Parcel", desc: "DPD Parcel service" },
                    { value: "bag",    label: "🛍 Bag",          desc: "DPD Expresspak 5 Next Day" },
                  ] as const).map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPackageType(opt.value)}
                      className={`flex flex-col items-start px-3 py-2.5 rounded-lg border text-left transition-colors ${
                        packageType === opt.value
                          ? "border-[#1e3a5f] bg-[#1e3a5f]/5 ring-1 ring-[#1e3a5f]"
                          : "border-border bg-card hover:bg-muted/50"
                      }`}
                    >
                      <span className="text-sm font-semibold">{opt.label}</span>
                      <span className="text-xs text-muted-foreground">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className={`grid gap-3 ${willBookDpd ? "grid-cols-2" : "grid-cols-1"}`}>
              <div className="space-y-1.5">
                <Label htmlFor="parcels">{packageType === "bag" ? "Number of bags" : "Number of boxes"}</Label>
                <Input
                  id="parcels"
                  type="number"
                  min={1}
                  step={1}
                  value={numberOfParcels}
                  onChange={(e) => setNumberOfParcels(Math.max(1, parseInt(e.target.value) || 1))}
                />
              </div>
              {willBookDpd && (
                <div className="space-y-1.5">
                  <Label htmlFor="weight">Total weight (kg)</Label>
                  <Input
                    id="weight"
                    type="number"
                    min={0.1}
                    step={0.1}
                    placeholder="e.g. 2.5"
                    value={totalWeightKg}
                    onChange={(e) => setTotalWeightKg(e.target.value === "" ? "" : parseFloat(e.target.value))}
                  />
                </div>
              )}
            </div>

            {(() => {
              const notReady = order.items.filter(
                i => !i.dispatchedAt && !isItemReady(i)
              );
              if (notReady.length === 0) return null;
              return (
                <div className="rounded-lg bg-amber-50 border border-amber-300 px-4 py-3 text-sm text-amber-900 space-y-1.5">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {notReady.length} item line{notReady.length !== 1 ? "s" : ""} not yet in stock
                  </p>
                  <ul className="text-xs space-y-0.5 pl-5 list-disc text-amber-800">
                    {notReady.map(i => {
                      const parts = [i.colour, i.size].filter(Boolean).join(" / ");
                      return (
                        <li key={i.id}>
                          {i.productName}{parts ? ` (${parts})` : ""} ×{i.quantity}
                          {i.wearerName ? <span className="text-amber-700"> — {i.wearerName}</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-xs text-amber-800">
                    Dispatching now will send the ready items only. The items above will follow as a separate shipment once they arrive.
                    <strong> Cancel and wait</strong> if you want to dispatch the order complete.
                  </p>
                </div>
              );
            })()}

            <div className="rounded-lg bg-muted/20 border border-border px-4 py-3 text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground text-xs uppercase tracking-wide mb-1.5">What happens when you confirm</p>
              <p>✓ Delivery note opened for printing</p>
              {willBookDpd && <p>✓ DPD booking created automatically — tracking number assigned</p>}
              {willBookDpd && <p>✓ DPD shipping label printed (select your label printer)</p>}
              {isDpdShipping && !willBookDpd && <p>✓ DPD booking skipped — no tracking number assigned</p>}
              {namedCount > 0 && willBookDpd && <p>✓ Wearer labels printed with tracking number (delivery label first)</p>}
              {namedCount > 0 && !willBookDpd && <p>✓ Wearer labels available to print (delivery label first)</p>}
              <p>✓ {serviceOnly ? "Service order released to Invoicing" : "Order marked as dispatched"}</p>
              <p>✓ Portal customers notified automatically if applicable</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDispatchOpen(false)}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white gap-2"
              onClick={() => dispatchMutation.mutate()}
              disabled={dispatchMutation.isPending || (willBookDpd && (totalWeightKg === "" || order.deliveryAddressConflict || !order.deliveryAddress))}
            >
              <Send className="w-4 h-4" />
              {dispatchMutation.isPending
                ? (willBookDpd ? "Booking DPD…" : serviceOnly ? "Producing delivery note…" : "Dispatching…")
                : serviceOnly ? "Produce Delivery Note" : "Confirm Dispatch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Dispatched history row ─────────────────────────────────────────────────────
function ShippedRow({ order }: { order: ShippedOrder }) {
  const [expanded, setExpanded] = useState(false);

  const tracking = order.trackingNumber || order.dpdConsignmentId;
  const isDpd = !!order.dpdConsignmentId;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-bold text-sm">{order.orderNumber}</span>
              <span className="text-muted-foreground font-medium text-sm">{order.customerName}</span>
              {order.status === "delivered" ? (
                <Badge className="text-xs bg-green-100 text-green-800 border-green-300 gap-1">
                  <CheckCircle className="w-3 h-3" /> Delivered
                </Badge>
              ) : (
                <Badge className="text-xs bg-blue-100 text-blue-800 border-blue-300 gap-1">
                  <Truck className="w-3 h-3" /> Shipped
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4 mt-0.5 text-xs text-muted-foreground flex-wrap">
              <span>Dispatched {order.dispatchedAt ? formatDate(order.dispatchedAt) : "—"}</span>
              <span>{shippingLabel(order.shippingMethod)}</span>
              {tracking && (
                <span className="flex items-center gap-1 font-mono">
                  {tracking}
                  {isDpd && (
                    <a
                      href={`https://track.dpd.co.uk/search?reference=${order.dpdConsignmentId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-blue-600 hover:text-blue-800 ml-0.5"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </span>
              )}
              <span>{order.items.length} item lines</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => openDeliveryNote(order.id, order.shippingMethod)}>
            <FileText className="w-3 h-3" /> Delivery Note
          </Button>
          <ZebraLabels orderId={order.id} orderNumber={order.orderNumber} hasNamedRecipients={order.items.some((i) => i.recipientType === "person" && (i.recipientName || i.recipientEmployeeId))} />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {order.deliveryAddress && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Delivered to</h4>
                {order.attentionOf && <p className="font-medium">{order.attentionOf}</p>}
                <p className="text-muted-foreground text-xs">
                  {[order.deliveryAddress.line1, order.deliveryAddress.line2, order.deliveryAddress.city, order.deliveryAddress.postcode]
                    .filter(Boolean).join(", ")}
                </p>
              </div>
            )}
            {tracking && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Tracking</h4>
                <p className="font-mono text-sm flex items-center gap-1.5">
                  {tracking}
                  {isDpd && (
                    <a
                      href={`https://track.dpd.co.uk/search?reference=${order.dpdConsignmentId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </p>
              </div>
            )}
          </div>

          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Items</h4>
            <div className="space-y-1">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 text-sm">
                  <Package className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{item.productName}</span>
                    {item.productSku && (
                      <span className="font-mono text-xs text-indigo-500 ml-1.5">{item.productSku}</span>
                    )}
                    {(item.colour || item.size) && (
                      <span className="text-muted-foreground ml-2">{[item.colour, item.size].filter(Boolean).join(" / ")}</span>
                    )}
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {item.recipientType === "person" && (item.recipientName || item.employee)
                      ? [item.employee?.firstName, item.employee?.lastName, item.recipientName].filter(Boolean).join(" ")
                      : "Stock"}
                  </span>
                  <Badge variant="secondary" className="text-xs">×{item.quantity}</Badge>
                </div>
              ))}
            </div>
          </div>

          {(() => {
            const recipientMap = new Map<string, number>();
            for (const item of order.items) {
              if (item.recipientType === "person" && (item.recipientName || item.employee)) {
                const name = recipientFullName(item);
                recipientMap.set(name, (recipientMap.get(name) ?? 0) + item.quantity);
              }
            }
            const recipients = Array.from(recipientMap.entries()).sort(([a], [b]) => a.localeCompare(b));
            if (recipients.length === 0) return null;
            return (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Named Recipients</h4>
                <div className="space-y-1">
                  {recipients.map(([name, qty]) => (
                    <div key={name} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 text-sm">
                      <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="font-medium truncate flex-1">{name}</span>
                      <span className="text-muted-foreground text-xs">{qty} item{qty !== 1 ? "s" : ""}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">Use the <strong>Labels</strong> button above to reprint wearer labels.</p>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ── History tab with filters ───────────────────────────────────────────────────
function DispatchedHistory() {
  const [customerFilter, setCustomerFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [debouncedCustomer, setDebouncedCustomer] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedCustomer(customerFilter), 350);
    return () => clearTimeout(t);
  }, [customerFilter]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchFilter), 350);
    return () => clearTimeout(t);
  }, [searchFilter]);

  const params = new URLSearchParams();
  if (debouncedCustomer) params.set("customer", debouncedCustomer);
  if (debouncedSearch) params.set("search", debouncedSearch);

  const { data: orders = [], isLoading, refetch } = useQuery<ShippedOrder[]>({
    queryKey: ["dispatch-shipped", debouncedCustomer, debouncedSearch],
    queryFn: () => apiFetch(`/dispatch/shipped?${params}`),
  });

  const hasFilter = !!debouncedCustomer || !!debouncedSearch;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex gap-3 flex-wrap items-end">
        <div className="flex-1 min-w-48 space-y-1">
          <Label htmlFor="filter-customer" className="text-xs">Customer</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              id="filter-customer"
              placeholder="e.g. Uneek Clothing"
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
            {customerFilter && (
              <button onClick={() => setCustomerFilter("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 min-w-48 space-y-1">
          <Label htmlFor="filter-search" className="text-xs">Order / despatch / tracking number</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              id="filter-search"
              placeholder="e.g. ORD-001 or 15012345678901"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
            {searchFilter && (
              <button onClick={() => setSearchFilter("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <RefreshCw className="w-5 h-5 animate-spin" /> Loading history...
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <History className="w-10 h-10 text-muted-foreground/40" />
          <p className="font-medium">{hasFilter ? "No dispatched orders match your filters" : "No dispatched orders yet"}</p>
          {hasFilter && (
            <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => { setCustomerFilter(""); setSearchFilter(""); }}>
              <X className="w-3 h-3" /> Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{orders.length} order{orders.length !== 1 ? "s" : ""} found (most recent first)</p>
          {orders.map((order) => (
            <ShippedRow key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Bulk Labels Dialog ─────────────────────────────────────────────────────────
function BulkLabelsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [customerInput, setCustomerInput] = useState("");
  const [orderInput, setOrderInput] = useState("");
  const { toast } = useToast();

  function handleOpen() {
    const orderNum = orderInput.trim();
    const customer = customerInput.trim();
    if (!orderNum && !customer) {
      toast({ title: "Enter a value", description: "Type a customer name or order number.", variant: "destructive" });
      return;
    }
    const params = new URLSearchParams();
    if (orderNum) params.set("orderNumber", orderNum);
    else params.set("customer", customer);
    window.open(`/api/wearer-labels/bulk?${params}`, "_blank");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Tag className="w-4 h-4" /> Bulk Wearer Labels</DialogTitle>
          <DialogDescription>
            Print all wearer labels for a customer or a single order in one go.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-customer" className="text-sm font-medium">Customer name</Label>
            <Input
              id="bulk-customer"
              placeholder="e.g. Fast Lane Club"
              value={customerInput}
              onChange={(e) => setCustomerInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleOpen()}
            />
            <p className="text-xs text-muted-foreground">Partial match across all confirmed &amp; dispatched orders.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="flex-1 border-t border-border" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-order" className="text-sm font-medium">Order number</Label>
            <Input
              id="bulk-order"
              placeholder="e.g. ORD-042"
              value={orderInput}
              onChange={(e) => setOrderInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleOpen()}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleOpen} className="gap-1.5"><Printer className="w-3.5 h-3.5" /> Open Labels</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function Dispatch() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"queue" | "history">("queue");
  const [bulkLabelsOpen, setBulkLabelsOpen] = useState(false);
  const [queueFilter, setQueueFilter] = useState<"all" | "ready" | "pending" | "urgent">("all");
  const [searchQuery, setSearchQuery] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("search") ?? "";
  });

  const { data: orders = [], isLoading, refetch } = useQuery<DispatchOrder[]>({
    queryKey: ["dispatch-orders"],
    queryFn: () => apiFetch("/dispatch/orders"),
    refetchInterval: 15_000,
  });
  const { data: managerGroups = [], refetch: refetchManagerGroups } = useQuery<ManagerPackingGroup[]>({
    queryKey: ["manager-packing-groups"],
    queryFn: () => apiFetch("/dispatch/manager-groups"),
    refetchInterval: 15_000,
  });

  const readyCount = orders.filter((o) => o.productionComplete).length;
  const pendingCount = orders.filter((o) => !o.productionComplete).length;
  const urgentCount = orders.filter((o) => !o.productionComplete && (isToday(o.requiredDate) || isPast(o.requiredDate))).length;

  const q = searchQuery.trim().toLowerCase();
  const filteredOrders = orders.filter((o) => {
    if (queueFilter === "ready" && !o.productionComplete) return false;
    if (queueFilter === "pending" && o.productionComplete) return false;
    if (queueFilter === "urgent" && !((!o.productionComplete) && (isToday(o.requiredDate) || isPast(o.requiredDate)))) return false;
    if (q) {
      return (
        o.orderNumber.toLowerCase().includes(q) ||
        (o.customerName ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <Layout>
      <div className="space-y-6">
        <BulkLabelsDialog open={bulkLabelsOpen} onClose={() => setBulkLabelsOpen(false)} />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Truck className="w-7 h-7 text-primary" /> Dispatch
            </h1>
            <p className="text-muted-foreground mt-1">Post-production packing, labelling, and dispatch.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setBulkLabelsOpen(true)}>
              <Tag className="w-3.5 h-3.5" /> Bulk Labels
            </Button>
            {tab === "queue" && (
              <Button variant="ghost" size="icon" onClick={() => refetch()}><RefreshCw className="w-4 h-4" /></Button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setTab("queue")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              tab === "queue"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Truck className="w-4 h-4" />
            Dispatch Queue
            {orders.length > 0 && (
              <span className="ml-1 text-xs bg-muted text-muted-foreground rounded-full px-1.5 py-0.5">
                {orders.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("history")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              tab === "history"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <History className="w-4 h-4" />
            Dispatched
          </button>
        </div>

        {tab === "queue" && (
          <>
            {managerGroups.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2"><h2 className="text-lg font-semibold">Manager-grouped customer deliveries</h2><Badge className="bg-indigo-100 text-indigo-800 border-indigo-200">{managerGroups.length} group{managerGroups.length === 1 ? "" : "s"}</Badge></div>
                <p className="text-sm text-muted-foreground">For customers who have enabled this option, pack each supervisor’s team separately. Print the packing sheet and one external label per package before confirming dispatch. Items without an assigned supervisor cannot be dispatched.</p>
                {managerGroups.map(group => <ManagerPackingCard key={`${group.customerId}-${group.managerId ?? "unassigned"}`} group={group} onDone={() => { refetchManagerGroups(); refetch(); }} />)}
              </section>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by customer or order number…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-9"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {orders.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={() => setQueueFilter(f => f === "ready" ? "all" : "ready")}
                  className={`rounded-lg border px-4 py-3 text-center transition-all cursor-pointer ${queueFilter === "ready" ? "border-green-500 bg-green-50 ring-1 ring-green-500" : "border-border bg-card hover:border-green-300 hover:bg-green-50/40"}`}
                >
                  <div className="text-2xl font-bold text-green-600">{readyCount}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Ready to dispatch</div>
                </button>
                <button
                  onClick={() => setQueueFilter(f => f === "pending" ? "all" : "pending")}
                  className={`rounded-lg border px-4 py-3 text-center transition-all cursor-pointer ${queueFilter === "pending" ? "border-amber-500 bg-amber-50 ring-1 ring-amber-500" : "border-border bg-card hover:border-amber-300 hover:bg-amber-50/40"}`}
                >
                  <div className="text-2xl font-bold text-amber-600">{pendingCount}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Awaiting production</div>
                </button>
                <button
                  onClick={() => setQueueFilter(f => f === "urgent" ? "all" : "urgent")}
                  className={`rounded-lg border px-4 py-3 text-center transition-all cursor-pointer ${queueFilter === "urgent" ? "border-red-500 bg-red-50 ring-1 ring-red-500" : "border-border bg-card hover:border-red-300 hover:bg-red-50/40"}`}
                >
                  <div className={`text-2xl font-bold ${urgentCount > 0 ? "text-red-600" : "text-muted-foreground"}`}>{urgentCount}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Urgent / overdue</div>
                </button>
              </div>
            )}

            {isLoading ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
                <RefreshCw className="w-5 h-5 animate-spin" /> Loading dispatch queue...
              </div>
            ) : orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                <CheckCircle className="w-12 h-12 text-green-400" />
                <p className="text-lg font-medium">Nothing to dispatch</p>
                <p className="text-sm">Orders will appear here once production is complete or when plain (undecorated) items are ready to ship.</p>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <p className="text-sm">No orders match{q ? ` "${searchQuery}"` : " this filter"}.</p>
                <button className="text-xs text-primary underline" onClick={() => { setQueueFilter("all"); setSearchQuery(""); }}>Clear filters</button>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredOrders.map((order) => (
                  <DispatchCard key={order.id} order={order} onDispatched={() => {}} />
                ))}
              </div>
            )}
          </>
        )}

        {tab === "history" && <DispatchedHistory />}
      </div>
    </Layout>
  );
}
