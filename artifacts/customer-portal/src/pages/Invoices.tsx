import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import PortalLayout from "@/components/Layout";
import { apiFetch, API_BASE } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, FileText, Download, Receipt, CheckCircle2, Clock, AlertCircle } from "lucide-react";

interface Invoice {
  id: number;
  order_number: string | null;
  invoice_email_sent_at: string;
  invoice_date: string | null;
  total_amount: string | null;
  xero_invoice_id: string | null;
  xero_invoice_status: string | null;
  tracking_number: string | null;
  order_date: string | null;
  po_number: string | null;
  customer_name: string | null;
  status: string | null;
}

function XeroStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const s = status.toUpperCase();
  if (s === "PAID")
    return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200"><CheckCircle2 className="w-3 h-3 mr-1" />Paid</Badge>;
  if (s === "AUTHORISED")
    return <Badge className="bg-blue-100 text-blue-700 border-blue-200"><Clock className="w-3 h-3 mr-1" />Awaiting Payment</Badge>;
  if (s === "VOIDED" || s === "DELETED")
    return <Badge variant="outline" className="text-muted-foreground">Voided</Badge>;
  return <Badge variant="outline" className="text-muted-foreground capitalize">{status.toLowerCase()}</Badge>;
}

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const [downloading, setDownloading] = useState(false);

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const token = localStorage.getItem("portal_token");
      const res = await fetch(`${API_BASE}/portal/invoices/${invoice.id}/pdf`, {
        headers: token ? { Authorization: "Bearer " + token } : {},
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Invoice-${invoice.order_number ?? invoice.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download invoice PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const displayDate = invoice.invoice_date ?? invoice.invoice_email_sent_at;

  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="py-4 px-5">
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex h-10 w-10 rounded-lg bg-primary/10 items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-primary" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-foreground">
                {invoice.order_number ?? `Order #${invoice.id}`}
              </span>
              {invoice.po_number && (
                <span className="text-xs text-muted-foreground font-mono bg-muted/60 px-1.5 py-0.5 rounded">
                  PO: {invoice.po_number}
                </span>
              )}
              <XeroStatusBadge status={invoice.xero_invoice_status} />
              {!invoice.xero_invoice_status && (
                <Badge variant="outline" className="text-muted-foreground text-xs">
                  <AlertCircle className="w-3 h-3 mr-1" />Invoiced
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
              {displayDate && (
                <span>Invoice date: {formatDate(displayDate)}</span>
              )}
              {invoice.total_amount && (
                <span className="font-medium text-foreground">
                  {formatCurrency(parseFloat(invoice.total_amount) * 1.2)} inc. VAT
                </span>
              )}
              {invoice.total_amount && (
                <span className="text-xs">
                  ({formatCurrency(parseFloat(invoice.total_amount))} ex. VAT)
                </span>
              )}
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={downloadPdf}
            disabled={downloading}
          >
            {downloading
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span className="hidden sm:inline">Downloading…</span></>
              : <><Download className="w-3.5 h-3.5" /><span className="hidden sm:inline">Download PDF</span><span className="sm:hidden">PDF</span></>
            }
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Invoices() {
  const { data: invoices, isLoading } = useQuery<Invoice[]>({
    queryKey: ["portal-invoices"],
    queryFn: () => apiFetch("/portal/invoices"),
  });

  const paid = invoices?.filter(i => i.xero_invoice_status?.toUpperCase() === "PAID") ?? [];
  const awaiting = invoices?.filter(i => i.xero_invoice_status?.toUpperCase() === "AUTHORISED") ?? [];

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-1">Download your invoices and check payment status.</p>
        </div>

        {isLoading && (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && (!invoices || invoices.length === 0) && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <Receipt className="w-10 h-10 text-muted-foreground/30" />
              <p className="font-medium text-muted-foreground">No invoices yet</p>
              <p className="text-sm text-muted-foreground/70 max-w-xs">
                Your invoices will appear here once orders have been completed and invoiced.
              </p>
            </CardContent>
          </Card>
        )}

        {invoices && invoices.length > 0 && (
          <>
            {/* Summary bar */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Card>
                <CardContent className="py-4 px-5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total Invoices</p>
                  <p className="text-2xl font-bold mt-1">{invoices.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4 px-5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Paid</p>
                  <p className="text-2xl font-bold mt-1 text-emerald-600">{paid.length}</p>
                </CardContent>
              </Card>
              <Card className="col-span-2 sm:col-span-1">
                <CardContent className="py-4 px-5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Awaiting Payment</p>
                  <p className="text-2xl font-bold mt-1 text-blue-600">{awaiting.length}</p>
                </CardContent>
              </Card>
            </div>

            {/* Invoice list */}
            <div className="space-y-2">
              {invoices.map((invoice) => (
                <InvoiceRow key={invoice.id} invoice={invoice} />
              ))}
            </div>
          </>
        )}
      </div>
    </PortalLayout>
  );
}
