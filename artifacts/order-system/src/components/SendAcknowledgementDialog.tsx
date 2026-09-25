import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Mail, Copy, Check, CreditCard, XCircle, CheckCircle2, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

interface SendAcknowledgementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: {
    id: number;
    orderNumber: string;
    customerName: string | null;
    totalAmount?: number | null;
    status: string;
    customerEmail?: string | null;
  };
  onSent?: () => void;
}

export function SendAcknowledgementDialog({ open, onOpenChange, order, onSent }: SendAcknowledgementDialogProps) {
  const { toast } = useToast();
  const [emailTo, setEmailTo] = useState(order.customerEmail ?? "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [paymentLinkUrl, setPaymentLinkUrl] = useState<string | null>(null);
  const [paymentLinkLoading, setPaymentLinkLoading] = useState(false);
  const [paymentLinkError, setPaymentLinkError] = useState<string | null>(null);
  const [paymentLinkCopied, setPaymentLinkCopied] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);
  const [emailText, setEmailText] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [previewingPdf, setPreviewingPdf] = useState(false);

  const reset = () => {
    setEmailTo(order.customerEmail ?? "");
    setSending(false);
    setSent(false);
    setPaymentLinkUrl(null);
    setPaymentLinkLoading(false);
    setPaymentLinkError(null);
    setPaymentLinkCopied(false);
    setEmailCopied(false);
    setEmailText("");
    setEmailSubject("");
    setEmailConfigured(true);
    setPreviewingPdf(false);
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const generatePaymentLink = async () => {
    if (paymentLinkLoading) return;
    setPaymentLinkLoading(true);
    setPaymentLinkError(null);
    try {
      const data = await apiFetch<{ url: string }>(`/stripe/orders/${order.id}/payment-link`, { method: "POST" });
      setPaymentLinkUrl(data.url);
    } catch (err: any) {
      setPaymentLinkError(err.message);
    } finally {
      setPaymentLinkLoading(false);
    }
  };

  const loadPreview = async () => {
    try {
      const data = await apiFetch<{ text: string; subject: string; html: string; to: string; emailConfigured: boolean }>(
        `/orders/${order.id}/send-acknowledgement`,
        { method: "POST", body: JSON.stringify({ previewOnly: true }) }
      );
      setEmailText(data.text);
      setEmailSubject(data.subject);
      setEmailConfigured(data.emailConfigured ?? true);
      if (data.to) setEmailTo(data.to);
    } catch {}
  };

  const handlePreviewPdf = async () => {
    setPreviewingPdf(true);
    try {
      const res = await fetch(`${API_BASE}/orders/${order.id}/acknowledgement-pdf`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (err: any) {
      toast({ title: "PDF preview failed", description: err.message, variant: "destructive" });
    } finally {
      setPreviewingPdf(false);
    }
  };

  useEffect(() => {
    if (open) {
      setEmailTo(order.customerEmail ?? "");
      generatePaymentLink();
      loadPreview();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSend = async () => {
    setSending(true);
    try {
      const data = await apiFetch<{ sent: boolean; error?: string; to: string }>(
        `/orders/${order.id}/send-acknowledgement`,
        { method: "POST", body: JSON.stringify(emailTo ? { toEmail: emailTo } : {}) }
      );
      if (data.sent) {
        setSent(true);
        setEmailTo(data.to);
        toast({ title: "Acknowledgement sent", description: `Email delivered to ${data.to}` });
        onSent?.();
      } else {
        toast({ title: "Email not sent", description: data.error ?? "Email is not configured.", variant: "destructive" });
      }
    } catch (err: any) {
      if (err.message.includes("No customer email")) {
        toast({ title: "No email address", description: "Please enter the customer's email address.", variant: "destructive" });
      } else {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    } finally {
      setSending(false);
    }
  };

  const handleCopyEmail = async () => {
    await navigator.clipboard.writeText(emailText || "").catch(() => {});
    setEmailCopied(true);
    setTimeout(() => setEmailCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-600" />
            Send Order Acknowledgement
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {sent ? (
            <div className="flex items-start gap-3 rounded-lg bg-green-50 border border-green-200 p-4">
              <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-800">Acknowledgement sent!</p>
                <p className="text-xs text-green-700 mt-0.5">
                  The personalised email with payment link was delivered to <span className="font-medium">{emailTo}</span>.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Payment link */}
              <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <CreditCard className="w-4 h-4 text-blue-600" />
                  Stripe Payment Link
                </div>

                {paymentLinkLoading && !paymentLinkUrl && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" /> Generating unique payment link…
                  </p>
                )}

                {paymentLinkUrl && (
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
                      <button
                        onClick={generatePaymentLink}
                        disabled={paymentLinkLoading}
                        className="shrink-0 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        {paymentLinkLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Regenerate"}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">Total inc. 20% VAT — included automatically in the email.</p>
                  </div>
                )}

                {!paymentLinkLoading && !paymentLinkUrl && (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      {paymentLinkError
                        ? "Couldn't generate a unique link — the email will use the standard payment page instead."
                        : "No payment link yet."}
                    </p>
                    <Button size="sm" variant="outline" className="h-7 text-xs shrink-0 gap-1" onClick={generatePaymentLink} disabled={paymentLinkLoading}>
                      <Loader2 className={`w-3 h-3 ${paymentLinkLoading ? "animate-spin" : "hidden"}`} />
                      Retry
                    </Button>
                  </div>
                )}
              </div>

              {/* Email address */}
              <div className="grid gap-1.5">
                <Label htmlFor="send-ack-email">Send To</Label>
                <Input
                  id="send-ack-email"
                  placeholder="manager@example.com"
                  value={emailTo}
                  onChange={e => setEmailTo(e.target.value)}
                />
                {!emailTo && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <span>⚠</span> No email on file for this customer — please enter an address above.
                  </p>
                )}
                {emailTo && (
                  <p className="text-xs text-muted-foreground">Separate multiple addresses with commas.</p>
                )}
              </div>

              {/* Preview */}
              {emailSubject && (
                <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground mb-1 text-sm">{emailSubject}</p>
                  <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed max-h-28 overflow-y-auto">{emailText}</pre>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => handleClose(false)}>
            {sent ? "Close" : "Cancel"}
          </Button>
          {!sent && (
            <>
              <Button variant="outline" onClick={handlePreviewPdf} disabled={previewingPdf} className="gap-1.5">
                {previewingPdf
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading…</>
                  : <><FileText className="w-4 h-4" /> Preview PDF</>}
              </Button>
              {emailText && (
                <Button variant="outline" onClick={handleCopyEmail} className="gap-1.5">
                  {emailCopied ? <><Check className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Email</>}
                </Button>
              )}
              {emailConfigured && (
                <Button onClick={handleSend} disabled={sending} className="gap-1.5">
                  {sending
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                    : <><Mail className="w-4 h-4" /> Send Email</>}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
