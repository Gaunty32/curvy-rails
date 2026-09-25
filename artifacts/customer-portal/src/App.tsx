import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useVersionCheck } from "@/hooks/use-version-check";
import { Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import React from "react";

import Login from "@/pages/Login";
import AcceptInvite from "@/pages/AcceptInvite";
import SelectBusiness from "@/pages/SelectBusiness";
import PreviewLogin from "@/pages/PreviewLogin";
import Dashboard from "@/pages/Dashboard";
import OrderDetailPage from "@/pages/OrderDetail";
import NewOrder from "@/pages/NewOrder";
import Wardrobe from "@/pages/Wardrobe";
import Products from "@/pages/Products";
import Team from "@/pages/Team";
import Invoices from "@/pages/Invoices";
import PaymentMethods from "@/pages/PaymentMethods";
import Stock from "@/pages/Stock";
import PickNote from "@/pages/PickNote";
import OrderHistory from "@/pages/OrderHistory";
import Reports from "@/pages/Reports";
import KnowledgeCentre from "@/pages/KnowledgeCentre";
import StoresLog from "@/pages/StoresLog";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 0, refetchOnWindowFocus: true } },
});

// ── Error Boundary ────────────────────────────────────────────────────────────
interface EBState { error: Error | null }
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, EBState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): EBState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[Portal ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="w-full max-w-md text-center space-y-4">
            <div className="flex justify-center">
              <div className="bg-red-50 rounded-full p-4 border border-red-100">
                <AlertTriangle className="w-10 h-10 text-red-500" />
              </div>
            </div>
            <h1 className="text-lg font-bold text-foreground">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              The page encountered an error. Please try refreshing — if the problem continues, contact the configured business.
            </p>
            <p className="text-xs font-mono bg-slate-100 rounded p-2 text-left text-slate-600 break-all">
              {this.state.error.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <RefreshCw className="w-4 h-4" /> Refresh page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Version banner ────────────────────────────────────────────────────────────
function UpdateBanner() {
  const updateAvailable = useVersionCheck();
  if (!updateAvailable) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between gap-3 bg-primary px-4 py-2.5 text-primary-foreground shadow-md">
      <p className="text-sm font-medium">A new version of the portal is available.</p>
      <button
        onClick={() => window.location.reload()}
        className="flex items-center gap-1.5 rounded-md bg-white/20 px-3 py-1 text-sm font-semibold hover:bg-white/30 transition-colors shrink-0"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Refresh
      </button>
    </div>
  );
}

// ── Protected route ───────────────────────────────────────────────────────────
function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) return <Redirect to="/login" />;
  return <Component />;
}

// ── Router ────────────────────────────────────────────────────────────────────
function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/accept-invite" component={AcceptInvite} />
      <Route path="/select-business" component={SelectBusiness} />
      <Route path="/preview-login" component={PreviewLogin} />
      <Route path="/orders/new" component={() => {
        const hasQuote = new URLSearchParams(window.location.search).has("quote");
        return hasQuote ? <NewOrder /> : <ProtectedRoute component={NewOrder} />;
      }} />
      <Route path="/orders/:id" component={() => <ProtectedRoute component={OrderDetailPage} />} />
      <Route path="/orders" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/invoices" component={() => <ProtectedRoute component={Invoices} />} />
      <Route path="/order-history" component={() => <ProtectedRoute component={OrderHistory} />} />
      <Route path="/wardrobe" component={() => <ProtectedRoute component={Wardrobe} />} />
      <Route path="/products" component={() => <ProtectedRoute component={Products} />} />
      <Route path="/team" component={() => <ProtectedRoute component={Team} />} />
      <Route path="/payment-methods" component={() => <ProtectedRoute component={PaymentMethods} />} />
      <Route path="/stores" component={() => <ProtectedRoute component={Stock} />} />
      <Route path="/stores/pick-note/:ref" component={() => <ProtectedRoute component={PickNote} />} />
      <Route path="/stores/log" component={() => <ProtectedRoute component={StoresLog} />} />
      <Route path="/reports" component={() => <ProtectedRoute component={Reports} />} />
      <Route path="/knowledge-centre" component={() => <ProtectedRoute component={KnowledgeCentre} />} />
      <Route path="/">
        {() => {
          const token = localStorage.getItem("portal_token");
          return token ? <Redirect to="/orders" /> : <Redirect to="/login" />;
        }}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthProvider>
              <UpdateBanner />
              <Router />
            </AuthProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
