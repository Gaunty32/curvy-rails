import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { useLocation, Link } from "wouter";
import { ShoppingBag, LogOut, LayoutDashboard, Menu, X, Eye, Shirt, Package, Users, Receipt, CreditCard, Bell, CheckCheck, Truck, ThumbsUp, AlertCircle, Info, Boxes, History, ArrowLeftRight, MessageCircle, AlertTriangle, Lightbulb, BarChart3, BookOpen, ClipboardList } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { usePublicConfig } from "@/lib/publicConfig";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const BASKET_LS_KEY = "portal-new-order";

function useBasketCount(isPreview: boolean) {
  const [lsCount, setLsCount] = useState<number>(() => {
    try { const r = localStorage.getItem(BASKET_LS_KEY); return r ? (JSON.parse(r)?.basket?.length ?? 0) : 0; } catch { return 0; }
  });

  useEffect(() => {
    const read = () => {
      try { const r = localStorage.getItem(BASKET_LS_KEY); setLsCount(r ? (JSON.parse(r)?.basket?.length ?? 0) : 0); } catch { setLsCount(0); }
    };
    window.addEventListener("storage", read);
    window.addEventListener("focus", read);
    const t = setInterval(read, 3000);
    return () => { window.removeEventListener("storage", read); window.removeEventListener("focus", read); clearInterval(t); };
  }, []);

  const { data: serverBasket } = useQuery<{ itemCount?: number }>({
    queryKey: ["portal-basket-count"],
    queryFn: () => apiFetch("/portal/basket"),
    enabled: !isPreview,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  return isPreview ? 0 : Math.max(lsCount, serverBasket?.itemCount ?? 0);
}

interface PortalNotification {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
  type: string;
  is_read: boolean;
  created_at: string;
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const { data: notifications = [] } = useQuery<PortalNotification[]>({
    queryKey: ["portal-notifications"],
    queryFn: () => apiFetch("/portal/notifications"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const unread = notifications.filter(n => !n.is_read).length;

  const markRead = useMutation({
    mutationFn: (id: number) => apiFetch(`/portal/notifications/${id}/read`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => apiFetch("/portal/notifications/read-all", { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-notifications"] }),
  });

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const typeIcon = (type: string) => {
    if (type === "needs_approval") return <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />;
    if (type === "approved") return <ThumbsUp className="w-4 h-4 text-green-500 shrink-0" />;
    if (type === "dispatched") return <Truck className="w-4 h-4 text-blue-500 shrink-0" />;
    return <Info className="w-4 h-4 text-muted-foreground shrink-0" />;
  };

  const handleClick = (n: PortalNotification) => {
    if (!n.is_read) markRead.mutate(n.id);
    if (n.link) setLocation(n.link);
    setOpen(false);
  };

  const fmt = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-full hover:bg-muted/60 transition-colors"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
      >
        <Bell className="w-5 h-5 text-muted-foreground" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="font-semibold text-sm">Notifications</span>
            {unread > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-border">
            {notifications.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-20" />
                No notifications yet
              </div>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={cn(
                    "w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors",
                    !n.is_read && "bg-primary/5"
                  )}
                >
                  {typeIcon(n.type)}
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm leading-tight truncate", !n.is_read && "font-semibold")}>{n.title}</p>
                    {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                    <p className="text-[10px] text-muted-foreground mt-1">{fmt(n.created_at)}</p>
                  </div>
                  {!n.is_read && (
                    <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PortalFeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [type, setType] = useState<"critical" | "minor" | "feature">("minor");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [done, setDone] = useState(false);

  const submit = useMutation({
    mutationFn: () => apiFetch("/portal/feedback", { method: "POST", body: JSON.stringify({ type, title, description }) }),
    onSuccess: () => { setDone(true); setTitle(""); setDescription(""); setType("minor"); },
  });

  const handleClose = () => { setDone(false); onClose(); };

  const TYPES = [
    { value: "critical" as const, label: "Urgent Issue", desc: "System broken / urgent", icon: AlertTriangle, cls: "border-red-200 bg-red-50 text-red-700" },
    { value: "minor" as const, label: "Minor Issue", desc: "Something not quite right", icon: AlertCircle, cls: "border-amber-200 bg-amber-50 text-amber-700" },
    { value: "feature" as const, label: "Suggestion", desc: "Idea or improvement", icon: Lightbulb, cls: "border-blue-200 bg-blue-50 text-blue-700" },
  ];

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Report an Issue or Share a Suggestion</DialogTitle>
        </DialogHeader>
        {done ? (
          <div className="py-8 text-center space-y-2">
            <p className="text-3xl">✓</p>
            <p className="font-semibold">Thank you for your feedback!</p>
            <p className="text-sm text-muted-foreground">We'll look into it as soon as possible.</p>
            <Button className="mt-4" onClick={handleClose}>Close</Button>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-1">
              <div className="grid grid-cols-3 gap-2">
                {TYPES.map(t => {
                  const Icon = t.icon;
                  const sel = type === t.value;
                  return (
                    <button
                      key={t.value}
                      onClick={() => setType(t.value)}
                      className={cn("flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition-all", t.cls, sel && "ring-2 ring-offset-1 ring-current")}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="text-xs font-semibold leading-tight">{t.label}</span>
                      <span className="text-[10px] opacity-70 leading-tight">{t.desc}</span>
                    </button>
                  );
                })}
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Summary <span className="text-destructive">*</span></label>
                <Input placeholder="Brief description…" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">More detail (optional)</label>
                <Textarea placeholder="Steps to reproduce, or any extra context…" value={description} onChange={e => setDescription(e.target.value)} rows={3} maxLength={2000} />
              </div>
              {submit.isError && <p className="text-xs text-destructive">Something went wrong — please try again.</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={() => submit.mutate()} disabled={!title.trim() || submit.isPending}>
                {submit.isPending ? "Sending…" : "Send"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { data: publicConfig } = usePublicConfig();
  const { user, logout, isPreview, isManager, isDeptManager, previewEmployeeName } = useAuth();
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [switchingBusiness, setSwitchingBusiness] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const basketCount = useBasketCount(isPreview);

  const hasMultipleBusinesses = (() => {
    try {
      const stored = localStorage.getItem("portal_businesses");
      return stored ? (JSON.parse(stored) as any[]).length > 1 : false;
    } catch { return false; }
  })();

  const switchBusiness = async () => {
    setSwitchingBusiness(true);
    try {
      const data = await apiFetch("/portal/auth/switch-business", { method: "POST" });
      localStorage.removeItem("portal_token");
      sessionStorage.setItem("portal_selection_token", data.selectionToken);
      sessionStorage.setItem("portal_selection_email", data.email);
      sessionStorage.setItem("portal_selection_businesses", JSON.stringify(data.businesses));
      localStorage.setItem("portal_businesses", JSON.stringify(data.businesses));
      setLocation("/select-business");
    } catch {
      logout();
    } finally {
      setSwitchingBusiness(false);
    }
  };

  const nav = [
    { label: "My Orders", icon: LayoutDashboard, href: "/orders" },
    { label: "New Order", icon: ShoppingBag, href: "/orders/new", basketCount },
    { label: "Wardrobe", icon: Shirt, href: "/wardrobe" },
    { label: "Products", icon: Package, href: "/products" },
    { label: "Invoices", icon: Receipt, href: "/invoices" },
    { label: "Order History", icon: History, href: "/order-history" },
    { label: "Payment", icon: CreditCard, href: "/payment-methods" },
    ...(isManager ? [{ label: "Team", icon: Users, href: "/team" }] : isDeptManager ? [{ label: "My Team", icon: Users, href: "/team" }] : []),
    ...(isManager ? [{ label: "Stores", icon: Boxes, href: "/stores" }] : []),
    ...(isManager ? [{ label: "Stores Log", icon: ClipboardList, href: "/stores/log" }] : []),
    ...(isManager ? [{ label: "Reports", icon: BarChart3, href: "/reports" }] : []),
    { label: "Knowledge Centre", icon: BookOpen, href: "/knowledge-centre" },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Staff preview banner */}
      {isPreview && (
        <div className="bg-amber-400 text-amber-950 text-xs font-semibold flex items-center justify-center gap-2 px-4 py-1.5 sticky top-0 z-50">
          <Eye className="w-3.5 h-3.5 shrink-0" />
          Staff preview{previewEmployeeName ? <> — viewing as <strong>{previewEmployeeName}</strong></> : " — no specific employee selected"}. Basket is saved in this browser only — not to the server.
          <button
            onClick={logout}
            className="ml-3 underline underline-offset-2 hover:no-underline font-medium"
          >
            Exit preview
          </button>
        </div>
      )}
      {/* Top nav */}
      <header className="h-28 border-b bg-card shadow-sm sticky top-0 z-40 flex items-center px-6 gap-4">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {user?.customer?.logo_url ? (
            <img
              src={user.customer.logo_url}
              alt={user.customer.name}
              className="h-24 w-auto max-w-[400px] object-contain shrink-0"
            />
          ) : publicConfig?.logoUrl ? (
            <img src={publicConfig.logoUrl} alt={publicConfig.businessName || publicConfig.tradingName || "Business logo"} className="h-20 w-auto shrink-0" />
          ) : null}
        </div>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-1">
          {nav.map(({ label, icon: Icon, href, basketCount: bc }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors no-underline",
                location === href
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
              {bc != null && bc > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none">
                  {bc > 99 ? "99+" : bc}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="hidden sm:flex items-center gap-2">
          {!isPreview && <NotificationBell />}
          {!isPreview && (
            <Button variant="ghost" size="sm" onClick={() => setFeedbackOpen(true)} className="gap-1.5 text-muted-foreground">
              <MessageCircle className="w-4 h-4" /> Report Issue
            </Button>
          )}
          {user && (
            <span className="text-xs text-muted-foreground truncate max-w-[160px]">{user.user?.email}</span>
          )}
          {!isPreview && hasMultipleBusinesses && (
            <Button variant="ghost" size="sm" onClick={switchBusiness} disabled={switchingBusiness} className="gap-1.5 text-muted-foreground">
              <ArrowLeftRight className="w-4 h-4" /> Switch business
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={logout} className="gap-1.5 text-muted-foreground">
            <LogOut className="w-4 h-4" /> Sign out
          </Button>
        </div>

        {/* Mobile menu button */}
        <div className="sm:hidden flex items-center gap-2">
          {!isPreview && <NotificationBell />}
          <button className="p-1.5 rounded-md" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className="sm:hidden border-b bg-card px-4 py-3 flex flex-col gap-1">
          {nav.map(({ label, icon: Icon, href, basketCount: bc }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "relative flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors no-underline",
                location === href
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <Icon className="w-4 h-4" /> {label}
              {bc != null && bc > 0 && (
                <span className="ml-auto min-w-[20px] h-5 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1.5">
                  {bc > 99 ? "99+" : bc}
                </span>
              )}
            </Link>
          ))}
          <div className="border-t mt-2 pt-2 flex flex-col gap-1">
            <span className="text-xs text-muted-foreground px-1">{user?.user?.email}</span>
            {!isPreview && (
              <Button variant="ghost" size="sm" onClick={() => { setFeedbackOpen(true); setMobileOpen(false); }} className="justify-start gap-1.5 text-muted-foreground">
                <MessageCircle className="w-4 h-4" /> Report Issue
              </Button>
            )}
            {!isPreview && hasMultipleBusinesses && (
              <Button variant="ghost" size="sm" onClick={switchBusiness} disabled={switchingBusiness} className="justify-start gap-1.5 text-muted-foreground">
                <ArrowLeftRight className="w-4 h-4" /> Switch business
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={logout} className="justify-start gap-1.5 text-muted-foreground">
              <LogOut className="w-4 h-4" /> Sign out
            </Button>
          </div>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 container max-w-5xl mx-auto px-4 py-6">{children}</main>

      <footer className="border-t py-6 flex flex-col items-center gap-2">
        <span className="text-xs text-muted-foreground/60 uppercase tracking-widest font-medium">Powered by</span>
        {publicConfig?.logoUrl && <img src={publicConfig.logoUrl} alt={publicConfig.businessName || publicConfig.tradingName || "Business logo"} className="h-10 w-auto opacity-70" />}
      </footer>

      <PortalFeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  );
}
