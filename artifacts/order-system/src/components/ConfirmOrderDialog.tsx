import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, CheckCircle2, ShoppingCart, PackageX, Mail, Check,
  Copy, ChevronRight, Package, AlertTriangle, Truck, CreditCard, XCircle,
} from "lucide-react";

const SHIPPING_OPTIONS = [
  { value: "local_delivery", label: "Local Delivery" },
  { value: "office_collection", label: "Office Collection" },
  { value: "warehouse_collection", label: "Warehouse Collection" },
  { value: "courier", label: "Courier" },
] as const;

function defaultRequiredDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

const API_BASE = "/api";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

interface ShortfallItem {
  id: number;
  productName: string;
  colour: string | null;
  size: string | null;
  purchaseQuantity: number;
  supplierId: number | null;
  supplierName: string | null;
  supplierEmail: string | null;
}

interface ShortfallGroup {
  supplierId: number | null;
  supplierName: string;
  supplierEmail: string | null;
  itemIds: number[];
  items: ShortfallItem[];
}

interface ProcessShortfallGroup {
  supplierName: string;
  supplierId: number | null;
  items: Array<{ name: string; sku: string | null; shortfall: number }>;
}

interface AllocationResult {
  allocation: { allocated: number; purchaseRequired: number };
  shortfallGroups: ShortfallGroup[];
  processShortfallGroups: ProcessShortfallGroup[];
  autoCreatedProcessStockPos: string[];
  unlinkedItems: number;
  emailConfigured: boolean;
  stripeCharge?: { success: boolean; paymentIntentId?: string; cardLast4?: string; error?: string } | null;
}

type Step = "review" | "checking_overdue" | "overdue_warning" | "confirming" | "email" | "sending_email" | "done";

interface OverdueCheckResult {
  isOverdue: boolean;
  overdueAmount: number;
  totalDue: number;
  oldestDueDate: string | null;
  invoiceCount: number;
  notLinked?: boolean;
  checkFailed?: boolean;
}

interface ConfirmOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: {
    id: number;
    orderNumber: string;
    customerId?: number | null;
    customerName: string | null;
    customerEmail?: string | null;
    status: string;
    totalAmount?: number | null;
    requiredDate?: string | null;
    shippingMethod?: string | null;
    items?: Array<{ id: number; productName: string; quantity: number; purchaseRequired?: boolean }>;
  };
  onConfirmed: () => void;
  customerDefaultShipping?: string | null;
}

export function ConfirmOrderDialog({ open, onOpenChange, order, onConfirmed, customerDefaultShipping }: ConfirmOrderDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("review");
  const [result, setResult] = useState<AllocationResult | null>(null);
  const [emailTo, setEmailTo] = useState(order.customerEmail ?? "");
  const [emailSent, setEmailSent] = useState(false);
  const [emailText, setEmailText] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [copied, setCopied] = useState(false);
  const [requiredDate, setRequiredDate] = useState(defaultRequiredDate);
  const [shippingMethod, setShippingMethod] = useState<string>("");
  const [carriageAmount, setCarriageAmount] = useState<string>("");
  const [paymentLinkUrl, setPaymentLinkUrl] = useState<string | null>(null);
  const [paymentLinkLoading, setPaymentLinkLoading] = useState(false);
  const [paymentLinkError, setPaymentLinkError] = useState<string | null>(null);
  const [paymentLinkCopied, setPaymentLinkCopied] = useState(false);
  const [overdueCheck, setOverdueCheck] = useState<OverdueCheckResult | null>(null);
  const [emptyFinishes, setEmptyFinishes] = useState<string[]>([]);

  const initialRequiredDate = () =>
    order.requiredDate ? new Date(order.requiredDate).toISOString().slice(0, 10) : defaultRequiredDate();
  const initialShippingMethod = () => order.shippingMethod ?? customerDefaultShipping ?? "";

  const reset = () => {
    setStep("review");
    setResult(null);
    setEmailTo("");
    setEmailSent(false);
    setEmailText("");
    setCopied(false);
    setRequiredDate(initialRequiredDate());
    const sm = initialShippingMethod();
    setShippingMethod(sm);
    setCarriageAmount(sm === "courier" ? "8.50" : "");
    setPaymentLinkUrl(null);
    setPaymentLinkLoading(false);
    setPaymentLinkError(null);
    setPaymentLinkCopied(false);
    setOverdueCheck(null);
    setEmptyFinishes([]);
  };

  useEffect(() => {
    if (open) {
      setRequiredDate(initialRequiredDate());
      const sm = initialShippingMethod();
      setShippingMethod(sm);
      setCarriageAmount(sm === "courier" ? "8.50" : "");
      // Preflight: check for finishes with no processes
      apiFetch<{ ok: boolean; finishesWithNoProcesses: string[] }>(`/orders/${order.id}/confirm-preflight`)
        .then(d => setEmptyFinishes(d.finishesWithNoProcesses))
        .catch(() => {/* non-fatal */});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (shippingMethod === "courier") {
      setCarriageAmount(prev => prev === "" ? "8.50" : prev);
    }
  }, [shippingMethod]);

  const handleClose = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  // ─── Generate Stripe Payment Link ────────────────────────────────────────
  const generatePaymentLink = async () => {
    if (paymentLinkLoading) return;
    setPaymentLinkLoading(true);
    setPaymentLinkError(null);
    try {
      const data = await apiFetch<{ url: string; existing?: boolean }>(
        `/stripe/orders/${order.id}/payment-link`,
        { method: "POST" }
      );
      setPaymentLinkUrl(data.url);
    } catch (err: any) {
      setPaymentLinkError(err.message);
    } finally {
      setPaymentLinkLoading(false);
    }
  };

  useEffect(() => {
    if (step === "email" && open && !paymentLinkUrl && !paymentLinkLoading) {
      generatePaymentLink();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, open]);

  // ─── Step 1: Confirm ──────────────────────────────────────────────────────
  const doConfirm = async () => {
    setStep("confirming");
    try {
      const data = await apiFetch<AllocationResult & { id: number }>(`/orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "confirmed",
          requiredDate: requiredDate || null,
          shippingMethod: shippingMethod || null,
          carriageAmount: carriageAmount !== "" ? parseFloat(carriageAmount) : 0,
        }),
      });
      setResult(data);
      // Garment shortfalls remain in the Purchasing queue. Process-material
      // shortfalls are auto-created by the API. Do not ask staff to choose a
      // historical PO here — that list can contain completed or ordered POs.
      setStep("email");
      onConfirmed();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setStep("review");
    }
  };

  const handleConfirm = async () => {
    if (!order.customerId) {
      doConfirm();
      return;
    }
    setStep("checking_overdue");
    try {
      const overdue = await apiFetch<OverdueCheckResult>(
        `/xero/overdue-check/customer/${order.customerId}?days=30`
      );
      if (overdue.isOverdue) {
        setOverdueCheck(overdue);
        setStep("overdue_warning");
      } else {
        doConfirm();
      }
    } catch {
      // Never block confirmation because the overdue check itself failed
      doConfirm();
    }
  };

  // ─── Step 3: Send Email ───────────────────────────────────────────────────
  const handleSendEmail = async () => {
    setStep("sending_email");
    try {
      const data = await apiFetch<{ sent: boolean; text: string; subject: string; error?: string; to: string }>(
        `/orders/${order.id}/send-acknowledgement`,
        { method: "POST", body: JSON.stringify(emailTo ? { toEmail: emailTo } : {}) }
      );
      setEmailText(data.text);
      setEmailSubject(data.subject);
      if (data.sent) {
        setEmailSent(true);
        setEmailTo(data.to);
        toast({ title: "Email Sent", description: `Acknowledgement sent to ${data.to}` });
      } else {
        toast({ title: "Email not sent", description: data.error ?? "SMTP not configured — use copy instead.", variant: "destructive" });
      }
      setStep("email");
    } catch (err: any) {
      if (err.message.includes("No customer email")) {
        toast({ title: "No email address", description: "Enter the customer's email address below.", variant: "destructive" });
      } else {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
      setStep("email");
    }
  };

  const handlePreviewEmail = async () => {
    try {
      const data = await apiFetch<{ text: string; subject: string; html: string; to: string }>(
        `/orders/${order.id}/send-acknowledgement`,
        { method: "POST", body: JSON.stringify({ toEmail: emailTo || "preview@example.com", previewOnly: true }) }
      );
      setEmailText(data.text);
      setEmailSubject(data.subject);
      setEmailTo(prev => prev || data.to);
    } catch {}
  };

  const handleCopyEmail = async () => {
    if (!emailText) await handlePreviewEmail();
    const textToCopy = emailText || "Loading...";
    await navigator.clipboard.writeText(textToCopy).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const itemCount = order.items?.length ?? 0;
  const isConfirming = step === "confirming";
  const isSendingEmail = step === "sending_email";
  const queuedPurchaseLines = result?.shortfallGroups.reduce((total, group) => total + group.items.length, 0) ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">

        {/* ── STEP: REVIEW ── */}
        {step === "review" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-primary" />
                Confirm Order {order.orderNumber}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer</span>
                  <span className="font-medium">{order.customerName ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Items</span>
                  <span className="font-medium">{itemCount} line{itemCount !== 1 ? "s" : ""}</span>
                </div>
                {order.totalAmount != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Order Total</span>
                    <span className="font-semibold">£{Number(order.totalAmount).toFixed(2)}</span>
                  </div>
                )}
              </div>

              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="required-date">Required Date</Label>
                  <Input
                    id="required-date"
                    type="date"
                    value={requiredDate}
                    onChange={e => setRequiredDate(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="shipping-method" className="flex items-center gap-1.5">
                    <Truck className="w-4 h-4" />
                    Shipping Method <span className="text-destructive">*</span>
                  </Label>

                  <Select value={shippingMethod} onValueChange={setShippingMethod}>
                    <SelectTrigger id="shipping-method" className={!shippingMethod ? "border-destructive/50 ring-destructive/20" : ""}>
                      <SelectValue placeholder="Select shipping method…" />
                    </SelectTrigger>
                    <SelectContent>
                      {SHIPPING_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Show context beneath the dropdown */}
                  {!shippingMethod && (
                    <p className="text-[11px] text-destructive">A shipping method is required to confirm</p>
                  )}
                  {shippingMethod && customerDefaultShipping && shippingMethod !== customerDefaultShipping && (
                    <div className="flex items-center justify-between gap-2 rounded-md px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 text-xs">
                      <span>Customer default is <strong>{SHIPPING_OPTIONS.find(o => o.value === customerDefaultShipping)?.label ?? customerDefaultShipping}</strong></span>
                      <button
                        type="button"
                        className="underline underline-offset-2 text-amber-600 hover:text-amber-800 shrink-0"
                        onClick={() => setShippingMethod(customerDefaultShipping)}
                      >
                        Revert
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="carriage-amount">Shipping Charge</Label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-muted-foreground text-sm pointer-events-none">£</span>
                    <Input
                      id="carriage-amount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={carriageAmount}
                      onChange={e => setCarriageAmount(e.target.value)}
                      placeholder="0.00"
                      className="pl-7"
                    />
                  </div>
                  {shippingMethod === "courier" && (
                    <p className="text-[11px] text-muted-foreground">Default £8.50 DPD charge — override if needed</p>
                  )}
                </div>
              </div>

              {/* Finish-with-no-processes warning */}
              {emptyFinishes.length > 0 && (
                <div className="flex items-start gap-2.5 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">Cannot confirm — finish{emptyFinishes.length > 1 ? "es" : ""} missing processes</p>
                    <ul className="mt-1 list-disc list-inside space-y-0.5">
                      {emptyFinishes.map(name => (
                        <li key={name}><strong>{name}</strong> has no processes assigned</li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-destructive/80">Go to the customer's <strong>Finishes</strong> tab and add processes to {emptyFinishes.length > 1 ? "these finishes" : "this finish"} before confirming.</p>
                  </div>
                </div>
              )}

              <p className="text-sm text-muted-foreground">
                Confirming will allocate available stock to this order and flag any shortfalls for purchasing. A production worksheet can then be created once stock is picked.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
              <Button onClick={handleConfirm} disabled={!requiredDate || !shippingMethod || emptyFinishes.length > 0}>
                <Check className="w-4 h-4 mr-1.5" /> Confirm Order
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── STEP: CHECKING OVERDUE BALANCE ── */}
        {step === "checking_overdue" && (
          <div className="flex flex-col items-center gap-4 py-10">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Checking customer account balance…</p>
          </div>
        )}

        {/* ── STEP: OVERDUE BALANCE WARNING ── */}
        {step === "overdue_warning" && overdueCheck && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-700">
                <AlertTriangle className="w-5 h-5" />
                Balance Overdue
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-2 text-sm">
                <p className="text-amber-900">
                  <strong>{order.customerName ?? "This customer"}</strong> has {overdueCheck.invoiceCount} invoice{overdueCheck.invoiceCount !== 1 ? "s" : ""} more than 30 days overdue.
                </p>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Overdue Amount</span>
                  <span className="font-semibold text-amber-800">£{overdueCheck.overdueAmount.toFixed(2)}</span>
                </div>
                {overdueCheck.oldestDueDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Oldest Due Date</span>
                    <span className="font-medium">{new Date(overdueCheck.oldestDueDate).toLocaleDateString("en-GB")}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Balance Due</span>
                  <span className="font-medium">£{overdueCheck.totalDue.toFixed(2)}</span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">Are you sure you want to confirm this order?</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("review")}>Cancel</Button>
              <Button variant="destructive" onClick={doConfirm}>
                <Check className="w-4 h-4 mr-1.5" /> Confirm Anyway
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── STEP: CONFIRMING ── */}
        {step === "confirming" && (
          <div className="flex flex-col items-center gap-4 py-10">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Confirming order and allocating stock…</p>
          </div>
        )}

        {/* ── STEP: EMAIL ── */}
        {(step === "email" || step === "sending_email") && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-blue-600" />
                Order Acknowledgement
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Unlinked items warning (shown when jumped straight to email with no shortfall groups) */}
              {result && result.unlinkedItems > 0 && result.shortfallGroups.length === 0 && (
                <div className="flex items-start gap-2 rounded-md bg-orange-50 border border-orange-300 px-3 py-2.5 text-sm text-orange-800">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    <strong>{result.unlinkedItems} line{result.unlinkedItems !== 1 ? "s" : ""}</strong> {result.unlinkedItems !== 1 ? "are" : "is"} not linked to a catalogue product — no stock check was performed. Check the Purchasing page to raise any required orders manually.
                  </span>
                </div>
              )}

              {queuedPurchaseLines > 0 && (
                <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                  <div className="flex items-start gap-1.5">
                    <PackageX className="w-4 h-4 mt-0.5 shrink-0" />
                    <span><strong>{queuedPurchaseLines} garment line{queuedPurchaseLines !== 1 ? "s" : ""}</strong> need ordering and have been left in the Purchasing queue. Choose an eligible draft PO or create a new one there.</span>
                  </div>
                </div>
              )}
              {(result?.processShortfallGroups ?? []).length > 0 && (
                <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
                  <div className="flex items-start gap-1.5">
                    <Package className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>Process-material purchasing has been added automatically to the supplier draft PO.</span>
                  </div>
                </div>
              )}

              {/* Stripe Payment Link */}
              <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <CreditCard className="w-4 h-4 text-blue-600" />
                    Stripe Payment Link
                  </div>
                  {!paymentLinkUrl && (
                    <button
                      onClick={generatePaymentLink}
                      disabled={paymentLinkLoading}
                      className="text-xs text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                    >
                      {paymentLinkLoading ? <><Loader2 className="w-3 h-3 animate-spin" /> Generating…</> : "Regenerate"}
                    </button>
                  )}
                  {paymentLinkUrl && (
                    <button
                      onClick={generatePaymentLink}
                      disabled={paymentLinkLoading}
                      className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center gap-1"
                      title="Generate a new payment link"
                    >
                      {paymentLinkLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Regenerate"}
                    </button>
                  )}
                </div>
                {paymentLinkError && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> {paymentLinkError}
                  </p>
                )}
                {paymentLinkLoading && !paymentLinkUrl && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" /> Creating payment link…
                  </div>
                )}
                {paymentLinkUrl ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={paymentLinkUrl}
                        className="text-xs flex-1 rounded border bg-background px-2 py-1 font-mono outline-none select-all min-w-0"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(paymentLinkUrl).catch(() => {});
                          setPaymentLinkCopied(true);
                          setTimeout(() => setPaymentLinkCopied(false), 2000);
                        }}
                        className="shrink-0 flex items-center gap-1 text-xs border rounded px-2 py-1 hover:bg-muted transition-colors"
                      >
                        {paymentLinkCopied ? <><Check className="w-3 h-3 text-green-600" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">Total inc. 20% VAT — included automatically in the acknowledgement email.</p>
                  </div>
                ) : (!paymentLinkLoading && (
                  <p className="text-xs text-muted-foreground">
                    {paymentLinkError ? "Could not generate link — the email will use a generic payment link." : "Generating a payment link for this order…"}
                  </p>
                ))}
              </div>

              {emailSent ? (
                <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-700">
                  <CheckCircle2 className="w-4 h-4" />
                  Acknowledgement sent to <span className="font-medium ml-1">{emailTo}</span>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Send an order acknowledgement email to the customer.
                    {!result?.emailConfigured && " SMTP is not yet configured — you can copy the email text to send manually."}
                  </p>
                  <div className="grid gap-1.5">
                    <Label htmlFor="email-to">Customer Email</Label>
                    <Input
                      id="email-to"
                      placeholder="customer@example.com"
                      value={emailTo}
                      onChange={e => setEmailTo(e.target.value)}
                    />
                  </div>
                  {emailSubject && (
                    <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground mb-1">{emailSubject}</p>
                      <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed max-h-32 overflow-y-auto">{emailText}</pre>
                    </div>
                  )}
                </>
              )}
            </div>
            <DialogFooter className="flex-wrap gap-2">
              <Button variant="outline" onClick={() => setStep("done")}>
                {emailSent ? "Continue" : "Skip"}
              </Button>
              {!emailSent && (
                <>
                  <Button variant="outline" onClick={handleCopyEmail} className="gap-1.5">
                    {copied ? <><Check className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Email</>}
                  </Button>
                  {result?.emailConfigured && (
                    <Button onClick={handleSendEmail} disabled={isSendingEmail} className="gap-1.5">
                      {isSendingEmail ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><Mail className="w-4 h-4" /> Send Email</>}
                    </Button>
                  )}
                </>
              )}
              {emailSent && (
                <Button onClick={() => setStep("done")} className="gap-1.5">
                  <ChevronRight className="w-4 h-4" /> Done
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {/* ── STEP: DONE ── */}
        {step === "done" && result && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="w-5 h-5" />
                Order Confirmed
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                {order.orderNumber} has been confirmed. Here's a summary of what was done:
              </p>
              <ul className="space-y-2 text-sm">
                {result.allocation.allocated > 0 && (
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                    <span>{result.allocation.allocated} line{result.allocation.allocated !== 1 ? "s" : ""} allocated from stock — ready to pick and send to production</span>
                  </li>
                )}
                {result.allocation.purchaseRequired > 0 && (
                  <li className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    <span>{result.allocation.purchaseRequired} line{result.allocation.purchaseRequired !== 1 ? "s" : ""} remain in Purchasing — choose an eligible draft PO or create a new one there</span>
                  </li>
                )}
                {emailSent && (
                  <li className="flex items-start gap-2">
                    <Mail className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                    <span>Acknowledgement email sent to {emailTo}</span>
                  </li>
                )}
                {result.stripeCharge?.success && (
                  <li className="flex items-start gap-2">
                    <CreditCard className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    <span>
                      Payment taken from card ending <strong>{result.stripeCharge.cardLast4}</strong>
                    </span>
                  </li>
                )}
                {result.stripeCharge && !result.stripeCharge.success && (
                  <li className="flex items-start gap-2">
                    <XCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                    <span className="text-destructive">
                      Payment failed — {result.stripeCharge.error}. Charge the card manually or contact the customer.
                    </span>
                  </li>
                )}
              </ul>
              {result.allocation.allocated > 0 && (
                <div className="rounded-md bg-blue-50 border border-blue-100 p-3 text-sm text-blue-700">
                  <strong>Next step:</strong> Once the stock is picked, click <em>Send to Production</em> on the order to create a production worksheet.
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => handleClose(false)}>Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
