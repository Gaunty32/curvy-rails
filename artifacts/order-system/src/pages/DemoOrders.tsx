import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import DemoLayout from "./DemoLayout";
import { getDemoToken, demoFetch, maskName, maskMoney } from "@/lib/demo";

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
    pending:        "bg-amber-100  text-amber-700",
    in_progress:    "bg-blue-100   text-blue-700",
    dispatched:     "bg-emerald-100 text-emerald-700",
    invoiced:       "bg-indigo-100 text-indigo-700",
    portal_pending: "bg-violet-100 text-violet-700",
    cancelled:      "bg-red-100    text-red-700",
    quote:          "bg-slate-100  text-slate-600",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colours[status] ?? "bg-muted text-muted-foreground"}`}>
      {STATUS_LABELS[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function DemoOrders() {
  const [, setLocation] = useLocation();
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState("");
  const PAGE_SIZE = 30;

  useEffect(() => {
    if (!getDemoToken()) setLocation("/demo");
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["demo-orders", page],
    queryFn: () => demoFetch(`/demo/orders?page=${page}`),
  });

  const allOrders: any[] = data?.orders ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filtered = search.trim()
    ? allOrders.filter((o: any) =>
        o.order_number?.toLowerCase().includes(search.toLowerCase()) ||
        o.status?.toLowerCase().includes(search.toLowerCase())
      )
    : allOrders;

  return (
    <DemoLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Orders</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {total.toLocaleString()} orders in system
            </p>
          </div>
          <div className="relative w-60">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by ref or status…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5 w-36">Order ref</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Order date</TableHead>
                    <TableHead>Required by</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                        No orders match your search
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((order: any) => (
                      <TableRow key={order.id} className="hover:bg-muted/40">
                        <TableCell className="pl-5 font-mono text-xs font-medium">
                          <Link href={`/demo/orders/${order.id}`}>
                            <a className="text-primary hover:underline">{order.order_number}</a>
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className="text-muted-foreground/60 select-none">{maskName(order.customer_name)}</span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(order.order_date)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(order.required_date)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground/50 select-none font-mono">{maskMoney(order.total_amount)}</TableCell>
                        <TableCell><StatusBadge status={order.status} /></TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </DemoLayout>
  );
}
