import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Mail, Copy, Check, CheckCircle2, FileText, Link as LinkIcon } from "lucide-react";
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

interface SendQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: { id: number; quoteNumber: string; customerName: string | null; customerEmail?: string | null };
  onSent?: () => void;
}

export function SendQuoteDialog({ open, onOpenChange, quote, onSent }: SendQuoteDialogProps) {
  const { toast } = useToast();
  const [emailTo, setEmailTo] = useState(quote.customerEmail ?? "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [emailText, setEmailText] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [portalLink, setPortalLink] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);
  const [previewingPdf, setPreviewingPdf] = useState(false);

  const reset = () => {
    setEmailTo(quote.customerEmail ?? "");
    setSending(false);
    setSent(false);
    setEmailText("");
    setEmailSubject("");
    setEmailConfigured(true);
    setPortalLink("");
    setLinkCopied(false);
    setEmailCopied(false);
    setPreviewingPdf(false);
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const loadPreview = async () => {
    try {
      const data = await apiFetch<{ text: string; subject: string; to: string; emailConfigured: boolean; portalLink: string }>(
        `/quotes/${quote.id}/send`,
        { method: "POST", body: JSON.stringify({ previewOnly: true }) }
      );
      setEmailText(data.text);
      setEmailSubject(data.subject);
      setEmailConfigured(data.emailConfigured ?? true);
      setPortalLink(data.portalLink ?? "");
      if (data.to) setEmailTo(data.to);
    } catch {}
  };

  useEffect(() => {
    if (open) {
      // Seed the field immediately with the already-loaded email; the preview
      // call below may refine it (e.g. with a manager email from the portal).
      if (!emailTo && quote.customerEmail) setEmailTo(quote.customerEmail);
      loadPreview();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSend = async () => {
    setSending(true);
    try {
      const data = await apiFetch<{ sent: boolean; error?: string; to: string }>(
        `/quotes/${quote.id}/send`,
        { method: "POST", body: JSON.stringify(emailTo ? { toEmail: emailTo } : {}) }
      );
      if (data.sent) {
        setSent(true);
        setEmailTo(data.to);
        toast({ title: "Quote sent", description: `Email delivered to ${data.to}` });
        onSent?.();
      } else {
        toast({ title: "Email not sent", description: data.error ?? "Email is not configured.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handlePreviewPdf = async () => {
    setPreviewingPdf(true);
    try {
      const res = await fetch(`${API_BASE}/quotes/${quote.id}/pdf`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (err: any) {
      toast({ title: "PDF preview failed", description: err.message, variant: "destructive" });
    } finally {
      setPreviewingPdf(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-600" />
            Send Quote — {quote.quoteNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {sent ? (
            <div className="flex items-start gap-3 rounded-lg bg-green-50 border border-green-200 p-4">
              <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-800">Quote sent!</p>
                <p className="text-xs text-green-700 mt-0.5">
                  The quote email with PDF attachment was delivered to <span className="font-medium">{emailTo}</span>.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Portal link */}
              {portalLink && (
                <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <LinkIcon className="w-4 h-4 text-blue-600" />
                    Customer Quote Link
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={portalLink}
                      className="text-xs flex-1 rounded border bg-background px-2 py-1 font-mono outline-none select-all min-w-0"
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(portalLink).catch(() => {});
                        setLinkCopied(true);
                        setTimeout(() => setLinkCopied(false), 2000);
                      }}
                      className="shrink-0 flex items-center gap-1 text-xs border rounded px-2 py-1 hover:bg-muted transition-colors"
                    >
                      {linkCopied ? <><Check className="w-3 h-3 text-green-600" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">This link is included in the email — the customer clicks it to review items and place their order.</p>
                </div>
              )}

              {/* Email address */}
              <div className="grid gap-1.5">
                <Label htmlFor="send-quote-email">Send To</Label>
                <Input
                  id="send-quote-email"
                  placeholder="customer@example.com"
                  value={emailTo}
                  onChange={e => setEmailTo(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Defaults to the customer's manager email. Separate multiple addresses with commas.</p>
              </div>

              {/* Email preview — strip the "Subject\n====\n\n" header from the plain
                  text since the subject is already shown in the heading above */}
              {emailSubject && (
                <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground mb-1 text-sm">{emailSubject}</p>
                  <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed max-h-28 overflow-y-auto overflow-x-hidden">
                    {emailText.replace(/^[^\n]*\n=+\n\n?/, "")}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex flex-row flex-wrap items-center justify-between gap-2 pt-2 border-t">
          <Button variant="outline" onClick={() => handleClose(false)}>
            {sent ? "Close" : "Cancel"}
          </Button>
          {!sent && (
            <div className="flex items-center flex-wrap gap-2">
              <Button variant="outline" onClick={handlePreviewPdf} disabled={previewingPdf} className="gap-1.5">
                {previewingPdf
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading…</>
                  : <><FileText className="w-4 h-4" /> Preview PDF</>}
              </Button>
              {emailText && (
                <Button variant="outline" onClick={() => {
                  navigator.clipboard.writeText(emailText).catch(() => {});
                  setEmailCopied(true);
                  setTimeout(() => setEmailCopied(false), 2000);
                }} className="gap-1.5">
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
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
