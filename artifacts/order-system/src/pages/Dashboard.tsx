import { useState, useRef, useEffect } from "react";
import Layout from "@/components/Layout";
import {
  useGetDashboardStats,
  useListCustomers,
  useListOrders,
  useCreateOrder,
  getListOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/StatusBadge";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  PoundSterling,
  ShoppingCart,
  Users,
  Package,
  ArrowRight,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  User,
  FileText,
  X,
  TrendingUp,
  BarChart2,
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  BarChart, Bar,
} from "recharts";

const API_BASE = "/api";
async function apiFetch<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface ProfitWeek {
  week_start: string;
  order_count: number;
  revenue: number;
  cost: number;
  gross_profit: number;
  gp_margin: number | null;
}
interface ProfitMonth {
  month_start: string;
  order_count: number;
  revenue: number;
  cost: number;
  gross_profit: number;
  gp_margin: number | null;
}
interface ProfitJob {
  id: number;
  order_number: string;
  customer_name: string | null;
  order_date: string;
  status: string;
  revenue: number;
  cost: number;
  gross_profit: number;
  gp_margin: number | null;
}
interface ProfitStats {
  weekly: ProfitWeek[];
  monthly: ProfitMonth[];
  jobs: ProfitJob[];
}

function fmtWeek(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function fmtMonth(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}
function fmtPct(v: number | null) {
  if (v == null) return "—";
  return `${v.toFixed(0)}%`;
}
function gpColor(gp: number) {
  return gp >= 0 ? "text-emerald-700" : "text-red-600";
}
function marginColor(m: number | null) {
  if (m == null) return "text-muted-foreground";
  if (m >= 30) return "text-emerald-700";
  if (m >= 15) return "text-amber-700";
  return "text-red-600";
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: stats, isLoading } = useGetDashboardStats();
  const { data: customers } = useListCustomers();
  const { data: orders } = useListOrders();
  const createOrderMutation = useCreateOrder();

  const { data: profitStats } = useQuery<ProfitStats>({
    queryKey: ["dashboard-profit-stats"],
    queryFn: () => apiFetch("/dashboard/profit-stats"),
  });

  const [profitView, setProfitView] = useState<"weekly" | "monthly">("weekly");

  // Customer search
  const [customerQuery, setCustomerQuery] = useState("");
  const [showCustomerResults, setShowCustomerResults] = useState(false);
  const customerSearchRef = useRef<HTMLDivElement>(null);

  // Order search
  const [orderQuery, setOrderQuery] = useState("");
  const [showOrderResults, setShowOrderResults] = useState(false);
  const orderSearchRef = useRef<HTMLDivElement>(null);

  // New Order dialog
  const [isNewOrderOpen, setIsNewOrderOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");

  // New Return dialog
  const [isNewReturnOpen, setIsNewReturnOpen] = useState(false);
  const [returnOrderId, setReturnOrderId] = useState<string>("");
  const [returnReason, setReturnReason] = useState("");

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (customerSearchRef.current && !customerSearchRef.current.contains(e.target as Node)) {
        setShowCustomerResults(false);
      }
      if (orderSearchRef.current && !orderSearchRef.current.contains(e.target as Node)) {
        setShowOrderResults(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filteredCustomers = customers?.filter((c) => {
    const q = customerQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.email?.toLowerCase().includes(q)) ||
      (c.phone?.toLowerCase().includes(q))
    );
  }).slice(0, 6) ?? [];

  const filteredOrders = orders?.filter((o) => {
    const q = orderQuery.toLowerCase();
    return (
      o.orderNumber.toLowerCase().includes(q) ||
      (o.customerName?.toLowerCase().includes(q))
    );
  }).slice(0, 6) ?? [];

  const handleCreateOrder = () => {
    createOrderMutation.mutate(
      {
        data: {
          customerId: selectedCustomerId ? parseInt(selectedCustomerId, 10) : null,
          orderDate: new Date().toISOString(),
          items: [],
        },
      },
      {
        onSuccess: (newOrder) => {
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          toast({ title: "Order Created", description: "Taking you to the new order..." });
          setIsNewOrderOpen(false);
          setSelectedCustomerId("");
          setLocation(`/orders/${newOrder.id}`);
        },
        onError: () => {
          toast({ title: "Error", description: "Could not create order.", variant: "destructive" });
        },
      }
    );
  };

  const handleCreateReturn = () => {
    if (!returnOrderId) {
      toast({ title: "Select an order", description: "Please select the order being returned.", variant: "destructive" });
      return;
    }
    const originalOrder = orders?.find((o) => o.id === parseInt(returnOrderId, 10));
    createOrderMutation.mutate(
      {
        data: {
          customerId: originalOrder?.customerId ?? null,
          notes: `RETURN — Original: ${originalOrder?.orderNumber ?? ""}${returnReason ? `. Reason: ${returnReason}` : ""}`,
          orderDate: new Date().toISOString(),
          items: [],
        },
      },
      {
        onSuccess: (newOrder) => {
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          toast({ title: "Return Created", description: "Add the returned items on the next screen." });
          setIsNewReturnOpen(false);
          setReturnOrderId("");
          setReturnReason("");
          setLocation(`/orders/${newOrder.id}`);
        },
        onError: () => {
          toast({ title: "Error", description: "Could not create return.", variant: "destructive" });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex h-[50vh] items-center justify-center">
          <div className="flex flex-col items-center text-muted-foreground">
            <Loader2 className="w-10 h-10 animate-spin mb-4 text-primary" />
            <p className="font-medium animate-pulse">Loading dashboard...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (!stats) return null;

  const chartData = [
    { name: "Draft", value: stats.ordersByStatus.draft, color: "#94a3b8" },
    { name: "Confirmed", value: stats.ordersByStatus.confirmed, color: "#3b82f6" },
    { name: "Shipped", value: stats.ordersByStatus.shipped, color: "#f59e0b" },
    { name: "Delivered", value: stats.ordersByStatus.delivered, color: "#10b981" },
  ].filter((item) => item.value > 0);

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Overview</h1>
            <p className="text-muted-foreground mt-1">Here's what's happening with your business today.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => setIsNewOrderOpen(true)} className="shadow-sm shadow-primary/20">
              <Plus className="w-4 h-4 mr-2" /> New Order
            </Button>
            <Button variant="outline" onClick={() => setIsNewReturnOpen(true)}>
              <RotateCcw className="w-4 h-4 mr-2" /> New Return
            </Button>
          </div>
        </div>

        {/* Search Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Customer Search */}
          <div ref={customerSearchRef} className="relative">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Customer Search</p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by name, email or phone..."
                className="pl-9 pr-8 bg-background"
                value={customerQuery}
                onChange={(e) => {
                  setCustomerQuery(e.target.value);
                  setShowCustomerResults(e.target.value.length > 0);
                }}
                onFocus={() => customerQuery.length > 0 && setShowCustomerResults(true)}
              />
              {customerQuery && (
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => { setCustomerQuery(""); setShowCustomerResults(false); }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {showCustomerResults && customerQuery.length > 0 && (
              <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-card border border-border rounded-xl shadow-lg overflow-hidden">
                {filteredCustomers.length > 0 ? (
                  filteredCustomers.map((c) => (
                    <button
                      key={c.id}
                      className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-center gap-3 border-b border-border/40 last:border-0"
                      onClick={() => {
                        setShowCustomerResults(false);
                        setCustomerQuery("");
                        setLocation("/customers");
                      }}
                    >
                      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm flex-shrink-0">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground text-sm truncate">{c.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.email ?? c.phone ?? "No contact info"}</p>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground ml-auto flex-shrink-0" />
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
                    <User className="w-4 h-4" /> No customers found
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Order Search */}
          <div ref={orderSearchRef} className="relative">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Order Search</p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by order number or customer..."
                className="pl-9 pr-8 bg-background"
                value={orderQuery}
                onChange={(e) => {
                  setOrderQuery(e.target.value);
                  setShowOrderResults(e.target.value.length > 0);
                }}
                onFocus={() => orderQuery.length > 0 && setShowOrderResults(true)}
              />
              {orderQuery && (
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => { setOrderQuery(""); setShowOrderResults(false); }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {showOrderResults && orderQuery.length > 0 && (
              <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-card border border-border rounded-xl shadow-lg overflow-hidden">
                {filteredOrders.length > 0 ? (
                  filteredOrders.map((o) => (
                    <button
                      key={o.id}
                      className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-center gap-3 border-b border-border/40 last:border-0"
                      onClick={() => {
                        setShowOrderResults(false);
                        setOrderQuery("");
                        setLocation(`/orders/${o.id}`);
                      }}
                    >
                      <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground text-sm">{o.orderNumber}</p>
                        <p className="text-xs text-muted-foreground truncate">{o.customerName ?? "No customer"} &bull; {formatDate(o.orderDate)}</p>
                      </div>
                      <StatusBadge status={o.status} className="flex-shrink-0" />
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
                    <FileText className="w-4 h-4" /> No orders found
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-card shadow-sm border-border/50 overflow-hidden relative hover:shadow-md transition-all duration-300">
            <div className="absolute top-0 left-0 w-1 h-full bg-blue-500" />
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle>
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <PoundSterling className="w-5 h-5 text-blue-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl lg:text-3xl font-bold text-foreground font-display">
                {formatCurrency(stats.totalRevenue)}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card shadow-sm border-border/50 overflow-hidden relative hover:shadow-md transition-all duration-300">
            <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500" />
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Orders</CardTitle>
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                <ShoppingCart className="w-5 h-5 text-indigo-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl lg:text-3xl font-bold text-foreground font-display">
                {stats.totalOrders}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card shadow-sm border-border/50 overflow-hidden relative hover:shadow-md transition-all duration-300">
            <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500" />
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Customers</CardTitle>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                <Users className="w-5 h-5 text-emerald-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl lg:text-3xl font-bold text-foreground font-display">
                {stats.totalCustomers}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card shadow-sm border-border/50 overflow-hidden relative hover:shadow-md transition-all duration-300">
            <div className="absolute top-0 left-0 w-1 h-full bg-amber-500" />
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Products</CardTitle>
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                <Package className="w-5 h-5 text-amber-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl lg:text-3xl font-bold text-foreground font-display">
                {stats.totalProducts}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Chart + Recent Orders */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="col-span-1 shadow-sm border-border/50 flex flex-col">
            <CardHeader>
              <CardTitle className="font-display">Orders by Status</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-[280px]">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} stroke="transparent" />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => [`${value} Orders`, "Count"]}
                      contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                    />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  No order data available
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="col-span-1 lg:col-span-2 shadow-sm border-border/50">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display">Recent Orders</CardTitle>
              <Link href="/orders" className="text-sm font-medium text-primary flex items-center hover:underline">
                View all <ArrowRight className="ml-1 w-4 h-4" />
              </Link>
            </CardHeader>
            <CardContent>
              {stats.recentOrders.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-border/50">
                  <Table>
                    <TableHeader className="bg-muted/30">
                      <TableRow>
                        <TableHead className="font-medium text-foreground">Order</TableHead>
                        <TableHead className="font-medium text-foreground">Customer</TableHead>
                        <TableHead className="font-medium text-foreground">Date</TableHead>
                        <TableHead className="font-medium text-foreground">Status</TableHead>
                        <TableHead className="text-right font-medium text-foreground">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.recentOrders.map((order) => (
                        <TableRow key={order.id} className="hover:bg-muted/30 transition-colors">
                          <TableCell>
                            <Link href={`/orders/${order.id}`} className="font-medium text-primary hover:underline">
                              {order.orderNumber}
                            </Link>
                          </TableCell>
                          <TableCell className="font-medium text-foreground">{order.customerName || "Unknown"}</TableCell>
                          <TableCell className="text-muted-foreground">{formatDate(order.orderDate)}</TableCell>
                          <TableCell><StatusBadge status={order.status} /></TableCell>
                          <TableCell className="text-right font-bold text-foreground">
                            {formatCurrency(order.totalAmount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground border-2 border-dashed border-border/50 rounded-xl">
                  <Package className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                  <p className="font-medium text-foreground">No orders yet</p>
                  <p className="text-sm mt-1 mb-4">Create your first sales order to see it here.</p>
                  <Button onClick={() => setIsNewOrderOpen(true)} size="sm">
                    <Plus className="w-4 h-4 mr-1" /> Create Order
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Revenue & Gross Profit ── */}
        {profitStats && (
          <>
            {/* GP KPI row */}
            {(() => {
              const now = new Date();
              const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
              const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

              const thisWeekJobs = (profitStats.jobs ?? []).filter(j => new Date(j.order_date) >= weekAgo);
              const thisMonthJobs = (profitStats.jobs ?? []).filter(j => new Date(j.order_date) >= monthStart);

              const weekGP = thisWeekJobs.reduce((s, j) => s + j.gross_profit, 0);
              const monthGP = thisMonthJobs.reduce((s, j) => s + j.gross_profit, 0);
              const monthRev = thisMonthJobs.reduce((s, j) => s + j.revenue, 0);
              const monthMargin = monthRev > 0 ? (monthGP / monthRev) * 100 : null;
              const allRev = (profitStats.jobs ?? []).reduce((s, j) => s + j.revenue, 0);
              const allGP = (profitStats.jobs ?? []).reduce((s, j) => s + j.gross_profit, 0);
              const overallMargin = allRev > 0 ? (allGP / allRev) * 100 : null;

              return (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Card className="bg-card shadow-sm border-border/50 overflow-hidden relative hover:shadow-md transition-all duration-300">
                    <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500" />
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Gross Profit — This Week</CardTitle>
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                        <TrendingUp className="w-5 h-5 text-emerald-600" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className={`text-2xl lg:text-3xl font-bold font-display ${gpColor(weekGP)}`}>{formatCurrency(weekGP)}</div>
                      <p className="text-xs text-muted-foreground mt-1">{thisWeekJobs.length} order{thisWeekJobs.length !== 1 ? "s" : ""} this week</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-card shadow-sm border-border/50 overflow-hidden relative hover:shadow-md transition-all duration-300">
                    <div className="absolute top-0 left-0 w-1 h-full bg-teal-500" />
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Gross Profit — This Month</CardTitle>
                      <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center">
                        <BarChart2 className="w-5 h-5 text-teal-600" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className={`text-2xl lg:text-3xl font-bold font-display ${gpColor(monthGP)}`}>{formatCurrency(monthGP)}</div>
                      <p className={`text-xs mt-1 font-medium ${marginColor(monthMargin)}`}>
                        {fmtPct(monthMargin)} margin
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="bg-card shadow-sm border-border/50 overflow-hidden relative hover:shadow-md transition-all duration-300">
                    <div className="absolute top-0 left-0 w-1 h-full bg-cyan-500" />
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Overall GP Margin</CardTitle>
                      <div className="w-10 h-10 rounded-xl bg-cyan-50 flex items-center justify-center">
                        <PoundSterling className="w-5 h-5 text-cyan-600" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className={`text-2xl lg:text-3xl font-bold font-display ${marginColor(overallMargin)}`}>{fmtPct(overallMargin)}</div>
                      <p className="text-xs text-muted-foreground mt-1">across recent {profitStats.jobs.length} orders</p>
                    </CardContent>
                  </Card>
                </div>
              );
            })()}

            {/* Revenue & GP Worm */}
            <Card className="shadow-sm border-border/50">
              <CardHeader className="py-3 px-5 border-b border-border/40 bg-muted/10 flex flex-row items-center gap-3">
                <TrendingUp className="w-4 h-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-sm">Revenue &amp; Gross Profit</span>
                </div>
                <Tabs value={profitView} onValueChange={(v) => setProfitView(v as "weekly" | "monthly")} className="shrink-0">
                  <TabsList className="h-7">
                    <TabsTrigger value="weekly" className="text-xs px-3 h-6">13-week worm</TabsTrigger>
                    <TabsTrigger value="monthly" className="text-xs px-3 h-6">Monthly</TabsTrigger>
                  </TabsList>
                </Tabs>
              </CardHeader>
              <CardContent className="pt-4 pb-3 px-2">
                {profitView === "weekly" ? (
                  profitStats.weekly.length === 0 ? (
                    <div className="h-36 flex items-center justify-center text-muted-foreground text-sm">No data for the past 13 weeks</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={160}>
                      <AreaChart data={profitStats.weekly.map(w => ({
                        week: fmtWeek(w.week_start),
                        revenue: Math.round(w.revenue),
                        gp: Math.round(w.gross_profit),
                        orders: w.order_count,
                      }))} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#1e3a5f" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#1e3a5f" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gpGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                        <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#888" }} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={(v) => v === 0 ? "" : `£${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: "#888" }} axisLine={false} tickLine={false} width={36} />
                        <Tooltip
                          formatter={(v: number, name: string) => [formatCurrency(v), name === "revenue" ? "Revenue" : "Gross Profit"]}
                          labelFormatter={(l) => `Week of ${l}`}
                          contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb" }}
                        />
                        <Area type="monotone" dataKey="revenue" stroke="#1e3a5f" strokeWidth={2} fill="url(#revGrad)" dot={{ r: 2, fill: "#1e3a5f" }} name="revenue" />
                        <Area type="monotone" dataKey="gp" stroke="#10b981" strokeWidth={2} fill="url(#gpGrad)" dot={{ r: 2, fill: "#10b981" }} name="gp" />
                        <Legend iconType="circle" iconSize={8} formatter={(v) => v === "revenue" ? "Revenue" : "Gross Profit"} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )
                ) : (
                  profitStats.monthly.length === 0 ? (
                    <div className="h-36 flex items-center justify-center text-muted-foreground text-sm">No monthly data available</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={profitStats.monthly.map(m => ({
                        month: fmtMonth(m.month_start),
                        revenue: Math.round(m.revenue),
                        gp: Math.round(m.gross_profit),
                        orders: m.order_count,
                      }))} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#888" }} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={(v) => v === 0 ? "" : `£${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: "#888" }} axisLine={false} tickLine={false} width={36} />
                        <Tooltip
                          formatter={(v: number, name: string) => [formatCurrency(v), name === "revenue" ? "Revenue" : "Gross Profit"]}
                          contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb" }}
                        />
                        <Bar dataKey="revenue" fill="#1e3a5f" radius={[3, 3, 0, 0]} name="revenue" />
                        <Bar dataKey="gp" fill="#10b981" radius={[3, 3, 0, 0]} name="gp" />
                        <Legend iconType="circle" iconSize={8} formatter={(v) => v === "revenue" ? "Revenue" : "Gross Profit"} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                      </BarChart>
                    </ResponsiveContainer>
                  )
                )}
              </CardContent>
            </Card>

            {/* Per-job GP table */}
            <Card className="shadow-sm border-border/50">
              <CardHeader className="py-3 px-5 border-b border-border/40 bg-muted/10 flex flex-row items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm">Gross Profit — Per Job</span>
                <span className="text-xs text-muted-foreground ml-1">— recent 25 orders</span>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-muted/30">
                      <TableRow>
                        <TableHead className="font-medium text-foreground">Order</TableHead>
                        <TableHead className="font-medium text-foreground">Customer</TableHead>
                        <TableHead className="font-medium text-foreground hidden sm:table-cell">Date</TableHead>
                        <TableHead className="font-medium text-foreground hidden md:table-cell">Status</TableHead>
                        <TableHead className="text-right font-medium text-foreground">Revenue</TableHead>
                        <TableHead className="text-right font-medium text-foreground hidden lg:table-cell">Cost</TableHead>
                        <TableHead className="text-right font-medium text-foreground">GP</TableHead>
                        <TableHead className="text-right font-medium text-foreground">Margin</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profitStats.jobs.map((job) => (
                        <TableRow key={job.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setLocation(`/orders/${job.id}`)}>
                          <TableCell>
                            <span className="font-medium text-primary">{job.order_number}</span>
                          </TableCell>
                          <TableCell className="text-sm text-foreground">{job.customer_name ?? "—"}</TableCell>
                          <TableCell className="text-muted-foreground text-sm hidden sm:table-cell">{formatDate(job.order_date)}</TableCell>
                          <TableCell className="hidden md:table-cell"><StatusBadge status={job.status} /></TableCell>
                          <TableCell className="text-right tabular-nums font-mono text-sm">{formatCurrency(job.revenue)}</TableCell>
                          <TableCell className="text-right tabular-nums font-mono text-sm text-muted-foreground hidden lg:table-cell">{formatCurrency(job.cost)}</TableCell>
                          <TableCell className={`text-right tabular-nums font-mono text-sm font-semibold ${gpColor(job.gross_profit)}`}>{formatCurrency(job.gross_profit)}</TableCell>
                          <TableCell className={`text-right tabular-nums text-sm font-semibold ${marginColor(job.gp_margin)}`}>{fmtPct(job.gp_margin)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* New Order Dialog */}
      <Dialog open={isNewOrderOpen} onOpenChange={setIsNewOrderOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">New Sales Order</DialogTitle>
            <DialogDescription>
              Select a customer to create a draft order. You can add products on the next screen.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="new-order-customer">Customer (optional)</Label>
              <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                <SelectTrigger id="new-order-customer">
                  <SelectValue placeholder="Choose a customer..." />
                </SelectTrigger>
                <SelectContent>
                  {customers?.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsNewOrderOpen(false); setSelectedCustomerId(""); }}>
              Cancel
            </Button>
            <Button onClick={handleCreateOrder} disabled={createOrderMutation.isPending}>
              {createOrderMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : "Create Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Return Dialog */}
      <Dialog open={isNewReturnOpen} onOpenChange={setIsNewReturnOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-amber-500" /> New Return
            </DialogTitle>
            <DialogDescription>
              Select the original order being returned. A return order will be created so you can record the items coming back.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="return-order">Original Order</Label>
              <Select value={returnOrderId} onValueChange={setReturnOrderId}>
                <SelectTrigger id="return-order">
                  <SelectValue placeholder="Select original order..." />
                </SelectTrigger>
                <SelectContent>
                  {orders?.filter(o => !o.notes?.startsWith("RETURN")).map((o) => (
                    <SelectItem key={o.id} value={o.id.toString()}>
                      {o.orderNumber} — {o.customerName ?? "No customer"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="return-reason">Reason for Return</Label>
              <Textarea
                id="return-reason"
                placeholder="e.g. Faulty item, wrong product shipped..."
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsNewReturnOpen(false); setReturnOrderId(""); setReturnReason(""); }}>
              Cancel
            </Button>
            <Button onClick={handleCreateReturn} disabled={!returnOrderId || createOrderMutation.isPending} variant="default">
              {createOrderMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : "Create Return"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
