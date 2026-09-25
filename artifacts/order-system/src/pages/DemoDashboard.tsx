import { useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ShoppingCart, Clock, Truck, PhoneCall, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import DemoLayout from "./DemoLayout";
import { getDemoToken, demoFetch, maskName, maskMoney } from "@/lib/demo";

const STATUS_COLOURS: Record<string, string> = {
  pending:       "#f59e0b",
  in_progress:   "#3b82f6",
  dispatched:    "#10b981",
  invoiced:      "#6366f1",
  portal_pending:"#8b5cf6",
  cancelled:     "#ef4444",
  quote:         "#94a3b8",
};

const STATUS_LABELS: Record<string, string> = {
  pending:        "Pending",
  in_progress:    "In Progress",
  dispatched:     "Dispatched",
  invoiced:       "Invoiced",
  portal_pending: "Portal Pending",
  cancelled:      "Cancelled",
  quote:          "Quote",
};

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

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
  const label = STATUS_LABELS[status] ?? status.replace(/_/g, " ");
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colours[status] ?? "bg-muted text-muted-foreground"}`}>
      {label}
    </span>
  );
}

export default function DemoDashboard() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!getDemoToken()) setLocation("/demo");
  }, []);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["demo-stats"],
    queryFn: () => demoFetch("/demo/stats"),
  });

  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ["demo-orders", 1],
    queryFn: () => demoFetch("/demo/orders?page=1"),
  });

  const recentOrders: any[] = (ordersData?.orders ?? []).slice(0, 8);
  const chartData = (stats?.byStatus ?? []).map((row: any) => ({
    name: STATUS_LABELS[row.status] ?? row.status,
    value: parseInt(row.cnt, 10),
    fill: STATUS_COLOURS[row.status] ?? "#94a3b8",
  })).filter((d: any) => d.value > 0);

  const summary = stats?.summary ?? {};

  return (
    <DemoLayout>
      <div className="space-y-6">

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Live order pipeline overview</p>
          </div>
          <a href="mailto:">
            <Button className="gap-2 shrink-0">
              <PhoneCall className="w-4 h-4" /> Get in touch
            </Button>
          </a>
        </div>

        {/* Stats */}
        {statsLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="py-5 px-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center">
                    <ShoppingCart className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total orders</p>
                    <p className="text-2xl font-bold">{parseInt(summary.total_orders ?? "0").toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-5 px-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Active orders</p>
                    <p className="text-2xl font-bold">{parseInt(summary.active_orders ?? "0").toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-5 px-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <Truck className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Dispatched</p>
                    <p className="text-2xl font-bold">{parseInt(summary.dispatched ?? "0").toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-5 px-5">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Value this month</p>
                  <p className="text-2xl font-bold text-muted-foreground/50 select-none">{maskMoney(summary.month_value)}</p>
                  <p className="text-[10px] text-muted-foreground/40 mt-0.5">Anonymised in demo</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">

          {/* Order status chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Orders by status</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              {statsLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={false}>
                      {chartData.map((entry: any, i: number) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => [`${v} orders`, ""]} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Recent orders */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Recent orders</CardTitle>
              <Link href="/demo/orders">
                <a className="text-xs text-primary flex items-center gap-1 hover:underline">View all <ArrowRight className="w-3 h-3" /></a>
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              {ordersLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5">Order</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentOrders.map((order: any) => (
                      <TableRow key={order.id} className="cursor-pointer hover:bg-muted/40">
                        <TableCell className="pl-5 font-mono text-xs font-medium">
                          <Link href={`/demo/orders/${order.id}`}>
                            <a className="text-primary hover:underline">{order.order_number}</a>
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className="text-muted-foreground/60 select-none">{maskName(order.customer_name)}</span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(order.order_date)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground/50 select-none font-mono">{maskMoney(order.total_amount)}</TableCell>
                        <TableCell><StatusBadge status={order.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

        </div>

        {/* CTA banner */}
        <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-7 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="text-white font-semibold text-lg mb-1">Ready to streamline your uniform management?</p>
            <p className="text-slate-400 text-sm">Our team will walk you through a tailored demo and discuss pricing.</p>
          </div>
          <a href="mailto:" className="shrink-0">
            <Button variant="secondary" className="gap-2 font-semibold">
              <PhoneCall className="w-4 h-4" /> Book a call
            </Button>
          </a>
        </div>

      </div>
    </DemoLayout>
  );
}
