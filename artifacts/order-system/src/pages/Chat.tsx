import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Hash, Users, ShoppingCart, User, Plus, Send, Bell, BellOff,
  Loader2, MessageSquare, X, UserPlus, Check
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const API_BASE = "/api";

function getActor(): string {
  return localStorage.getItem("sbs_actor_name") || "";
}

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const actor = getActor() || "Unknown";
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-actor": actor,
      ...opts?.headers,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return undefined as T;
  return res.json();
}

interface Conversation {
  id: number;
  type: "general" | "order" | "customer" | "custom" | "direct";
  order_id: number | null;
  customer_id: number | null;
  subject: string | null;
  created_by: string;
  created_at: string;
  last_message_at: string | null;
  message_count: string;
  last_message: string | null;
  last_sender: string | null;
  order_number: string | null;
  customer_name: string | null;
  participants: string[];
}

interface StaffAccount {
  name: string;
  email: string;
  avatar_url?: string | null;
}

function useStaffDirectory() {
  return useQuery<StaffAccount[]>({
    queryKey: ["staff-accounts-directory"],
    queryFn: () => apiFetch<{ accounts: StaffAccount[] }>("/auth/staff/accounts").then(r => r.accounts ?? []),
    staleTime: 5 * 60_000,
  });
}

interface ChatMessage {
  id: number;
  conversation_id: number;
  sender_name: string;
  content: string;
  created_at: string;
}

interface NotifPref {
  conversation_id: number;
  user_name: string;
  email: string | null;
  notify_email: boolean;
}

interface Participant {
  user_name: string;
  added_by: string;
  added_at: string;
}

function convLabel(c: Conversation, currentActor?: string): string {
  if (c.type === "general") return "General";
  if (c.type === "order") return c.order_number ? `Order ${c.order_number}` : `Order #${c.order_id}`;
  if (c.type === "customer") return c.customer_name || `Customer #${c.customer_id}`;
  if (c.type === "direct") {
    const others = (c.participants ?? []).filter(n => n !== currentActor);
    if (others.length === 0) return "Just you";
    return others.join(", ");
  }
  return c.subject || "Custom chat";
}

function convIcon(type: Conversation["type"]) {
  if (type === "general") return <Hash className="w-4 h-4" />;
  if (type === "order") return <ShoppingCart className="w-4 h-4" />;
  if (type === "customer") return <User className="w-4 h-4" />;
  if (type === "direct") return <Users className="w-4 h-4" />;
  return <MessageSquare className="w-4 h-4" />;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function sameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 42%)`;
}

function Avatar({ name, size = 7, avatarUrl }: { name: string; size?: number; avatarUrl?: string | null }) {
  if (avatarUrl) {
    return (
      <img
        src={`${API_BASE}/storage${avatarUrl}`}
        alt={name}
        title={name}
        className={`w-${size} h-${size} rounded-full object-cover shrink-0 ring-1 ring-border`}
      />
    );
  }
  return (
    <div
      className={`w-${size} h-${size} rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0`}
      style={{ backgroundColor: stringToColor(name) }}
      title={name}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

// ─── Notification settings panel ─────────────────────────────────────────────
function NotifPanel({ convId, onClose }: { convId: number; onClose: () => void }) {
  const actor = getActor() || "Unknown";
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: pref, isLoading } = useQuery<NotifPref>({
    queryKey: ["chat-notif", convId, actor],
    queryFn: () => apiFetch(`/chat/notification-prefs/${convId}`),
  });

  const [notify, setNotify] = useState(false);
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (pref) {
      setNotify(pref.notify_email);
      setEmail(pref.email || "");
    }
  }, [pref]);

  const save = useMutation({
    mutationFn: () => apiFetch("/chat/notification-prefs", {
      method: "POST",
      body: JSON.stringify({ conversation_id: convId, notify_email: notify, email: email || null }),
    }),
    onSuccess: () => {
      toast({ title: "Notification settings saved" });
      qc.invalidateQueries({ queryKey: ["chat-notif", convId] });
      onClose();
    },
  });

  if (isLoading) return (
    <div className="p-4 border-b flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
    </div>
  );

  return (
    <div className="border-b bg-muted/30 px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Email notifications</p>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex items-center gap-3">
        <Switch id="notif-toggle" checked={notify} onCheckedChange={setNotify} />
        <Label htmlFor="notif-toggle" className="text-sm">Email me when someone posts here</Label>
      </div>
      {notify && (
        <div>
          <Input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="text-sm h-8"
          />
          <p className="text-xs text-muted-foreground mt-1">Leave blank to use your account email</p>
        </div>
      )}
      <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} className="h-7 text-xs">
        {save.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
        Save
      </Button>
    </div>
  );
}

// ─── Members panel ────────────────────────────────────────────────────────────
function MembersPanel({ convId, onClose }: { convId: number; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addName, setAddName] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const { data: staffDirectory = [] } = useStaffDirectory();
  const avatarFor = (name: string) => staffDirectory.find(s => s.name === name)?.avatar_url ?? null;

  const { data: participants = [], isLoading } = useQuery<Participant[]>({
    queryKey: ["chat-participants", convId],
    queryFn: () => apiFetch(`/chat/conversations/${convId}/participants`),
  });

  const { data: knownUsers = [] } = useQuery<{ user_name: string }[]>({
    queryKey: ["chat-known-users"],
    queryFn: () => apiFetch("/chat/known-users"),
  });

  const suggestions = knownUsers
    .map(u => u.user_name)
    .filter(n => n.toLowerCase().includes(addName.toLowerCase()) && !participants.find(p => p.user_name === n));

  const addMember = useMutation({
    mutationFn: (name: string) => apiFetch(`/chat/conversations/${convId}/participants`, {
      method: "POST",
      body: JSON.stringify({ user_name: name }),
    }),
    onSuccess: () => {
      toast({ title: "Member added" });
      qc.invalidateQueries({ queryKey: ["chat-participants", convId] });
      qc.invalidateQueries({ queryKey: ["chat-conversations"] });
      setAddName("");
      setShowSuggestions(false);
    },
    onError: () => toast({ title: "Could not add member", variant: "destructive" }),
  });

  const removeMember = useMutation({
    mutationFn: (name: string) => apiFetch(`/chat/conversations/${convId}/participants/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
    onSuccess: () => {
      toast({ title: "Member removed" });
      qc.invalidateQueries({ queryKey: ["chat-participants", convId] });
      qc.invalidateQueries({ queryKey: ["chat-conversations"] });
    },
    onError: () => toast({ title: "Could not remove member", variant: "destructive" }),
  });

  function handleAdd(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    addMember.mutate(trimmed);
  }

  return (
    <div className="border-b bg-muted/30 px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Members</p>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {participants.map(p => (
            <div key={p.user_name} className="flex items-center gap-1.5 bg-background border rounded-full pl-1 pr-2 py-0.5">
              <Avatar name={p.user_name} size={5} avatarUrl={avatarFor(p.user_name)} />
              <span className="text-xs font-medium">{p.user_name}</span>
              <button
                className="text-muted-foreground hover:text-destructive ml-0.5"
                title={`Remove ${p.user_name}`}
                onClick={() => removeMember.mutate(p.user_name)}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {participants.length === 0 && (
            <p className="text-xs text-muted-foreground">No members yet</p>
          )}
        </div>
      )}

      {/* Add member */}
      <div className="relative">
        <div className="flex gap-2">
          <Input
            placeholder="Add by name…"
            value={addName}
            onChange={e => { setAddName(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={e => { if (e.key === "Enter") handleAdd(addName); }}
            className="text-sm h-8 flex-1"
          />
          <Button size="sm" className="h-8 px-3" onClick={() => handleAdd(addName)} disabled={!addName.trim() || addMember.isPending}>
            {addMember.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
          </Button>
        </div>
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-lg shadow-lg overflow-hidden">
            {suggestions.slice(0, 6).map(name => (
              <button
                key={name}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                onMouseDown={() => handleAdd(name)}
              >
                <Avatar name={name} size={5} avatarUrl={avatarFor(name)} />
                {name}
              </button>
            ))}
            {addName.trim() && !suggestions.find(s => s.toLowerCase() === addName.toLowerCase()) && (
              <button
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2 text-primary"
                onMouseDown={() => handleAdd(addName)}
              >
                <UserPlus className="w-4 h-4" />
                Add "{addName.trim()}"
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────
function MessageBubble({ msg, prevMsg, avatarUrl }: { msg: ChatMessage; prevMsg?: ChatMessage; avatarUrl?: string | null }) {
  const actor = getActor();
  const me = msg.sender_name === actor && actor !== "";
  const showName = !prevMsg || prevMsg.sender_name !== msg.sender_name;
  const showDateSep = !prevMsg || !sameDay(prevMsg.created_at, msg.created_at);

  return (
    <>
      {showDateSep && (
        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground font-medium">{fmtDate(msg.created_at)}</span>
          <div className="flex-1 h-px bg-border" />
        </div>
      )}
      <div className={cn("flex gap-2.5 px-4", me ? "flex-row-reverse" : "flex-row", showName ? "mt-3" : "mt-0.5")}>
        {!me && (
          <div className={cn("shrink-0 mt-0.5", showName ? "opacity-100" : "opacity-0")}>
            <Avatar name={msg.sender_name} size={7} avatarUrl={avatarUrl} />
          </div>
        )}
        <div className={cn("max-w-[70%]", me ? "items-end" : "items-start", "flex flex-col gap-0.5")}>
          {showName && !me && (
            <span className="text-xs font-semibold text-foreground px-1">{msg.sender_name}</span>
          )}
          <div className={cn(
            "rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words",
            me
              ? "bg-primary text-primary-foreground rounded-tr-sm"
              : "bg-muted text-foreground rounded-tl-sm"
          )}>
            {msg.content}
          </div>
          <span className="text-[10px] text-muted-foreground px-1">{fmtTime(msg.created_at)}</span>
        </div>
        {me && (
          <div className={cn("shrink-0 mt-0.5", showName ? "opacity-100" : "opacity-0")}>
            <Avatar name={msg.sender_name} size={7} avatarUrl={avatarUrl} />
          </div>
        )}
      </div>
    </>
  );
}

// ─── Conversation sidebar item ────────────────────────────────────────────────
function ConvItem({ conv, active, onClick, currentActor, avatarFor }: { conv: Conversation; active: boolean; onClick: () => void; currentActor?: string; avatarFor: (name: string) => string | null }) {
  const label = convLabel(conv, currentActor);
  const count = parseInt(conv.message_count || "0", 10);
  const participants = (conv.participants ?? []).filter(n => conv.type !== "direct" || n !== currentActor);

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2 rounded-lg flex items-center gap-2.5 transition-colors group",
        active
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <span className="shrink-0 opacity-70">{convIcon(conv.type)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate leading-tight">{label}</p>
        {conv.last_message ? (
          <p className="text-xs truncate opacity-60 leading-tight mt-0.5">
            {conv.last_sender ? `${conv.last_sender}: ` : ""}{conv.last_message}
          </p>
        ) : (
          <p className="text-xs opacity-40 leading-tight mt-0.5">
            {conv.created_by && conv.created_by !== "Unknown" ? `by ${conv.created_by}` : ""}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {participants.length > 0 && (
          <div className="flex -space-x-1.5">
            {participants.slice(0, 3).map(name => {
              const url = avatarFor(name);
              return url ? (
                <img key={name} src={`${API_BASE}/storage${url}`} alt={name} title={name} className="w-4 h-4 rounded-full border border-background object-cover" />
              ) : (
                <div key={name} className="w-4 h-4 rounded-full border border-background text-[8px] font-bold text-white flex items-center justify-center" style={{ backgroundColor: stringToColor(name) }}>
                  {name.charAt(0).toUpperCase()}
                </div>
              );
            })}
            {participants.length > 3 && (
              <div className="w-4 h-4 rounded-full border border-background bg-muted text-[8px] font-bold text-muted-foreground flex items-center justify-center">
                +{participants.length - 3}
              </div>
            )}
          </div>
        )}
        {count > 0 && <span className="text-[10px] opacity-50">{count}</span>}
      </div>
    </button>
  );
}

// ─── New conversation dialog ──────────────────────────────────────────────────
function NewConvDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const { toast } = useToast();
  const [type, setType] = useState<"custom" | "order" | "customer" | "direct">("custom");
  const [subject, setSubject] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const actor = getActor();
  const { data: staffDirectory = [] } = useStaffDirectory();
  const pickableStaff = staffDirectory.filter(s => s.name !== actor);

  const { data: orders = [] } = useQuery<any[]>({
    queryKey: ["orders-search", orderNumber],
    queryFn: () => apiFetch(`/orders?search=${encodeURIComponent(orderNumber)}&limit=10`),
    enabled: type === "order" && orderNumber.length > 0,
  });

  const { data: customers = [] } = useQuery<any[]>({
    queryKey: ["customers-search", customerName],
    queryFn: () => apiFetch(`/customers?search=${encodeURIComponent(customerName)}&limit=10`),
    enabled: type === "customer" && customerName.length > 0,
  });

  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);

  const create = useMutation({
    mutationFn: () => apiFetch<any>("/chat/conversations", {
      method: "POST",
      body: JSON.stringify({
        type,
        subject: type === "custom" ? subject : null,
        order_id: type === "order" ? selectedOrderId : null,
        customer_id: type === "customer" ? selectedCustomerId : null,
        participant_names: type === "direct" ? selectedNames : undefined,
      }),
    }),
    onSuccess: (data) => {
      toast({ title: type === "direct" ? "Direct message started" : "Chat created" });
      onCreated(data.id);
      onClose();
      setSubject(""); setOrderNumber(""); setCustomerName(""); setSelectedNames([]);
      setSelectedOrderId(null); setSelectedCustomerId(null);
    },
    onError: () => toast({ title: "Could not create chat", variant: "destructive" }),
  });

  function toggleName(name: string) {
    setSelectedNames(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  }

  const canCreate = type === "custom" ? subject.trim().length > 0
    : type === "order" ? !!selectedOrderId
    : type === "customer" ? !!selectedCustomerId
    : selectedNames.length > 0;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New chat</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Type selector */}
          <div className="flex gap-2">
            {(["direct", "custom", "order", "customer"] as const).map(t => (
              <button
                key={t}
                onClick={() => { setType(t); setSelectedOrderId(null); setSelectedCustomerId(null); }}
                className={cn(
                  "flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors",
                  type === t ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"
                )}
              >
                {t === "direct" ? "Direct message" : t === "custom" ? "Custom topic" : t === "order" ? "Order" : "Customer"}
              </button>
            ))}
          </div>

          {type === "direct" && (
            <div>
              <Label className="text-sm mb-1.5 block">Send to</Label>
              <div className="grid grid-cols-4 gap-3 max-h-64 overflow-y-auto py-1">
                {pickableStaff.map(s => {
                  const selected = selectedNames.includes(s.name);
                  return (
                    <button
                      key={s.name}
                      type="button"
                      onClick={() => toggleName(s.name)}
                      className="flex flex-col items-center gap-1 group"
                    >
                      <div className={cn(
                        "relative rounded-full p-0.5 transition-all",
                        selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "ring-1 ring-transparent group-hover:ring-border"
                      )}>
                        <Avatar name={s.name} size={12} avatarUrl={s.avatar_url} />
                        {selected && (
                          <div className="absolute -bottom-0.5 -right-0.5 bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center">
                            <Check className="w-2.5 h-2.5" />
                          </div>
                        )}
                      </div>
                      <span className="text-[11px] text-center leading-tight truncate w-full">{s.name}</span>
                    </button>
                  );
                })}
                {pickableStaff.length === 0 && (
                  <p className="text-xs text-muted-foreground col-span-4">No other staff accounts found</p>
                )}
              </div>
              {selectedNames.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  {selectedNames.length === 1 ? `Messaging ${selectedNames[0]}` : `Group message with ${selectedNames.join(", ")}`}
                </p>
              )}
            </div>
          )}

          {type === "custom" && (
            <div>
              <Label className="text-sm mb-1.5 block">Topic / subject</Label>
              <Input placeholder="e.g. Q3 planning, Delivery issue…" value={subject} onChange={e => setSubject(e.target.value)} />
            </div>
          )}

          {type === "order" && (
            <div>
              <Label className="text-sm mb-1.5 block">Search order</Label>
              <Input placeholder="Order number or customer name…" value={orderNumber} onChange={e => { setOrderNumber(e.target.value); setSelectedOrderId(null); }} />
              {orders.length > 0 && !selectedOrderId && (
                <div className="mt-1 border rounded-lg overflow-hidden">
                  {orders.slice(0, 6).map((o: any) => (
                    <button key={o.id} onClick={() => { setSelectedOrderId(o.id); setOrderNumber(`${o.orderNumber} — ${o.customerName}`); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex justify-between">
                      <span className="font-medium">{o.orderNumber}</span>
                      <span className="text-muted-foreground">{o.customerName}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedOrderId && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><Check className="w-3 h-3" /> Order selected</p>}
            </div>
          )}

          {type === "customer" && (
            <div>
              <Label className="text-sm mb-1.5 block">Search customer</Label>
              <Input placeholder="Customer name…" value={customerName} onChange={e => { setCustomerName(e.target.value); setSelectedCustomerId(null); }} />
              {customers.length > 0 && !selectedCustomerId && (
                <div className="mt-1 border rounded-lg overflow-hidden">
                  {customers.slice(0, 6).map((c: any) => (
                    <button key={c.id} onClick={() => { setSelectedCustomerId(c.id); setCustomerName(c.name); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted">
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
              {selectedCustomerId && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><Check className="w-3 h-3" /> Customer selected</p>}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!canCreate || create.isPending}>
            {create.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Create chat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Message area ─────────────────────────────────────────────────────────────
function MessageArea({ conv }: { conv: Conversation }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [panel, setPanel] = useState<"none" | "notif" | "members">("none");
  const actor = getActor();
  const { data: staffDirectory = [] } = useStaffDirectory();
  const avatarFor = (name: string) => staffDirectory.find(s => s.name === name)?.avatar_url ?? null;

  const { data: messages = [], isLoading } = useQuery<ChatMessage[]>({
    queryKey: ["chat-messages", conv.id],
    queryFn: () => apiFetch(`/chat/conversations/${conv.id}/messages`),
    refetchInterval: 5000,
  });

  // Mark conversation as read when opened or when new messages arrive
  const qcRef = qc;
  useEffect(() => {
    apiFetch(`/chat/conversations/${conv.id}/mark-read`, { method: "POST" })
      .then(() => qcRef.invalidateQueries({ queryKey: ["chat-unread-count"] }))
      .catch(() => {});
  }, [conv.id, messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = useMutation({
    mutationFn: () => apiFetch(`/chat/conversations/${conv.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: draft.trim() }),
    }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["chat-messages", conv.id] });
      qc.invalidateQueries({ queryKey: ["chat-conversations"] });
    },
    onError: () => toast({ title: "Could not send message", variant: "destructive" }),
  });

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (draft.trim()) send.mutate();
    }
  }

  const label = convLabel(conv, actor);
  const creator = conv.created_by && conv.created_by !== "Unknown" ? conv.created_by : null;
  const participants: string[] = (conv.participants ?? []).filter(n => conv.type !== "direct" || n !== actor);

  function subtitle() {
    const parts: string[] = [];
    if (conv.type === "order") parts.push("Order chat");
    else if (conv.type === "customer" && conv.customer_name) parts.push(`Customer: ${conv.customer_name}`);
    else if (conv.type === "general") parts.push("General channel");
    else if (conv.type === "direct") parts.push(participants.length > 1 ? "Group message" : "Direct message");
    if (creator) parts.push(`created by ${creator}`);
    return parts.join(" · ");
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-background shrink-0">
        <span className="text-muted-foreground">{convIcon(conv.type)}</span>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-foreground leading-tight">{label}</h2>
          <p className="text-xs text-muted-foreground">{subtitle()}</p>
        </div>

        {/* Participant avatars */}
        {participants.length > 0 && (
          <button
            className="flex -space-x-1.5 hover:opacity-80 transition-opacity"
            title={`Members: ${participants.join(", ")}`}
            onClick={() => setPanel(p => p === "members" ? "none" : "members")}
          >
            {participants.slice(0, 4).map(name => {
              const url = avatarFor(name);
              return url ? (
                <img key={name} src={`${API_BASE}/storage${url}`} alt={name} className="w-6 h-6 rounded-full border-2 border-background object-cover" />
              ) : (
                <div key={name} className="w-6 h-6 rounded-full border-2 border-background text-[9px] font-bold text-white flex items-center justify-center" style={{ backgroundColor: stringToColor(name) }}>
                  {name.charAt(0).toUpperCase()}
                </div>
              );
            })}
            {participants.length > 4 && (
              <div className="w-6 h-6 rounded-full border-2 border-background bg-muted text-[9px] font-bold text-muted-foreground flex items-center justify-center">
                +{participants.length - 4}
              </div>
            )}
          </button>
        )}

        <Button
          variant="ghost"
          size="sm"
          className={cn("gap-1.5 text-xs h-8", panel === "members" && "bg-muted")}
          onClick={() => setPanel(p => p === "members" ? "none" : "members")}
        >
          <Users className="w-3.5 h-3.5" />
          Members
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className={cn("gap-1.5 text-xs h-8", panel === "notif" && "bg-muted")}
          onClick={() => setPanel(p => p === "notif" ? "none" : "notif")}
        >
          {panel === "notif" ? <BellOff className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
          Notifications
        </Button>
      </div>

      {/* Side panels */}
      {panel === "notif" && <NotifPanel convId={conv.id} onClose={() => setPanel("none")} />}
      {panel === "members" && <MembersPanel convId={conv.id} onClose={() => setPanel("none")} />}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading messages…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <MessageSquare className="w-10 h-10 opacity-20" />
            <p className="font-medium text-sm">No messages yet</p>
            <p className="text-xs">Start the conversation below</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <MessageBubble key={msg.id} msg={msg} prevMsg={messages[i - 1]} avatarUrl={avatarFor(msg.sender_name)} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t bg-background px-4 py-3">
        <div className="flex gap-2 items-end">
          <Textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${label}… (Enter to send, Shift+Enter for new line)`}
            rows={1}
            className="resize-none text-sm min-h-[38px] max-h-40 flex-1"
            style={{ height: "auto" }}
            onInput={e => {
              const t = e.currentTarget;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 160) + "px";
            }}
          />
          <Button
            size="sm"
            className="h-9 px-3 shrink-0"
            onClick={() => { if (draft.trim()) send.mutate(); }}
            disabled={!draft.trim() || send.isPending}
          >
            {send.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 ml-0.5">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Chat() {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const { data: conversations = [], isLoading } = useQuery<Conversation[]>({
    queryKey: ["chat-conversations"],
    queryFn: () => apiFetch("/chat/conversations"),
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (conversations.length > 0 && activeId === null) {
      const general = conversations.find(c => c.type === "general");
      setActiveId(general?.id ?? conversations[0].id);
    }
  }, [conversations, activeId]);

  const activeConv = conversations.find(c => c.id === activeId) ?? null;

  const actor = getActor();
  const { data: staffDirectory = [] } = useStaffDirectory();
  const avatarFor = (name: string) => staffDirectory.find(s => s.name === name)?.avatar_url ?? null;

  const grouped = {
    direct: conversations.filter(c => c.type === "direct"),
    general: conversations.filter(c => c.type === "general"),
    order: conversations.filter(c => c.type === "order"),
    customer: conversations.filter(c => c.type === "customer"),
    custom: conversations.filter(c => c.type === "custom"),
  };

  return (
    <Layout>
      <div className="flex h-[calc(100vh-4rem)] -m-6 overflow-hidden rounded-none">
        {/* Sidebar */}
        <aside className="w-64 shrink-0 border-r bg-muted/30 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-3 border-b">
            <h2 className="font-semibold text-sm text-foreground">Chats</h2>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setNewOpen(true)}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : (
              <>
                {grouped.direct.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 mb-1">Direct messages</p>
                    {grouped.direct.map(c => <ConvItem key={c.id} conv={c} active={activeId === c.id} onClick={() => setActiveId(c.id)} currentActor={actor} avatarFor={avatarFor} />)}
                  </div>
                )}
                {grouped.general.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 mb-1">General</p>
                    {grouped.general.map(c => <ConvItem key={c.id} conv={c} active={activeId === c.id} onClick={() => setActiveId(c.id)} currentActor={actor} avatarFor={avatarFor} />)}
                  </div>
                )}
                {grouped.order.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 mb-1">Orders</p>
                    {grouped.order.map(c => <ConvItem key={c.id} conv={c} active={activeId === c.id} onClick={() => setActiveId(c.id)} currentActor={actor} avatarFor={avatarFor} />)}
                  </div>
                )}
                {grouped.customer.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 mb-1">Customers</p>
                    {grouped.customer.map(c => <ConvItem key={c.id} conv={c} active={activeId === c.id} onClick={() => setActiveId(c.id)} currentActor={actor} avatarFor={avatarFor} />)}
                  </div>
                )}
                {grouped.custom.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 mb-1">Topics</p>
                    {grouped.custom.map(c => <ConvItem key={c.id} conv={c} active={activeId === c.id} onClick={() => setActiveId(c.id)} currentActor={actor} avatarFor={avatarFor} />)}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="px-3 py-3 border-t">
            <Button variant="outline" size="sm" className="w-full gap-2 text-xs h-8" onClick={() => setNewOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> New chat
            </Button>
          </div>
        </aside>

        {/* Message panel */}
        <main className="flex-1 overflow-hidden">
          {activeConv ? (
            <MessageArea key={activeConv.id} conv={activeConv} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
              <MessageSquare className="w-12 h-12 opacity-20" />
              <p className="font-medium">Select a chat to get started</p>
              <Button variant="outline" size="sm" onClick={() => setNewOpen(true)} className="gap-2">
                <Plus className="w-4 h-4" /> New chat
              </Button>
            </div>
          )}
        </main>
      </div>

      <NewConvDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={id => { setActiveId(id); }}
      />
    </Layout>
  );
}
