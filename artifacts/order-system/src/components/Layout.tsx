import { ReactNode, useEffect, useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, ShoppingCart, Users, Package, Truck, LogOut, Boxes, ShoppingBag, ClipboardList, Settings2, Send, CheckSquare, FileText, Warehouse, BarChart2, MonitorPlay, Bell, MessageSquare, X, Gift, ShoppingBasket, Package2, AlertTriangle, AlertCircle, Lightbulb, MessageCircle, Hash, Mail, ImageIcon, Camera, Loader2, ChevronDown, MessageSquarePlus, Megaphone, BookOpen, PhoneCall } from "lucide-react";
import { cn } from "@/lib/utils";
import { isStaffAuthenticated, clearStaffToken, staffAuthHeader, getStaffJwtPayload } from "@/lib/staff-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const API_BASE = "/api";

function getStoredActor(): string {
  return localStorage.getItem("sbs_actor_name") || "";
}

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const actor = getStoredActor();
  const token = localStorage.getItem("sbs_staff_token");
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(actor ? { "x-actor": actor } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts?.headers,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface InboxMessage {
  id: number;
  order_id: number;
  order_number: string;
  author_name: string;
  body: string;
  created_at: string;
  customer_name: string | null;
  is_read: boolean;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

let desktopNotifPermission: NotificationPermission = "default";
let notifiedIds = new Set<number>();

function requestDesktopNotifPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().then(p => { desktopNotifPermission = p; });
  } else if ("Notification" in window) {
    desktopNotifPermission = Notification.permission;
  }
}

function fireDesktopNotif(msg: InboxMessage) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (notifiedIds.has(msg.id)) return;
  notifiedIds.add(msg.id);
  new Notification(`New message on ${msg.order_number}`, {
    body: `${msg.author_name}: ${msg.body.slice(0, 120)}`,
    icon: "",
    tag: `order-msg-${msg.id}`,
  });
}

function MessagesBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();
  const actor = getStoredActor();

  const { data } = useQuery<{ messages: InboxMessage[]; unreadCount: number }>({
    queryKey: ["messages-inbox", actor],
    queryFn: () => apiFetch(`/messages/inbox?reader=${encodeURIComponent(actor)}`),
    enabled: isStaffAuthenticated(),
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  const messages = data?.messages ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  // Fire desktop notifications for new unread messages
  useEffect(() => {
    requestDesktopNotifPermission();
  }, []);

  useEffect(() => {
    if (actor && messages.length > 0) {
      messages.filter(m => !m.is_read && m.author_name !== actor).forEach(fireDesktopNotif);
    }
  }, [messages, actor]);

  // Close on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const handleClick = (msg: InboxMessage) => {
    setOpen(false);
    navigate(`/orders/${msg.order_id}`);
  };

  return (
    <div className="relative w-full" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative flex items-center w-full px-3 py-2.5 rounded-xl text-sm font-medium text-white/60 hover:bg-white/10 hover:text-white transition-all duration-200 group"
        title="Internal messages"
      >
        <MessageSquare className="w-5 h-5 mr-3 text-white/50 group-hover:text-white/80 transition-colors shrink-0" />
        Job Messages
        {unreadCount > 0 && (
          <span className="ml-auto min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-80 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="font-semibold text-sm flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-muted-foreground" />
              Job Messages
              {unreadCount > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{unreadCount} unread</span>
              )}
            </span>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="max-h-[400px] overflow-y-auto divide-y divide-border">
            {messages.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-20" />
                No messages yet
              </div>
            ) : (
              messages.map(msg => (
                <button
                  key={msg.id}
                  onClick={() => handleClick(msg)}
                  className={cn(
                    "w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors",
                    !msg.is_read && msg.author_name !== actor && "bg-primary/5"
                  )}
                >
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                    {msg.author_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1 justify-between">
                      <span className={cn("text-xs font-semibold truncate", !msg.is_read && msg.author_name !== actor && "text-primary")}>
                        {msg.order_number}
                        {msg.customer_name && <span className="text-muted-foreground font-normal ml-1">· {msg.customer_name}</span>}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0 ml-1">{formatTime(msg.created_at)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <span className="font-medium text-foreground">{msg.author_name}:</span>{" "}
                      <span className="line-clamp-2">{msg.body}</span>
                    </p>
                  </div>
                  {!msg.is_read && msg.author_name !== actor && (
                    <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />
                  )}
                </button>
              ))
            )}
          </div>
          {messages.length > 0 && (
            <div className="px-4 py-2 border-t border-border text-center">
              <span className="text-xs text-muted-foreground">Click any message to open the order</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Chat unread notification bell ───────────────────────────────────────────
function ChatBell() {
  const [, navigate] = useLocation();
  const actor = getStoredActor();

  const { data } = useQuery<{ count: number }>({
    queryKey: ["chat-unread-count", actor],
    queryFn: () => apiFetch(`/chat/unread-count`),
    enabled: isStaffAuthenticated() && !!actor,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const count = data?.count ?? 0;

  return (
    <button
      onClick={() => navigate("/chat")}
      className="relative flex items-center w-full px-3 py-2.5 rounded-xl text-sm font-medium text-white/60 hover:bg-white/10 hover:text-white transition-all duration-200 group"
      title={count > 0 ? `${count} unread chat message${count !== 1 ? "s" : ""}` : "Chat"}
    >
      <Mail className={cn("w-5 h-5 mr-3 text-white/50 group-hover:text-white/80 transition-colors shrink-0", count > 0 && "animate-pulse text-amber-400")} />
      Chat
      {count > 0 && (
        <span className="ml-auto min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold px-1 leading-none">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}

// ─── Top-right flashing unread chat indicator ────────────────────────────────
function TopRightChatIndicator({ dark = false }: { dark?: boolean }) {
  const [, navigate] = useLocation();
  const actor = getStoredActor();

  const { data } = useQuery<{ count: number }>({
    queryKey: ["chat-unread-count", actor],
    queryFn: () => apiFetch(`/chat/unread-count`),
    enabled: isStaffAuthenticated() && !!actor,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const count = data?.count ?? 0;

  return (
    <button
      onClick={() => navigate("/chat")}
      className={cn(
        "relative flex items-center justify-center w-9 h-9 rounded-full transition-colors shrink-0",
        dark ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
      title={count > 0 ? `${count} unread chat message${count !== 1 ? "s" : ""}` : "Chat"}
    >
      <Mail className="w-5 h-5" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-red-500 text-white text-[8px] font-bold items-center justify-center">
            {count > 9 ? "9+" : count}
          </span>
        </span>
      )}
    </button>
  );
}

export function FeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [type, setType] = useState<"critical" | "minor" | "feature">("minor");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const submit = useMutation({
    mutationFn: () =>
      apiFetch(`/feedback`, {
        method: "POST",
        body: JSON.stringify({ type, title, description }),
      }),
    onSuccess: () => {
      toast({ title: type === "critical" ? "🚨 Critical issue reported" : "✓ Feedback submitted", description: "Your staff identity has been recorded with the report." });
      queryClient.invalidateQueries({ queryKey: ["feedback"] });
      setTitle(""); setDescription(""); setType("minor");
      onClose();
    },
    onError: (error: Error) => toast({ title: "Failed to submit", description: error.message, variant: "destructive" }),
  });

  const TYPES = [
    { value: "critical" as const, label: "Critical Issue", desc: "System broken / urgent", icon: AlertTriangle, color: "border-red-300 bg-red-50 text-red-700 data-[sel=true]:ring-2 data-[sel=true]:ring-red-400 data-[sel=true]:bg-red-100" },
    { value: "minor" as const, label: "Minor Issue", desc: "Something not quite right", icon: AlertCircle, color: "border-amber-300 bg-amber-50 text-amber-700 data-[sel=true]:ring-2 data-[sel=true]:ring-amber-400 data-[sel=true]:bg-amber-100" },
    { value: "feature" as const, label: "Feature Request", desc: "Idea or improvement", icon: Lightbulb, color: "border-blue-300 bg-blue-50 text-blue-700 data-[sel=true]:ring-2 data-[sel=true]:ring-blue-400 data-[sel=true]:bg-blue-100" },
  ];

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Report an Issue / Request a Feature</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="grid grid-cols-3 gap-2">
            {TYPES.map(t => {
              const Icon = t.icon;
              const sel = type === t.value;
              return (
                <button
                  key={t.value}
                  data-sel={sel}
                  onClick={() => setType(t.value)}
                  className={cn("flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition-all", t.color, sel && "ring-2")}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-xs font-semibold leading-tight">{t.label}</span>
                  <span className="text-[10px] opacity-70 leading-tight">{t.desc}</span>
                </button>
              );
            })}
          </div>

          {type === "critical" && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>A notification email will be sent immediately for critical issues.</span>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Title <span className="text-destructive">*</span></label>
            <Input placeholder="Brief description of the issue or feature…" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Details (optional)</label>
            <Textarea placeholder="Steps to reproduce, expected behaviour, or more detail…" value={description} onChange={e => setDescription(e.target.value)} rows={3} maxLength={2000} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => submit.mutate()} disabled={!title.trim() || submit.isPending}>
            {submit.isPending ? "Submitting…" : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Profile photo (reuses the same object-storage upload flow as Customer Portal's Team page) ───

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-violet-100 text-violet-700",
  "bg-emerald-100 text-emerald-700",
  "bg-orange-100 text-orange-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
  "bg-indigo-100 text-indigo-700",
  "bg-amber-100 text-amber-700",
];
function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
function initialsOf(name: string) {
  return name.trim().split(/\s+/).map(p => p[0]).join("").toUpperCase().slice(0, 2);
}

function AvatarCircle({ name, avatarUrl, size = "w-9 h-9", textSize = "text-xs" }: { name: string; avatarUrl?: string | null; size?: string; textSize?: string }) {
  if (avatarUrl) {
    return (
      <img
        src={`${API_BASE}/storage${avatarUrl}`}
        alt=""
        className={`${size} rounded-full object-cover shrink-0 ring-1 ring-white/20`}
      />
    );
  }
  return (
    <div className={`${size} rounded-full flex items-center justify-center ${textSize} font-bold shrink-0 ${getAvatarColor(name || "?")}`}>
      {initialsOf(name || "?")}
    </div>
  );
}

async function uploadAvatarFile(file: File): Promise<string> {
  const meta = await apiFetch<{ uploadURL: string; objectPath: string }>("/storage/uploads/request-url", {
    method: "POST",
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
  });
  await fetch(meta.uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
  return meta.objectPath;
}

interface StaffMe {
  name: string | null;
  email: string | null;
  is_superuser: boolean;
  allowed_nav: string[] | null;
  avatar_url: string | null;
}

// Top-right account widget: shows the current user's photo/initials + name so it's always
// clear whose account is logged in, with a dropdown to upload a photo or sign out.
function UserMenu({ staffMe, onSignOut, dark = false }: { staffMe: StaffMe | undefined; onSignOut: () => void; dark?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const jwtPayload = getStaffJwtPayload();
  const displayName = staffMe?.name || jwtPayload?.name || "Staff";
  const email = staffMe?.email;
  const canHavePhoto = !!email; // password-only (no email) logins have no individual profile

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const avatarMutation = useMutation({
    mutationFn: (avatar_url: string | null) =>
      apiFetch("/auth/staff/me/avatar", {
        method: "PATCH",
        headers: staffAuthHeader() as Record<string, string>,
        body: JSON.stringify({ avatar_url }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-me"] });
      toast({ title: "Profile photo updated" });
    },
    onError: () => toast({ title: "Could not update photo", variant: "destructive" }),
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please choose an image file", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const objectPath = await uploadAvatarFile(file);
      avatarMutation.mutate(objectPath);
    } catch {
      toast({ title: "Photo upload failed", description: "Please try again.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-full transition-colors",
          dark ? "hover:bg-white/10" : "hover:bg-black/5"
        )}
      >
        <AvatarCircle name={displayName} avatarUrl={staffMe?.avatar_url} size="w-8 h-8" />
        <span className={cn("hidden sm:block text-sm font-medium max-w-[140px] truncate", dark ? "text-white/90" : "text-foreground")}>{displayName}</span>
        <ChevronDown className={cn("w-3.5 h-3.5", dark ? "text-white/50" : "text-muted-foreground")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <label className={cn("relative shrink-0", canHavePhoto && "cursor-pointer group/avatar")}>
              <AvatarCircle name={displayName} avatarUrl={staffMe?.avatar_url} size="w-11 h-11" textSize="text-sm" />
              {canHavePhoto && (
                <>
                  <span className="absolute -bottom-1 -right-1 flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground shadow ring-2 ring-card group-hover/avatar:scale-110 transition-transform">
                    {uploading || avatarMutation.isPending ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Camera className="w-2.5 h-2.5" />}
                  </span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading || avatarMutation.isPending} />
                </>
              )}
            </label>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{displayName}</p>
              {email && <p className="text-xs text-muted-foreground truncate">{email}</p>}
            </div>
          </div>
          {canHavePhoto ? (
            <div className="px-4 py-2.5 border-b border-border">
              <p className="text-xs text-muted-foreground">Click your photo above to change it{staffMe?.avatar_url ? "." : " — you're currently using initials."}</p>
              {staffMe?.avatar_url && (
                <button
                  type="button"
                  className="text-xs text-destructive hover:underline mt-1"
                  onClick={() => avatarMutation.mutate(null)}
                >
                  Remove photo
                </button>
              )}
            </div>
          ) : (
            <div className="px-4 py-2.5 border-b border-border">
              <p className="text-xs text-muted-foreground">Signed in with the shared staff password — no individual profile photo.</p>
            </div>
          )}
          <button
            onClick={onSignOut}
            className="flex items-center w-full gap-2 px-4 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/5 transition-colors"
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

interface LayoutProps {
  children: ReactNode;
}

type NavItem = { name: string; href: string; icon: React.ElementType };
type NavSection = { label: string; items: NavItem[] };

export default function Layout({ children }: LayoutProps) {
  const [location, setLocation] = useLocation();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const [navScrollable, setNavScrollable] = useState(false);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const check = () => setNavScrollable(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", check); ro.disconnect(); };
  }, []);

  useEffect(() => {
    if (!isStaffAuthenticated()) {
      setLocation("/login");
    }
  }, [location]);

  // ── Current user permissions ──────────────────────────────────────────────
  // NOTE: this hook must be called unconditionally, before any early return,
  // to satisfy React's Rules of Hooks. isStaffAuthenticated() is time-based
  // (checks JWT expiry against Date.now()), so it can flip from true to false
  // between renders of the same mounted component (e.g. session expires while
  // the page is open) — putting a conditional `return null` before this hook
  // previously caused "Rendered fewer hooks than expected" (React error #300).
  const jwtPayload = getStaffJwtPayload();
  const { data: staffMe } = useQuery<StaffMe>({
    queryKey: ["staff-me"],
    queryFn: () =>
      apiFetch("/auth/staff/me", {
        headers: staffAuthHeader() as Record<string, string>,
      }),
    staleTime: 60_000,
    enabled: isStaffAuthenticated(),
  });

  const qc = useQueryClient();
  const { data: enquiryCountData } = useQuery<{ count: number }>({
    queryKey: ["enquiries-unread-count"],
    queryFn: () => apiFetch("/wc-enquiries/unread-count"),
    enabled: isStaffAuthenticated(),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const enquiryUnreadCount = enquiryCountData?.count ?? 0;

  // Mark all enquiries as read when the user is on /enquiries
  useEffect(() => {
    if (location === "/enquiries" && enquiryUnreadCount > 0) {
      apiFetch("/wc-enquiries/mark-all-read", { method: "PATCH" })
        .then(() => qc.invalidateQueries({ queryKey: ["enquiries-unread-count"] }))
        .catch(() => {/* silent */});
    }
  }, [location, enquiryUnreadCount]);

  if (!isStaffAuthenticated()) return null;

  function handleSignOut() {
    clearStaffToken();
    setLocation("/");
  }

  // null = all access (default before data loads or for password login)
  const allowedNav: string[] | null = staffMe?.allowed_nav ?? null;

  function isNavAllowed(href: string): boolean {
    // How To guides are a shared staff resource and should remain available
    // even when an account is restricted to specific operational pages.
    if (href === "/how-to") return true;
    if (allowedNav === null) return true; // full access
    return allowedNav.includes(href);
  }

  const rawNavSections: NavSection[] = [
    {
      label: "",
      items: [
        { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
        { name: "Orders", href: "/orders", icon: ShoppingCart },
        { name: "WooCommerce", href: "/woo-orders", icon: ShoppingBasket },
        { name: "Quotes", href: "/quotes", icon: FileText },
        { name: "Customers", href: "/customers", icon: Users },
        { name: "Products", href: "/products", icon: Package },
        { name: "Bundles", href: "/bundles", icon: Package2 },
        { name: "Web Enquiries", href: "/enquiries", icon: MessageSquarePlus },
      ],
    },
    {
      label: "Operations",
      items: [
        { name: "Stock", href: "/stock", icon: Warehouse },
        { name: "Process Stock", href: "/process-stock", icon: Boxes },
        { name: "Production", href: "/production", icon: ClipboardList },
        { name: "Purchasing", href: "/purchasing", icon: ShoppingBag },
        { name: "Dispatch", href: "/dispatch", icon: Send },
        { name: "Invoicing", href: "/invoices", icon: FileText },
        { name: "Suppliers", href: "/suppliers", icon: Truck },
        { name: "Tasks", href: "/tasks", icon: CheckSquare },
      ],
    },
    {
      label: "Reports",
      items: [
        { name: "Portal Orders", href: "/reports", icon: BarChart2 },
        { name: "Monthly Rewards", href: "/select-extra", icon: Gift },
        { name: "Feedback & Issues", href: "/feedback", icon: MessageCircle },
        { name: "Chat", href: "/chat", icon: Hash },
      ],
    },
    {
      label: "Comms",
      items: [
        { name: "Campaigns", href: "/campaigns", icon: Megaphone },
        { name: "Templates", href: "/templates", icon: Mail },
        { name: "Live Chat", href: "/live-chat", icon: MessageCircle },
        { name: "Callbacks", href: "/admin/callbacks", icon: PhoneCall },
      ],
    },
    {
      label: "Resources",
      items: [
        { name: "How To", href: "/how-to", icon: BookOpen },
      ],
    },
  ];

  // Filter nav items based on user's allowed_nav
  const navSections: NavSection[] = rawNavSections
    .map(section => ({
      ...section,
      items: section.items.filter(item => isNavAllowed(item.href)),
    }))
    .filter(section => section.items.length > 0);

  const allNavItems = navSections.flatMap(s => s.items);

  const rawBottomNavItems = [
    { name: "Settings", href: "/settings", icon: Settings2 },
    { name: "Demo", href: "/demo", icon: MonitorPlay },
  ];

  // Superusers always see Settings; filter others by allowed_nav
  const isSuperuser = staffMe?.is_superuser ?? !jwtPayload?.email;
  const bottomNavItems = rawBottomNavItems.filter(item =>
    item.href === "/settings" ? (isSuperuser || isNavAllowed(item.href)) : isNavAllowed(item.href)
  );

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex w-64 flex-col fixed inset-y-0 z-10" style={{ backgroundColor: "hsl(var(--sidebar))" }}>
        {/* Logo */}
        <div className="flex items-center justify-center px-4 py-5 border-b border-white/10">
          <img
            src=""
            alt=""
            className="w-full h-auto object-contain"
          />
        </div>

        <div className="flex-1 relative min-h-0">
          <nav ref={navRef} className="h-full px-4 py-5 overflow-y-auto space-y-4">
          {navSections.map((section) => (
            <div key={section.label || "__top__"}>
              {section.label && (
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-white/30 select-none">
                  {section.label}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = location === item.href || (item.href !== "/dashboard" && location.startsWith(item.href));
                  const badge = item.href === "/enquiries" && enquiryUnreadCount > 0 ? enquiryUnreadCount : null;
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={cn(
                        "flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group",
                        isActive
                          ? "bg-white/15 text-white shadow-sm"
                          : "text-white/60 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      <item.icon className={cn(
                        "w-5 h-5 mr-3 transition-colors shrink-0",
                        isActive ? "text-primary" : "text-white/50 group-hover:text-white/80"
                      )} />
                      {item.name}
                      {badge !== null && (
                        <span className="ml-auto min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none">
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
          </nav>
          {navScrollable && (
            <div className="pointer-events-none absolute bottom-0 inset-x-0 h-16" style={{ background: "linear-gradient(to top, hsl(var(--sidebar)), transparent)" }} />
          )}
        </div>

        <div className="p-4 border-t border-white/10 space-y-1">
          <MessagesBell />
          <ChatBell />
          <button
            onClick={() => setFeedbackOpen(true)}
            className="flex items-center w-full px-3 py-2.5 rounded-xl text-sm font-medium text-white/60 hover:bg-white/10 hover:text-white transition-all duration-200 group"
          >
            <MessageCircle className="w-5 h-5 mr-3 text-white/50 group-hover:text-white/80 transition-colors shrink-0" />
            Feedback
          </button>
          {bottomNavItems.map((item) => {
            const isActive = location === item.href || location.startsWith(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group",
                  isActive
                    ? "bg-white/15 text-white shadow-sm"
                    : "text-white/60 hover:bg-white/10 hover:text-white"
                )}
              >
                <item.icon className={cn(
                  "w-5 h-5 mr-3 transition-colors",
                  isActive ? "text-primary" : "text-white/50 group-hover:text-white/80"
                )} />
                {item.name}
              </Link>
            );
          })}
          <button
            onClick={handleSignOut}
            className="flex items-center w-full px-3 py-2.5 rounded-xl text-sm font-medium text-white/50 hover:bg-red-500/20 hover:text-red-300 transition-colors group"
          >
            <LogOut className="w-5 h-5 mr-3 transition-colors" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 relative min-w-0">
        {/* Mobile Header */}
        <header className="md:hidden h-16 flex items-center justify-between px-4 border-b border-border/60 sticky top-0 z-20" style={{ backgroundColor: "hsl(var(--sidebar))" }}>
          <img
            src=""
            alt=""
            className="h-9 w-auto object-contain"
          />
          <div className="flex items-center gap-1.5">
            <TopRightChatIndicator dark />
            <UserMenu staffMe={staffMe} onSignOut={handleSignOut} dark />
          </div>
        </header>

        {/* Desktop Top Bar — account widget in the top-right so it's always clear who's logged in */}
        <header className="hidden md:flex h-14 items-center justify-end gap-2 px-6 border-b border-border/60 sticky top-0 z-20 bg-background/80 backdrop-blur">
          <TopRightChatIndicator />
          <UserMenu staffMe={staffMe} onSignOut={handleSignOut} />
        </header>

        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
          {children}
        </div>
      </main>

      {/* Mobile Navigation Bottom Bar — shows first 5 items only */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 h-16 bg-card border-t border-border/60 flex items-center justify-around px-2 z-20 pb-safe">
        {allNavItems.slice(0, 5).map((item) => {
          const isActive = location === item.href || (item.href !== "/dashboard" && location.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center w-full h-full",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <item.icon className="w-5 h-5 mb-1" />
              <span className="text-[10px] font-medium">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  );
}
