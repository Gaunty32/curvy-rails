import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  FileText, Mail, BookOpen, Loader2, ExternalLink, CheckCircle2,
  Truck, Clock, AlertTriangle, Package, Hash, ChevronDown, ChevronRight,
  Eye, MessageSquare, BadgeCheck, CircleDashed, CalendarClock, X, Zap, Search, RefreshCw, Layers, Pencil,
} from "lucide-react";

const API_BASE = "/api";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface InvoiceOrder {
  id: number;
  orderNumber: string;
  customerName: string | null;
  customerId: number | null;
  totalAmount: string;
  carriageAmount?: string | null;
  status: string;
  orderDate: string | null;
  dispatchedAt: string | null;
  invoiceDate: string | null;
  trackingNumber: string | null;
  shippingMethod: string | null;
  paidAt: string | null;
  invoiceEmailSentAt: string | null;
  invoiceEmailSentTo: string | null;
  xeroInvoiceId: string | null;
  xeroInvoiceStatus: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  invoiceScheduledSendAt: string | null;
  invoiceScheduleToEmail: string | null;
  customerHighLevelContactId: string | null;
  poNumber?: string | null;
  poNumberRequired?: boolean | null;
  deliveryAddressId?: number | null;
  zeroVat?: boolean | null;
}

function toWhatsAppNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("44")) return digits;
  if (digits.startsWith("0")) return `44${digits.slice(1)}`;
  return `44${digits}`;
}

interface InvoicesData {
  toSend: InvoiceOrder[];
  toPost: InvoiceOrder[];
  done: InvoiceOrder[];
}

interface PoGroupOrder {
  id: number;
  orderNumber: string;
  customerName: string | null;
  customerId: number | null;
  totalAmount: string;
  status: string;
  poNumber: string | null;
  orderDate: string | null;
  dispatchedAt: string | null;
  invoiceEmailSentAt: string | null;
  xeroInvoiceId: string | null;
  zeroVat?: boolean | null;
}

interface PoGroup {
  poNumber: string;
  customerName: string | null;
  customerId: number | null;
  zeroVat?: boolean | null;
  orders: PoGroupOrder[];
  totalEx: number;
  totalInc: number;
}

interface CustomerGroup {
  customerId: number | null;
  customerName: string | null;
  zeroVat?: boolean | null;
  orders: PoGroupOrder[];
  totalEx: number;
  totalInc: number;
}

interface EmailStatus {
  configured: boolean;
  host: string | null;
  fromEmail: string | null;
}

function parseApiError(e: Error): string {
  try {
    const obj = JSON.parse(e.message);
    return obj.error ?? e.message;
  } catch {
    return e.message;
  }
}

/**
 * If a Xero error message contains a period/year lock date, returns the
 * next available date (lock date + 1 day) as "YYYY-MM-DD". Otherwise null.
 */
function parseLockDate(errorMsg: string): string | null {
  // Matches "currently set at 30-Jun-2026" (the latest lock date in the message)
  const months: Record<string, number> = {
    jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
  };
  const re = /currently set at (\d{1,2})-([A-Za-z]{3})-(\d{4})/g;
  let latest: Date | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(errorMsg)) !== null) {
    const day = parseInt(m[1], 10);
    const mon = months[m[2].toLowerCase()];
    const year = parseInt(m[3], 10);
    if (mon === undefined) continue;
    const d = new Date(year, mon, day);
    if (!latest || d > latest) latest = d;
  }
  if (!latest) return null;
  // Next available date = lock date + 1 day
  latest.setDate(latest.getDate() + 1);
  return latest.toISOString().slice(0, 10);
}

function DPDLink({ tracking }: { tracking: string }) {
  return (
    <a
      href={`https://track.dpd.co.uk/parcels/${tracking}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs font-mono"
    >
      {tracking} <ExternalLink className="w-3 h-3" />
    </a>
  );
}

function TrackingCell({ order, onSaved }: { order: InvoiceOrder; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(order.trackingNumber ?? "");
  const { toast } = useToast();
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: (tn: string | null) =>
      apiFetch(`/invoices/${order.id}/tracking`, { method: "PATCH", body: JSON.stringify({ trackingNumber: tn || null }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setEditing(false);
      onSaved();
    },
    onError: (e: Error) => toast({ title: "Error", description: parseApiError(e), variant: "destructive" }),
  });

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 15006678987456"
          className="h-7 text-xs w-40 font-mono"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") save.mutate(value);
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <Button size="sm" className="h-7 px-2 text-xs" onClick={() => save.mutate(value)} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    );
  }

  return order.trackingNumber ? (
    <div className="flex items-center gap-2">
      <DPDLink tracking={order.trackingNumber} />
      <button onClick={() => { setValue(order.trackingNumber ?? ""); setEditing(true); }} className="text-muted-foreground hover:text-foreground text-xs underline">edit</button>
    </div>
  ) : (
    <button onClick={() => setEditing(true)} className="text-xs text-muted-foreground hover:text-foreground underline flex items-center gap-1">
      <Truck className="w-3 h-3" /> Add tracking
    </button>
  );
}

function isCrossMonth(d1: string | null, d2: string | null): boolean {
  if (!d1 || !d2) return false;
  const a = new Date(d1), b = new Date(d2);
  return a.getMonth() !== b.getMonth() || a.getFullYear() !== b.getFullYear();
}

function toDateInput(iso: string | null): string {
  if (!iso) return new Date().toISOString().slice(0, 10);
  return new Date(iso).toISOString().slice(0, 10);
}

function OrderRow({
  order,
  showSendEmail,
  showPostXero,
  showResend,
  selected,
  onToggle,
}: {
  order: InvoiceOrder;
  showSendEmail?: boolean;
  showPostXero?: boolean;
  showResend?: boolean;
  selected?: boolean;
  onToggle?: (id: number) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [invoiceDateEdit, setInvoiceDateEdit] = useState(toDateInput(order.invoiceDate));
  const crossMonth = isCrossMonth(order.orderDate, order.invoiceDate);
  const [isPaid, setIsPaid] = useState(!!order.paidAt);
  const [loadingEmailPreview, setLoadingEmailPreview] = useState(false);
  const [invoiceEmailTo, setInvoiceEmailTo] = useState("");

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];
  const [scheduledDate, setScheduledDate] = useState(
    order.invoiceScheduledSendAt
      ? new Date(order.invoiceScheduledSendAt).toISOString().split("T")[0]
      : ""
  );
  const [scheduleEmailTo, setScheduleEmailTo] = useState(order.invoiceScheduleToEmail ?? "");

  const [lockDateDialog, setLockDateDialog] = useState<{ suggestedDate: string; errorMsg: string } | null>(null);
  const [lockDateInput, setLockDateInput] = useState("");

  const [editingCarriage, setEditingCarriage] = useState(false);
  const [carriageInput, setCarriageInput] = useState("");

  const saveCarriage = useMutation({
    mutationFn: (val: string) => {
      const v = parseFloat(val);
      if (isNaN(v) || v < 0) throw new Error("Invalid amount");
      return apiFetch(`/orders/${order.id}`, { method: "PATCH", body: JSON.stringify({ carriageAmount: v }) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["invoices"] }); setEditingCarriage(false); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const isCollection = ["office_collection", "warehouse_collection"].includes(order.shippingMethod ?? "");
  const isLocalDelivery = ["free_local", "local_delivery"].includes(order.shippingMethod ?? "");
  const poMissing = !!(order.poNumberRequired && !order.poNumber);

  const saveInvoiceDate = useMutation({
    mutationFn: (d: string) => apiFetch(`/invoices/${order.id}/invoice-date`, { method: "PATCH", body: JSON.stringify({ invoiceDate: d }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
    onError: (e: Error) => toast({ title: "Error", description: parseApiError(e), variant: "destructive" }),
  });

  const togglePaid = useMutation({
    mutationFn: (paid: boolean) => apiFetch(`/invoices/${order.id}/paid`, { method: "PATCH", body: JSON.stringify({ paid }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
    onError: (e: Error) => {
      setIsPaid(!isPaid);
      toast({ title: "Error", description: parseApiError(e), variant: "destructive" });
    },
  });

  const sendEmail = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; sentTo: string; xeroInvoiceId?: string }>(`/invoices/${order.id}/send-email`, { method: "POST", body: JSON.stringify(invoiceEmailTo.trim() ? { toEmail: invoiceEmailTo.trim() } : {}) }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setConfirmOpen(false);
      const xeroMsg = res.xeroInvoiceId ? " Also posted to Xero." : "";
      toast({ title: "Invoice sent", description: `Emailed to ${res.sentTo}.${xeroMsg}` });
    },
    onError: (e: Error) => toast({ title: "Failed to send", description: parseApiError(e), variant: "destructive" }),
  });

  const sendHighLevel = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; contactId: string; orderNumber: string }>(`/invoices/${order.id}/send-highlevel`, { method: "POST" }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setConfirmOpen(false);
      toast({ title: "Sent via High Level", description: `Workflow triggered for ${res.orderNumber}.` });
    },
    onError: (e: Error) => toast({ title: "High Level error", description: parseApiError(e), variant: "destructive" }),
  });

  const markSent = useMutation({
    mutationFn: () => apiFetch(`/invoices/${order.id}/mark-sent`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Moved to Xero queue", description: "Invoice marked as sent — no email was sent to the customer." });
    },
    onError: (e: Error) => toast({ title: "Error", description: parseApiError(e), variant: "destructive" }),
  });

  const scheduleSend = useMutation({
    mutationFn: (scheduledSendAt: string | null) =>
      apiFetch(`/invoices/${order.id}/schedule`, { method: "PATCH", body: JSON.stringify({ scheduledSendAt, toEmail: scheduleEmailTo.trim() || undefined }) }),
    onSuccess: (_data, scheduledSendAt) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setConfirmOpen(false);
      if (scheduledSendAt) {
        const d = new Date(scheduledSendAt).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
        toast({ title: "Invoice scheduled", description: `Will be sent automatically on ${d}.` });
      } else {
        toast({ title: "Schedule cancelled" });
      }
    },
    onError: (e: Error) => toast({ title: "Error", description: parseApiError(e), variant: "destructive" }),
  });

  const postXero = useMutation({
    mutationFn: () => apiFetch<{ xeroInvoiceId: string; invoiceNumber: string; allocatedAmount: number; clearedByCredit: boolean }>(`/invoices/${order.id}/post-xero`, { method: "POST" }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      const base = `Invoice ${res.invoiceNumber} posted to Xero.`;
      const extra = res.clearedByCredit
        ? ` £${res.allocatedAmount.toFixed(2)} credit allocated — invoice cleared.`
        : res.allocatedAmount > 0
        ? ` £${res.allocatedAmount.toFixed(2)} credit allocated against invoice.`
        : "";
      toast({ title: "Posted to Xero", description: base + extra });
    },
    onError: (e: Error) => {
      const msg = parseApiError(e);
      const nextDate = parseLockDate(msg);
      if (nextDate) {
        setLockDateInput(nextDate);
        setLockDateDialog({ suggestedDate: nextDate, errorMsg: msg });
      } else {
        toast({ title: "Xero error", description: msg, variant: "destructive" });
      }
    },
  });

  const refreshStripeLink = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; url?: string; amountPence?: number; skipped?: string }>(`/invoices/${order.id}/refresh-stripe-link`, { method: "POST" }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      const amount = res.amountPence ? `£${(res.amountPence / 100).toFixed(2)}` : "";
      toast({ title: "Stripe link updated", description: `New payment link created${amount ? ` for ${amount} inc. VAT` : ""}.` });
    },
    onError: (e: Error) => toast({ title: "Failed to refresh Stripe link", description: parseApiError(e), variant: "destructive" }),
  });

  const handlePreviewPdf = () => {
    window.open(`/api/invoices/${order.id}/preview-pdf`, "_blank");
  };

  const handlePreviewEmail = async () => {
    setLoadingEmailPreview(true);
    try {
      const data = await apiFetch<{ subject: string; html: string }>(`/invoices/${order.id}/preview-email`);
      const blob = new Blob([data.html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      toast({ title: "Preview failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoadingEmailPreview(false);
    }
  };

  const handleWhatsApp = () => {
    if (!order.customerPhone) return;
    const waNum = toWhatsAppNumber(order.customerPhone);
    const firstName = order.customerName?.split(" ")[0] ?? "there";
    const msg = `Hi ${firstName}, your order ${order.orderNumber} is ready for collection. Please bring a copy of this invoice or quote your order reference: ${order.orderNumber}.`;
    window.open(`https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const subtotal = parseFloat(order.totalAmount);
  const carriage = parseFloat(String(order.carriageAmount ?? 0));
  const vatMultiplier = order.zeroVat ? 1 : 1.2;
  const total = (subtotal + carriage) * vatMultiplier;

  return (
    <>
      <TableRow className={selected ? "bg-blue-50/60" : undefined}>
        {onToggle && (
          <TableCell className="w-8 pl-3 pr-0" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={!!selected}
              onChange={() => onToggle(order.id)}
              className="h-4 w-4 rounded border-gray-300 text-primary accent-primary cursor-pointer"
            />
          </TableCell>
        )}
        <TableCell>
          <div className="flex flex-col gap-0.5">
            <Link href={`/orders/${order.id}`} className="font-medium text-primary hover:underline">
              {order.orderNumber}
            </Link>
            {order.poNumber && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-700 font-mono bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 w-fit">
                <Hash className="w-3 h-3" />{order.poNumber}
              </span>
            )}
            {poMissing && (
              <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 w-fit">
                <AlertTriangle className="w-3 h-3" />PO required
              </span>
            )}
          </div>
        </TableCell>
        <TableCell className="text-sm">{order.customerName ?? "—"}</TableCell>
        <TableCell className="text-sm text-right font-medium">
          <div>{formatCurrency(total)}</div>
          <div className="text-xs text-muted-foreground">ex VAT {formatCurrency(subtotal)}</div>
          {editingCarriage ? (
            <div className="flex items-center justify-end gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
              <span className="text-xs text-muted-foreground">£</span>
              <Input
                value={carriageInput}
                onChange={(e) => setCarriageInput(e.target.value)}
                className="h-6 w-16 text-xs text-right px-1 py-0"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveCarriage.mutate(carriageInput);
                  if (e.key === "Escape") setEditingCarriage(false);
                }}
              />
              <Button size="sm" className="h-6 px-1.5 text-xs" onClick={() => saveCarriage.mutate(carriageInput)} disabled={saveCarriage.isPending}>
                {saveCarriage.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "✓"}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => setEditingCarriage(false)}>
                <X className="w-3 h-3" />
              </Button>
            </div>
          ) : (
            <button
              className="flex items-center justify-end gap-1 mt-1 w-full text-xs text-muted-foreground hover:text-foreground group"
              onClick={() => { setCarriageInput(carriage.toFixed(2)); setEditingCarriage(true); }}
              title="Edit carriage charge"
            >
              <Truck className="w-3 h-3 shrink-0" />
              <span>{carriage > 0 ? formatCurrency(carriage) : <span className="italic opacity-60">no carriage</span>}</span>
              <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
            </button>
          )}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {order.dispatchedAt ? formatDate(order.dispatchedAt) : "—"}
        </TableCell>
        <TableCell>
          <TrackingCell order={order} onSaved={() => {}} />
        </TableCell>
        <TableCell>
          {order.invoiceEmailSentAt ? (
            <div className="text-xs">
              <div className="flex items-center gap-1 text-green-700 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" /> Sent
              </div>
              <div className="text-muted-foreground">{order.invoiceEmailSentTo}</div>
              <div className="text-muted-foreground">{formatDate(order.invoiceEmailSentAt)}</div>
            </div>
          ) : order.invoiceScheduledSendAt ? (
            <div className="text-xs space-y-0.5">
              <div className="flex items-center gap-1 text-amber-700 font-medium">
                <CalendarClock className="w-3.5 h-3.5" /> Scheduled
              </div>
              <div className="text-muted-foreground">{formatDate(order.invoiceScheduledSendAt)}</div>
              <button
                className="flex items-center gap-0.5 text-red-600 hover:text-red-800 hover:underline text-xs mt-0.5"
                onClick={() => scheduleSend.mutate(null)}
                disabled={scheduleSend.isPending}
              >
                <X className="w-3 h-3" /> Cancel
              </button>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" /> Not sent
            </span>
          )}
        </TableCell>
        <TableCell>
          {order.xeroInvoiceId ? (
            <Badge className="bg-indigo-100 text-indigo-800 border-indigo-300 text-xs gap-1">
              <BookOpen className="w-3 h-3" /> {order.xeroInvoiceStatus ?? "DRAFT"}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell>
          <div className="flex flex-col items-start gap-1.5">
            {showSendEmail && (
              <>
                <Button
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => setConfirmOpen(true)}
                  disabled={sendEmail.isPending || poMissing}
                  title={poMissing ? "Add a PO number to this order before sending the invoice" : undefined}
                >
                  {sendEmail.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                  Send Invoice
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => markSent.mutate()}
                  disabled={markSent.isPending}
                  title="Move to Xero queue without emailing the customer"
                >
                  {markSent.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookOpen className="w-3 h-3" />}
                  Skip email
                </Button>
                {poMissing && (
                  <span className="text-xs text-red-600 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />Add PO number first
                  </span>
                )}
              </>
            )}
            {showResend && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                onClick={() => setConfirmOpen(true)}
                disabled={sendEmail.isPending}
              >
                {sendEmail.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Resend
              </Button>
            )}
            {showPostXero && total <= 0 && (
              <span className="text-xs text-amber-600 flex items-center gap-1" title="This is a £0.00 invoice — it will be posted to Xero as a draft">
                <AlertTriangle className="w-3 h-3" />£0 — posts as draft
              </span>
            )}
            {showPostXero && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                onClick={() => postXero.mutate()}
                disabled={postXero.isPending}
              >
                {postXero.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookOpen className="w-3 h-3" />}
                {order.xeroInvoiceId ? "Re-post to Xero" : "Post to Xero"}
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>

      {/* Send invoice dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{showResend ? "Resend Invoice" : "Send Invoice"} — {order.orderNumber}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              {showResend
                ? "This will resend the invoice PDF to the customer. Xero will also be updated if not already posted."
                : "This will email the invoice PDF to the customer and post it to Xero as a draft invoice."}
            </p>

            {/* Summary card */}
            <div className="rounded-lg bg-muted/50 border border-border p-3 space-y-1.5">
              <div><span className="text-muted-foreground">Customer:</span> <strong>{order.customerName}</strong></div>
              <div><span className="text-muted-foreground">Amount:</span> <strong>{formatCurrency(total)} inc. VAT</strong></div>
              {order.trackingNumber && (
                <div><span className="text-muted-foreground">DPD:</span> <strong className="font-mono text-xs">{order.trackingNumber}</strong></div>
              )}
              {isCollection && (
                <div className="flex items-center gap-1.5 text-green-700 text-xs font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Customer collection order
                </div>
              )}
              {!order.trackingNumber && !isCollection && (
                <div className="flex items-center gap-1.5 text-amber-700 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  No tracking number — add one for a better customer experience
                </div>
              )}
            </div>

            {/* Email override */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Send To <span className="text-muted-foreground font-normal">(optional — overrides customer email on file)</span></label>
              <input
                type="email"
                placeholder={order.customerEmail ?? order.invoiceEmailSentTo ?? "customer@example.com"}
                value={invoiceEmailTo}
                onChange={e => setInvoiceEmailTo(e.target.value)}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-xs text-muted-foreground">Leave blank to use the email address on the customer's account.</p>
            </div>

            {/* Paid toggle */}
            <div className="flex items-center gap-3 rounded-lg border border-border p-3">
              <button
                type="button"
                onClick={() => {
                  const next = !isPaid;
                  setIsPaid(next);
                  togglePaid.mutate(next);
                }}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${isPaid ? "bg-green-600" : "bg-gray-300"}`}
                role="switch"
                aria-checked={isPaid}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${isPaid ? "translate-x-5" : "translate-x-0"}`} />
              </button>
              <div className="flex-1">
                <div className="font-medium text-foreground flex items-center gap-1.5">
                  {isPaid
                    ? <><BadgeCheck className="w-4 h-4 text-green-600" /> Already paid</>
                    : <><CircleDashed className="w-4 h-4 text-muted-foreground" /> Not yet paid</>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isPaid
                    ? "Invoice will include a \u2018Payment Received\u2019 notice \u2014 a VAT invoice for their records."
                    : "Invoice will include payment instructions (BACS + card link if available)."}
                </p>
              </div>
              {togglePaid.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
            </div>

            {/* Invoice date */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Invoice Date</label>
              {crossMonth && (
                <div className="flex items-start gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-2 text-xs text-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>Order placed in a different month — check the invoice date is correct.</span>
                </div>
              )}
              <input
                type="date"
                value={invoiceDateEdit}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onChange={(e) => {
                  setInvoiceDateEdit(e.target.value);
                  if (e.target.value) saveInvoiceDate.mutate(e.target.value);
                }}
              />
              <p className="text-xs text-muted-foreground">This date appears on the invoice and in Xero.</p>
            </div>

            {/* Preview + WhatsApp actions */}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handlePreviewPdf}>
                <Eye className="w-3.5 h-3.5" /> Preview PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={handlePreviewEmail}
                disabled={loadingEmailPreview}
              >
                {loadingEmailPreview
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Eye className="w-3.5 h-3.5" />}
                Preview email
              </Button>
              {!order.paidAt && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs border-violet-200 text-violet-700 hover:bg-violet-50"
                  onClick={() => refreshStripeLink.mutate()}
                  disabled={refreshStripeLink.isPending}
                  title="Regenerate the Stripe payment link with the current order total + shipping"
                >
                  {refreshStripeLink.isPending
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <RefreshCw className="w-3.5 h-3.5" />}
                  Refresh Stripe link
                </Button>
              )}
              {(isCollection || isLocalDelivery) && (order.customerHighLevelContactId || order.customerPhone) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs border-green-200 text-green-700 hover:bg-green-50"
                  onClick={() => order.customerHighLevelContactId ? sendHighLevel.mutate() : handleWhatsApp()}
                  disabled={!!order.customerHighLevelContactId && sendHighLevel.isPending}
                  title={order.customerHighLevelContactId ? "Send via High Level WhatsApp" : "Open WhatsApp"}
                >
                  {order.customerHighLevelContactId && sendHighLevel.isPending
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <MessageSquare className="w-3.5 h-3.5" />}
                  WhatsApp
                </Button>
              )}
            </div>

          </div>

          {/* Schedule for later */}
          <div className="border-t pt-4 space-y-2">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <CalendarClock className="w-3.5 h-3.5 text-muted-foreground" /> Schedule for later
            </p>
            <p className="text-xs text-muted-foreground">Pick a future date — the invoice will be sent automatically at 9am on that day.</p>

            {/* Email for scheduled send */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Send to</label>
              <input
                type="email"
                placeholder={order.customerEmail ?? "No email on file — enter one below"}
                value={scheduleEmailTo}
                onChange={(e) => setScheduleEmailTo(e.target.value)}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {!order.customerEmail && !scheduleEmailTo && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <span>⚠</span> No email on file — the scheduled send will fail unless you enter one above.
                </p>
              )}
              {(order.customerEmail || scheduleEmailTo) && (
                <p className="text-xs text-muted-foreground">
                  {scheduleEmailTo
                    ? `Will send to: ${scheduleEmailTo}`
                    : `Will send to: ${order.customerEmail} (from customer record)`}
                </p>
              )}
            </div>

            <div className="flex gap-2 items-center">
              <input
                type="date"
                value={scheduledDate}
                min={tomorrowStr}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="flex h-8 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs shrink-0"
                disabled={!scheduledDate || scheduleSend.isPending || (!order.customerEmail && !scheduleEmailTo)}
                title={!order.customerEmail && !scheduleEmailTo ? "Enter an email address to schedule" : undefined}
                onClick={() => {
                  // Send the plain date — the backend converts it to 9am UK time,
                  // correctly accounting for GMT/BST.
                  scheduleSend.mutate(scheduledDate);
                }}
              >
                {scheduleSend.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CalendarClock className="w-3 h-3" />}
                Schedule
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={() => sendEmail.mutate()} disabled={sendEmail.isPending} className="gap-2">
              {sendEmail.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" />Sending...</>
                : <><Mail className="w-4 h-4" />Send Now</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Xero period lock date dialog */}
      <Dialog open={!!lockDateDialog} onOpenChange={(open) => { if (!open) setLockDateDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-amber-500" />
              Invoice Date Locked
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Xero rejected this invoice because the date falls within a locked period. Update the invoice date to the next available date and retry.
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold">New Invoice Date</label>
              <input
                type="date"
                value={lockDateInput}
                min={lockDateDialog?.suggestedDate}
                onChange={(e) => setLockDateInput(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                This is the day after Xero's period lock date. Change it if needed.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setLockDateDialog(null)}>
              Cancel
            </Button>
            <Button
              disabled={!lockDateInput || saveInvoiceDate.isPending || postXero.isPending}
              onClick={() => {
                if (!lockDateInput) return;
                saveInvoiceDate.mutate(lockDateInput, {
                  onSuccess: () => {
                    setInvoiceDateEdit(lockDateInput);
                    setLockDateDialog(null);
                    postXero.mutate();
                  },
                });
              }}
            >
              {(saveInvoiceDate.isPending || postXero.isPending)
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Updating…</>
                : <><BookOpen className="w-4 h-4" /> Update & Post to Xero</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ShipmentGroupPanel({ orders, onSent }: { orders: InvoiceOrder[]; onSent: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const goodsTotal = orders.reduce((s, o) => s + parseFloat(o.totalAmount ?? "0"), 0);
  // Consolidated invoices include delivery for every selected address order.
  const singleCarriage = orders.reduce(
    (sum, order) => sum + parseFloat(order.carriageAmount ?? "0"),
    0
  );
  const combinedTotal = goodsTotal + singleCarriage;
  const groupZeroVat = orders[0]?.zeroVat ?? false;
  const groupVatMult = groupZeroVat ? 1 : 1.2;
  const hasPo = orders.some((o) => o.poNumber);
  const posMissing = orders.some((o) => o.poNumberRequired && !o.poNumber);
  const dispatchDate = orders[0].dispatchedAt ? formatDate(orders[0].dispatchedAt) : "—";
  const customerName = orders[0].customerName ?? "Customer";
  const invoiceRef = orders.map((o) => o.orderNumber).join("+");

  const send = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; sentTo: string; invoiceRef: string }>("/invoices/consolidated/send-email", {
        method: "POST",
        body: JSON.stringify({ orderIds: orders.map((o) => o.id) }),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["invoices-by-customer"] });
      setOpen(false);
      onSent();
      toast({ title: "Combined invoice sent", description: `Invoice ${res.invoiceRef} emailed to ${res.sentTo}.` });
    },
    onError: (e: Error) => toast({ title: "Failed to send", description: parseApiError(e), variant: "destructive" }),
  });

  return (
    <>
      <div className="rounded-xl border-2 border-violet-200 bg-violet-50 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
          <Truck className="w-4 h-4 text-violet-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-violet-900">{customerName}</span>
              <span className="inline-flex items-center gap-1 text-xs font-medium bg-violet-100 text-violet-700 border border-violet-300 rounded-full px-2 py-0.5">
                <Package className="w-3 h-3" /> Same-day shipment
              </span>
            </div>
            <div className="text-xs text-violet-700 mt-0.5 font-mono">
              {orders.map((o) => o.orderNumber).join(" + ")}
              <span className="font-sans ml-2 text-violet-600">· dispatched {dispatchDate}</span>
              {singleCarriage > 0 && (
                <span className="font-sans ml-2 text-violet-600">· {formatCurrency(singleCarriage)} shipping (×1)</span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-semibold text-sm text-violet-900">{formatCurrency(combinedTotal * groupVatMult)} inc VAT</div>
            <div className="text-xs text-violet-600">{formatCurrency(combinedTotal)} ex VAT</div>
          </div>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white shrink-0"
            onClick={() => setOpen(true)}
            disabled={posMissing || send.isPending}
            title={posMissing ? "Add PO numbers before sending" : undefined}
          >
            {send.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
            Send Combined Invoice
          </Button>
        </div>
        {posMissing && (
          <div className="px-4 pb-2.5 text-xs text-red-600 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Add PO number{orders.filter((o) => o.poNumberRequired && !o.poNumber).length > 1 ? "s" : ""} before sending
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Combined Invoice — {orders.length} orders</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              These orders were dispatched together on {dispatchDate}. A single invoice PDF will be generated with one shipping charge and emailed to the customer.
            </p>
            <div className="rounded-lg bg-muted/50 border p-3 space-y-1.5">
              <div><span className="text-muted-foreground">Customer:</span> <strong>{customerName}</strong></div>
              <div><span className="text-muted-foreground">Orders:</span> <strong className="font-mono">{invoiceRef}</strong></div>
              {hasPo && (
                <div>
                  <span className="text-muted-foreground">PO refs:</span>{" "}
                  <strong className="font-mono">{[...new Set(orders.map((o) => o.poNumber).filter(Boolean))].join(", ")}</strong>
                </div>
              )}
              <div><span className="text-muted-foreground">Goods total:</span> <strong>{formatCurrency(goodsTotal)} ex VAT</strong></div>
              {singleCarriage > 0 && (
                <div><span className="text-muted-foreground">Shipping (×1):</span> <strong>{formatCurrency(singleCarriage)}</strong></div>
              )}
              <div><span className="text-muted-foreground">Invoice total:</span> <strong>{formatCurrency(combinedTotal * groupVatMult)} inc. VAT</strong></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={() => send.mutate()}
              disabled={send.isPending}
              className="gap-1.5 bg-violet-600 hover:bg-violet-700"
            >
              {send.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
              Send Combined Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function makeCols(selectable: boolean) {
  return (
    <TableRow className="bg-muted/40">
      {selectable && <TableHead className="w-8 pl-3 pr-0"></TableHead>}
      <TableHead className="text-xs">Order</TableHead>
      <TableHead className="text-xs">Customer</TableHead>
      <TableHead className="text-xs text-right">Amount</TableHead>
      <TableHead className="text-xs">Dispatched</TableHead>
      <TableHead className="text-xs">DPD Tracking</TableHead>
      <TableHead className="text-xs">Email</TableHead>
      <TableHead className="text-xs">Xero</TableHead>
      <TableHead className="text-xs">Actions</TableHead>
    </TableRow>
  );
}
const COLS = makeCols(false);

function CombineBar({
  orders,
  onClear,
  onSent,
}: {
  orders: InvoiceOrder[];
  onClear: () => void;
  onSent: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const totalEx = orders.reduce((s, o) => s + parseFloat(o.totalAmount), 0);
  const combineZeroVat = orders[0]?.zeroVat ?? false;
  const combineVatMult = combineZeroVat ? 1 : 1.2;
  const customerName = orders[0]?.customerName ?? "customer";

  const send = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; sentTo: string; invoiceRef: string }>("/invoices/consolidated/send-email", {
        method: "POST",
        body: JSON.stringify({ orderIds: orders.map((o) => o.id) }),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["invoices-by-customer"] });
      setOpen(false);
      onClear();
      onSent();
      toast({
        title: orders.length === 1 ? "Invoice sent" : "Combined invoice sent",
        description: `Invoice ${res.invoiceRef} emailed to ${res.sentTo}.`,
      });
    },
    onError: (e: Error) => toast({ title: "Failed to send", description: parseApiError(e), variant: "destructive" }),
  });

  return (
    <>
      <div className="flex items-center gap-3 rounded-lg bg-blue-50 border border-blue-200 px-4 py-2.5">
        <Layers className="w-4 h-4 text-blue-600 shrink-0" />
        <div className="flex-1 text-sm text-blue-800">
          <span className="font-semibold">{orders.length} order{orders.length !== 1 ? "s" : ""}</span>
          {" "}selected for <span className="font-semibold">{customerName}</span>
          <span className="text-blue-600 ml-2 font-mono text-xs">
            {formatCurrency(totalEx)} ex VAT · {formatCurrency(totalEx * combineVatMult)} inc VAT
          </span>
        </div>
        <Button
          size="sm"
          className="h-8 gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white shrink-0"
          onClick={() => setOpen(true)}
        >
          <Mail className="w-3 h-3" />
          {orders.length === 1 ? "Send Invoice" : "Send Combined Invoice"}
        </Button>
        <button onClick={onClear} className="text-blue-500 hover:text-blue-800 ml-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {orders.length === 1 ? "Send Invoice" : `Send Combined Invoice — ${orders.length} orders`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              {orders.length === 1
                ? "This will email the invoice to the customer."
                : `This will generate a single invoice PDF covering all ${orders.length} orders and email it to the customer.`}
            </p>
            <div className="rounded-lg bg-muted/50 border p-3 space-y-1.5">
              <div><span className="text-muted-foreground">Customer:</span> <strong>{customerName}</strong></div>
              <div><span className="text-muted-foreground">Orders:</span> <strong>{orders.map((o) => o.orderNumber).join(", ")}</strong></div>
              {orders.some((o) => o.poNumber) && (
                <div><span className="text-muted-foreground">PO refs:</span> <strong className="font-mono">{[...new Set(orders.map((o) => o.poNumber).filter(Boolean))].join(", ")}</strong></div>
              )}
              <div><span className="text-muted-foreground">Total:</span> <strong>{formatCurrency(totalEx * combineVatMult)} inc. VAT</strong></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => send.mutate()} disabled={send.isPending} className="gap-1.5">
              {send.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
              {orders.length === 1 ? "Send Invoice" : "Send Combined Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function Invoices() {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }

  const { data, isLoading, refetch: refetchInvoices, isFetching } = useQuery<InvoicesData>({
    queryKey: ["invoices"],
    queryFn: () => apiFetch("/invoices"),
    refetchInterval: 15_000,
  });

  const { data: poGroups, isLoading: poLoading, refetch: refetchPo } = useQuery<PoGroup[]>({
    queryKey: ["invoices-by-po"],
    queryFn: () => apiFetch("/invoices/by-po-number"),
    refetchInterval: 15_000,
  });

  const { data: customerGroups, isLoading: customerLoading, refetch: refetchCustomer } = useQuery<CustomerGroup[]>({
    queryKey: ["invoices-by-customer"],
    queryFn: () => apiFetch("/invoices/by-customer"),
    refetchInterval: 15_000,
  });

  const { data: emailStatus } = useQuery<EmailStatus>({
    queryKey: ["email-status"],
    queryFn: () => apiFetch("/settings/email/status"),
  });

  const [searchQuery, setSearchQuery] = useState("");

  const toSend = data?.toSend ?? [];
  const toPost = data?.toPost ?? [];
  const done = data?.done ?? [];
  const groups = poGroups ?? [];

  // Auto-detect same-day/same-address shipment groups (2+ orders shipped together)
  const shipmentGroups = (() => {
    const groupMap = new Map<string, InvoiceOrder[]>();
    for (const order of toSend) {
      if (!order.dispatchedAt) continue;
      const dateKey = new Date(order.dispatchedAt).toISOString().slice(0, 10);
      const customerKey = order.customerId != null ? `c${order.customerId}` : `n:${order.customerName ?? "?"}`;
      const addrKey = order.deliveryAddressId != null ? `a${order.deliveryAddressId}` : "main";
      const poKey = order.poNumber ? `po:${order.poNumber}` : "no-po";
      const key = `${customerKey}__${dateKey}__${addrKey}__${poKey}`;
      const arr = groupMap.get(key) ?? [];
      arr.push(order);
      groupMap.set(key, arr);
    }
    return [...groupMap.values()].filter((g) => g.length >= 2);
  })();
  const groupedOrderIds = new Set(shipmentGroups.flatMap((g) => g.map((o) => o.id)));
  const ungroupedOrders = toSend.filter((o) => !groupedOrderIds.has(o.id));

  const allInvoices = [...toSend, ...toPost, ...done];
  const searchTrimmed = searchQuery.trim().toLowerCase();
  const searchResults = searchTrimmed
    ? allInvoices.filter((o) =>
        o.orderNumber.toLowerCase().includes(searchTrimmed) ||
        (o.customerName?.toLowerCase().includes(searchTrimmed)) ||
        (o.xeroInvoiceId?.toLowerCase().includes(searchTrimmed))
      )
    : null;

  // Selection — orders the user has ticked in ungrouped To Send rows or search results
  const selectablePool = searchResults ?? ungroupedOrders;
  const selectedOrders = selectablePool.filter((o) => selectedIds.has(o.id));
  const selectedCustomerKey = selectedOrders.length > 0
    ? (selectedOrders[0].customerId ? String(selectedOrders[0].customerId) : selectedOrders[0].customerName ?? "")
    : null;
  const allSameCustomer = selectedOrders.length > 0 && selectedOrders.every(
    (o) => (o.customerId ? String(o.customerId) : o.customerName ?? "") === selectedCustomerKey
  );
  // Combining rules: orders with PO numbers must all share the same PO number;
  // orders without a PO number can be combined only with other no-PO orders for the same customer.
  const selectedPOs = [...new Set(selectedOrders.map((o) => o.poNumber).filter(Boolean))];
  const allHaveSamePO = selectedPOs.length === 1 && selectedOrders.every((o) => o.poNumber === selectedPOs[0]);
  const noneHavePO = selectedOrders.every((o) => !o.poNumber);
  const showCombineBar = selectedOrders.length >= 1 && allSameCustomer && (allHaveSamePO || noneHavePO);

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <FileText className="w-7 h-7 text-primary" /> Invoicing
            </h1>
            <p className="text-muted-foreground mt-1">
              Send invoices to customers and post them to Xero.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {emailStatus && (
              <Badge className={emailStatus.configured
                ? "bg-green-100 text-green-800 border-green-300 gap-1.5"
                : "bg-amber-100 text-amber-800 border-amber-300 gap-1.5"
              }>
                <Mail className="w-3 h-3" />
                {emailStatus.configured ? (emailStatus.fromEmail ? `Email: ${emailStatus.fromEmail}` : "Email configured") : "Email not configured"}
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => { refetchInvoices(); refetchPo(); }}
              disabled={isFetching}
            >
              <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
              {isFetching ? "Refreshing…" : "Refresh"}
            </Button>
            <Button variant="outline" size="sm" asChild className="gap-1.5 text-xs">
              <a href="/settings">Configure email →</a>
            </Button>
          </div>
        </div>

        {/* SMTP warning */}
        {emailStatus && !emailStatus.configured && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <strong>Email not configured.</strong> Go to{" "}
              <a href="/settings" className="underline font-medium">Settings → Email</a>{" "}
              to set up your Microsoft 365 SMTP credentials before sending invoices.
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "To Send", count: toSend.length, color: "bg-blue-50 border-blue-200 text-blue-800", icon: <Mail className="w-5 h-5 text-blue-500" /> },
            { label: "To Post to Xero", count: toPost.length, color: "bg-indigo-50 border-indigo-200 text-indigo-800", icon: <BookOpen className="w-5 h-5 text-indigo-500" /> },
            { label: "Complete", count: done.length, color: "bg-green-50 border-green-200 text-green-800", icon: <CheckCircle2 className="w-5 h-5 text-green-500" /> },
          ].map((s) => (
            <div key={s.label} className={`rounded-xl border p-4 flex items-center gap-3 ${s.color}`}>
              {s.icon}
              <div>
                <div className="text-2xl font-bold">{s.count}</div>
                <div className="text-xs font-medium">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by order number, customer name, or Xero ID…"
            className="pl-9 pr-8 h-9 text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Search results — shown only when a query is active */}
        {searchResults !== null && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {searchResults.length === 0
                ? "No invoices matched your search."
                : `${searchResults.length} result${searchResults.length !== 1 ? "s" : ""} found — tick orders to combine into one invoice`}
            </p>
            {showCombineBar && (
              <CombineBar
                orders={selectedOrders}
                onClear={clearSelection}
                onSent={() => { refetchInvoices(); refetchCustomer(); }}
              />
            )}
            {searchResults.length > 0 && (
              <div className="rounded-xl border border-border overflow-hidden">
                <Table>
                  <TableHeader>{makeCols(true)}</TableHeader>
                  <TableBody>
                    {searchResults.map((order) => (
                      <OrderRow
                        key={order.id}
                        order={order}
                        showSendEmail={!order.invoiceEmailSentAt}
                        showPostXero={!!order.invoiceEmailSentAt && !order.xeroInvoiceId}
                        showResend={!!order.invoiceEmailSentAt}
                        selected={selectedIds.has(order.id)}
                        onToggle={toggleSelect}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {/* Tabs — hidden while searching */}
        {searchResults === null && (
        <Tabs defaultValue="to-send">
          <TabsList>
            <TabsTrigger value="to-send" className="gap-2">
              <Mail className="w-4 h-4" /> To Send
              {toSend.length > 0 && (
                <Badge className="ml-1 bg-blue-500 text-white text-xs px-1.5 py-0 h-5">{toSend.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="to-post" className="gap-2">
              <BookOpen className="w-4 h-4" /> To Post to Xero
              {toPost.length > 0 && (
                <Badge className="ml-1 bg-indigo-500 text-white text-xs px-1.5 py-0 h-5">{toPost.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="done" className="gap-2">
              <CheckCircle2 className="w-4 h-4" /> Complete
            </TabsTrigger>
            <TabsTrigger value="by-customer" className="gap-2">
              <Package className="w-4 h-4" /> By Customer
              {(customerGroups?.filter(g => g.orders.some(o => !o.invoiceEmailSentAt)).length ?? 0) > 0 && (
                <Badge className="ml-1 bg-amber-500 text-white text-xs px-1.5 py-0 h-5">{customerGroups!.filter(g => g.orders.some(o => !o.invoiceEmailSentAt)).length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="by-po" className="gap-2">
              <Hash className="w-4 h-4" /> By PO #
              {groups.length > 0 && (
                <Badge className="ml-1 bg-slate-500 text-white text-xs px-1.5 py-0 h-5">{groups.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* To Send */}
          <TabsContent value="to-send" className="mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : toSend.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">All invoices have been sent</p>
                <p className="text-sm mt-1">Dispatched orders will appear here waiting to be invoiced.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Auto-detected same-day shipment groups */}
                {shipmentGroups.map((group) => (
                  <ShipmentGroupPanel
                    key={group.map((o) => o.id).join("-")}
                    orders={group}
                    onSent={() => { refetchInvoices(); refetchCustomer(); }}
                  />
                ))}

                {/* Manual combine bar for individually ticked ungrouped orders */}
                {showCombineBar && searchResults === null && (
                  <CombineBar
                    orders={selectedOrders}
                    onClear={clearSelection}
                    onSent={() => { refetchInvoices(); refetchCustomer(); }}
                  />
                )}
                {!showCombineBar && ungroupedOrders.length > 1 && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" /> Tick multiple orders from the same customer to send a combined invoice
                  </p>
                )}

                {/* Individual ungrouped orders */}
                {ungroupedOrders.length > 0 && (
                  <div className="rounded-xl border border-border overflow-hidden">
                    <Table>
                      <TableHeader>{makeCols(true)}</TableHeader>
                      <TableBody>
                        {ungroupedOrders.map((order) => (
                          <OrderRow
                            key={order.id}
                            order={order}
                            showSendEmail
                            selected={selectedIds.has(order.id)}
                            onToggle={toggleSelect}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* To Post */}
          <TabsContent value="to-post" className="mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : toPost.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Nothing waiting for Xero</p>
                <p className="text-sm mt-1">Invoices emailed but not yet posted to Xero will appear here.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden">
                <Table>
                  <TableHeader>{COLS}</TableHeader>
                  <TableBody>
                    {toPost.map((order) => (
                      <OrderRow key={order.id} order={order} showPostXero showResend />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Done */}
          <TabsContent value="done" className="mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : done.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No completed invoices yet</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden">
                <Table>
                  <TableHeader>{COLS}</TableHeader>
                  <TableBody>
                    {done.map((order) => (
                      <OrderRow key={order.id} order={order} showResend showPostXero />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
          {/* By Customer */}
          <TabsContent value="by-customer" className="mt-4">
            {customerLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : (customerGroups ?? []).length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No dispatched orders to invoice</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(customerGroups ?? []).map((g) => (
                  <CustomerGroupRow
                    key={g.customerId ?? g.customerName ?? "unknown"}
                    group={g}
                    onRefresh={() => { refetchInvoices(); refetchCustomer(); }}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* By PO # */}
          <TabsContent value="by-po" className="mt-4">
            {poLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : groups.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <Hash className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No customer PO numbers yet</p>
                <p className="text-sm mt-1">Orders with a customer PO number will be grouped here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {groups.map((g) => (
                  <PoGroupRow key={`${g.poNumber}__${g.customerId}`} group={g} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
        )}
      </div>
    </Layout>
  );
}

function CustomerGroupRow({ group, onRefresh }: { group: CustomerGroup; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirmConsolidated, setConfirmConsolidated] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const dispatchedUnsent = group.orders.filter(
    (o) => ["shipped", "dispatched"].includes(o.status) && !o.invoiceEmailSentAt
  );
  const alreadyInvoiced = group.orders.filter((o) => !!o.invoiceEmailSentAt);
  const consolidatedTotal = dispatchedUnsent.reduce((s, o) => s + parseFloat(o.totalAmount ?? "0"), 0);
  const cgVatMult = group.zeroVat ? 1 : 1.2;

  const sendConsolidated = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; sentTo: string; invoiceRef: string }>("/invoices/consolidated/send-email", {
        method: "POST",
        body: JSON.stringify({ orderIds: dispatchedUnsent.map((o) => o.id) }),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["invoices-by-customer"] });
      qc.invalidateQueries({ queryKey: ["invoices-by-po"] });
      setConfirmConsolidated(false);
      onRefresh();
      toast({
        title: "Consolidated invoice sent",
        description: `Invoice ${res.invoiceRef} emailed to ${res.sentTo} covering ${dispatchedUnsent.length} order${dispatchedUnsent.length !== 1 ? "s" : ""}.`,
      });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to send", description: parseApiError(e), variant: "destructive" }),
  });

  const statusColor: Record<string, string> = {
    dispatched: "bg-green-100 text-green-800 border-green-200",
    shipped: "bg-green-100 text-green-800 border-green-200",
    in_production: "bg-blue-100 text-blue-800 border-blue-200",
    confirmed: "bg-indigo-100 text-indigo-800 border-indigo-200",
    draft: "bg-gray-100 text-gray-700 border-gray-200",
    cancelled: "bg-red-100 text-red-700 border-red-200",
  };

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
        <Package className="w-4 h-4 text-primary shrink-0" />
        <span className="font-semibold text-sm">{group.customerName ?? "Unknown customer"}</span>
        <div className="ml-auto flex items-center gap-4">
          {dispatchedUnsent.length > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700 font-medium">
              <Clock className="w-3.5 h-3.5" /> {dispatchedUnsent.length} to invoice
            </span>
          )}
          {alreadyInvoiced.length > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" /> {alreadyInvoiced.length} invoiced
            </span>
          )}
          <span className="text-xs text-muted-foreground">{group.orders.length} order{group.orders.length !== 1 ? "s" : ""}</span>
          <span className="text-sm font-medium">{formatCurrency(group.totalEx)} ex VAT</span>
          <span className="text-xs text-muted-foreground">({formatCurrency(group.totalInc)} inc)</span>
        </div>
      </button>

      {/* Action bar — shown when 1+ dispatched unsent orders */}
      {dispatchedUnsent.length >= 1 && (
        <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-200 flex items-center gap-3">
          <div className="flex-1 text-sm text-amber-800">
            <span className="font-semibold">{dispatchedUnsent.length} dispatched order{dispatchedUnsent.length !== 1 ? "s" : ""}</span>
            {" "}ready to invoice
            <span className="text-amber-600 ml-2 font-mono text-xs">
              {formatCurrency(consolidatedTotal)} ex VAT · {formatCurrency(consolidatedTotal * cgVatMult)} inc VAT
            </span>
            {dispatchedUnsent.some(o => o.poNumber) && (
              <span className="text-amber-600 ml-2 text-xs">
                · PO refs: {[...new Set(dispatchedUnsent.map(o => o.poNumber).filter(Boolean))].join(", ")}
              </span>
            )}
          </div>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white"
            onClick={(e) => { e.stopPropagation(); setConfirmConsolidated(true); }}
            disabled={sendConsolidated.isPending}
          >
            {sendConsolidated.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
            {dispatchedUnsent.length === 1 ? "Send Invoice" : "Send Combined Invoice"}
          </Button>
        </div>
      )}

      {/* Expandable order list */}
      {open && (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/20">
              <TableHead className="text-xs">Order #</TableHead>
              <TableHead className="text-xs">PO #</TableHead>
              <TableHead className="text-xs">Date</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">Dispatched</TableHead>
              <TableHead className="text-xs">Invoice Sent</TableHead>
              <TableHead className="text-xs text-right">Total (ex)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.orders.map((o) => (
              <TableRow key={o.id} className={dispatchedUnsent.some((d) => d.id === o.id) ? "bg-amber-50/50" : undefined}>
                <TableCell className="text-xs font-mono">
                  <Link href={`/orders/${o.id}`} className="text-primary hover:underline">
                    {o.orderNumber}
                  </Link>
                </TableCell>
                <TableCell className="text-xs font-mono text-muted-foreground">{o.poNumber ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{o.orderDate ? formatDate(o.orderDate) : "—"}</TableCell>
                <TableCell className="text-xs">
                  <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold capitalize ${statusColor[o.status] ?? "bg-muted text-muted-foreground"}`}>
                    {o.status.replace(/_/g, " ")}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{o.dispatchedAt ? formatDate(o.dispatchedAt) : "—"}</TableCell>
                <TableCell className="text-xs">
                  {o.invoiceEmailSentAt
                    ? <span className="text-green-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{formatDate(o.invoiceEmailSentAt)}</span>
                    : <span className="text-muted-foreground">Not sent</span>
                  }
                </TableCell>
                <TableCell className="text-right text-xs font-medium">{formatCurrency(parseFloat(o.totalAmount ?? "0"))}</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/30 font-semibold">
              <TableCell colSpan={6} className="text-xs text-right text-muted-foreground">Group total (ex VAT)</TableCell>
              <TableCell className="text-right text-sm">{formatCurrency(group.totalEx)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}

      {/* Confirm dialog */}
      <Dialog open={confirmConsolidated} onOpenChange={setConfirmConsolidated}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dispatchedUnsent.length === 1 ? "Send Invoice" : "Send Combined Invoice"} — {group.customerName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              This will generate a single invoice PDF covering {dispatchedUnsent.length} dispatched order{dispatchedUnsent.length !== 1 ? "s" : ""} and email it to the customer.
            </p>
            <div className="rounded-lg bg-muted/50 border p-3 space-y-1.5">
              <div><span className="text-muted-foreground">Customer:</span> <strong>{group.customerName}</strong></div>
              <div><span className="text-muted-foreground">Orders:</span> <strong>{dispatchedUnsent.map((o) => o.orderNumber).join(", ")}</strong></div>
              {dispatchedUnsent.some(o => o.poNumber) && (
                <div><span className="text-muted-foreground">PO refs:</span> <strong className="font-mono">{[...new Set(dispatchedUnsent.map(o => o.poNumber).filter(Boolean))].join(", ")}</strong></div>
              )}
              <div><span className="text-muted-foreground">Total:</span> <strong>{formatCurrency(consolidatedTotal * cgVatMult)} inc. VAT</strong></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmConsolidated(false)}>Cancel</Button>
            <Button
              onClick={() => sendConsolidated.mutate()}
              disabled={sendConsolidated.isPending}
              className="gap-1.5 bg-amber-600 hover:bg-amber-700"
            >
              {sendConsolidated.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
              {dispatchedUnsent.length === 1 ? "Send Invoice" : "Send Combined Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PoGroupRow({ group }: { group: PoGroup }) {
  const [open, setOpen] = useState(false);
  const [confirmConsolidated, setConfirmConsolidated] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const dispatchedUnsent = group.orders.filter(
    (o) => ["shipped", "dispatched"].includes(o.status) && !o.invoiceEmailSentAt
  );
  const pendingOrders = group.orders.filter(
    (o) => !["shipped", "dispatched"].includes(o.status)
  );

  const sendConsolidated = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; sentTo: string; invoiceRef: string }>("/invoices/consolidated/send-email", {
        method: "POST",
        body: JSON.stringify({ orderIds: dispatchedUnsent.map((o) => o.id) }),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["po-groups"] });
      setConfirmConsolidated(false);
      toast({
        title: "Consolidated invoice sent",
        description: `Invoice ${res.invoiceRef} emailed to ${res.sentTo} covering ${dispatchedUnsent.length} orders.`,
      });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to send", description: parseApiError(e), variant: "destructive" }),
  });

  const statusColor: Record<string, string> = {
    dispatched: "bg-green-100 text-green-800 border-green-200",
    shipped: "bg-green-100 text-green-800 border-green-200",
    in_production: "bg-blue-100 text-blue-800 border-blue-200",
    confirmed: "bg-indigo-100 text-indigo-800 border-indigo-200",
    draft: "bg-gray-100 text-gray-700 border-gray-200",
    cancelled: "bg-red-100 text-red-700 border-red-200",
  };

  const allInvoiced = group.orders.every((o) => !!o.invoiceEmailSentAt);
  const consolidatedTotal = dispatchedUnsent.reduce((s, o) => s + parseFloat(o.totalAmount ?? "0"), 0);
  const pgVatMult = group.zeroVat ? 1 : 1.2;

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {/* Header row */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
        <Hash className="w-4 h-4 text-primary shrink-0" />
        <span className="font-semibold text-sm">{group.poNumber}</span>
        <span className="text-sm text-muted-foreground mx-1">·</span>
        <span className="text-sm text-muted-foreground">{group.customerName ?? "Unknown customer"}</span>
        <div className="ml-auto flex items-center gap-4">
          {allInvoiced && (
            <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" /> All invoiced
            </span>
          )}
          {dispatchedUnsent.length > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700 font-medium">
              <Clock className="w-3.5 h-3.5" /> {dispatchedUnsent.length} to invoice
            </span>
          )}
          <span className="text-xs text-muted-foreground">{group.orders.length} order{group.orders.length !== 1 ? "s" : ""}</span>
          <span className="text-sm font-medium">{formatCurrency(group.totalEx)} ex VAT</span>
          <span className="text-xs text-muted-foreground">({formatCurrency(group.totalInc)} inc)</span>
        </div>
      </button>

      {/* Send Combined Invoice action bar — shown when 2+ dispatched unsent orders */}
      {dispatchedUnsent.length >= 1 && (
        <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-200 flex items-center gap-3">
          <div className="flex-1 text-sm text-amber-800">
            <span className="font-semibold">{dispatchedUnsent.length} dispatched order{dispatchedUnsent.length !== 1 ? "s" : ""}</span>
            {" "}ready to invoice
            {pendingOrders.length > 0 && (
              <span className="text-amber-600 ml-1">· {pendingOrders.length} order{pendingOrders.length !== 1 ? "s" : ""} still in production (to follow)</span>
            )}
            <span className="text-amber-600 ml-2 font-mono text-xs">
              {formatCurrency(consolidatedTotal)} ex VAT · {formatCurrency(consolidatedTotal * pgVatMult)} inc VAT
            </span>
          </div>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white"
            onClick={(e) => { e.stopPropagation(); setConfirmConsolidated(true); }}
            disabled={sendConsolidated.isPending}
          >
            {sendConsolidated.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
            Send Combined Invoice
          </Button>
        </div>
      )}

      {/* Expandable order list */}
      {open && (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/20">
              <TableHead className="text-xs">Order #</TableHead>
              <TableHead className="text-xs">Date</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">Dispatched</TableHead>
              <TableHead className="text-xs">Invoice Sent</TableHead>
              <TableHead className="text-xs">Xero</TableHead>
              <TableHead className="text-xs text-right">Total (ex)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.orders.map((o) => (
              <TableRow key={o.id} className={dispatchedUnsent.some((d) => d.id === o.id) ? "bg-amber-50/50" : undefined}>
                <TableCell className="text-xs font-mono">
                  <Link href={`/orders/${o.id}`} className="text-primary hover:underline">
                    {o.orderNumber}
                  </Link>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{o.orderDate ? formatDate(o.orderDate) : "—"}</TableCell>
                <TableCell>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${statusColor[o.status] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}>
                    {o.status.replace("_", " ")}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{o.dispatchedAt ? formatDate(o.dispatchedAt) : "—"}</TableCell>
                <TableCell className="text-xs">
                  {o.invoiceEmailSentAt
                    ? <span className="text-green-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{formatDate(o.invoiceEmailSentAt)}</span>
                    : <span className="text-muted-foreground">Not sent</span>
                  }
                </TableCell>
                <TableCell className="text-xs">
                  {o.xeroInvoiceId
                    ? <span className="text-green-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Posted</span>
                    : <span className="text-muted-foreground">—</span>
                  }
                </TableCell>
                <TableCell className="text-right text-xs font-medium">{formatCurrency(parseFloat(o.totalAmount ?? "0"))}</TableCell>
              </TableRow>
            ))}
            {/* Totals row */}
            <TableRow className="bg-muted/30 font-semibold">
              <TableCell colSpan={6} className="text-xs text-right text-muted-foreground">Group total (ex VAT)</TableCell>
              <TableCell className="text-right text-sm">{formatCurrency(group.totalEx)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}

      {/* Confirm consolidated send dialog */}
      <Dialog open={confirmConsolidated} onOpenChange={setConfirmConsolidated}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Combined Invoice — PO {group.poNumber}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              This will generate a single consolidated invoice PDF covering {dispatchedUnsent.length} dispatched order{dispatchedUnsent.length !== 1 ? "s" : ""} and email it to the customer.
            </p>
            <div className="rounded-lg bg-muted/50 border p-3 space-y-1.5">
              <div><span className="text-muted-foreground">Customer:</span> <strong>{group.customerName}</strong></div>
              <div><span className="text-muted-foreground">PO Ref:</span> <strong className="font-mono">{group.poNumber}</strong></div>
              <div><span className="text-muted-foreground">Orders covered:</span> <strong>{dispatchedUnsent.map((o) => o.orderNumber).join(", ")}</strong></div>
              <div><span className="text-muted-foreground">Total:</span> <strong>{formatCurrency(consolidatedTotal * pgVatMult)} inc. VAT</strong></div>
            </div>
            {pendingOrders.length > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                <strong>{pendingOrders.length} order{pendingOrders.length !== 1 ? "s" : ""} still in production</strong> ({pendingOrders.map((o) => o.orderNumber).join(", ")}) will NOT be included in this invoice. They will appear as items to follow and be invoiced separately when dispatched.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmConsolidated(false)}>Cancel</Button>
            <Button
              onClick={() => sendConsolidated.mutate()}
              disabled={sendConsolidated.isPending}
              className="gap-1.5 bg-amber-600 hover:bg-amber-700"
            >
              {sendConsolidated.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
              Send Combined Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
