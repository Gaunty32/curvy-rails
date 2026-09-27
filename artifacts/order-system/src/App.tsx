import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useVersionCheck } from "@/hooks/use-version-check";
import { RefreshCw, AlertTriangle } from "lucide-react";
import React, { useEffect, useState } from "react";
import InstallationSetup, { type SetupStatus } from "@/pages/InstallationSetup";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-lg w-full bg-card border border-destructive/30 rounded-xl shadow-md p-6 space-y-4">
            <div className="flex items-center gap-3 text-destructive">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h2 className="text-lg font-semibold">Something went wrong</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              The page crashed. The error below can help diagnose the issue.
            </p>
            <pre className="text-xs bg-muted rounded-lg p-3 overflow-auto max-h-48 text-foreground whitespace-pre-wrap">
              {this.state.error.message}
              {"\n\n"}
              {this.state.error.stack}
            </pre>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

import Dashboard from "@/pages/Dashboard";
import Orders from "@/pages/Orders";
import OrderDetail from "@/pages/OrderDetail";
import Customers from "@/pages/Customers";
import CustomerDetail from "@/pages/CustomerDetail";
import Products from "@/pages/Products";
import ProductDetail from "@/pages/ProductDetail";
import ProductBom from "@/pages/ProductBom";
import Components from "@/pages/Components";
import Stock from "@/pages/Stock";
import ProcessStock from "@/pages/ProcessStock";
import Purchasing from "@/pages/Purchasing";
import Production from "@/pages/Production";
import Suppliers from "@/pages/Suppliers";
import Dispatch from "@/pages/Dispatch";
import Settings from "@/pages/Settings";
import Tasks from "@/pages/Tasks";
import Invoices from "@/pages/Invoices";
import Reports from "@/pages/Reports";
import SelectExtra from "@/pages/SelectExtra";
import Quotes from "@/pages/Quotes";
import QuoteDetail from "@/pages/QuoteDetail";
import WooOrders from "@/pages/WooOrders";
import Bundles from "@/pages/Bundles";
import Enquiries from "@/pages/Enquiries";
import Feedback from "@/pages/Feedback";
import Chat from "@/pages/Chat";
import Templates from "@/pages/Templates";
import LiveChatSessions from "@/pages/LiveChatSessions";
import CategoryManager from "@/pages/CategoryManager";
import WorkflowEditor from "@/pages/WorkflowEditor";
import Campaigns from "@/pages/Campaigns";
import Callbacks from "@/pages/Callbacks";
import HowToLanding from "@/pages/how-to/HowToLanding";
import StockTakeGuide from "@/pages/how-to/StockTakeGuide";
import NotFound from "@/pages/not-found";
import DemoGate from "@/pages/DemoGate";
import DemoDashboard from "@/pages/DemoDashboard";
import DemoOrders from "@/pages/DemoOrders";
import DemoOrderDetail from "@/pages/DemoOrderDetail";
import DemoProducts from "@/pages/DemoProducts";
import DemoCustomers from "@/pages/DemoCustomers";
import DemoPortal from "@/pages/DemoPortal";
import DemoSection from "@/pages/DemoSection";
import PortalGuide from "@/pages/PortalGuide";
import Landing from "@/pages/Landing";
import StaffLogin from "@/pages/StaffLogin";
import TvDisplay from "@/pages/TvDisplay";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    }
  }
});

function UpdateBanner() {
  const updateAvailable = useVersionCheck();
  if (!updateAvailable) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between gap-3 bg-primary px-4 py-2.5 text-primary-foreground shadow-md">
      <p className="text-sm font-medium">A new version of the app is available.</p>
      <button
        onClick={() => window.location.reload()}
        className="flex items-center gap-1.5 rounded-md bg-white/20 px-3 py-1 text-sm font-semibold hover:bg-white/30 transition-colors shrink-0"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Refresh now
      </button>
    </div>
  );
}

// Resets the error boundary on every route change so a crash on page A
// doesn't keep showing the error card when the user navigates to page B.
function RouteErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary key={location}>{children}</ErrorBoundary>;
}

function InstallationGate() {
  const [location, setLocation] = useLocation();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refreshStatus() {
    try {
      const response = await fetch("/api/setup/status", { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : `Setup status is unavailable (${response.status}).`);
      }
      const result = await response.json() as SetupStatus;
      if (typeof result.activated !== "boolean" || typeof result.administratorConfigured !== "boolean") {
        throw new Error("The server returned an incomplete installation status.");
      }
      setStatus(result);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reach the setup server.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
    const interval = window.setInterval(() => { void refreshStatus(); }, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (status?.activated && location === "/setup") setLocation("/login");
    else if (status && !status.activated && location !== "/setup") setLocation("/setup");
  }, [location, setLocation, status]);

  if (loading && !status) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f172a] text-slate-300">
        <div className="flex items-center gap-3 text-sm"><RefreshCw className="h-4 w-4 animate-spin" />Checking installation status…</div>
      </div>
    );
  }

  if (!status && error) {
    return (
      <main className="min-h-screen bg-[#0f172a] p-6 text-white">
        <div className="mx-auto mt-16 max-w-xl rounded-2xl border border-amber-400/20 bg-white/[0.04] p-6">
          <div className="flex items-center gap-3 text-amber-200">
            <AlertTriangle className="h-5 w-5" />
            <h1 className="text-xl font-semibold">Installation setup is unavailable</h1>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-400">{error}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">The order system is kept locked until the server can confirm that installation is activated.</p>
          <button onClick={() => { setLoading(true); void refreshStatus(); }} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500">
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </div>
      </main>
    );
  }

  if (!status) return null;
  if (!status.activated) return <InstallationSetup status={status} onRefresh={refreshStatus} />;
  return <Router />;
}

function Router() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/" component={Landing} />
      <Route path="/login" component={StaffLogin} />
      <Route path="/portal-guide" component={PortalGuide} />
      <Route path="/tv-display" component={TvDisplay} />

      {/* Demo routes — no auth required */}
      <Route path="/demo" component={DemoGate} />
      <Route path="/demo/dashboard" component={DemoDashboard} />
      <Route path="/demo/orders" component={DemoOrders} />
      <Route path="/demo/orders/:id" component={DemoOrderDetail} />
      <Route path="/demo/products" component={DemoProducts} />
      <Route path="/demo/customers" component={DemoCustomers} />
      <Route path="/demo/portal" component={DemoPortal} />
      <Route path="/demo/stock" component={() => <DemoSection section="stock" />} />
      <Route path="/demo/process-stock" component={() => <DemoSection section="process-stock" />} />
      <Route path="/demo/production" component={() => <DemoSection section="production" />} />
      <Route path="/demo/purchasing" component={() => <DemoSection section="purchasing" />} />
      <Route path="/demo/dispatch" component={() => <DemoSection section="dispatch" />} />
      <Route path="/demo/invoicing" component={() => <DemoSection section="invoicing" />} />
      <Route path="/demo/suppliers" component={() => <DemoSection section="suppliers" />} />
      <Route path="/demo/tasks" component={() => <DemoSection section="tasks" />} />

      {/* Staff routes — auth enforced inside Layout */}
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/orders" component={Orders} />
      <Route path="/orders/:id" component={OrderDetail} />
      <Route path="/customers" component={Customers} />
      <Route path="/customers/:id" component={CustomerDetail} />
      <Route path="/products" component={Products} />
       <Route path="/products/:id/bom" component={ProductBom} />
      <Route path="/products/:id" component={ProductDetail} />
      <Route path="/stock" component={Stock} />
       <Route path="/components" component={Components} />
      <Route path="/process-stock" component={ProcessStock} />
      <Route path="/purchasing" component={Purchasing} />
      <Route path="/production" component={Production} />
      <Route path="/suppliers" component={Suppliers} />
      <Route path="/dispatch" component={Dispatch} />
      <Route path="/tasks" component={Tasks} />
      <Route path="/invoices" component={Invoices} />
      <Route path="/settings" component={Settings} />
      <Route path="/reports" component={Reports} />
      <Route path="/select-extra" component={SelectExtra} />
      <Route path="/quotes" component={Quotes} />
      <Route path="/quotes/:id" component={QuoteDetail} />
      <Route path="/woo-orders" component={WooOrders} />
      <Route path="/bundles" component={Bundles} />
      <Route path="/enquiries" component={Enquiries} />
      <Route path="/feedback" component={Feedback} />
      <Route path="/chat" component={Chat} />
      <Route path="/live-chat" component={LiveChatSessions} />
      <Route path="/templates" component={Templates} />
      <Route path="/admin/callbacks" component={Callbacks} />
      <Route path="/categories" component={CategoryManager} />
      <Route path="/workflows/new" component={WorkflowEditor} />
      <Route path="/workflows/:id" component={WorkflowEditor} />
      <Route path="/campaigns" component={Campaigns} />
      <Route path="/how-to" component={HowToLanding} />
      <Route path="/how-to/stock-take" component={StockTakeGuide} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <UpdateBanner />
          <RouteErrorBoundary>
            <InstallationGate />
          </RouteErrorBoundary>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
