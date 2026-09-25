import { useEffect } from "react";
import { useLocation, useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ArrowLeft, Package, PhoneCall } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import DemoLayout from "./DemoLayout";
import { getDemoToken, demoFetch, maskName, maskMoney, maskText } from "@/lib/demo";

const STATUS_LABELS: Record<string, string> = {
  pending:        "Pending",
  in_progress:    "In Progress",
  dispatched:     "Dispatched",
  invoiced:       "Invoiced",
  portal_pending: "Portal Pending",
  cancelled:      "Cancelled",
  quote:          "Quote",
};

function StatusBadge({ status }: { status: string }) {
  const colours: Record<string, string> = {
    pending:        "bg-amber-100  text-amber-700  border-amber-200",
    in_progress:    "bg-blue-100   text-blue-700   border-blue-200",
    dispatched:     "bg-emerald-100 text-emerald-700 border-emerald-200",
    invoiced:       "bg-indigo-100 text-indigo-700 border-indigo-200",
    portal_pending: "bg-violet-100 text-violet-700 border-violet-200",
    cancelled:      "bg-red-100    text-red-700    border-red-200",
    quote:          "bg-slate-100  text-slate-600  border-slate-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${colours[status] ?? "bg-muted text-muted-foreground border-border"}`}>
      {STATUS_LABELS[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function DemoOrderDetail() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();

  useEffect(() => {
    if (!getDemoToken()) setLocation("/demo");
  }, []);

  const { data: order, isLoading, error } = useQuery({
    queryKey: ["demo-order", params.id],
    queryFn: () => demoFetch(`/demo/orders/${params.id}`),
    enabled: !!params.id,
  });

  if (isLoading) {
    return (
      <DemoLayout>
        <div className="flex justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      </DemoLayout>
    );
  }

  if (error || !order) {
    return (
      <DemoLayout>
        <div className="text-center py-20">
          <Package className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="font-medium text-lg">Order not found</p>
          <Link href="/demo/orders">
            <Button variant="outline" className="mt-4">Back to orders</Button>
          </Link>
        </div>
      </DemoLayout>
    );
  }

  const items: any[] = order.items ?? [];
  const itemTotal = items.reduce((s: number, i: any) => s + parseFloat(i.line_total ?? "0"), 0);

  return (
    <DemoLayout>
      <div className="max-w-3xl space-y-5">

        {/* Back */}
        <Link href="/demo/orders">
          <a className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> All orders
          </a>
        </Link>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold font-mono">{order.order_number}</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Placed {formatDate(order.order_date)}</p>
          </div>
          <StatusBadge status={order.status} />
        </div>

        {/* Metadata cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="py-4 px-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Customer</p>
              <p className="font-medium text-sm text-muted-foreground/60 select-none">{maskName(order.customer_name)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 px-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Order date</p>
              <p className="font-medium text-sm">{formatDate(order.order_date)}</p>
            </CardContent>
          </Card>
          {order.required_date && (
            <Card>
              <CardContent className="py-4 px-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Required by</p>
                <p className="font-medium text-sm">{formatDate(order.required_date)}</p>
              </CardContent>
            </Card>
          )}
          {order.shipping_method && (
            <Card>
              <CardContent className="py-4 px-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Shipping</p>
                <p className="font-medium text-sm">{order.shipping_method}</p>
              </CardContent>
            </Card>
          )}
          {order.po_number && (
            <Card>
              <CardContent className="py-4 px-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">PO number</p>
                <p className="font-medium text-sm text-muted-foreground/60 select-none">{maskText(order.po_number, 3)}</p>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardContent className="py-4 px-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Order value</p>
              <p className="font-semibold text-sm text-muted-foreground/50 select-none font-mono">{maskMoney(order.total_amount)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Items */}
        <Card>
          <CardHeader className="py-3 px-5 border-b">
            <CardTitle className="text-base">Order items ({items.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Product</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right pr-5">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: any) => (
                  <TableRow key={item.id} className="hover:bg-muted/30">
                    <TableCell className="pl-5 font-medium text-sm">{item.product_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[item.colour, item.size].filter(Boolean).join(" / ") || "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground/60 select-none">
                      {item.recipient_name ? maskName(item.recipient_name) : "—"}
                    </TableCell>
                    <TableCell className="text-center text-sm">{item.quantity}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground/50 select-none font-mono">{maskMoney(item.unit_price)}</TableCell>
                    <TableCell className="text-right pr-5 text-sm font-medium text-muted-foreground/50 select-none font-mono">{maskMoney(item.line_total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Totals */}
            <div className="border-t px-5 py-3 flex justify-end">
              <div className="text-right space-y-1">
                <div className="flex gap-16 text-sm">
                  <span className="text-muted-foreground">Order total</span>
                  <span className="font-semibold text-muted-foreground/50 select-none font-mono">{maskMoney(itemTotal)}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notes */}
        {order.notes && (
          <Card>
            <CardContent className="py-4 px-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Notes</p>
              <p className="text-sm text-muted-foreground/60 select-none whitespace-pre-line">{maskText(order.notes, 4)}</p>
            </CardContent>
          </Card>
        )}

        {/* CTA */}
        <div className="rounded-xl border bg-muted/30 px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <p className="font-medium text-sm">Like what you see?</p>
            <p className="text-muted-foreground text-xs mt-0.5">Our team would love to walk you through a live tailored demo.</p>
          </div>
          <a href="mailto:">
            <Button size="sm" className="gap-2 shrink-0">
              <PhoneCall className="w-3.5 h-3.5" /> Get in touch
            </Button>
          </a>
        </div>

      </div>
    </DemoLayout>
  );
}
