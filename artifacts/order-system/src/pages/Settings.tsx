import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings2, RefreshCw, CheckCircle, AlertTriangle, AlertCircle, Play,
  Eye, EyeOff, Loader2, Wifi, WifiOff, ShoppingCart, Star, BookMarked, Package,
  Link2, Unlink2, Users, ExternalLink, BookOpen, Mail, Send, Lock, GripVertical, Ruler,
  UserPlus, Trash2, UserCheck, Zap, Phone, Printer, Truck, Share2, Globe, Copy,
  Shield, ShieldCheck, UserCog, ChevronRight, Plus, Palette, MessageSquarePlus, GitBranch,
  Download, Tag,
  Camera,
} from "lucide-react";
import { staffAuthHeader, getStaffJwtPayload } from "@/lib/staff-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";
import { formatDate } from "@/lib/utils";
import { getListProductsQueryKey } from "@workspace/api-client-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";

const API_BASE = "/api";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface SyncLog {
  id: number;
  type: string;
  status: string;
  message: string | null;
  itemsCreated: string | null;
  itemsUpdated: string | null;
  errors: string | null;
  progressPct: number | null;
  startedAt: string;
  completedAt: string | null;
}

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  running: { label: "Running", color: "bg-blue-100 text-blue-800 border-blue-300" },
  completed: { label: "Completed", color: "bg-green-100 text-green-800 border-green-300" },
  completed_with_errors: { label: "Completed w/ Errors", color: "bg-amber-100 text-amber-800 border-amber-300" },
  failed: { label: "Failed", color: "bg-red-100 text-red-800 border-red-300" },
};

const SCHEDULE_OPTIONS = [
  { value: "none", label: "Disabled" },
  { value: "hourly", label: "Every hour" },
  { value: "every6hours", label: "Every 6 hours" },
  { value: "daily", label: "Daily (2am)" },
];

interface XeroStatus {
  connected: boolean;
  hasCredentials: boolean;
  tenantId: string | null;
  tenantName: string | null;
  expiresAt: string | null;
}

const DEFAULT_SIZE_ORDER = [
  "XXXS", "XXS", "XS", "S", "M", "L", "XL",
  "2XL", "3XL", "4XL", "5XL", "6XL", "7XL", "8XL",
  "X-Small", "Small", "Medium", "Large", "X-Large", "XX-Large",
  "One Size",
];

function MayaIntegrationTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  type MayaStatus = {
    apiEnabled: boolean;
    connection: string;
    writeAccess: boolean;
    lastRequest: string | null;
    lastSuccessful: string | null;
    lastFailed: string | null;
    changesByMaya: number | null;
    awaitingApproval: number | null;
    webhook: { configured: boolean };
  };
  const statusQuery = useQuery<MayaStatus>({
    queryKey: ["maya-integration-status"],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/auth/staff/maya/integration/status`, { headers: staffAuthHeader() });
      if (!response.ok) throw new Error("Unable to load Maya integration status");
      return response.json();
    },
    refetchInterval: 30_000,
  });
  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await fetch(`${API_BASE}/auth/staff/maya/integration/write-access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...staffAuthHeader() },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error("Unable to update Maya write access");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maya-integration-status"] });
      toast({ title: "Maya write access updated" });
    },
    onError: (error: Error) => toast({ title: "Update failed", description: error.message, variant: "destructive" }),
  });
  const status = statusQuery.data;
  const format = (value: string | null) => value ? formatDate(value) : "Not recorded";

  return (
    <div className="grid gap-6 max-w-2xl">
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-base">Maya Integration</h2>
          <Badge variant={status?.connection === "connected" ? "default" : "secondary"} className="ml-auto">
            {statusQuery.isLoading ? "Checking…" : status?.connection === "connected" ? "Connected" : "Not configured"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Maya can read approved, non-sensitive site data. Write requests remain subject to this independent control and approval workflow.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div className="rounded-lg border p-3"><p className="text-muted-foreground">Write access</p><p className="font-semibold">{status?.writeAccess ? "Enabled" : "Disabled"}</p></div>
          <div className="rounded-lg border p-3"><p className="text-muted-foreground">Webhook</p><p className="font-semibold">{status?.webhook.configured ? "Configured" : "Not configured"}</p></div>
          <div className="rounded-lg border p-3"><p className="text-muted-foreground">Last request</p><p className="font-medium">{format(status?.lastRequest ?? null)}</p></div>
          <div className="rounded-lg border p-3"><p className="text-muted-foreground">Last success</p><p className="font-medium">{format(status?.lastSuccessful ?? null)}</p></div>
          <div className="rounded-lg border p-3"><p className="text-muted-foreground">Last failure</p><p className="font-medium">{format(status?.lastFailed ?? null)}</p></div>
          <div className="rounded-lg border p-3"><p className="text-muted-foreground">Changes by Maya</p><p className="font-medium">{status?.changesByMaya ?? "None recorded"}</p></div>
          <div className="rounded-lg border p-3"><p className="text-muted-foreground">Awaiting approval</p><p className="font-medium">{status?.awaitingApproval ?? "None recorded"}</p></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => statusQuery.refetch()} disabled={statusQuery.isFetching} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${statusQuery.isFetching ? "animate-spin" : ""}`} /> Refresh status
          </Button>
          <Button
            variant={status?.writeAccess ? "destructive" : "default"}
            onClick={() => toggleMutation.mutate(!status?.writeAccess)}
            disabled={!status || toggleMutation.isPending}
            className="gap-2"
          >
            {toggleMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            {status?.writeAccess ? "DISABLE MAYA WRITE ACCESS" : "Enable Maya write access"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The Maya API key is never shown or sent to this screen. Only authenticated staff sessions can change write access.
        </p>
      </div>
    </div>
  );
}

function SizesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: rawSettings } = useQuery<Record<string, string | null>>({
    queryKey: ["settings"],
    queryFn: () => fetch(`${API_BASE}/settings`).then(r => r.json()),
    staleTime: 1000 * 60 * 10,
  });

  const [order, setOrder] = useState<string[]>(DEFAULT_SIZE_ORDER);
  const [dirty, setDirty] = useState(false);
  const [newSize, setNewSize] = useState("");
  const dragIdx = useRef<number | null>(null);

  useEffect(() => {
    const raw = rawSettings?.["size_order"];
    if (raw) {
      try { setOrder(JSON.parse(raw)); } catch {}
    }
  }, [rawSettings]);

  const saveMutation = useMutation({
    mutationFn: () =>
      fetch(`${API_BASE}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size_order: JSON.stringify(order) }),
      }).then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast({ title: "Size order saved" });
      setDirty(false);
    },
    onError: () => toast({ title: "Error", description: "Could not save size order", variant: "destructive" }),
  });

  const handleDragStart = (idx: number) => { dragIdx.current = idx; };
  const handleDragOver = (e: DragEvent<HTMLDivElement>, idx: number) => {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    setOrder(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx.current!, 1);
      next.splice(idx, 0, moved);
      dragIdx.current = idx;
      return next;
    });
    setDirty(true);
  };
  const handleDragEnd = () => { dragIdx.current = null; };

  const addSize = () => {
    const trimmed = newSize.trim();
    if (!trimmed || order.includes(trimmed)) { setNewSize(""); return; }
    setOrder(prev => [...prev, trimmed]);
    setNewSize("");
    setDirty(true);
  };

  const removeSize = (size: string) => {
    setOrder(prev => prev.filter(s => s !== size));
    setDirty(true);
  };

  return (
    <div className="grid gap-6 max-w-xl">
      <div>
        <h3 className="text-sm font-semibold mb-1">Size Display Order</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Drag to reorder, or add/remove sizes. This order is used everywhere sizes appear — wardrobe items, order forms, stock tables, and the customer portal.
        </p>
        <div className="border rounded-lg divide-y overflow-hidden">
          {order.map((size, idx) => (
            <div
              key={size}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className="flex items-center gap-3 px-4 py-2.5 cursor-grab active:cursor-grabbing hover:bg-muted/50 select-none transition-colors group"
            >
              <GripVertical className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
              <span className="text-sm font-medium flex-1">{size}</span>
              <button
                onClick={(e) => { e.stopPropagation(); removeSize(size); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-muted-foreground hover:text-red-600 hover:bg-red-50"
                title="Remove size"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <Input
            value={newSize}
            onChange={(e) => setNewSize(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addSize(); }}
            placeholder="Add a size (e.g. Extra Small Youth)"
            className="flex-1"
          />
          <Button variant="outline" onClick={addSize} disabled={!newSize.trim()}>Add</Button>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!dirty || saveMutation.isPending}
          className="gap-2"
        >
          {saveMutation.isPending
            ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</>
            : <><CheckCircle className="w-4 h-4" />Save Order</>}
        </Button>
        <Button
          variant="outline"
          onClick={() => { setOrder(DEFAULT_SIZE_ORDER); setDirty(true); }}
        >
          Reset to Default
        </Button>
      </div>
    </div>
  );
}

interface StaffAccount { name: string; email: string; }

function StaffAccountsCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newName, setNewName]   = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding]     = useState(false);

  const { data, isLoading } = useQuery<{ accounts: StaffAccount[] }>({
    queryKey: ["staff-accounts"],
    queryFn: () => fetch(`${API_BASE}/auth/staff/accounts`).then(r => r.json()),
  });
  const accounts = data?.accounts ?? [];

  const addMutation = useMutation({
    mutationFn: () =>
      fetch(`${API_BASE}/auth/staff/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, email: newEmail }),
      }).then(async r => { if (!r.ok) throw new Error((await r.json()).error); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-accounts"] });
      setNewName(""); setNewEmail(""); setAdding(false);
      toast({ title: "Staff account added" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: (email: string) =>
      fetch(`${API_BASE}/auth/staff/accounts/${encodeURIComponent(email)}`, { method: "DELETE" })
        .then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-accounts"] });
      toast({ title: "Account removed" });
    },
    onError: () => toast({ title: "Error", description: "Could not remove account", variant: "destructive" }),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-base flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-muted-foreground" /> Staff Accounts
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Add each staff member's name and email address. They can then sign in using a one-time code sent to their email — no password needed.
        </p>
      </div>

      {/* Accounts list */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <Users className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No staff accounts yet. Add one below.</p>
        </div>
      ) : (
        <div className="border rounded-lg divide-y overflow-hidden">
          {accounts.map(a => (
            <div key={a.email} className="flex items-center justify-between px-4 py-3 gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{a.name}</p>
                <p className="text-xs text-muted-foreground truncate">{a.email}</p>
              </div>
              <button
                onClick={() => removeMutation.mutate(a.email)}
                disabled={removeMutation.isPending}
                className="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                title="Remove"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      {adding ? (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input placeholder="James Smith" value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Email address</Label>
              <Input type="email" placeholder="admin@example.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !newName || !newEmail} className="gap-1.5">
              {addMutation.isPending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Adding…</> : <><CheckCircle className="w-3.5 h-3.5" />Add account</>}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewName(""); setNewEmail(""); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="gap-2">
          <UserPlus className="w-4 h-4" /> Add staff member
        </Button>
      )}
    </div>
  );
}

function InvocoTab({ rawSettings }: { rawSettings: Record<string, string> | undefined }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [apiKey, setApiKey]     = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [apiUrl, setApiUrl]     = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [loaded, setLoaded]     = useState(false);

  useEffect(() => {
    if (rawSettings && !loaded) {
      setApiKey(rawSettings["invoco_api_key"] ?? "");
      setUsername(rawSettings["invoco_username"] ?? "");
      setPassword(rawSettings["invoco_password"] ?? "");
      setApiUrl(rawSettings["invoco_api_url"] ?? "");
      setLoaded(true);
    }
  }, [rawSettings, loaded]);

  const saveMutation = useMutation({
    mutationFn: () =>
      fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoco_api_key:  apiKey   || null,
          invoco_username: username || null,
          invoco_password: password || null,
          invoco_api_url:  apiUrl   || null,
        }),
      }).then((r) => { if (!r.ok) throw new Error("Save failed"); return r.json(); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-raw"] });
      toast({ title: "Invoco settings saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const isConfigured = !!((apiKey || (username && password)) && apiUrl);

  return (
    <div className="grid gap-6 max-w-2xl">
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Phone className="w-4 h-4 text-blue-500" />
          <h2 className="font-semibold text-base">Invoco Phonebook Sync</h2>
          {isConfigured && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">
              <CheckCircle className="w-3 h-3" /> Configured
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Whenever a customer is created or updated, their name and phone number are automatically pushed to your Invoco phonebook — so incoming calls display the customer's name on your handsets.
        </p>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="invocoApiUrl">API Endpoint URL</Label>
            <Input
              id="invocoApiUrl"
              placeholder="https://api.invoco.net/phonebook/contacts"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The Invoco API endpoint for adding/updating phonebook contacts.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invocoApiKey">API Key</Label>
            <div className="relative">
              <Input
                id="invocoApiKey"
                type={showApiKey ? "text" : "password"}
                placeholder="Your Invoco API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Sent as <code className="bg-muted px-1 rounded text-xs">Authorization: Bearer &lt;key&gt;</code>. If set, username/password below are ignored.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Basic Auth (fallback if no API key)</p>
            <div className="space-y-1.5">
              <Label htmlFor="invocoUsername">Username</Label>
              <Input
                id="invocoUsername"
                placeholder="your-invoco-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invocoPassword">Password</Label>
              <div className="relative">
                <Input
                  id="invocoPassword"
                  type={showPass ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        <Button size="sm" className="gap-1.5" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending
            ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</>
            : <><CheckCircle className="w-4 h-4" />Save</>}
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-2">
        <h2 className="font-semibold text-sm">How it works</h2>
        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc list-inside">
          <li>Every time you save a customer, their <strong>phone number</strong> and <strong>contact name</strong> are pushed to Invoco in the background.</li>
          <li>Uses your <strong>API key</strong> (Bearer token) if set; falls back to <strong>HTTP Basic Auth</strong> if not.</li>
          <li>If the customer has no phone number, the sync is skipped for that record.</li>
          <li>Errors are logged server-side but won't interrupt saving the customer.</li>
        </ul>
      </div>
    </div>
  );
}

function HighLevelTab({ rawSettings }: { rawSettings: Record<string, string> | undefined }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [webhookUrl, setWebhookUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [locationId, setLocationId] = useState("");
  const [campaignUserId, setCampaignUserId] = useState("");
  const [campaignUserName, setCampaignUserName] = useState("");
  const [weeklyCampaignPromptEmail, setWeeklyCampaignPromptEmail] = useState("");
  const [deliveryWebhookUrl, setDeliveryWebhookUrl] = useState("");
  const [googleReviewUrl, setGoogleReviewUrl] = useState("");
  const [facebookReviewUrl, setFacebookReviewUrl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [testFollowupEmail, setTestFollowupEmail] = useState("");
  const [testFollowupSending, setTestFollowupSending] = useState(false);
  const [testFollowupResult, setTestFollowupResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [bulkTagging, setBulkTagging] = useState(false);
  const [bulkTagResult, setBulkTagResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (rawSettings && !loaded) {
      setWebhookUrl(rawSettings["high_level_webhook_url"] ?? "");
      setApiKey(rawSettings["high_level_api_key"] ?? "");
      setLocationId(rawSettings["high_level_location_id"] ?? "");
      setCampaignUserId(rawSettings["high_level_user_id"] ?? "");
      setCampaignUserName(rawSettings["high_level_user_name"] ?? "");
      setWeeklyCampaignPromptEmail(rawSettings["weekly_campaign_prompt_email"] ?? "");
      setDeliveryWebhookUrl(rawSettings["local_delivery_ghl_webhook_url"] ?? "");
      setGoogleReviewUrl(rawSettings["google_review_url"] ?? "");
      setFacebookReviewUrl(rawSettings["facebook_review_url"] ?? "");
      setLoaded(true);
    }
  }, [rawSettings, loaded]);

  const saveMutation = useMutation({
    mutationFn: () =>
      fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          high_level_webhook_url: webhookUrl || null,
          high_level_api_key: apiKey || null,
          high_level_location_id: locationId || null,
          high_level_user_id: campaignUserId || null,
          high_level_user_name: campaignUserName || null,
          weekly_campaign_prompt_email: weeklyCampaignPromptEmail.trim() || null,
          local_delivery_ghl_webhook_url: deliveryWebhookUrl || null,
          google_review_url: googleReviewUrl || null,
          facebook_review_url: facebookReviewUrl || null,
        }),
      }).then((r) => { if (!r.ok) throw new Error("Save failed"); return r.json(); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-raw"] });
      toast({ title: "High Level settings saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      fetch("/api/enquiries/sync", { method: "POST" }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<{ synced: number }>;
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["enquiries"] });
      toast({ title: "Enquiries synced", description: `${data.synced} lead${data.synced !== 1 ? "s" : ""} imported from High Level` });
    },
    onError: (e: Error) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const { data: enquiries = [] } = useQuery<any[]>({
    queryKey: ["enquiries"],
    queryFn: () => fetch("/api/enquiries").then((r) => r.json()),
  });

  return (
    <div className="grid gap-6 max-w-2xl">
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          <h2 className="font-semibold text-base">Leads Sync (Enquiries)</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Contacts tagged <strong>Telephone Enquiry</strong>, <strong>Website Lead</strong>, or <strong>Showroom Contact</strong> in High Level will appear as selectable Enquiries when creating a new quote.
        </p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="hlApiKey">API Key (Private Integration Token)</Label>
            <Input
              id="hlApiKey"
              type="password"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              High Level → Settings → Integrations → Private Integrations → create or copy token.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hlLocationId">Location ID</Label>
            <Input
              id="hlLocationId"
              placeholder="abc123xyz..."
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              High Level → Settings → Business Profile — the Location ID shown at the top.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hlCampaignUserId">Campaign User ID</Label>
              <Input
                id="hlCampaignUserId"
                placeholder="HighLevel user ID"
                value={campaignUserId}
                onChange={(e) => setCampaignUserId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hlCampaignUserName">Campaign User Name</Label>
              <Input
                id="hlCampaignUserName"
                placeholder="Email campaigns"
                value={campaignUserName}
                onChange={(e) => setCampaignUserName(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Used when creating Email Marketing campaigns. The integration will try to find a location user automatically when these are blank.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="weeklyCampaignPromptEmail">Friday campaign prompt email</Label>
            <Input
              id="weeklyCampaignPromptEmail"
              type="email"
              placeholder="Leave blank to use the enquiry notification email"
              value={weeklyCampaignPromptEmail}
              onChange={(e) => setWeeklyCampaignPromptEmail(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
          Every Friday at 9am, the integration sends this address a shortlist and a link to choose one article for the scheduled campaign.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Button size="sm" className="gap-1.5" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : <><CheckCircle className="w-4 h-4" />Save</>}
          </Button>
          <Button
            size="sm" variant="outline" className="gap-1.5"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || !apiKey || !locationId}
          >
            {syncMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Syncing…</> : <><RefreshCw className="w-4 h-4" />Sync Enquiries Now</>}
          </Button>
          {enquiries.length > 0 && (
            <span className="text-xs text-muted-foreground">{enquiries.length} enquiri{enquiries.length !== 1 ? "es" : "y"} cached</span>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          <h2 className="font-semibold text-base">High Level Webhook</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          When you click <strong>Send via High Level</strong> on a collection order invoice, the integration posts the order data to this URL, triggering your workflow to send the customer their invoice template.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="hlWebhookUrl">Webhook URL</Label>
          <Input
            id="hlWebhookUrl"
            placeholder="https://services.leadconnectorhq.com/hooks/..."
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Find this in High Level → Automations → your workflow → Webhook trigger → copy the URL.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : <><CheckCircle className="w-4 h-4" />Save Webhook URL</>}
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          <h2 className="font-semibold text-base">Local Delivery Notifications</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          When a <strong>Send Invoice</strong> is triggered for a <strong>local delivery</strong> order, the configured automation sends the customer an out-for-delivery email and fires your workflow. A later follow-up can be configured separately.
        </p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="deliveryWebhookUrl">Local Delivery GHL Webhook URL</Label>
            <Input
              id="deliveryWebhookUrl"
              placeholder="https://services.leadconnectorhq.com/hooks/..."
              value={deliveryWebhookUrl}
              onChange={(e) => setDeliveryWebhookUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              GHL automation webhook for local delivery events. The payload includes <code>eventType</code> (<code>out_for_delivery</code> or <code>delivery_followup</code>), <code>contactId</code>, <code>orderNumber</code>, <code>customerName</code>, and <code>actorName</code>.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="googleReviewUrl">Google Review Link</Label>
            <Input
              id="googleReviewUrl"
              placeholder="https://g.page/r/..."
              value={googleReviewUrl}
              onChange={(e) => setGoogleReviewUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Your Google Business Profile review link — shown as a button in the 48h follow-up email.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="facebookReviewUrl">Facebook Review Link</Label>
            <Input
              id="facebookReviewUrl"
              placeholder="https://www.facebook.com/..."
              value={facebookReviewUrl}
              onChange={(e) => setFacebookReviewUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Your Facebook page reviews URL — shown as a button in the 48h follow-up email.
            </p>
          </div>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : <><CheckCircle className="w-4 h-4" />Save</>}
        </Button>
      </div>

      {/* ── Test review follow-up email ─────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-base flex items-center gap-2">
            <Mail className="w-4 h-4 text-green-600" /> Test Review Follow-up Email
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Send yourself a preview of the 48-hour review request email that customers receive after their order is dispatched. Uses the Google &amp; Facebook review links saved above.
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="your@email.com"
            value={testFollowupEmail}
            onChange={e => { setTestFollowupEmail(e.target.value); setTestFollowupResult(null); }}
            className="flex-1"
          />
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            disabled={!testFollowupEmail || testFollowupSending}
            onClick={async () => {
              setTestFollowupSending(true);
              setTestFollowupResult(null);
              try {
                const res = await fetch("/api/invoices/test-followup-email", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ toEmail: testFollowupEmail }),
                });
                const data = await res.json();
                if (data.ok) {
                  setTestFollowupResult({ ok: true, msg: `Sent to ${testFollowupEmail}` });
                } else {
                  setTestFollowupResult({ ok: false, msg: data.error ?? "Send failed" });
                }
              } catch {
                setTestFollowupResult({ ok: false, msg: "Request failed" });
              } finally {
                setTestFollowupSending(false);
              }
            }}
          >
            {testFollowupSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send test
          </Button>
        </div>
        {testFollowupResult && (
          <div className={`flex items-center gap-2 text-sm rounded-md px-3 py-2 ${testFollowupResult.ok ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
            {testFollowupResult.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            {testFollowupResult.msg}
          </div>
        )}
      </div>

      {/* ── Bulk tag all customers ────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-base flex items-center gap-2">
            <Tag className="w-4 h-4 text-amber-500" /> Bulk-tag Contacts
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Adds the <strong>customer</strong> tag to every contact in High Level that belongs to a customer in the order system. Contacts not yet linked to GHL will be created or matched first.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            size="sm" variant="outline" className="gap-1.5"
            disabled={bulkTagging || !apiKey || !locationId}
            onClick={async () => {
              setBulkTagging(true);
              setBulkTagResult(null);
              try {
                const res = await fetch("/api/customers/bulk-ghl-tag", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ tag: "customer" }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error ?? "Request failed");
                setBulkTagResult({
                  ok: true,
                  msg: `Done — ${data.tagged} tagged, ${data.synced} newly synced to GHL, ${data.failed} failed (${data.total} total).`,
                });
              } catch (e: any) {
                setBulkTagResult({ ok: false, msg: e.message });
              } finally {
                setBulkTagging(false);
              }
            }}
          >
            {bulkTagging ? <><Loader2 className="w-4 h-4 animate-spin" />Tagging…</> : <><Tag className="w-4 h-4" />Push "customer" tag to all</>}
          </Button>
        </div>
        {bulkTagResult && (
          <div className={`flex items-center gap-2 text-sm rounded-md px-3 py-2 ${bulkTagResult.ok ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
            {bulkTagResult.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            {bulkTagResult.msg}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-2">
        <h2 className="font-semibold text-sm">Payload sent to High Level</h2>
        <p className="text-xs text-muted-foreground">The following fields are POSTed as JSON to your webhook URL:</p>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
          <li><code>contactId</code> — the customer's High Level contact ID (set per-customer)</li>
          <li><code>orderNumber</code> — e.g. ORD-1234</li>
          <li><code>customerName</code></li>
          <li><code>totalAmountExVat</code> — e.g. "250.00"</li>
          <li><code>totalAmountIncVat</code> — e.g. "300.00"</li>
          <li><code>customerEmail</code></li>
          <li><code>shippingMethod</code> — e.g. "office_collection"</li>
        </ul>
      </div>
    </div>
  );
}

function SecurityTab() {
  const [current, setCurrent]     = useState("");
  const [newPass, setNewPass]     = useState("");
  const [confirm, setConfirm]     = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew]     = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [success, setSuccess]     = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPass !== confirm) { setError("New passwords don't match"); return; }
    if (newPass.length < 8) { setError("New password must be at least 8 characters"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/staff/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: newPass }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to change password"); return; }
      setSuccess(true);
      setCurrent(""); setNewPass(""); setConfirm("");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 max-w-2xl">

      <StaffAccountsCard />

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-base">Change Staff Password</h2>
          <p className="text-sm text-muted-foreground mt-1">
            All staff share a single login password for the order system. Update it here when needed.
          </p>
        </div>

        {success && (
          <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <CheckCircle className="w-4 h-4 shrink-0" /> Password changed successfully.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Current password</Label>
            <div className="relative">
              <Input type={showCurrent ? "text" : "password"} value={current}
                onChange={e => setCurrent(e.target.value)} placeholder="Enter current password"
                className="pr-10" />
              <button type="button" onClick={() => setShowCurrent(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>New password</Label>
            <div className="relative">
              <Input type={showNew ? "text" : "password"} value={newPass}
                onChange={e => setNewPass(e.target.value)} placeholder="At least 8 characters"
                className="pr-10" />
              <button type="button" onClick={() => setShowNew(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Confirm new password</Label>
            <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat new password" />
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
          )}

          <Button type="submit" disabled={loading || !current || !newPass || !confirm} className="gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : <><Lock className="w-4 h-4" />Update password</>}
          </Button>
        </form>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-2">
        <h2 className="font-semibold text-base">Forgotten your password?</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          If you're completely locked out, go to the login page and click <strong>"Back"</strong> then use the email code option — or use the recovery key from Replit Secrets{" "}
          (<code className="text-xs bg-muted px-1.5 py-0.5 rounded">STAFF_RECOVERY_KEY</code>) to clear the password and set a new one.
        </p>
      </div>
    </div>
  );
}

const LABEL_PRINTER_KEY = "sbs_label_printer";
const A4_PRINTER_KEY = "sbs_a4_printer";

function PrinterRow({
  label, description, storageKey, placeholder, uses,
}: {
  label: string; description: string; storageKey: string; placeholder: string; uses: string;
}) {
  const [printerName, setPrinterName] = useState(() => {
    try { return localStorage.getItem(storageKey) || ""; } catch { return ""; }
  });
  const [saved, setSaved] = useState(false);

  function save() {
    try {
      const val = printerName.trim();
      if (val) localStorage.setItem(storageKey, val);
      else localStorage.removeItem(storageKey);
    } catch { /* ignore */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="border rounded-lg p-4">
      <h4 className="font-semibold text-sm mb-0.5">{label}</h4>
      <p className="text-xs text-muted-foreground mb-3">{description}</p>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Label className="mb-1 block text-xs">Printer name</Label>
          <Input
            value={printerName}
            onChange={e => { setPrinterName(e.target.value); setSaved(false); }}
            placeholder={placeholder}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Must match exactly as shown in Windows → Printers &amp; scanners.
            Leave blank to always use the browser dialog.
          </p>
        </div>
        <Button onClick={save} className="gap-2 shrink-0">
          {saved ? <><CheckCircle className="w-4 h-4" /> Saved</> : "Save"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-2 italic">Used for: {uses}</p>
    </div>
  );
}

function PrintingTab() {
  return (
    <div className="grid gap-6 max-w-2xl">
      <div>
        <h3 className="text-base font-semibold mb-1">Default Printers (QZ Tray)</h3>
        <p className="text-sm text-muted-foreground mb-4">
          When <strong>QZ Tray</strong> is running, documents send directly to the saved printer — no dialog, no switching.
          If QZ Tray isn't running or no printer is saved, the normal browser print dialog opens as a fallback.
        </p>
        <div className="grid gap-3">
          <PrinterRow
            label="Label Printer"
            description="Thermal label printer for small-format labels."
            storageKey={LABEL_PRINTER_KEY}
            placeholder="TSC DA210"
            uses="Wearer labels, box labels, DPD shipping labels"
          />
          <PrinterRow
            label="Document Printer (A4)"
            description="Standard A4 printer for documents."
            storageKey={A4_PRINTER_KEY}
            placeholder="HP LaserJet Pro"
            uses="Production worksheets, picking slips"
          />
        </div>
      </div>

      <div className="border rounded-lg p-4 bg-muted/40">
        <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
          <Printer className="w-4 h-4" /> QZ Tray setup (one-time, per computer)
        </h4>
        <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
          <li>Download and install <strong>QZ Tray</strong> from <a href="https://qz.io/download/" target="_blank" rel="noreferrer" className="underline text-foreground">qz.io/download</a></li>
          <li>Launch QZ Tray — it runs in the system tray (bottom-right of taskbar)</li>
          <li>Right-click the QZ Tray icon → <strong>Advanced</strong> → tick <strong>Allow unsigned content</strong></li>
          <li>Set the printer names above and click Save for each</li>
          <li>Print any label or document — it will go straight to the correct printer</li>
        </ol>
        <p className="text-xs text-muted-foreground mt-3">
          QZ Tray must be running whenever you want silent printing. It's a small background app — set it to start with Windows for convenience.
        </p>
      </div>
    </div>
  );
}

// ── Users tab ────────────────────────────────────────────────────────────────

const ALL_NAV_PAGES = [
  { label: "Dashboard", href: "/dashboard", group: "Main" },
  { label: "Orders", href: "/orders", group: "Main" },
  { label: "WooCommerce", href: "/woo-orders", group: "Main" },
  { label: "Quotes", href: "/quotes", group: "Main" },
  { label: "Customers", href: "/customers", group: "Main" },
  { label: "Products", href: "/products", group: "Main" },
  { label: "Bundles", href: "/bundles", group: "Main" },
  { label: "Web Enquiries", href: "/enquiries", group: "Main" },
  { label: "Stock", href: "/stock", group: "Operations" },
  { label: "Process Stock", href: "/process-stock", group: "Operations" },
  { label: "Production", href: "/production", group: "Operations" },
  { label: "Purchasing", href: "/purchasing", group: "Operations" },
  { label: "Dispatch", href: "/dispatch", group: "Operations" },
  { label: "Invoicing", href: "/invoices", group: "Operations" },
  { label: "Suppliers", href: "/suppliers", group: "Operations" },
  { label: "Tasks", href: "/tasks", group: "Operations" },
  { label: "Portal Orders", href: "/reports", group: "Reports" },
  { label: "Monthly Rewards", href: "/select-extra", group: "Reports" },
  { label: "Feedback & Issues", href: "/feedback", group: "Reports" },
  { label: "Chat", href: "/chat", group: "Reports" },
  { label: "Campaigns", href: "/campaigns", group: "Comms" },
  { label: "Templates", href: "/templates", group: "Comms" },
  { label: "Live Chat", href: "/live-chat", group: "Comms" },
  { label: "Settings", href: "/settings", group: "Admin" },
  { label: "Demo", href: "/demo", group: "Admin" },
];

const NAV_GROUPS = ["Main", "Operations", "Reports", "Comms", "Admin"] as const;

interface StaffUserAccount {
  name: string;
  email: string;
  is_superuser?: boolean;
  allowed_nav?: string[] | null;
}

function UserInitials({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  const initials =
    parts.length > 1
      ? parts[0][0] + parts[parts.length - 1][0]
      : parts[0].slice(0, 2);
  return (
    <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm shrink-0 uppercase">
      {initials}
    </div>
  );
}

function UsersTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [addingUser, setAddingUser] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const jwtPayload = getStaffJwtPayload();

  const { data: me } = useQuery<{
    name: string | null;
    email: string | null;
    is_superuser: boolean;
    allowed_nav: string[] | null;
  }>({
    queryKey: ["staff-me"],
    queryFn: () =>
      apiFetch("/auth/staff/me", {
        headers: staffAuthHeader() as Record<string, string>,
      }),
    staleTime: 30_000,
  });

  const isSuperuser = me?.is_superuser ?? !jwtPayload?.email;

  const { data: accountsData, isLoading } = useQuery<{
    accounts: StaffUserAccount[];
  }>({
    queryKey: ["staff-accounts"],
    queryFn: () => apiFetch("/auth/staff/accounts"),
  });
  const accounts = accountsData?.accounts ?? [];
  const selectedAccount = accounts.find(a => a.email === selectedEmail) ?? null;

  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editSuperuser, setEditSuperuser] = useState(false);
  const [editAllAccess, setEditAllAccess] = useState(true);
  const [editAllowedNav, setEditAllowedNav] = useState<string[]>([]);

  useEffect(() => {
    if (selectedAccount) {
      setEditName(selectedAccount.name);
      setEditEmail(selectedAccount.email);
      setEditSuperuser(!!selectedAccount.is_superuser);
      const nav = selectedAccount.allowed_nav;
      setEditAllAccess(nav == null);
      setEditAllowedNav(nav ?? []);
    }
  }, [selectedEmail, accountsData]);

  const saveMutation = useMutation({
    mutationFn: (vars: {
      email: string;
      body: Partial<StaffUserAccount & { email: string }>;
    }) =>
      apiFetch(`/auth/staff/accounts/${encodeURIComponent(vars.email)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(staffAuthHeader() as Record<string, string>),
        },
        body: JSON.stringify(vars.body),
      }),
    onSuccess: (_: unknown, vars: { email: string; body: Partial<StaffUserAccount & { email: string }> }) => {
      queryClient.invalidateQueries({ queryKey: ["staff-accounts"] });
      const newEmailVal = vars.body.email;
      if (newEmailVal && newEmailVal !== vars.email) setSelectedEmail(newEmailVal);
      toast({ title: "User updated" });
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (email: string) =>
      apiFetch(`/auth/staff/accounts/${encodeURIComponent(email)}`, {
        method: "DELETE",
        headers: staffAuthHeader() as Record<string, string>,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-accounts"] });
      setSelectedEmail(null);
      toast({ title: "User removed" });
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addMutation = useMutation({
    mutationFn: () =>
      apiFetch("/auth/staff/accounts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(staffAuthHeader() as Record<string, string>),
        },
        body: JSON.stringify({
          name: newName.trim(),
          email: newEmail.trim().toLowerCase(),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-accounts"] });
      setAddingUser(false);
      setNewName("");
      setNewEmail("");
      toast({ title: "User added" });
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function handleSave() {
    if (!selectedAccount) return;
    const body: Partial<StaffUserAccount & { email: string }> = {
      name: editName,
      is_superuser: editSuperuser,
      allowed_nav: editAllAccess ? null : editAllowedNav,
    };
    if (editEmail !== selectedAccount.email) body.email = editEmail;
    saveMutation.mutate({ email: selectedAccount.email, body });
  }

  function togglePage(href: string) {
    setEditAllowedNav(prev =>
      prev.includes(href) ? prev.filter(h => h !== href) : [...prev, href]
    );
  }

  const grouped = Object.fromEntries(
    NAV_GROUPS.map(g => [g, ALL_NAV_PAGES.filter(p => p.group === g)])
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex gap-6 min-h-[520px]">
      {/* Left: user list */}
      <div className="w-64 shrink-0 border-r pr-4 space-y-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Staff Accounts
        </p>
        {accounts.map(a => (
          <button
            key={a.email}
            onClick={() => {
              setSelectedEmail(a.email);
              setAddingUser(false);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-sm transition-colors ${
              selectedEmail === a.email
                ? "bg-primary/10 text-primary"
                : "hover:bg-muted"
            }`}
          >
            <UserInitials name={a.name} />
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{a.name}</p>
              <p className="text-xs text-muted-foreground truncate">{a.email}</p>
            </div>
            {a.is_superuser && (
              <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
            )}
          </button>
        ))}
        {isSuperuser && (
          <button
            onClick={() => {
              setAddingUser(true);
              setSelectedEmail(null);
              setNewName("");
              setNewEmail("");
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors border border-dashed border-border mt-2"
          >
            <UserPlus className="w-4 h-4" /> Add user
          </button>
        )}
        {accounts.length === 0 && !isSuperuser && (
          <p className="text-xs text-muted-foreground px-2 py-4">No users configured</p>
        )}
      </div>

      {/* Right: detail / edit */}
      <div className="flex-1 min-w-0">
        {addingUser ? (
          <div className="space-y-4 max-w-md">
            <h3 className="text-base font-semibold flex items-center gap-2">
              <UserPlus className="w-4 h-4" /> Add New User
            </h3>
            <div className="space-y-3">
              <div>
                <Label>Full name</Label>
                <Input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. Sarah Jones"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Email address</Label>
                <Input
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="e.g. sarah@example.com"
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  This email is used for OTP login
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => addMutation.mutate()}
                disabled={
                  !newName.trim() ||
                  !newEmail.includes("@") ||
                  addMutation.isPending
                }
              >
                {addMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : (
                  <UserPlus className="w-4 h-4 mr-1" />
                )}
                Add User
              </Button>
              <Button variant="outline" onClick={() => setAddingUser(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : selectedAccount ? (
          <div className="space-y-5 max-w-lg">
            <div className="flex items-center gap-3">
              <UserInitials name={selectedAccount.name} />
              <div>
                <h3 className="text-base font-semibold">{selectedAccount.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {selectedAccount.email}
                </p>
              </div>
              {selectedAccount.is_superuser && (
                <Badge className="ml-auto bg-primary/10 text-primary border-primary/20">
                  <ShieldCheck className="w-3 h-3 mr-1" /> Superuser
                </Badge>
              )}
            </div>

            {isSuperuser ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Full name</Label>
                    <Input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Email address</Label>
                    <Input
                      value={editEmail}
                      onChange={e => setEditEmail(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/30">
                  <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Superuser access</p>
                    <p className="text-xs text-muted-foreground">
                      Can manage users and access all settings
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditSuperuser(v => !v)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
                      editSuperuser ? "bg-primary" : "bg-input"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        editSuperuser ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-medium">Page access</Label>
                  <div className="flex gap-6">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        checked={editAllAccess}
                        onChange={() => setEditAllAccess(true)}
                        className="accent-primary"
                      />
                      Full access (all pages)
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        checked={!editAllAccess}
                        onChange={() => setEditAllAccess(false)}
                        className="accent-primary"
                      />
                      Restricted
                    </label>
                  </div>

                  {!editAllAccess && (
                    <div className="border rounded-lg p-4 space-y-4 bg-muted/20">
                      {NAV_GROUPS.map(group => (
                        <div key={group}>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                            {group}
                          </p>
                          <div className="grid grid-cols-2 gap-y-1.5 gap-x-4">
                            {grouped[group].map(page => (
                              <label
                                key={page.href}
                                className="flex items-center gap-2 text-sm cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={editAllowedNav.includes(page.href)}
                                  onChange={() => togglePage(page.href)}
                                  className="accent-primary"
                                />
                                {page.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => {
                      if (
                        confirm(
                          `Remove ${selectedAccount.name}? They will no longer be able to log in.`
                        )
                      ) {
                        deleteMutation.mutate(selectedAccount.email);
                      }
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove user
                  </Button>
                  <Button onClick={handleSave} disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-1" />
                    ) : null}
                    Save changes
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-lg border p-4 text-sm text-muted-foreground bg-muted/20 flex items-center gap-2">
                <Shield className="w-4 h-4 shrink-0" />
                Only superusers can edit user permissions.
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-20">
            <UserCog className="w-10 h-10 mb-3 opacity-30" />
            <p className="font-medium">Select a user to view or edit</p>
            <p className="text-xs mt-1">
              {isSuperuser
                ? "Or use the button on the left to add a new user"
                : "Contact your administrator to change account settings"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [wooUrl, setWooUrl] = useState("");
  const [wooKey, setWooKey] = useState("");
  const [wooSecret, setWooSecret] = useState("");
  const [syncSchedule, setSyncSchedule] = useState("none");
  const [enquiryNotificationEmail, setEnquiryNotificationEmail] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [formLoaded, setFormLoaded] = useState(false);

  // Xero credential fields
  const [xeroClientId, setXeroClientId] = useState("");
  const [xeroClientSecret, setXeroClientSecret] = useState("");
  const [showXeroSecret, setShowXeroSecret] = useState(false);

  // Xero sync progress bar state — effect is placed after syncXeroContactsMutation declaration below
  const [xeroSyncProgress, setXeroSyncProgress] = useState(0);

  // Social / Facebook fields
  const [fbPageId, setFbPageId] = useState("");
  const [fbAccessToken, setFbAccessToken] = useState("");
  const [fbAppSecret, setFbAppSecret] = useState("");
  const [fbFormLoaded, setFbFormLoaded] = useState(false);
  const [savingFb, setSavingFb] = useState(false);
  const [checkingFbToken, setCheckingFbToken] = useState(false);
  const [fbCheckMissingPerms, setFbCheckMissingPerms] = useState<string[]>([]);
  const [fbCheckGrantedPerms, setFbCheckGrantedPerms] = useState<string[]>([]);
  type FbPage = { id: string; name: string; category: string; pageToken: string };
  const [fbTokenPages, setFbTokenPages] = useState<FbPage[] | null>(null);
  const [fbTokenError, setFbTokenError] = useState<string | null>(null);
  const [fbIsPageToken, setFbIsPageToken] = useState(false);

  // LinkedIn OAuth fields
  const [liClientId, setLiClientId] = useState("");
  const [liClientSecret, setLiClientSecret] = useState("");
  const [liCredentialsSaving, setLiCredentialsSaving] = useState(false);
  const [liManualOrgUrn, setLiManualOrgUrn] = useState("");
  const [liManualOrgName, setLiManualOrgName] = useState("");
  type LiStatus = {
    connected: boolean; personName?: string; personUrn?: string;
    orgUrn?: string; orgName?: string; orgs?: { urn: string; name: string }[];
    postToProfile: boolean; postToPage: boolean;
    tokenExpiresAt?: number; hasRefreshToken: boolean;
  };

  // Google Business Profile fields
  const [gbpClientId, setGbpClientId] = useState("");
  const [gbpClientSecret, setGbpClientSecret] = useState("");
  const [savingGbp, setSavingGbp] = useState(false);
  const [gbpSelectedLocation, setGbpSelectedLocation] = useState<{ name: string; title: string } | null>(null);
  const [gbpManualEntry, setGbpManualEntry] = useState(false);
  const [gbpManualName, setGbpManualName] = useState("");
  const [gbpManualTitle, setGbpManualTitle] = useState("");

  // Social test post
  const [testingPost, setTestingPost] = useState(false);
  const [testPostResults, setTestPostResults] = useState<Record<string, { ok: boolean; skipped?: boolean; error?: string; postId?: string; postName?: string }> | null>(null);

  // ── Guidance sync state ───────────────────────────────────────────────────
  const [guidanceSyncing, setGuidanceSyncing] = useState(false);
  const [guidanceSynced, setGuidanceSynced] = useState(0);
  const [guidanceTotal, setGuidanceTotal] = useState(0);
  const [guidanceErrors, setGuidanceErrors] = useState<string[]>([]);
  const [guidanceDone, setGuidanceDone] = useState(false);

  const handleGuidanceSync = useCallback(async () => {
    setGuidanceSyncing(true);
    setGuidanceSynced(0);
    setGuidanceTotal(0);
    setGuidanceErrors([]);
    setGuidanceDone(false);
    let offset = 0;
    const limit = 50;
    let totalSynced = 0;
    const allErrors: string[] = [];
    try {
      while (true) {
        const result = await apiFetch<{ synced: number; total: number; offset: number; limit: number; errors: string[]; hasMore: boolean }>(
          `/woo/sync/products-guidance?limit=${limit}&offset=${offset}`,
          { method: "POST" }
        );
        totalSynced += result.synced;
        setGuidanceSynced(totalSynced);
        setGuidanceTotal(result.total);
        if (result.errors?.length) allErrors.push(...result.errors);
        setGuidanceErrors([...allErrors]);
        if (!result.hasMore) break;
        offset += limit;
      }
      setGuidanceDone(true);
      toast({ title: "Guidance synced", description: `${totalSynced} product${totalSynced !== 1 ? "s" : ""} updated.` });
    } catch (err: any) {
      toast({ title: "Guidance sync failed", description: err.message, variant: "destructive" });
    } finally {
      setGuidanceSyncing(false);
    }
  }, [toast]);

  // ── Bundle sync state ─────────────────────────────────────────────────────
  const [bundleSyncing, setBundleSyncing] = useState(false);
  const [bundleSyncResult, setBundleSyncResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null);

  const handleBundleSync = useCallback(async () => {
    setBundleSyncing(true);
    setBundleSyncResult(null);
    try {
      const result = await apiFetch<{ created: number; updated: number; errors: string[] }>("/woo/sync/bundles", { method: "POST" });
      setBundleSyncResult(result);
      toast({ title: "Bundle sync complete", description: `${result.created} created, ${result.updated} updated.` });
    } catch (err: any) {
      toast({ title: "Bundle sync failed", description: err.message, variant: "destructive" });
    } finally {
      setBundleSyncing(false);
    }
  }, [toast]);

  // ── Customer import state ─────────────────────────────────────────────────
  const [customerImporting, setCustomerImporting] = useState(false);
  type CustomerImportResult = {
    fetched: number;
    created: number;
    skipped: number;
    shopAccountsCreated: number;
    shopAccountsUpdated: number;
    linkedOrders: number;
    errors: string[];
  };
  const [customerImportResult, setCustomerImportResult] = useState<CustomerImportResult | null>(null);

  const handleCustomerImport = useCallback(async () => {
    setCustomerImporting(true);
    setCustomerImportResult(null);
    try {
      const result = await apiFetch<CustomerImportResult>("/woo/customers/sync", { method: "POST" });
      setCustomerImportResult(result);
      toast({
        title: "Customer and shop account sync complete",
        description: `${result.shopAccountsCreated} shop accounts created, ${result.shopAccountsUpdated} updated.`,
      });
    } catch (err: any) {
      toast({ title: "Customer import failed", description: err.message, variant: "destructive" });
    } finally {
      setCustomerImporting(false);
    }
  }, [toast]);

  // Reviews refresh
  const [reviewsRefreshing, setReviewsRefreshing] = useState(false);
  const [reviewsRefreshResult, setReviewsRefreshResult] = useState<{ count: number } | null>(null);
  const handleRefreshReviews = useCallback(async () => {
    setReviewsRefreshing(true);
    setReviewsRefreshResult(null);
    try {
      const result = await apiFetch<{ ok: boolean; count: number }>("/shop/reviews/refresh", { method: "POST" });
      setReviewsRefreshResult({ count: result.count });
      toast({ title: "Reviews refreshed", description: `${result.count} review${result.count !== 1 ? "s" : ""} loaded.` });
    } catch (err: any) {
      toast({ title: "Refresh failed", description: err.message, variant: "destructive" });
    } finally {
      setReviewsRefreshing(false);
    }
  }, [toast]);

  // Image migration from WordPress
  const [imageMigrating, setImageMigrating] = useState(false);
  const [wpDirectIp, setWpDirectIp] = useState("213.165.231.127");
  type ImageMigrationResult = { totalUrls: number; downloaded: number; skipped: number; dbUpdated: number; totalErrors: number; message: string };
  const [imageMigrationResult, setImageMigrationResult] = useState<ImageMigrationResult | null>(null);

  const handleImageMigration = useCallback(async () => {
    setImageMigrating(true);
    setImageMigrationResult(null);
    try {
      const result = await apiFetch<ImageMigrationResult>("/image-migration/download-from-wp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wpDirectIp: wpDirectIp.trim() || undefined }),
      });
      setImageMigrationResult(result);
      toast({ title: "Image migration complete", description: result.message });
    } catch (err: any) {
      toast({ title: "Image migration failed", description: err.message, variant: "destructive" });
    } finally {
      setImageMigrating(false);
    }
  }, [toast, wpDirectIp]);

  // Re-engagement email settings
  const [checkinEnabled, setCheckinEnabled] = useState(false);
  const [checkinLastRun, setCheckinLastRun] = useState<string | null>(null);
  const [savingCheckin, setSavingCheckin] = useState(false);
  const [runningCheckin, setRunningCheckin] = useState(false);
  const [checkinRunResult, setCheckinRunResult] = useState<{ sent: number; errors: number } | null>(null);
  const [checkinEligibleCount, setCheckinEligibleCount] = useState<number | null>(null);

  // Email / SMTP fields
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFromEmail, setSmtpFromEmail] = useState("");
  const [smtpFromName, setSmtpFromName] = useState("");
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [smtpFormLoaded, setSmtpFormLoaded] = useState(false);
  const [testEmailTo, setTestEmailTo] = useState("");

  // Detect ?xero=connected and ?gbp=connected redirects from OAuth callbacks
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const xeroParam = params.get("xero");
    const gbpParam = params.get("gbp");
    const msg = params.get("msg");
    if (xeroParam === "connected") {
      toast({ title: "Xero connected", description: "Your Xero account has been linked successfully." });
      window.history.replaceState({}, "", window.location.pathname);
      queryClient.invalidateQueries({ queryKey: ["xero-status"] });
    } else if (xeroParam === "error") {
      toast({ title: "Xero connection failed", description: msg ?? "Unknown error", variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (gbpParam === "connected") {
      toast({ title: "Google Business Profile connected!", description: "You can now select your business location below." });
      window.history.replaceState({}, "", window.location.pathname);
      queryClient.invalidateQueries({ queryKey: ["gbp-status"] });
      queryClient.invalidateQueries({ queryKey: ["gbp-locations"] });
    } else if (gbpParam === "error") {
      toast({ title: "Google connection failed", description: msg ?? "Unknown error", variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
    const liParam = params.get("li");
    if (liParam === "connected") {
      toast({ title: "LinkedIn connected!", description: "Your LinkedIn account is now linked. Configure posting preferences below." });
      window.history.replaceState({}, "", window.location.pathname);
      queryClient.invalidateQueries({ queryKey: ["linkedin-status"] });
    } else if (liParam === "error") {
      toast({ title: "LinkedIn connection failed", description: msg ?? "Unknown error", variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const { data: xeroStatus } = useQuery<XeroStatus>({
    queryKey: ["xero-status"],
    queryFn: () => apiFetch("/xero/status"),
    refetchInterval: 60_000,
  });

  const { data: xeroRedirectUriData } = useQuery<{ redirectUri: string; isOverride: boolean }>({
    queryKey: ["xero-redirect-uri"],
    queryFn: () => apiFetch("/xero/redirect-uri"),
    staleTime: Infinity,
  });

  // GBP status + locations
  const { data: gbpRedirectUriData } = useQuery<{ redirectUri: string }>({
    queryKey: ["gbp-redirect-uri"],
    queryFn: () => apiFetch("/gbp/redirect-uri"),
  });

  const { data: gbpStatus, refetch: refetchGbpStatus } = useQuery<{ connected: boolean; locationName?: string; locationTitle?: string; hasClientId?: boolean; hasClientSecret?: boolean; hasRefreshToken?: boolean }>({
    queryKey: ["gbp-status"],
    queryFn: () => apiFetch("/gbp/status"),
    refetchInterval: 60_000,
  });

  // LinkedIn OAuth status + redirect URI
  const { data: liRedirectUriData } = useQuery<{ redirectUri: string }>({
    queryKey: ["linkedin-redirect-uri"],
    queryFn: () => apiFetch("/linkedin/redirect-uri"),
    staleTime: Infinity,
  });
  const { data: liStatus, refetch: refetchLiStatus } = useQuery<LiStatus>({
    queryKey: ["linkedin-status"],
    queryFn: () => apiFetch("/linkedin/status"),
    refetchInterval: 60_000,
  });

  // Use a counter so each manual retry (even repeated ones) creates a distinct query key and fires
  const [gbpLocationsRefreshCount, setGbpLocationsRefreshCount] = useState(0);
  const [gbpShowLocationSelector, setGbpShowLocationSelector] = useState(false);
  const [gbpRetryCountdown, setGbpRetryCountdown] = useState<number | null>(null);
  const { data: gbpLocations, error: gbpLocationsError, isFetching: gbpLocationsFetching } = useQuery<{ name: string; title: string }[]>({
    queryKey: ["gbp-locations", gbpLocationsRefreshCount],
    queryFn: () => apiFetch(gbpLocationsRefreshCount > 0 ? "/gbp/locations?refresh=1" : "/gbp/locations"),
    // Only fetch when user explicitly opens the selector or hits Retry — never auto-fire on page load.
    // Auto-firing burns the very low GBP Account Management API quota immediately.
    enabled: !!gbpStatus?.connected && (gbpShowLocationSelector || gbpLocationsRefreshCount > 0),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 60 * 60_000,
  });

  // Countdown display only — does NOT auto-retry (auto-retry burns the low GBP API quota).
  // User must click Retry manually after the countdown reaches zero.
  useEffect(() => {
    if (!gbpLocationsError) { setGbpRetryCountdown(null); return; }
    const raw = (gbpLocationsError as any)?.message ?? String(gbpLocationsError);
    let retryAfter: number | null = null;
    try { retryAfter = JSON.parse(raw)?.retryAfter ?? null; } catch { /* not JSON */ }
    if (!retryAfter || retryAfter <= 0) { setGbpRetryCountdown(null); return; }
    setGbpRetryCountdown(retryAfter);
    const interval = setInterval(() => {
      setGbpRetryCountdown((prev) => {
        if (prev === null || prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [gbpLocationsError]);

  // Editable redirect URI — pre-fill once the auto-detected value arrives
  const [xeroRedirectUri, setXeroRedirectUri] = useState("");
  useEffect(() => {
    if (xeroRedirectUriData?.redirectUri && !xeroRedirectUri) {
      setXeroRedirectUri(xeroRedirectUriData.redirectUri);
    }
  }, [xeroRedirectUriData]);

  const saveXeroCredsMutation = useMutation({
    mutationFn: (data: { clientId: string; clientSecret: string; redirectUri: string }) =>
      apiFetch("/xero/credentials", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["xero-redirect-uri"] });
      toast({ title: "Xero credentials saved", description: "Click 'Connect to Xero' to authorise." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const syncXeroContactsMutation = useMutation({
    mutationFn: () => apiFetch("/xero/sync/contacts", { method: "POST" }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["xero-status"] });
      toast({
        title: "Xero contact sync complete",
        description: `${res.customersImported} customers imported, ${res.suppliersImported} suppliers imported, ${res.pushed} pushed to Xero.`,
      });
    },
    onError: (e: Error) => toast({ title: "Sync failed", description: parseApiError(e), variant: "destructive" }),
  });

  // Progress bar animation — must be after syncXeroContactsMutation is declared
  useEffect(() => {
    if (!syncXeroContactsMutation.isPending) {
      if (xeroSyncProgress > 0) {
        setXeroSyncProgress(100);
        const t = setTimeout(() => setXeroSyncProgress(0), 700);
        return () => clearTimeout(t);
      }
      return;
    }
    setXeroSyncProgress(5);
    const interval = setInterval(() => {
      setXeroSyncProgress((prev) => {
        if (prev >= 88) { clearInterval(interval); return prev; }
        const step = Math.max(0.5, (88 - prev) * 0.04);
        return Math.min(88, prev + step);
      });
    }, 200);
    return () => clearInterval(interval);
  }, [syncXeroContactsMutation.isPending]);

  const disconnectXeroMutation = useMutation({
    mutationFn: () => apiFetch("/xero/disconnect", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["xero-status"] });
      toast({ title: "Xero disconnected" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const { data: rawSettings } = useQuery<Record<string, string | null>>({
    queryKey: ["settings-raw"],
    queryFn: () => apiFetch("/settings/raw"),
  });

  useEffect(() => {
    if (rawSettings && !formLoaded) {
      setWooUrl(rawSettings["woo_url"] ?? "");
      setWooKey(rawSettings["woo_consumer_key"] ?? "");
      setWooSecret(rawSettings["woo_consumer_secret"] ?? "");
      setSyncSchedule(rawSettings["woo_sync_schedule"] ?? "none");
      setEnquiryNotificationEmail(rawSettings["enquiry_notification_email"] ?? "");
      setFormLoaded(true);
    }
  }, [rawSettings, formLoaded]);

  useEffect(() => {
    if (rawSettings && !fbFormLoaded) {
      setFbPageId(rawSettings["facebook_page_id"] ?? "");
      setFbAccessToken(rawSettings["facebook_page_access_token"] ?? "");
      setFbAppSecret(rawSettings["facebook_app_secret"] ?? "");
      setFbFormLoaded(true);
    }
  }, [rawSettings, fbFormLoaded]);

  // Auto-check the currently saved Facebook token's permissions when settings load
  const { data: fbSavedTokenCheck } = useQuery<{ hasToken: boolean; isExpired?: boolean; isNonExpiring?: boolean; expiresAt?: number | null; grantedPermissions?: string[]; missingPermissions?: string[] }>({
    queryKey: ["fb-saved-token-check"],
    queryFn: () => apiFetch("/facebook/check-saved-token"),
    enabled: !!rawSettings?.["facebook_page_access_token"],
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (rawSettings && !liClientId) {
      setLiClientId(rawSettings["linkedin_client_id"] ?? "");
    }
  }, [rawSettings]);

  async function saveFacebookSettings(overridePageId?: string, overrideToken?: string) {
    const pageId = (typeof overridePageId === "string" ? overridePageId : undefined) ?? fbPageId;
    const token = (typeof overrideToken === "string" ? overrideToken : undefined) ?? fbAccessToken;
    if (!pageId || !token) {
      toast({ title: "Missing fields", description: "Both Page Access Token and Facebook Page ID are required.", variant: "destructive" });
      return;
    }
    setSavingFb(true);
    try {
      // Save page ID, token, and App Secret (if provided)
      const saveBody: Record<string, string> = { facebook_page_id: pageId, facebook_page_access_token: token };
      if (fbAppSecret) saveBody["facebook_app_secret"] = fbAppSecret;
      const res = await fetch(`${API_BASE}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(saveBody),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Save failed (HTTP ${res.status})`);
      }

      // If App Secret is configured, auto-extend to a non-expiring Page token
      if (fbAppSecret) {
        try {
          const extRes = await apiFetch<any>("/facebook/extend-token", {
            method: "POST",
            body: JSON.stringify({ token, pageId }),
          });
          if (extRes.ok || extRes.nonExpiring) {
            toast({ title: "Facebook settings saved", description: "Token extended to non-expiring Page token — reviews and posts will work indefinitely." });
            queryClient.invalidateQueries({ queryKey: ["settings"] });
            queryClient.invalidateQueries({ queryKey: ["fb-saved-token-check"] });
            return;
          }
        } catch (extErr: any) {
          // Extension failed — token still saved, just show a warning
          toast({ title: "Facebook settings saved", description: `Token saved but auto-extension failed: ${extErr?.message ?? "unknown error"}. Reviews will work until the token expires.`, variant: "default" });
          queryClient.invalidateQueries({ queryKey: ["settings"] });
          queryClient.invalidateQueries({ queryKey: ["fb-saved-token-check"] });
          return;
        }
      }

      toast({ title: "Facebook settings saved", description: `Page ID ${pageId} saved successfully.` });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["fb-saved-token-check"] });
    } catch (e: any) {
      toast({ title: "Failed to save Facebook settings", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setSavingFb(false);
    }
  }

  useEffect(() => {
    if (rawSettings && !smtpFormLoaded) {
      setSmtpHost(rawSettings["smtp_host"] ?? "smtp.office365.com");
      setSmtpPort(rawSettings["smtp_port"] ?? "587");
      setSmtpUser(rawSettings["smtp_user"] ?? "");
      setSmtpFromEmail(rawSettings["smtp_from_email"] ?? "");
      setSmtpFromName(rawSettings["smtp_from_name"] ?? "");
      setSmtpFormLoaded(true);
    }
  }, [rawSettings, smtpFormLoaded]);

  const saveSmtpMutation = useMutation({
    mutationFn: (data: Record<string, string | null>) => apiFetch("/settings", { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-raw"] });
      queryClient.invalidateQueries({ queryKey: ["email-status"] });
      toast({ title: "Email settings saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const testSmtpMutation = useMutation({
    mutationFn: (to: string) => apiFetch<{ ok: boolean; provider?: string; messageId?: string; error?: string }>("/settings/email/test", { method: "POST", body: JSON.stringify({ to }) }),
    onSuccess: (res) => {
      if (res.ok) {
        toast({ title: "Test email sent", description: `Delivered via ${res.provider ?? "unknown"}. Check the inbox (and spam folder) for the test message.` });
      } else {
        toast({ title: "Send failed", description: res.error ?? "Unknown error", variant: "destructive" });
      }
    },
    onError: (e: Error) => toast({ title: "Test failed", description: parseApiError(e), variant: "destructive" }),
  });

  const { data: logs = [], isLoading: logsLoading, refetch: refetchLogs } = useQuery<SyncLog[]>({
    queryKey: ["sync-logs"],
    queryFn: () => apiFetch("/woo-sync/logs"),
    // Poll every 3s while a sync is running, otherwise every 15s
    refetchInterval: (query) => {
      const data = query.state.data as SyncLog[] | undefined;
      return data?.[0]?.status === "running" ? 3000 : 15000;
    },
  });

  const isSyncRunning = logs[0]?.status === "running";

  // When a sync transitions from "running" → completed/failed, invalidate all product data
  const prevSyncStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const current = logs[0]?.status;
    if (prevSyncStatus.current === "running" && current && current !== "running") {
      queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["product"] });
    }
    prevSyncStatus.current = current;
  }, [logs[0]?.status]);

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, string | null>) => apiFetch("/settings", { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-raw"] });
      toast({ title: "Settings saved", description: "WooCommerce sync will use the new credentials." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function parseApiError(e: Error): string {
    try {
      const obj = JSON.parse(e.message);
      return obj.error ?? e.message;
    } catch {
      return e.message;
    }
  }

  const syncMutation = useMutation({
    mutationFn: (full = false) => apiFetch(`/woo-sync/run${full ? "?full=true" : ""}`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sync-logs"] });
      toast({ title: "Sync started", description: "Running in the background — the log below updates automatically." });
    },
    onError: (e: Error) => {
      queryClient.invalidateQueries({ queryKey: ["sync-logs"] });
      toast({ title: "Sync failed", description: parseApiError(e), variant: "destructive" });
    },
  });

  // ── Guidance sync state ──────────────────────────────────────────────────
  const [guidanceSyncState, setGuidanceSyncState] = useState<
    { status: "idle" } |
    { status: "running"; synced: number; total: number; offset: number } |
    { status: "done"; synced: number; total: number; errors: string[] } |
    { status: "error"; message: string }
  >({ status: "idle" });

  async function runGuidanceSync() {
    if (!isConnected) return;
    setGuidanceSyncState({ status: "running", synced: 0, total: 0, offset: 0 });
    const limit = 50;
    let offset = 0;
    let totalSynced = 0;
    let allErrors: string[] = [];
    let total = 0;

    try {
      while (true) {
        const result: any = await apiFetch(`/woo/sync/products-guidance?limit=${limit}&offset=${offset}`, { method: "POST" });
        totalSynced += result.synced ?? 0;
        total = result.total ?? total;
        allErrors = [...allErrors, ...(result.errors ?? [])];
        setGuidanceSyncState({ status: "running", synced: totalSynced, total, offset: offset + limit });
        if (!result.hasMore) break;
        offset += limit;
      }
      setGuidanceSyncState({ status: "done", synced: totalSynced, total, errors: allErrors });
      toast({ title: "Guidance sync complete", description: `${totalSynced} products updated.` });
    } catch (e: any) {
      setGuidanceSyncState({ status: "error", message: parseApiError(e) });
      toast({ title: "Guidance sync failed", description: parseApiError(e), variant: "destructive" });
    }
  }

  // ── Customer sync state ──────────────────────────────────────────────────
  const [customerSyncState, setCustomerSyncState] = useState<
    { status: "idle" } |
    { status: "running" } |
    {
      status: "done";
      fetched: number;
      created: number;
      skipped: number;
      shopAccountsCreated: number;
      shopAccountsUpdated: number;
      linkedOrders: number;
      errors: string[];
    } |
    { status: "error"; message: string }
  >({ status: "idle" });

  const customerSyncMutation = useMutation({
    mutationFn: () => apiFetch<any>("/woo/customers/sync", {
      method: "POST",
      body: JSON.stringify({ perPage: 100, page: 1, allPages: true }),
    }),
    onMutate: () => setCustomerSyncState({ status: "running" }),
    onSuccess: (result: any) => {
      setCustomerSyncState({
        status: "done",
        fetched: result.fetched ?? 0,
        created: result.created ?? 0,
        skipped: result.skipped ?? 0,
        shopAccountsCreated: result.shopAccountsCreated ?? 0,
        shopAccountsUpdated: result.shopAccountsUpdated ?? 0,
        linkedOrders: result.linkedOrders ?? 0,
        errors: result.errors ?? [],
      });
      toast({
        title: "Customer and shop account sync complete",
        description: `${result.shopAccountsCreated ?? 0} shop accounts created, ${result.shopAccountsUpdated ?? 0} updated.`,
      });
    },
    onError: (e: Error) => {
      setCustomerSyncState({ status: "error", message: parseApiError(e) });
      toast({ title: "Customer import failed", description: parseApiError(e), variant: "destructive" });
    },
  });

  // ── Activation emails state ──────────────────────────────────────────────
  const [activationState, setActivationState] = useState<
    { status: "idle" } |
    { status: "running" } |
    { status: "done"; sent: number; failed: number; errors: string[]; sentAt: string } |
    { status: "error"; message: string }
  >({ status: "idle" });

  const { data: activationStatus, refetch: refetchActivationStatus } = useQuery<{
    sentAt: string | null;
    customerCount: number;
    cooldownMs: number;
  }>({
    queryKey: ["shop-activation-email-status"],
    queryFn: () => apiFetch("/shop/auth/activation-email-status"),
    staleTime: 30_000,
  });

  const activationMutation = useMutation({
    mutationFn: (force: boolean) =>
      apiFetch<{ sent: number; failed: number; errors: string[]; sentAt: string; total: number }>(
        "/shop/auth/send-activation-emails",
        { method: "POST", body: JSON.stringify({ force }) }
      ),
    onMutate: () => setActivationState({ status: "running" }),
    onSuccess: (result) => {
      setActivationState({
        status: "done",
        sent: result.sent,
        failed: result.failed,
        errors: result.errors,
        sentAt: result.sentAt,
      });
      refetchActivationStatus();
      toast({
        title: "Activation emails sent",
        description: `${result.sent} sent · ${result.failed} failed`,
      });
    },
    onError: (e: Error) => {
      setActivationState({ status: "error", message: parseApiError(e) });
      toast({ title: "Failed to send activation emails", description: parseApiError(e), variant: "destructive" });
    },
  });

  const cooldownExpired = activationStatus?.sentAt
    ? Date.now() - new Date(activationStatus.sentAt).getTime() >= (activationStatus.cooldownMs ?? 86_400_000)
    : true;

  const lastLog = logs[0];
  const isConnected = !!(rawSettings?.["woo_url"] && rawSettings?.["woo_consumer_key"] && rawSettings?.["woo_consumer_secret"]);

  function handleSave() {
    saveMutation.mutate({
      woo_url: wooUrl || null,
      woo_consumer_key: wooKey || null,
      woo_consumer_secret: wooSecret || null,
      woo_sync_schedule: syncSchedule === "none" ? null : syncSchedule,
      enquiry_notification_email: enquiryNotificationEmail.trim() || null,
    });
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Settings2 className="w-7 h-7 text-primary" /> Settings
          </h1>
          <p className="text-muted-foreground mt-1">Configure integrations and sync preferences.</p>
        </div>

        <Tabs defaultValue="woocommerce" onValueChange={async (tab) => {
          if (tab === "reengagement") {
            try {
              const [s, c] = await Promise.all([
                apiFetch("/reengagement/settings") as Promise<{ enabled: boolean; lastRun: string | null }>,
                apiFetch("/reengagement/eligible-count") as Promise<{ count: number }>,
              ]);
              setCheckinEnabled(s.enabled);
              setCheckinLastRun(s.lastRun);
              setCheckinEligibleCount(c.count);
            } catch {}
          }
        }}>
          <TabsList className="flex-wrap h-auto gap-y-1">
            <TabsTrigger value="woocommerce" className="gap-2">
              <ShoppingCart className="w-4 h-4" /> WooCommerce Sync
            </TabsTrigger>
            <TabsTrigger value="xero" className="gap-2">
              <BookOpen className="w-4 h-4" /> Xero Accounting
            </TabsTrigger>
            <TabsTrigger value="email" className="gap-2">
              <Mail className="w-4 h-4" /> Email
            </TabsTrigger>
            <TabsTrigger value="security" className="gap-2">
              <Lock className="w-4 h-4" /> Security
            </TabsTrigger>
            <TabsTrigger value="highlevel" className="gap-2">
              <Zap className="w-4 h-4" /> High Level
            </TabsTrigger>
            <TabsTrigger value="invoco" className="gap-2">
              <Phone className="w-4 h-4" /> Invoco
            </TabsTrigger>
            <TabsTrigger value="sizes" className="gap-2">
              <Ruler className="w-4 h-4" /> Sizes
            </TabsTrigger>
            <TabsTrigger value="printing" className="gap-2">
              <Printer className="w-4 h-4" /> Printing
            </TabsTrigger>
            <TabsTrigger value="dpd" className="gap-2">
              <Truck className="w-4 h-4" /> DPD Courier
            </TabsTrigger>
            <TabsTrigger value="social" className="gap-2">
              <Share2 className="w-4 h-4" /> Social Media
            </TabsTrigger>
            <TabsTrigger value="reengagement" className="gap-2">
              <Mail className="w-4 h-4" /> Re-engagement
            </TabsTrigger>
            <TabsTrigger value="branding" className="gap-2">
              <Palette className="w-4 h-4" /> Branding
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-2">
              <Users className="w-4 h-4" /> Users
            </TabsTrigger>
            <TabsTrigger value="shop" className="gap-2">
              <Globe className="w-4 h-4" /> Shop Page
            </TabsTrigger>
            <TabsTrigger value="workflows" className="gap-2">
              <GitBranch className="w-4 h-4" /> Workflows
            </TabsTrigger>
            <TabsTrigger value="maya" className="gap-2">
              <ShieldCheck className="w-4 h-4" /> Maya Integration
            </TabsTrigger>
          </TabsList>

          <TabsContent value="woocommerce" className="mt-6">
            <div className="grid gap-6 max-w-2xl">

              {/* Connection status banner */}
              <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium ${isConnected ? "bg-green-50 border-green-200 text-green-800" : "bg-muted/50 border-border text-muted-foreground"}`}>
                {isConnected ? <Wifi className="w-4 h-4 flex-shrink-0" /> : <WifiOff className="w-4 h-4 flex-shrink-0" />}
                {isConnected
                  ? `Connected to ${rawSettings?.["woo_url"]}`
                  : "Not connected — enter your WooCommerce credentials below"}
              </div>

              {/* Credentials */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h2 className="font-semibold text-base">Store Credentials</h2>
                <p className="text-sm text-muted-foreground">
                  Generate API keys in your WooCommerce admin under <strong>Settings → Advanced → REST API</strong>. Set permissions to <strong>Read</strong>.
                </p>

                <div className="space-y-1.5">
                  <Label>Store URL</Label>
                  <Input
                    placeholder="https://yourstore.com"
                    value={wooUrl}
                    onChange={(e) => setWooUrl(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Consumer Key</Label>
                  <div className="relative">
                    <Input
                      type={showKey ? "text" : "password"}
                      placeholder="ck_xxxxxxxxxxxx"
                      value={wooKey}
                      onChange={(e) => setWooKey(e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Consumer Secret</Label>
                  <div className="relative">
                    <Input
                      type={showSecret ? "text" : "password"}
                      placeholder="cs_xxxxxxxxxxxx"
                      value={wooSecret}
                      onChange={(e) => setWooSecret(e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Schedule */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h2 className="font-semibold text-base">Sync Schedule</h2>
                <p className="text-sm text-muted-foreground">
                  Products are synced one-way from WooCommerce — your store stays the master catalogue.
                </p>
                <div className="space-y-1.5">
                  <Label>Automatic sync frequency</Label>
                  <Select value={syncSchedule} onValueChange={setSyncSchedule}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCHEDULE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Save + Sync buttons */}
              <div className="flex items-center gap-3 flex-wrap">
                <Button onClick={handleSave} disabled={saveMutation.isPending} className="gap-2">
                  {saveMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Saving...</> : <><CheckCircle className="w-4 h-4" />Save Settings</>}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => syncMutation.mutate(false)}
                  disabled={syncMutation.isPending || isSyncRunning || !isConnected}
                  className="gap-2"
                  title="Only fetches products changed since the last sync"
                >
                  {(syncMutation.isPending || isSyncRunning) ? <><Loader2 className="w-4 h-4 animate-spin" />Syncing...</> : <><Play className="w-4 h-4" />Sync Changes</>}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => syncMutation.mutate(true)}
                  disabled={syncMutation.isPending || isSyncRunning || !isConnected}
                  className="gap-2 text-muted-foreground"
                  title="Re-fetches all products from WooCommerce regardless of when they were last modified"
                >
                  {(syncMutation.isPending || isSyncRunning) ? <><Loader2 className="w-4 h-4 animate-spin" />Syncing all...</> : <><RefreshCw className="w-4 h-4" />Full Sync</>}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">
                <strong>Sync Changes</strong> is fast — it only fetches products modified since the last run. Use <strong>Full Sync</strong> when you've made bulk changes in WooCommerce or want to be sure everything is up to date.
              </p>

              {/* Live progress bar — shown while a sync is running */}
              {isSyncRunning && (() => {
                const pct = logs[0]?.progressPct ?? 0;
                const phase = pct === 0 ? "Connecting to WooCommerce…" :
                              pct < 10 ? "Fetching product catalogue…" :
                              pct < 99 ? `Processing products… ${pct}%` :
                              "Finishing up…";
                return (
                  <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-blue-800 font-medium">
                        <Loader2 className="w-4 h-4 animate-spin" />{phase}
                      </span>
                      {pct > 0 && <span className="text-blue-600 font-mono text-xs">{pct}%</span>}
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all duration-700 ease-out"
                        style={{ width: pct > 0 ? `${pct}%` : "8%", animation: pct === 0 ? "pulse 1.5s infinite" : undefined }}
                      />
                    </div>
                    <p className="text-xs text-blue-600">Updates every few seconds — you can leave this page and come back.</p>
                  </div>
                );
              })()}

              {/* Last sync summary — shown when idle */}
              {lastLog && !isSyncRunning && (
                <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-sm ${
                  lastLog.status === "completed" ? "bg-green-50 border-green-200" :
                  lastLog.status === "failed" ? "bg-red-50 border-red-200" :
                  "bg-amber-50 border-amber-200"
                }`}>
                  {lastLog.status === "completed" ? <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" /> :
                   lastLog.status === "failed" ? <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" /> :
                   <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />}
                  <div>
                    <div className="font-medium">
                      Last sync: {formatDate(lastLog.startedAt)}
                      {lastLog.completedAt && ` → ${formatDate(lastLog.completedAt)}`}
                    </div>
                    {lastLog.message && <div className="text-muted-foreground">{lastLog.message}</div>}
                    {(lastLog.itemsCreated || lastLog.itemsUpdated) && (
                      <div className="text-muted-foreground">
                        {lastLog.itemsCreated} created · {lastLog.itemsUpdated} updated
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Sync Product Guidance ────────────────────────────────────── */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <BookMarked className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-base">Sync Product Guidance</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Pulls value/durability/smart ratings, best-for text, badges, tags, and gallery
                      images from WooCommerce custom fields (<code className="text-xs bg-muted px-1 rounded">_sbs_*</code>) for every linked product.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    variant="outline"
                    onClick={handleGuidanceSync}
                    disabled={guidanceSyncing || !isConnected}
                    className="gap-2"
                  >
                    {guidanceSyncing
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Syncing guidance…</>
                      : <><BookMarked className="w-4 h-4" />Sync Product Guidance</>}
                  </Button>
                  {guidanceSyncing && guidanceTotal > 0 && (
                    <span className="text-sm text-muted-foreground font-mono">
                      {guidanceSynced} / {guidanceTotal}
                    </span>
                  )}
                </div>

                {/* Progress bar while running */}
                {guidanceSyncing && guidanceTotal > 0 && (
                  <div className="space-y-1.5">
                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-primary h-2 rounded-full transition-all duration-500"
                        style={{ width: `${Math.round((guidanceSynced / guidanceTotal) * 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {Math.round((guidanceSynced / guidanceTotal) * 100)}% — fetching from WooCommerce in batches of 50
                    </p>
                  </div>
                )}

                {/* Result */}
                {guidanceDone && !guidanceSyncing && (
                  <div className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border text-sm ${guidanceErrors.length ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-green-50 border-green-200 text-green-800"}`}>
                    {guidanceErrors.length
                      ? <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      : <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                    <div>
                      <p className="font-medium">{guidanceSynced} product{guidanceSynced !== 1 ? "s" : ""} updated</p>
                      {guidanceErrors.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs">
                          {guidanceErrors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                          {guidanceErrors.length > 5 && <li>…and {guidanceErrors.length - 5} more</li>}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Sync Bundle Definitions ──────────────────────────────────── */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <Package className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-base">Sync Bundle Definitions</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Imports bundle product names, prices, and component lists from WooCommerce (YITH bundles)
                      into your local Bundles catalogue. Existing bundles are updated; components are replaced.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    variant="outline"
                    onClick={handleBundleSync}
                    disabled={bundleSyncing || !isConnected}
                    className="gap-2"
                  >
                    {bundleSyncing
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Syncing bundles…</>
                      : <><Package className="w-4 h-4" />Sync Bundles from WooCommerce</>}
                  </Button>
                </div>
                {bundleSyncResult && !bundleSyncing && (
                  <div className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border text-sm ${bundleSyncResult.errors.length ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-green-50 border-green-200 text-green-800"}`}>
                    {bundleSyncResult.errors.length
                      ? <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      : <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                    <div>
                      <p className="font-medium">
                        {bundleSyncResult.created} bundle{bundleSyncResult.created !== 1 ? "s" : ""} created
                        · {bundleSyncResult.updated} updated
                      </p>
                      {bundleSyncResult.errors.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs">
                          {bundleSyncResult.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                          {bundleSyncResult.errors.length > 5 && <li>…and {bundleSyncResult.errors.length - 5} more</li>}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Migrate Images from WordPress ────────────────────────────── */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <Download className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-base">Migrate Images from WordPress</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Downloads every product, variant, and category image from WordPress and saves them
                      to the installation's own storage — so the shop never depends on the old WooCommerce server again.
                      Safe to re-run; already-migrated images are skipped. This may take a few minutes.
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">WordPress server IP</label>
                  <input
                    type="text"
                    value={wpDirectIp}
                    onChange={(e) => setWpDirectIp(e.target.value)}
                    placeholder="e.g. 213.165.231.127"
                    className="w-60 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground">
                    Direct IP of the old WP server — bypasses DNS so images are fetched from the original host even after the domain was pointed to this site.
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    variant="outline"
                    onClick={handleImageMigration}
                    disabled={imageMigrating}
                    className="gap-2"
                  >
                    {imageMigrating
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Downloading images…</>
                      : <><Download className="w-4 h-4" />Migrate Images from WordPress</>}
                  </Button>
                  {imageMigrating && (
                    <span className="text-sm text-muted-foreground">This will take a few minutes — don't close the page.</span>
                  )}
                </div>
                {imageMigrationResult && !imageMigrating && (
                  <div className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border text-sm ${imageMigrationResult.totalErrors > 0 ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-green-50 border-green-200 text-green-800"}`}>
                    {imageMigrationResult.totalErrors > 0
                      ? <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      : <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                    <div>
                      <p className="font-medium">{imageMigrationResult.downloaded} downloaded · {imageMigrationResult.skipped} already cached · {imageMigrationResult.dbUpdated} DB rows updated</p>
                      {imageMigrationResult.totalErrors > 0 && (
                        <p className="text-xs mt-0.5">{imageMigrationResult.totalErrors} image{imageMigrationResult.totalErrors !== 1 ? "s" : ""} could not be downloaded (they may have already been deleted from WordPress).</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Import WooCommerce Customers ─────────────────────────────── */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <UserCheck className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-base">Import WooCommerce Customers &amp; Shop Accounts</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Imports every registered WooCommerce customer into the staff customer list and creates
                      their passwordless shop account. Existing records are matched by email and updated safely.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    variant="outline"
                    onClick={handleCustomerImport}
                    disabled={customerImporting || !isConnected}
                    className="gap-2"
                  >
                    {customerImporting
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Importing…</>
                      : <><UserCheck className="w-4 h-4" />Sync Customers &amp; Shop Accounts</>}
                  </Button>
                </div>

                {/* Result */}
                {customerImportResult && !customerImporting && (
                  <div className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border text-sm ${customerImportResult.errors?.length ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-green-50 border-green-200 text-green-800"}`}>
                    {customerImportResult.errors?.length
                      ? <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      : <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                    <div>
                      <p className="font-medium">
                        {customerImportResult.fetched} WooCommerce customers checked
                        {" · "}{customerImportResult.shopAccountsCreated} shop accounts created
                        {" · "}{customerImportResult.shopAccountsUpdated} updated
                        {customerImportResult.linkedOrders > 0 && ` · ${customerImportResult.linkedOrders} historical orders linked`}
                      </p>
                      {customerImportResult.errors?.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs">
                          {customerImportResult.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                          {customerImportResult.errors.length > 5 && <li>…and {customerImportResult.errors.length - 5} more</li>}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Sync history */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                  <h2 className="font-semibold text-sm">Sync History</h2>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetchLogs()}>
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {logsLoading ? (
                  <div className="flex items-center justify-center py-10 text-muted-foreground text-sm gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin" />Loading...
                  </div>
                ) : logs.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">No sync runs yet.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-xs">Started</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs text-center">Created</TableHead>
                        <TableHead className="text-xs text-center">Updated</TableHead>
                        <TableHead className="text-xs">Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((log) => {
                        const cfg = STATUS_CFG[log.status] ?? { label: log.status, color: "bg-muted text-muted-foreground" };
                        return (
                          <TableRow key={log.id}>
                            <TableCell className="text-xs">{formatDate(log.startedAt)}</TableCell>
                            <TableCell><Badge className={`text-xs ${cfg.color}`}>{cfg.label}</Badge></TableCell>
                            <TableCell className="text-center text-sm font-medium">{log.itemsCreated ?? "—"}</TableCell>
                            <TableCell className="text-center text-sm font-medium">{log.itemsUpdated ?? "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{log.message ?? "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>

              {/* ── Guidance Sync ──────────────────────────────────────────── */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                  <h2 className="font-semibold text-sm flex items-center gap-2">
                    <Star className="w-4 h-4 text-amber-500" /> Sync Product Guidance from WooCommerce
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Pulls star ratings, badges, Best For / Not Ideal For text, and gallery images from WooCommerce meta fields into the local database. Runs in batches of 50 products.
                  </p>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <Button
                    variant="outline"
                    className="gap-2"
                    disabled={guidanceSyncState.status === "running" || !isConnected}
                    onClick={runGuidanceSync}
                  >
                    {guidanceSyncState.status === "running"
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Syncing guidance…</>
                      : <><RefreshCw className="w-4 h-4" />Sync Product Guidance</>}
                  </Button>

                  {guidanceSyncState.status === "running" && (
                    <div className="space-y-1.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-blue-800 font-medium flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Syncing product guidance…
                        </span>
                        {guidanceSyncState.total > 0 && (
                          <span className="text-blue-600 text-xs font-mono">
                            {guidanceSyncState.synced} / {guidanceSyncState.total}
                          </span>
                        )}
                      </div>
                      {guidanceSyncState.total > 0 && (
                        <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                            style={{ width: `${Math.round((guidanceSyncState.synced / guidanceSyncState.total) * 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {guidanceSyncState.status === "done" && (
                    <div className="flex items-start gap-3 px-4 py-3 rounded-lg border bg-green-50 border-green-200 text-sm">
                      <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="font-medium text-green-800">Guidance sync complete</div>
                        <div className="text-muted-foreground">{guidanceSyncState.synced} of {guidanceSyncState.total} products updated</div>
                        {guidanceSyncState.errors.length > 0 && (
                          <div className="mt-1 text-xs text-amber-700">{guidanceSyncState.errors.length} error(s): {guidanceSyncState.errors[0]}</div>
                        )}
                      </div>
                    </div>
                  )}

                  {guidanceSyncState.status === "error" && (
                    <div className="flex items-start gap-3 px-4 py-3 rounded-lg border bg-red-50 border-red-200 text-sm">
                      <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                      <div className="text-red-800">{guidanceSyncState.message}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Customer Import ────────────────────────────────────────── */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                  <h2 className="font-semibold text-sm flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-600" /> Sync Customers &amp; Shop Accounts from WooCommerce
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Imports every registered WooCommerce customer into the staff customer list and creates
                    their shop account. Their old WooCommerce password is not reused; they sign in with an emailed code.
                  </p>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <Button
                    variant="outline"
                    className="gap-2"
                    disabled={customerSyncState.status === "running" || !isConnected}
                    onClick={() => customerSyncMutation.mutate()}
                  >
                    {customerSyncState.status === "running"
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Importing…</>
                      : <><UserPlus className="w-4 h-4" />Sync Customers &amp; Shop Accounts</>}
                  </Button>

                  {customerSyncState.status === "done" && (
                    <div className="flex items-start gap-3 px-4 py-3 rounded-lg border bg-green-50 border-green-200 text-sm">
                      <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="font-medium text-green-800">Sync complete</div>
                        <div className="text-muted-foreground">
                          {customerSyncState.fetched} WooCommerce customers checked
                          {" · "}{customerSyncState.shopAccountsCreated} shop accounts created
                          {" · "}{customerSyncState.shopAccountsUpdated} updated
                          {customerSyncState.linkedOrders > 0 && ` · ${customerSyncState.linkedOrders} historical orders linked`}
                        </div>
                        {customerSyncState.errors.length > 0 && (
                          <div className="mt-1 text-xs text-amber-700">{customerSyncState.errors.length} error(s): {customerSyncState.errors[0]}</div>
                        )}
                      </div>
                    </div>
                  )}

                  {customerSyncState.status === "error" && (
                    <div className="flex items-start gap-3 px-4 py-3 rounded-lg border bg-red-50 border-red-200 text-sm">
                      <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                      <div className="text-red-800">{customerSyncState.message}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Send Activation Emails ─────────────────────────────────── */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                  <h2 className="font-semibold text-sm flex items-center gap-2">
                    <Mail className="w-4 h-4 text-blue-600" /> Send Activation Emails to Shop Customers
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Emails every shop customer with a sign-in link so they can activate their account.
                    Uses the passwordless OTP flow — no password required.
                    {activationStatus?.customerCount != null && (
                      <> <strong>{activationStatus.customerCount}</strong> customer{activationStatus.customerCount !== 1 ? "s" : ""} in the shop.</>
                    )}
                  </p>
                </div>
                <div className="px-5 py-4 space-y-3">
                  {/* Last sent notice */}
                  {activationStatus?.sentAt && activationState.status !== "done" && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border bg-blue-50 border-blue-200 text-blue-800 text-xs">
                      <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-medium">Previously sent</span> on {new Date(activationStatus.sentAt).toLocaleString()}.
                        {!cooldownExpired && <> A further send is available after 24 hours — use <strong>Force Resend</strong> to override.</>}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      className="gap-2"
                      disabled={activationMutation.isPending || activationState.status === "running"}
                      onClick={() => activationMutation.mutate(false)}
                    >
                      {activationState.status === "running"
                        ? <><Loader2 className="w-4 h-4 animate-spin" />Sending…</>
                        : <><Send className="w-4 h-4" />Send Activation Emails</>}
                    </Button>

                    {activationStatus?.sentAt && !cooldownExpired && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-muted-foreground text-xs"
                        disabled={activationMutation.isPending || activationState.status === "running"}
                        onClick={() => {
                          if (confirm("This will resend activation emails to ALL shop customers, even those emailed recently. Continue?")) {
                            activationMutation.mutate(true);
                          }
                        }}
                      >
                        Force Resend
                      </Button>
                    )}
                  </div>

                  {activationState.status === "done" && (
                    <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-sm ${activationState.failed > 0 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"}`}>
                      {activationState.failed > 0
                        ? <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                        : <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />}
                      <div>
                        <div className={`font-medium ${activationState.failed > 0 ? "text-amber-800" : "text-green-800"}`}>
                          {activationState.sent} sent · {activationState.failed} failed
                        </div>
                        {activationState.errors.length > 0 && (
                          <ul className="mt-1 space-y-0.5 text-xs text-amber-700">
                            {activationState.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                            {activationState.errors.length > 5 && <li>…and {activationState.errors.length - 5} more</li>}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}

                  {activationState.status === "error" && (
                    <div className="flex items-start gap-3 px-4 py-3 rounded-lg border bg-red-50 border-red-200 text-sm">
                      <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                      <div className="text-red-800">{activationState.message}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Product Enquiry Notifications ──────────────────────────── */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h2 className="font-semibold text-base flex items-center gap-2">
                  <MessageSquarePlus className="w-4 h-4 text-primary" /> Product Enquiry Notifications
                </h2>
                <p className="text-sm text-muted-foreground">
                  When a new product enquiry arrives via the WooCommerce webhook, an email alert is sent to this address. Leave blank to disable email notifications.
                </p>
                <div className="space-y-1.5">
                  <Label>Notification email address</Label>
                  <Input
                    type="email"
                    placeholder="staff@yourcompany.com"
                    value={enquiryNotificationEmail}
                    onChange={(e) => setEnquiryNotificationEmail(e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending
                    ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</>
                    : <><CheckCircle className="w-4 h-4" />Save</>}
                </Button>
              </div>

            </div>
          </TabsContent>
          <TabsContent value="xero" className="mt-6">
            <div className="grid gap-6 max-w-2xl">

              {/* Connection status banner */}
              <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium ${
                xeroStatus?.connected
                  ? "bg-green-50 border-green-200 text-green-800"
                  : xeroStatus?.hasCredentials
                    ? "bg-amber-50 border-amber-200 text-amber-800"
                    : "bg-muted/50 border-border text-muted-foreground"
              }`}>
                {xeroStatus?.connected
                  ? <><Wifi className="w-4 h-4 flex-shrink-0" /> Connected to Xero{xeroStatus.tenantName ? ` — ${xeroStatus.tenantName}` : ""}</>
                  : xeroStatus?.hasCredentials
                    ? <><Link2 className="w-4 h-4 flex-shrink-0" /> Credentials saved — click <strong className="mx-1">Connect to Xero</strong> below to complete authorisation</>
                    : <><WifiOff className="w-4 h-4 flex-shrink-0" /> Not connected — enter your credentials below and click Connect</>}
              </div>

              {/* Credentials */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-base">App Credentials</h2>
                  {xeroStatus?.hasCredentials && !xeroStatus?.connected && (
                    <Badge className="bg-amber-100 text-amber-800 border-amber-300 gap-1.5 text-xs">
                      <CheckCircle className="w-3 h-3" /> Credentials saved — connect to activate
                    </Badge>
                  )}
                  {xeroStatus?.hasCredentials && xeroStatus?.connected && (
                    <Badge className="bg-green-100 text-green-800 border-green-300 gap-1.5 text-xs">
                      <CheckCircle className="w-3 h-3" /> Connected
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Create a free <strong>Web App</strong> at{" "}
                  <a href="https://developer.xero.com/app/manage" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                    developer.xero.com <ExternalLink className="w-3 h-3" />
                  </a>{" "}
                  and paste the Client ID and Secret below. You <strong>must</strong> also add the redirect URI shown here to your Xero app — copy it exactly.
                </p>

                {/* Redirect URI — editable so it can be corrected if the auto-detected value is wrong */}
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Step 1 — Redirect URI</p>
                    {xeroRedirectUriData?.isOverride && (
                      <span className="text-xs text-amber-600 italic">Custom value saved</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={xeroRedirectUri}
                      onChange={(e) => setXeroRedirectUri(e.target.value)}
                      className="flex-1 text-xs font-mono bg-white border-amber-200 text-amber-900 h-8"
                      placeholder="Loading…"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 border-amber-300 text-amber-700 hover:bg-amber-100"
                      onClick={() => {
                        if (xeroRedirectUri) {
                          navigator.clipboard.writeText(xeroRedirectUri);
                          toast({ title: "Copied!", description: "Redirect URI copied to clipboard." });
                        }
                      }}
                      disabled={!xeroRedirectUri}
                    >
                      Copy
                    </Button>
                  </div>
                  <p className="text-xs text-amber-700">
                    Register this URL exactly in your Xero app under <strong>Configuration → Redirect URIs</strong>. Edit it here if your deployed app uses a different domain.
                  </p>
                </div>

                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Step 2 — Enter your credentials</p>
                <div className="space-y-1.5">
                  <Label>Client ID</Label>
                  <Input
                    placeholder="Your Xero Client ID"
                    value={xeroClientId}
                    onChange={(e) => setXeroClientId(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Client Secret</Label>
                  <div className="relative">
                    <Input
                      type={showXeroSecret ? "text" : "password"}
                      placeholder="Your Xero Client Secret"
                      value={xeroClientSecret}
                      onChange={(e) => setXeroClientSecret(e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowXeroSecret((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showXeroSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <Button
                  onClick={() => saveXeroCredsMutation.mutate({ clientId: xeroClientId, clientSecret: xeroClientSecret, redirectUri: xeroRedirectUri })}
                  disabled={saveXeroCredsMutation.isPending || !xeroClientId || !xeroClientSecret || !xeroRedirectUri}
                  className="gap-2"
                >
                  {saveXeroCredsMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Saving...</> : <><CheckCircle className="w-4 h-4" />Save Credentials</>}
                </Button>
              </div>

              {/* Connect / Disconnect */}
              <div className={`rounded-xl border bg-card p-5 space-y-4 ${xeroStatus?.hasCredentials && !xeroStatus?.connected ? "border-amber-300 ring-1 ring-amber-200" : "border-border"}`}>
                <h2 className="font-semibold text-base">Authorisation</h2>
                {xeroStatus?.connected ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <Badge className="bg-green-100 text-green-800 border-green-300 gap-1.5"><CheckCircle className="w-3.5 h-3.5" /> Connected</Badge>
                      {xeroStatus.tenantName && <span className="text-sm text-muted-foreground">{xeroStatus.tenantName}</span>}
                    </div>
                    {xeroStatus.expiresAt && (
                      <p className="text-xs text-muted-foreground">
                        Token expires: {new Date(xeroStatus.expiresAt).toLocaleString()}
                      </p>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => { if (confirm("Disconnect from Xero? Token and tenant link will be removed.")) disconnectXeroMutation.mutate(); }}
                      disabled={disconnectXeroMutation.isPending}
                    >
                      {disconnectXeroMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink2 className="w-4 h-4" />}
                      Disconnect
                    </Button>
                  </div>
                ) : xeroStatus?.hasCredentials ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <CheckCircle className="w-4 h-4 shrink-0" />
                      <span>Credentials saved. Click below to authorise access to your Xero organisation — you'll be redirected to Xero and back.</span>
                    </div>
                    <Button asChild size="lg" className="gap-2 w-full sm:w-auto">
                      <a href="/api/xero/connect">
                        <Link2 className="w-4 h-4" /> Connect to Xero
                      </a>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Save your credentials above, then click here to authorise this app to access your Xero organisation.
                    </p>
                    <Button asChild className="gap-2" disabled>
                      <span className="opacity-50 cursor-not-allowed">
                        <Link2 className="w-4 h-4" /> Connect to Xero
                      </span>
                    </Button>
                    <p className="text-xs text-muted-foreground">Save your Client ID and Secret first to enable this button.</p>
                  </div>
                )}
              </div>

              {/* Contact sync */}
              {xeroStatus?.connected && (
                <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                  <h2 className="font-semibold text-base">Contact Sync</h2>
                  <p className="text-sm text-muted-foreground">
                    Pulls all Xero contacts into Customers and Suppliers, matches existing records by email or name, and pushes any unmatched local records back to Xero.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => syncXeroContactsMutation.mutate()}
                    disabled={syncXeroContactsMutation.isPending}
                    className="gap-2"
                  >
                    {syncXeroContactsMutation.isPending
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Syncing contacts…</>
                      : <><Users className="w-4 h-4" />Sync Contacts</>}
                  </Button>

                  {/* Progress bar — visible while sync is running (and briefly on completion) */}
                  {xeroSyncProgress > 0 && (
                    <div className="space-y-1.5">
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                          style={{ width: `${xeroSyncProgress}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {xeroSyncProgress < 100
                          ? `Syncing… ${Math.round(xeroSyncProgress)}%`
                          : "Sync complete!"}
                      </p>
                    </div>
                  )}
                </div>
              )}

            </div>
          </TabsContent>

          {/* ─── Email Tab ─────────────────────────────────────────── */}
          <TabsContent value="email" className="mt-6">
            <div className="grid gap-6 max-w-2xl">

              {/* Resend active banner */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                  <h2 className="font-semibold text-base text-emerald-900">Email sending active via Resend</h2>
                </div>
                <p className="text-sm text-emerald-800 leading-relaxed">
                  Outgoing emails (invoices, portal sign-in links, order acknowledgements, and purchase orders) are sent through <strong>Resend</strong>. No SMTP configuration is needed.
                </p>
                <div className="flex gap-2 items-center">
                  <Input
                    type="email"
                    placeholder="Send test email to…"
                    value={testEmailTo}
                    onChange={e => setTestEmailTo(e.target.value)}
                    className="h-8 text-sm bg-white border-emerald-300 max-w-xs"
                    onKeyDown={e => { if (e.key === "Enter" && testEmailTo.includes("@")) testSmtpMutation.mutate(testEmailTo); }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testSmtpMutation.mutate(testEmailTo)}
                    disabled={testSmtpMutation.isPending || !testEmailTo.includes("@")}
                    className="gap-2 border-emerald-300 text-emerald-800 hover:bg-emerald-100 shrink-0"
                  >
                    {testSmtpMutation.isPending
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Sending…</>
                      : <><Send className="w-4 h-4" />Send test</>}
                  </Button>
                </div>
                <p className="text-xs text-emerald-700">Enter your email address and click Send test — if you receive it, login codes will work. Check your spam/junk folder too.</p>
              </div>

              {/* SMTP fallback (collapsed / reference only) */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h2 className="font-semibold text-base text-muted-foreground">SMTP (fallback — not currently used)</h2>
                <p className="text-sm text-muted-foreground">
                  These settings are only used if Resend is unavailable. Leave them blank unless you have a specific reason to configure an SMTP fallback.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <Label>SMTP Host</Label>
                    <Input placeholder="smtp.office365.com" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Port</Label>
                    <Input placeholder="587" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Username</Label>
                  <Input placeholder="you@yourdomain.com" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Password / App Password</Label>
                  <div className="relative">
                    <Input
                      type={showSmtpPass ? "text" : "password"}
                      placeholder="Enter your email password or app password"
                      value={smtpPass}
                      onChange={(e) => setSmtpPass(e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSmtpPass((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showSmtpPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>From Email Address</Label>
                  <Input placeholder="invoices@yourdomain.com" value={smtpFromEmail} onChange={(e) => setSmtpFromEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>From Name</Label>
                  <Input placeholder="Configured business name" value={smtpFromName} onChange={(e) => setSmtpFromName(e.target.value)} />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => saveSmtpMutation.mutate({
                    smtp_host: smtpHost || null,
                    smtp_port: smtpPort || null,
                    smtp_user: smtpUser || null,
                    smtp_pass: smtpPass || null,
                    smtp_from_email: smtpFromEmail || null,
                    smtp_from_name: smtpFromName || null,
                  })}
                  disabled={saveSmtpMutation.isPending}
                  className="gap-2"
                >
                  {saveSmtpMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : <><CheckCircle className="w-4 h-4" />Save SMTP Settings</>}
                </Button>
              </div>

            </div>
          </TabsContent>

          {/* ─── Security Tab ──────────────────────────────────────── */}
          <TabsContent value="security" className="mt-6">
            <SecurityTab />
          </TabsContent>

          {/* ─── High Level Tab ────────────────────────────────────── */}
          <TabsContent value="highlevel" className="mt-6">
            <HighLevelTab rawSettings={rawSettings} />
          </TabsContent>

          {/* ─── Invoco Tab ────────────────────────────────────────── */}
          <TabsContent value="invoco" className="mt-6">
            <InvocoTab rawSettings={rawSettings} />
          </TabsContent>

          {/* ─── Sizes Tab ─────────────────────────────────────────── */}
          <TabsContent value="sizes" className="mt-6">
            <SizesTab />
          </TabsContent>

          {/* ─── Printing Tab ──────────────────────────────────────── */}
          <TabsContent value="printing" className="mt-6">
            <PrintingTab />
          </TabsContent>

          {/* ─── DPD Tab ───────────────────────────────────────────── */}
          <TabsContent value="dpd" className="mt-6">
            <DpdTab />
          </TabsContent>

          {/* ─── Social Media Tab ──────────────────────────────────── */}
          <TabsContent value="social" className="mt-6">
            <div className="space-y-6 max-w-xl">
              <div className="bg-card border border-border/50 rounded-lg p-6 shadow-sm space-y-5">
                <div>
                  <h2 className="font-semibold text-base flex items-center gap-2">
                    <Share2 className="w-4 h-4 text-blue-600" /> Facebook Page
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Connect your Facebook Page to enable product-content publishing.
                  </p>
                </div>

                {/* Step 1: paste token and check it */}
                <div className="grid gap-2">
                  <Label>Page Access Token</Label>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={fbAccessToken}
                      onChange={e => { setFbAccessToken(e.target.value); setFbTokenPages(null); setFbTokenError(null); }}
                      placeholder="EAAxxxxxx…"
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      disabled={!fbAccessToken || checkingFbToken}
                      onClick={async () => {
                        setCheckingFbToken(true);
                        setFbTokenPages(null);
                        setFbTokenError(null);
                        setFbIsPageToken(false);
                        try {
                          const data = await apiFetch<any>("/facebook/check-token", {
                            method: "POST",
                            body: JSON.stringify({ accessToken: fbAccessToken }),
                          });
                          setFbIsPageToken(data.isPageToken ?? false);
                          setFbTokenPages(data.pages ?? []);
                          setFbCheckGrantedPerms(data.grantedPermissions ?? []);
                          setFbCheckMissingPerms(data.missingPermissions ?? []);
                        } catch (e: any) {
                          // apiFetch throws on non-ok — try to parse the message
                          const msg = e.message ?? "Request failed";
                          setFbTokenError(msg);
                        } finally {
                          setCheckingFbToken(false);
                        }
                      }}
                      className="shrink-0 gap-1.5"
                    >
                      {checkingFbToken ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                      Check Token
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Get a token from <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" className="underline">Meta Graph API Explorer</a> → select your app → change "User or Page" to your <strong>Page</strong> → add all four permissions below → Generate Access Token.
                  </p>
                  <p className="text-xs text-muted-foreground">Required: <code>pages_show_list</code>, <code>pages_read_engagement</code>, <code>pages_manage_posts</code>, <code>pages_read_user_content</code></p>
                </div>

                {/* ── Auto-check: saved token permissions ── */}
                {fbSavedTokenCheck?.hasToken && fbSavedTokenCheck.isExpired && (
                  <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span><strong>Saved token has expired.</strong> Generate a new one in Meta Graph API Explorer and save it above.</span>
                  </div>
                )}
                {fbSavedTokenCheck?.hasToken && !fbSavedTokenCheck.isExpired && (fbSavedTokenCheck.missingPermissions?.length ?? 0) > 0 && (
                  <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div className="space-y-1.5">
                      <p><strong>Saved token is missing permissions — this is why reviews show "Facebook User".</strong></p>
                      <p>Missing: {fbSavedTokenCheck.missingPermissions!.map(p => <code key={p} className="bg-red-100 px-1 rounded mr-1">{p}</code>)}</p>
                      <p className="text-xs">
                         Go to <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" className="underline font-medium">Meta Graph API Explorer</a> → select your app → User or Page: <strong>your configured Page</strong> → add all four required permissions → <strong>Generate Access Token</strong> → paste here and save.
                      </p>
                    </div>
                  </div>
                )}
                {fbSavedTokenCheck?.hasToken && !fbSavedTokenCheck.isExpired && (fbSavedTokenCheck.missingPermissions?.length ?? 1) === 0 && (
                  <div className="flex items-start gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
                    <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span><strong>Token has all required permissions.</strong> Reviewer names and photos should appear on the shop.</span>
                  </div>
                )}

                {/* ── Manual check-token result: missing permissions ── */}
                {fbCheckMissingPerms.length > 0 && fbTokenPages !== null && (
                  <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <p><strong>This token is missing:</strong> {fbCheckMissingPerms.map(p => <code key={p} className="bg-red-100 px-1 rounded mr-1">{p}</code>)}</p>
                      <p className="text-xs">Re-generate with all four required permissions before saving.</p>
                    </div>
                  </div>
                )}
                {fbCheckGrantedPerms.length > 0 && fbCheckMissingPerms.length === 0 && (
                  <div className="flex items-start gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
                    <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>All required permissions are present on this token.</span>
                  </div>
                )}

                {/* Token check error */}
                {fbTokenError && (
                  <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span><strong>Token error:</strong> {fbTokenError}</span>
                  </div>
                )}

                {/* Pages accessible by this token */}
                {fbTokenPages !== null && fbTokenPages.length === 0 && !fbIsPageToken && (
                  <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>No pages found for this token. Make sure you selected your <strong>Page</strong> (not your personal profile) in the "User or Page" dropdown in Graph API Explorer before generating.</span>
                  </div>
                )}

                {fbIsPageToken && fbTokenPages && fbTokenPages.length > 0 && (
                  <div className="flex items-start gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
                    <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>This is already a Page token for <strong>{fbTokenPages[0].name}</strong> (ID: {fbTokenPages[0].id}).</span>
                  </div>
                )}

                {fbTokenPages !== null && fbTokenPages.length > 0 && !fbIsPageToken && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">This User token has access to {fbTokenPages.length} page{fbTokenPages.length > 1 ? "s" : ""}. Select the one you want to post from:</p>
                    {fbTokenPages.map(page => (
                      <div key={page.id} className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${fbPageId === page.id ? "border-primary bg-primary/5" : "border-border"}`}>
                        <div>
                          <p className="font-medium">{page.name}</p>
                          <p className="text-xs text-muted-foreground">ID: {page.id} · {page.category}</p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={fbPageId === page.id ? "default" : "outline"}
                          onClick={() => {
                            const chosenToken = page.pageToken || fbAccessToken;
                            setFbPageId(page.id);
                            if (page.pageToken) setFbAccessToken(page.pageToken);
                            saveFacebookSettings(page.id, chosenToken);
                          }}
                        >
                          {fbPageId === page.id ? "Selected ✓" : "Use this page"}
                        </Button>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground">Clicking "Use this page" selects the page and saves immediately.</p>
                  </div>
                )}

                {/* Page ID — shown after selection or for manual entry */}
                <div className="grid gap-2">
                  <Label>Facebook Page ID</Label>
                  <Input value={fbPageId} onChange={e => setFbPageId(e.target.value)} placeholder="e.g. 123456789012345" />
                  <p className="text-xs text-muted-foreground">Auto-filled when you select a page above, or enter manually.</p>
                </div>

                {/* App Secret — enables auto-extension to non-expiring tokens */}
                <div className="grid gap-2">
                  <Label>App Secret <span className="text-muted-foreground font-normal">(optional — enables non-expiring tokens)</span></Label>
                  <Input
                    type="password"
                    value={fbAppSecret}
                    onChange={e => setFbAppSecret(e.target.value)}
                    placeholder="From Meta Developer Dashboard → Your App → App Settings → Basic"
                  />
                  <p className="text-xs text-muted-foreground">
                    If set, tokens are automatically extended to <strong>non-expiring Page tokens</strong> when saved — so you never need to regenerate them. Find it in{" "}
                    <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer" className="underline">Meta Developer Dashboard</a> → your app → App Settings → Basic → App Secret.
                  </p>
                </div>

                {/* Saved token expiry status */}
                {fbSavedTokenCheck?.hasToken && !fbSavedTokenCheck.isExpired && fbSavedTokenCheck.isNonExpiring && (
                  <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
                    <CheckCircle className="w-4 h-4 shrink-0" />
                    <span><strong>Non-expiring Page token.</strong> This token will not expire.</span>
                  </div>
                )}
                {fbSavedTokenCheck?.hasToken && !fbSavedTokenCheck.isExpired && !fbSavedTokenCheck.isNonExpiring && fbSavedTokenCheck.expiresAt && (
                  <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>Token expires {new Date(fbSavedTokenCheck.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}. Add your App Secret above and save to make it permanent.</span>
                  </div>
                )}

                <Button type="button" onClick={() => saveFacebookSettings()} disabled={savingFb || !fbPageId || !fbAccessToken} className="gap-2">
                  {savingFb ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                  Save Facebook Settings
                </Button>
              </div>

              {/* Google Business Profile OAuth */}
              <div className="bg-card border border-border/50 rounded-lg p-6 shadow-sm space-y-5">
                <div>
                  <h2 className="font-semibold text-base flex items-center gap-2">
                    <Globe className="w-4 h-4 text-green-600" /> Google Business Profile
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Connect your Google Business Profile to enable product-content publishing. Requires a Google Cloud project with the <strong>Business Profile API</strong> enabled and an OAuth 2.0 Web client credential.
                  </p>
                </div>

                {gbpStatus?.connected ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
                      <CheckCircle className="w-4 h-4 flex-shrink-0" />
                      Connected to Google Business Profile
                      {gbpStatus.locationTitle && <span className="ml-1 font-medium">— {gbpStatus.locationTitle}</span>}
                    </div>

                    {/* Warn if client credentials are missing — token exists but API calls will fail */}
                    {gbpStatus.connected && (gbpStatus.hasClientId === false || gbpStatus.hasClientSecret === false) && (
                      <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>
                          <strong>Credentials missing.</strong>{" "}
                          {!gbpStatus.hasClientId && !gbpStatus.hasClientSecret ? "Google Client ID and Secret are" : !gbpStatus.hasClientId ? "Google Client ID is" : "Google Client Secret is"} not saved.
                          Enter them in the fields below and click Save, then reconnect.
                        </span>
                      </div>
                    )}

                    {!gbpStatus.locationName && !gbpManualEntry && (
                      <div className="border border-amber-300 bg-amber-50 rounded-md p-3 space-y-3">
                        <div className="flex items-start gap-2 text-sm text-amber-800">
                          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <div className="space-y-1.5">
                            <p><strong>No location selected.</strong> Click <em>Try Auto-Resolve</em> first — it finds the account ID using your OAuth token (no API quota needed).</p>
                            <p className="text-xs text-amber-700">
                              If that fails, find your account ID at{" "}
                              <a href="https://business.google.com" target="_blank" rel="noopener noreferrer" className="underline font-medium">business.google.com</a>
                              {" "}→ click the configured profile → copy the number from the URL (e.g. <code className="bg-amber-100 px-1 rounded">…/n/123456789012345/…</code>).
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline"
                            className="gap-1.5 border-green-500 text-green-800 hover:bg-green-50"
                            disabled={savingGbp}
                            onClick={async () => {
                              setSavingGbp(true);
                              try {
                                // Resolve using the connected installation's saved configuration.
                                const data = await apiFetch<any>("/gbp/fix-location", {
                                  method: "POST",
                                });
                                if (data.ok) {
                                  toast({ title: "Location resolved!", description: data.locationName });
                                  queryClient.invalidateQueries({ queryKey: ["gbp-status"] });
                                }
                              } catch (e: any) {
                                toast({ title: "Auto-resolve failed", description: e?.message ?? "Could not resolve automatically. Use manual entry.", variant: "destructive" });
                                setGbpManualEntry(true);
                              } finally {
                                setSavingGbp(false);
                              }
                            }}>
                            {savingGbp ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                            Try Auto-Resolve
                          </Button>
                          <Button size="sm" variant="outline" className="gap-1.5 border-amber-400 text-amber-800 hover:bg-amber-100" onClick={() => setGbpManualEntry(true)}>
                            <CheckCircle className="w-3 h-3" /> Enter Location Manually
                          </Button>
                          <Button size="sm" variant="ghost" className="gap-1.5 text-amber-700 text-xs" onClick={() => setGbpShowLocationSelector(true)}>
                            <Globe className="w-3 h-3" /> Try Load from API
                          </Button>
                        </div>
                      </div>
                    )}
                    {!gbpStatus.locationName && gbpShowLocationSelector && !gbpManualEntry && (
                      <div className="text-sm text-amber-700">
                        Choose your business location from the dropdown below and click Save Location.
                      </div>
                    )}
                    {/* Warn when location isn't the correct full accounts/{id}/locations/{id} path */}
                    {gbpStatus.locationName && !(gbpStatus.locationName.startsWith("accounts/") && gbpStatus.locationName.includes("/locations/")) && !gbpShowLocationSelector && (
                      <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <div className="space-y-2">
                          <p>
                            <strong>Google reviews not loading.</strong>{" "}
                            The saved location ID (<code>{gbpStatus.locationName}</code>) needs resolving to a full account path.
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 border-amber-400 text-amber-800 hover:bg-amber-100"
                            disabled={savingGbp}
                            onClick={async () => {
                              setSavingGbp(true);
                              try {
                                await apiFetch("/gbp/fix-location", { method: "POST" });
                                toast({ title: "Location resolved", description: "Google reviews will load on the next refresh." });
                                queryClient.invalidateQueries({ queryKey: ["gbp-status"] });
                              } catch (e: any) {
                                toast({ title: "Could not resolve automatically", description: "Both Google APIs are rate-limited. Use the manual entry form below.", variant: "destructive" });
                                setGbpManualEntry(true);
                                // Pre-fill the location ID part so the user only needs to add the account number
                                if (gbpStatus.locationName && !gbpManualName) {
                                  setGbpManualName(gbpStatus.locationName);
                                }
                                if (gbpStatus.locationTitle && !gbpManualTitle) {
                                  setGbpManualTitle(gbpStatus.locationTitle);
                                }
                              } finally {
                                setSavingGbp(false);
                              }
                            }}
                          >
                            {savingGbp ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                            Fix Location Automatically
                          </Button>
                        </div>
                      </div>
                    )}

                    {gbpStatus.locationName && !gbpShowLocationSelector && (
                      <Button size="sm" variant="ghost" className="w-fit text-xs text-muted-foreground" onClick={() => setGbpShowLocationSelector(true)}>
                        Change Location
                      </Button>
                    )}

                    {/* Location fetch error — only relevant when selector is open */}
                    {gbpShowLocationSelector && gbpLocationsError && (() => {
                      const raw = (gbpLocationsError as any)?.message ?? String(gbpLocationsError);
                      let parsedMsg = raw;
                      try { parsedMsg = JSON.parse(raw)?.error ?? raw; } catch { /* not JSON */ }
                      // Strip HTML — Google returns a full HTML 404 page on some errors
                      if (parsedMsg.includes("<html") || parsedMsg.includes("<!DOCTYPE")) {
                        parsedMsg = "Google returned an unexpected response (the API endpoint may be unavailable).";
                      }
                      const isRateLimit = parsedMsg.includes("RATE_LIMIT_EXCEEDED") || parsedMsg.includes("429") || parsedMsg.includes("Quota exceeded") || parsedMsg.includes("rateLimitExceeded");
                      let content: React.ReactNode;
                      if (parsedMsg.startsWith("MISSING_CREDENTIALS:")) {
                        content = (
                          <div className="space-y-1">
                            <p><strong>Client ID or Secret not saved.</strong> Enter your Google OAuth credentials in the fields below and click Save, then click Disconnect and reconnect.</p>
                          </div>
                        );
                      } else if (parsedMsg.startsWith("INVALID_CLIENT:")) {
                        content = (
                          <div className="space-y-1">
                            <p><strong>Client credentials are wrong.</strong> Check your Google Client ID and Secret in the fields below match your Google Cloud Console OAuth client exactly.</p>
                          </div>
                        );
                      } else if (parsedMsg.startsWith("TOKEN_EXPIRED:")) {
                        content = (
                          <div className="space-y-1">
                            <p><strong>Authorisation has expired or been revoked.</strong> Click Disconnect below, then click Connect Google to reauthorise.</p>
                          </div>
                        );
                      } else if (parsedMsg.startsWith("TOKEN_REFRESH_FAILED:")) {
                        content = (
                          <div className="space-y-1">
                            <p><strong>Could not refresh access token:</strong> {parsedMsg.replace("TOKEN_REFRESH_FAILED:", "").trim()}</p>
                            <p className="text-xs text-red-500">Try disconnecting and reconnecting to Google.</p>
                          </div>
                        );
                      } else if (parsedMsg.startsWith("SERVICE_DISABLED:")) {
                        const activationUrl = parsedMsg.replace("SERVICE_DISABLED:", "");
                        content = (
                          <div className="space-y-1">
                            <p><strong>My Business Account Management API is not enabled</strong> in your Google Cloud project.</p>
                            <a href={activationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline font-medium hover:text-red-900">
                              Enable the API in Google Cloud Console ↗
                            </a>
                            <p className="text-xs text-red-500">After enabling, wait a minute then click Retry.</p>
                          </div>
                        );
                      } else if (isRateLimit) {
                        content = (
                          <div className="space-y-1">
                            <p><strong>Rate limit hit</strong> — the Google Business API has a low default quota.</p>
                            {gbpRetryCountdown !== null ? (
                              <p className="text-xs text-red-500">Auto-retrying in <strong>{gbpRetryCountdown}s</strong>…</p>
                            ) : (
                              <p className="text-xs text-red-500">If it keeps failing, use the manual entry below.</p>
                            )}
                          </div>
                        );
                      } else {
                        content = <span><strong>Could not load locations:</strong> {parsedMsg}</span>;
                      }
                      return (
                        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2.5">
                          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 space-y-2">
                            {content}
                            {isRateLimit && gbpRetryCountdown !== null ? (
                              <div className="flex items-center gap-2 h-7">
                                <Loader2 className="w-3 h-3 animate-spin text-red-400" />
                                <span className="text-xs text-red-500">Retrying automatically…</span>
                              </div>
                            ) : (
                              <Button size="sm" variant="outline" className="h-7 text-xs border-red-300 text-red-700 hover:bg-red-100 gap-1.5" onClick={() => setGbpLocationsRefreshCount((c) => c + 1)} disabled={gbpLocationsFetching}>
                                {gbpLocationsFetching ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                Retry
                              </Button>
                            )}
                            {!gbpManualEntry && (
                              <button className="text-xs underline text-red-600 hover:text-red-800" onClick={() => setGbpManualEntry(true)}>
                                Enter location manually →
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Manual location entry — fallback when API is rate-limited */}
                    {gbpManualEntry && (
                      <div className="border border-amber-300 bg-amber-50 rounded-md p-3 space-y-3">
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-amber-800">Enter location manually</p>
                          <p className="text-xs text-amber-700">
                            Find your location name:{" "}
                            <a href="https://business.google.com" target="_blank" rel="noopener noreferrer" className="underline font-medium">open business.google.com</a>
                            {" "}→ click your business → copy the URL. It will contain a long number — paste the full URL or just the number below and we'll do the rest.
                          </p>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <Label className="text-xs text-amber-800">Business name (display name)</Label>
                            <input
                              className="mt-1 w-full border border-amber-300 rounded px-2 py-1.5 text-sm bg-white"
                              placeholder="e.g. Your business"
                              value={gbpManualTitle}
                              onChange={e => setGbpManualTitle(e.target.value)}
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-amber-800">Location resource name</Label>
                            <input
                              className="mt-1 w-full border border-amber-300 rounded px-2 py-1.5 text-sm bg-white font-mono text-xs"
                              placeholder="accounts/123456789/locations/987654321"
                              value={gbpManualName}
                              onChange={e => setGbpManualName(e.target.value)}
                            />
                            <p className="text-xs text-amber-600 mt-0.5">Format: accounts/…/locations/… (from your GBP URL or API Explorer)</p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5 border-amber-400 text-amber-800 hover:bg-amber-100"
                              disabled={savingGbp || !gbpManualName.trim() || !gbpManualTitle.trim()}
                              onClick={async () => {
                                setSavingGbp(true);
                                try {
                                  await apiFetch("/gbp/location", { method: "POST", body: JSON.stringify({ name: gbpManualName.trim(), title: gbpManualTitle.trim() }) });
                                  toast({ title: "Location saved", description: gbpManualTitle.trim() });
                                  setGbpManualEntry(false);
                                  setGbpShowLocationSelector(false);
                                  queryClient.invalidateQueries({ queryKey: ["gbp-status"] });
                                } catch { toast({ title: "Failed to save location", variant: "destructive" }); }
                                finally { setSavingGbp(false); }
                              }}
                            >
                              {savingGbp ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                              Save Location
                            </Button>
                            <Button size="sm" variant="ghost" className="text-xs text-amber-700" onClick={() => setGbpManualEntry(false)}>Cancel</Button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Location selector — shown when user explicitly opens it */}
                    {gbpShowLocationSelector && gbpLocations && gbpLocations.length > 0 && (
                      <div className="grid gap-2">
                        <Label>Business Location</Label>
                        <select
                          className="border border-border rounded-md px-3 py-2 text-sm bg-background"
                          value={gbpSelectedLocation?.name ?? gbpStatus.locationName ?? ""}
                          onChange={e => {
                            const loc = gbpLocations.find(l => l.name === e.target.value);
                            if (loc) setGbpSelectedLocation(loc);
                          }}
                        >
                          <option value="">— select location —</option>
                          {gbpLocations.map(l => (
                            <option key={l.name} value={l.name}>{l.title}</option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={savingGbp || !gbpSelectedLocation}
                          onClick={async () => {
                            if (!gbpSelectedLocation) return;
                            setSavingGbp(true);
                            try {
                              await apiFetch("/gbp/location", { method: "POST", body: JSON.stringify({ name: gbpSelectedLocation.name, title: gbpSelectedLocation.title }) });
                              toast({ title: "Location saved", description: gbpSelectedLocation.title });
                              setGbpShowLocationSelector(false);
                              queryClient.invalidateQueries({ queryKey: ["gbp-status"] });
                            } catch { toast({ title: "Failed to save location", variant: "destructive" }); }
                            finally { setSavingGbp(false); }
                          }}
                          className="w-fit gap-2"
                        >
                          {savingGbp ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                          Save Location
                        </Button>
                      </div>
                    )}

                    <Button
                      size="sm" variant="outline"
                      className="text-red-600 border-red-300 hover:bg-red-50 gap-2 w-fit"
                      onClick={async () => {
                        await apiFetch("/gbp/disconnect", { method: "POST" });
                        queryClient.invalidateQueries({ queryKey: ["gbp-status"] });
                        toast({ title: "Google Business Profile disconnected" });
                      }}
                    >
                      Disconnect Google
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-2">
                      <Label>Google Cloud Client ID</Label>
                      <Input value={gbpClientId} onChange={e => setGbpClientId(e.target.value)} placeholder="1234567890-abc….apps.googleusercontent.com" />
                    </div>
                    <div className="grid gap-2">
                      <Label>Google Cloud Client Secret</Label>
                      <Input type="password" value={gbpClientSecret} onChange={e => setGbpClientSecret(e.target.value)} placeholder="GOCSPX-…" />
                      <p className="text-xs text-muted-foreground">
                        Create these in <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="underline">Google Cloud Console</a> → APIs &amp; Services → Credentials → Create OAuth 2.0 Client ID (Web application). Enable the <strong>Google My Business API</strong>. Add the redirect URI below as an authorised redirect URI.
                      </p>
                    </div>
                    {gbpRedirectUriData?.redirectUri && (
                      <div className="grid gap-2">
                        <Label>Authorised Redirect URI <span className="text-muted-foreground font-normal">(add this exactly in Google Cloud Console)</span></Label>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 bg-muted text-xs px-3 py-2 rounded border border-border break-all select-all">
                            {gbpRedirectUriData.redirectUri}
                          </code>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="shrink-0 gap-1"
                            onClick={() => { navigator.clipboard.writeText(gbpRedirectUriData.redirectUri); toast({ title: "Copied to clipboard" }); }}
                          >
                            <Copy className="w-3 h-3" /> Copy
                          </Button>
                        </div>
                      </div>
                    )}
                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        disabled={savingGbp || !gbpClientId || !gbpClientSecret}
                        onClick={async () => {
                          setSavingGbp(true);
                          try {
                            await apiFetch("/gbp/credentials", { method: "POST", body: JSON.stringify({ clientId: gbpClientId, clientSecret: gbpClientSecret }) });
                            toast({ title: "Credentials saved — click Connect to authorise" });
                          } catch { toast({ title: "Failed to save credentials", variant: "destructive" }); }
                          finally { setSavingGbp(false); }
                        }}
                        className="gap-2"
                      >
                        {savingGbp ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                        Save Credentials
                      </Button>
                      <Button
                        className="gap-2 bg-green-700 hover:bg-green-800 text-white"
                        onClick={() => { window.location.href = `${API_BASE}/gbp/connect`; }}
                      >
                        <Globe className="w-4 h-4" /> Connect to Google Business
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Refresh Reviews card */}
              <div className="bg-card border border-border/50 rounded-lg p-6 shadow-sm space-y-4">
                <div>
                  <h2 className="font-semibold text-base flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-amber-600" /> Shop Reviews
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Reviews from Google and Facebook are cached for 6 hours. Click here to force an immediate refresh — useful after connecting a new account or fixing a connection issue.
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    variant="outline"
                    onClick={handleRefreshReviews}
                    disabled={reviewsRefreshing}
                    className="gap-2"
                  >
                    {reviewsRefreshing
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Refreshing…</>
                      : <><RefreshCw className="w-4 h-4" />Refresh Reviews</>}
                  </Button>
                  {reviewsRefreshResult && !reviewsRefreshing && (
                    <span className="text-sm text-green-700 font-medium flex items-center gap-1">
                      <CheckCircle className="w-4 h-4" /> {reviewsRefreshResult.count} review{reviewsRefreshResult.count !== 1 ? "s" : ""} loaded
                    </span>
                  )}
                </div>
              </div>

              {/* Test post card */}
              <div className="bg-card border border-border/50 rounded-lg p-6 shadow-sm space-y-4">
                <div>
                  <h2 className="font-semibold text-base flex items-center gap-2">
                    <Send className="w-4 h-4 text-violet-600" /> Test Connections
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Send a live test post to Facebook and/or Google Business right now to confirm the connections are working.
                  </p>
                </div>

                <Button
                  onClick={async () => {
                    setTestingPost(true);
                    setTestPostResults(null);
                    try {
                      const data = await apiFetch<any>("/social-posts/test", { method: "POST" });
                      setTestPostResults(data);
                    } catch (e: any) {
                      toast({ title: "Test failed", description: e.message ?? "Unknown error", variant: "destructive" });
                    } finally {
                      setTestingPost(false);
                    }
                  }}
                  disabled={testingPost}
                  className="gap-2 bg-violet-600 hover:bg-violet-700 text-white"
                >
                  {testingPost ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {testingPost ? "Sending test post…" : "Send test post"}
                </Button>

                {testPostResults && (
                  <div className="space-y-2">
                    {/* Facebook result */}
                    {testPostResults.facebook && (
                      <div className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${testPostResults.facebook.ok ? "bg-green-50 border border-green-200 text-green-800" : testPostResults.facebook.skipped ? "bg-slate-50 border border-slate-200 text-slate-600" : "bg-red-50 border border-red-200 text-red-800"}`}>
                        <Share2 className="w-4 h-4 mt-0.5 shrink-0" />
                        <div>
                          <span className="font-semibold">Facebook: </span>
                          {testPostResults.facebook.ok
                            ? `✅ Posted successfully${testPostResults.facebook.postId ? ` (ID: ${testPostResults.facebook.postId})` : ""}`
                            : testPostResults.facebook.skipped
                              ? `⚠️ Skipped — ${testPostResults.facebook.error}`
                              : (() => {
                                  const err = testPostResults.facebook.error ?? "";
                                  const isMissingPermission = err.includes("pages_manage_posts") || err.includes("pages_read_engagement") || (err.includes('"code":200') || err.includes('"code": 200'));
                                  const isExpired = !isMissingPermission && (err.includes("Session has expired") || err.includes("Error validating access token") || err.includes('"code":190') || err.includes('"code": 190'));
                                  const isWrongPage = err.includes("error_subcode\":33") || err.includes('"subcode":33') || (err.includes("does not exist") && err.includes("missing permissions"));
                                  const isWrongToken = err.includes("error_subcode\":460") || err.includes("password was changed") || err.includes("must be logged in");
                                  return isMissingPermission ? (
                                    <span>❌ <strong>Missing permissions</strong> — The token needs <code>pages_manage_posts</code> and <code>pages_read_engagement</code> to post to your page. In Meta Business Manager:<br/>
                                      1. Go to <strong>Business Settings → System Users → the configured automation user</strong><br/>
                                      2. Click <strong>Add Assets → Pages → your configured Page</strong><br/>
                                      3. Set task to <strong>Manage page</strong> (Full control)<br/>
                                      4. Regenerate the System User token with <code>pages_manage_posts</code> and <code>pages_read_engagement</code> scopes selected<br/>
                                      5. Paste the new token above and click Save Facebook Settings<br/>
                                      <span className="text-xs opacity-70 mt-1 block">Raw: {err}</span>
                                    </span>
                                  ) : isExpired ? (
                                    <span>❌ <strong>Access token expired</strong> — Generate a new long-lived page access token from the{" "}
                                      <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" className="underline font-medium">Meta Graph API Explorer</a>, paste it above, and click Save Facebook Settings.<br/>
                                      <span className="text-xs opacity-70 mt-1 block">Raw: {err}</span>
                                    </span>
                                  ) : isWrongPage ? (
                                    <span>❌ <strong>Wrong Page ID or token type</strong> — The token must be a Page Access Token for the exact page ID entered.<br/>
                                      <span className="text-xs opacity-70 mt-1 block">Raw: {err}</span>
                                    </span>
                                  ) : isWrongToken ? (
                                    <span>❌ <strong>Token is a User token, not a Page token</strong> — Choose your page (not personal profile) from the "User or Page" dropdown in Graph API Explorer before generating the token.<br/>
                                      <span className="text-xs opacity-70 mt-1 block">Raw: {err}</span>
                                    </span>
                                  ) : <span>❌ Failed — {err}</span>;
                                })()}
                        </div>
                      </div>
                    )}
                    {/* Google result */}
                    {testPostResults.google && (
                      <div className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${testPostResults.google.ok ? "bg-green-50 border border-green-200 text-green-800" : testPostResults.google.skipped ? "bg-slate-50 border border-slate-200 text-slate-600" : "bg-red-50 border border-red-200 text-red-800"}`}>
                        <Globe className="w-4 h-4 mt-0.5 shrink-0" />
                        <div>
                          <span className="font-semibold">Google Business: </span>
                          {testPostResults.google.ok
                            ? `✅ Posted successfully${testPostResults.google.postName ? ` (${testPostResults.google.postName})` : ""}`
                            : testPostResults.google.skipped
                              ? `⚠️ Skipped — ${testPostResults.google.error}`
                              : `❌ Failed — ${testPostResults.google.error}`}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── LinkedIn ── */}
              <div className="bg-card border border-border/50 rounded-lg p-6 shadow-sm space-y-5">
                <div>
                  <h2 className="font-semibold text-base flex items-center gap-2">
                    <svg className="w-4 h-4 text-[#0A66C2]" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                    LinkedIn
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Automatically share new Knowledge Centre articles to your personal LinkedIn profile and/or company page. Tokens refresh automatically — no manual renewal needed.
                  </p>
                </div>

                {liStatus?.connected ? (
                  /* ── Connected state ── */
                  <div className="space-y-4">
                    <div className="flex items-start gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
                      <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      <div>
                        <span>Connected as <strong>{liStatus.personName ?? "LinkedIn user"}</strong></span>
                        {!liStatus.hasRefreshToken && (
                          <p className="text-amber-700 mt-1 text-xs">⚠ Manually-set token — reconnect via OAuth for automatic renewal.</p>
                        )}
                        {liStatus.tokenExpiresAt && (
                          <p className="text-xs text-green-600 mt-0.5">
                            Token valid until {new Date(liStatus.tokenExpiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Post-to toggles */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Post to personal profile</p>
                          <p className="text-xs text-muted-foreground">Posts appear on {liStatus.personName ?? "your"}'s feed</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={liStatus.postToProfile}
                          className="h-4 w-4 accent-primary cursor-pointer"
                          onChange={async (e) => {
                            await apiFetch("/linkedin/preferences", { method: "POST", body: JSON.stringify({ postToProfile: e.target.checked }) });
                            queryClient.invalidateQueries({ queryKey: ["linkedin-status"] });
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Post to company page</p>
                          <p className="text-xs text-muted-foreground">Posts appear on your LinkedIn company page</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={liStatus.postToPage}
                          className="h-4 w-4 accent-primary cursor-pointer"
                          onChange={async (e) => {
                            await apiFetch("/linkedin/preferences", { method: "POST", body: JSON.stringify({ postToPage: e.target.checked }) });
                            queryClient.invalidateQueries({ queryKey: ["linkedin-status"] });
                          }}
                        />
                      </div>
                    </div>

                    {/* Company page selector */}
                    {liStatus.postToPage && (
                      <div className="space-y-2 pl-1 border-l-2 border-primary/20 ml-1">
                        {liStatus.orgs && liStatus.orgs.length > 0 ? (
                          <div className="grid gap-1.5">
                            <Label className="text-xs">Company page</Label>
                            <select
                              className="border border-input rounded-md px-3 py-1.5 text-sm bg-background"
                              value={liStatus.orgUrn ?? ""}
                              onChange={async (e) => {
                                const org = liStatus.orgs!.find(o => o.urn === e.target.value);
                                if (!org) return;
                                await apiFetch("/linkedin/org", { method: "POST", body: JSON.stringify({ urn: org.urn, name: org.name }) });
                                queryClient.invalidateQueries({ queryKey: ["linkedin-status"] });
                              }}
                            >
                              {liStatus.orgs.map(o => (
                                <option key={o.urn} value={o.urn}>{o.name}</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <Label className="text-xs">Organisation URN</Label>
                            <p className="text-xs text-muted-foreground">No pages auto-detected (scope may need LinkedIn approval). Enter manually: find your company page at linkedin.com/company/XXXXX and prefix with <code>urn:li:organization:</code></p>
                            <div className="flex gap-2">
                              <Input
                                value={liManualOrgUrn}
                                onChange={e => setLiManualOrgUrn(e.target.value)}
                                placeholder="urn:li:organization:12345678"
                                className="flex-1 text-xs"
                              />
                              <Input
                                value={liManualOrgName}
                                onChange={e => setLiManualOrgName(e.target.value)}
                                placeholder="Company name"
                                className="w-36 text-xs"
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!liManualOrgUrn.startsWith("urn:li:organization:")}
                                onClick={async () => {
                                  await apiFetch("/linkedin/org", { method: "POST", body: JSON.stringify({ urn: liManualOrgUrn, name: liManualOrgName || liManualOrgUrn }) });
                                  queryClient.invalidateQueries({ queryKey: ["linkedin-status"] });
                                  setLiManualOrgUrn("");
                                  setLiManualOrgName("");
                                }}
                              >Save</Button>
                            </div>
                            {liStatus.orgUrn && (
                              <p className="text-xs text-green-700">Currently posting to: <strong>{liStatus.orgName ?? liStatus.orgUrn}</strong></p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { window.location.href = `${API_BASE}/linkedin/connect`; }}
                      >
                        Reconnect
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={async () => {
                          await apiFetch("/linkedin/disconnect", { method: "POST" });
                          queryClient.invalidateQueries({ queryKey: ["linkedin-status"] });
                          toast({ title: "LinkedIn disconnected" });
                        }}
                      >
                        Disconnect
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* ── Not connected state ── */
                  <div className="space-y-4">
                    {/* Step 1: App credentials */}
                    <div className="space-y-3">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Step 1 — App credentials</p>
                      <div className="grid gap-2">
                        <Label className="text-sm">Client ID</Label>
                        <Input
                          value={liClientId}
                          onChange={e => setLiClientId(e.target.value)}
                          placeholder="77avatb8o22ang"
                          className="font-mono text-sm"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label className="text-sm">Primary Client Secret</Label>
                        <Input
                          type="password"
                          value={liClientSecret}
                          onChange={e => setLiClientSecret(e.target.value)}
                          placeholder="••••••••••••••••"
                          className="font-mono text-sm"
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!liClientId || !liClientSecret || liCredentialsSaving}
                        onClick={async () => {
                          setLiCredentialsSaving(true);
                          try {
                            await apiFetch("/linkedin/credentials", { method: "POST", body: JSON.stringify({ clientId: liClientId, clientSecret: liClientSecret }) });
                            setLiClientSecret("");
                            toast({ title: "Credentials saved", description: "Now complete Step 2 and 3 below." });
                            queryClient.invalidateQueries({ queryKey: ["linkedin-redirect-uri"] });
                          } catch (e: any) {
                            toast({ title: "Failed to save credentials", description: e?.message, variant: "destructive" });
                          } finally {
                            setLiCredentialsSaving(false);
                          }
                        }}
                        className="gap-2"
                      >
                        {liCredentialsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Save Credentials
                      </Button>
                    </div>

                    {/* Step 2: Redirect URI */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Step 2 — Add redirect URL in LinkedIn Developer Portal</p>
                      <p className="text-xs text-muted-foreground">
                        Go to <a href="https://www.linkedin.com/developers/apps" target="_blank" rel="noreferrer" className="underline">linkedin.com/developers/apps</a> → your app → <strong>Auth</strong> tab → <strong>Authorised redirect URLs</strong> and add:
                      </p>
                      <div className="flex gap-2 items-center">
                        <code className="flex-1 text-xs bg-muted px-3 py-2 rounded border break-all">
                          {liRedirectUriData?.redirectUri ?? "Loading…"}
                        </code>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (liRedirectUriData?.redirectUri) {
                              navigator.clipboard.writeText(liRedirectUriData.redirectUri);
                              toast({ title: "Copied to clipboard" });
                            }
                          }}
                        >
                          Copy
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Also add the OAuth 2.0 scopes: <strong>openid</strong>, <strong>profile</strong>, <strong>email</strong>, <strong>w_member_social</strong>, <strong>w_organization_social</strong>, <strong>r_organization_social</strong>
                      </p>
                    </div>

                    {/* Step 3: Connect */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Step 3 — Authorise</p>
                      <Button
                        className="gap-2 bg-[#0A66C2] hover:bg-[#004182] text-white"
                        disabled={!liClientId}
                        onClick={() => { window.location.href = `${API_BASE}/linkedin/connect`; }}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                        Connect with LinkedIn
                      </Button>
                      {!liClientId && <p className="text-xs text-muted-foreground">Save your credentials first (Step 1).</p>}
                    </div>
                  </div>
                )}
              </div>

            </div>
          </TabsContent>

          {/* ─── Re-engagement Emails Tab ─────────────────────────── */}
          <TabsContent value="reengagement" className="mt-6">
            <div className="space-y-6 max-w-xl">

              {/* What it does */}
              <div className="bg-card border border-border/50 rounded-lg p-6 shadow-sm space-y-4">
                <div>
                  <h2 className="font-semibold text-base flex items-center gap-2">
                    <Mail className="w-4 h-4 text-blue-600" /> Automated Re-engagement Emails
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Sends a friendly "just checking in" email to customers who haven't placed an order in over 4 months — a gentle nudge about seasonal wardrobe refreshes and keeping their brand looking smart.
                  </p>
                </div>

                <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-900 space-y-1">
                  <p className="font-medium">How it works</p>
                  <ul className="list-disc pl-4 space-y-0.5 text-blue-800">
                    <li>Runs automatically every Monday morning</li>
                    <li>Only emails customers with a recorded email address</li>
                    <li>Won't re-email the same customer within 4 months</li>
                    <li>Personalised with the contact's first name and company logo</li>
                  </ul>
                </div>

                {checkinEligibleCount !== null && (
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{checkinEligibleCount}</span> customer{checkinEligibleCount === 1 ? "" : "s"} would receive an email if sent right now.
                  </p>
                )}
              </div>

              {/* Enable / disable */}
              <div className="bg-card border border-border/50 rounded-lg p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">Enable automatic emails</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Turn the weekly Monday morning job on or off.</p>
                  </div>
                  <Button
                    size="sm"
                    variant={checkinEnabled ? "default" : "outline"}
                    disabled={savingCheckin}
                    onClick={async () => {
                      setSavingCheckin(true);
                      try {
                        const next = !checkinEnabled;
                        await apiFetch("/reengagement/settings", {
                          method: "POST",
                          body: JSON.stringify({ enabled: next }),
                          headers: { "Content-Type": "application/json" },
                        });
                        setCheckinEnabled(next);
                      } catch (e: any) {
                        toast({ title: "Failed to save", description: e.message ?? "Unknown error", variant: "destructive" });
                      } finally {
                        setSavingCheckin(false);
                      }
                    }}
                    className="min-w-[80px]"
                  >
                    {savingCheckin ? <Loader2 className="w-4 h-4 animate-spin" /> : checkinEnabled ? "Enabled" : "Disabled"}
                  </Button>
                </div>

                {checkinLastRun && (
                  <p className="text-xs text-muted-foreground">Last run: {new Date(checkinLastRun).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>
                )}
              </div>

              {/* Preview + manual send */}
              <div className="bg-card border border-border/50 rounded-lg p-6 shadow-sm space-y-4">
                <div>
                  <h2 className="font-semibold text-base flex items-center gap-2">
                    <Eye className="w-4 h-4 text-slate-600" /> Preview &amp; Test
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Open a preview of the email template, or trigger a manual send to eligible customers right now.
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => window.open(`${API_BASE}/reengagement/preview`, "_blank")}
                  >
                    <Eye className="w-4 h-4" /> Preview email template
                  </Button>

                  <Button
                    disabled={runningCheckin}
                    className="gap-2"
                    onClick={async () => {
                      setRunningCheckin(true);
                      setCheckinRunResult(null);
                      try {
                        const data = await apiFetch<{ ok: boolean; sent: number; errors: number; error?: string }>("/reengagement/send-now", { method: "POST" });
                        if (data.ok) {
                          setCheckinRunResult({ sent: data.sent, errors: data.errors });
                          setCheckinLastRun(new Date().toISOString());
                          const eligible = await apiFetch<{ count: number }>("/reengagement/eligible-count");
                          setCheckinEligibleCount(eligible.count);
                        } else {
                          toast({ title: "Send failed", description: data.error ?? "Unknown error", variant: "destructive" });
                        }
                      } catch (e: any) {
                        toast({ title: "Send failed", description: e.message ?? "Unknown error", variant: "destructive" });
                      } finally {
                        setRunningCheckin(false);
                      }
                    }}
                  >
                    {runningCheckin ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {runningCheckin ? "Sending…" : "Send now"}
                  </Button>
                </div>

                {checkinRunResult && (
                  <div className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${checkinRunResult.errors === 0 ? "bg-green-50 border border-green-200 text-green-800" : "bg-amber-50 border border-amber-200 text-amber-800"}`}>
                    <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      Sent <strong>{checkinRunResult.sent}</strong> email{checkinRunResult.sent === 1 ? "" : "s"}
                      {checkinRunResult.errors > 0 ? `, ${checkinRunResult.errors} failed` : " successfully"}.
                    </span>
                  </div>
                )}
              </div>

            </div>
          </TabsContent>

          <TabsContent value="branding" className="mt-6">
            <BrandingTab />
          </TabsContent>

          <TabsContent value="users" className="mt-6">
            <UsersTab />
          </TabsContent>

          <TabsContent value="shop" className="mt-6">
            <ShopTab />
          </TabsContent>

          <TabsContent value="workflows" className="mt-6">
            <WorkflowsTab />
          </TabsContent>
          <TabsContent value="maya" className="mt-6">
            <MayaIntegrationTab />
          </TabsContent>

        </Tabs>
      </div>
    </Layout>
  );
}

function BrandingTab() {
  const { toast } = useToast();
  const [positions, setPositions] = useState<{ id: string; name: string; surcharge: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/shop/branding-options`)
      .then(r => r.json())
      .then(data => { setPositions(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/shop/branding-options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(positions),
      });
      if (!res.ok) throw new Error("Save failed");
      toast({ title: "Branding positions saved" });
    } catch (e: any) {
      toast({ title: "Failed to save", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const add = () =>
    setPositions(prev => [...prev, { id: `pos-${Date.now()}`, name: "", surcharge: 0 }]);

  const remove = (idx: number) =>
    setPositions(prev => prev.filter((_, i) => i !== idx));

  const update = (idx: number, field: string, value: string | number) =>
    setPositions(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));

  if (loading) return <div className="text-sm text-muted-foreground py-4">Loading…</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Logo Branding Positions</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure the logo positions available to customers on shop product pages.
          Each position can carry a per-item surcharge. Positions with a £0 surcharge
          are shown as "Included" and pre-ticked by default.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card divide-y">
        {positions.map((pos, idx) => (
          <div key={pos.id} className="flex items-end gap-3 px-4 py-3">
            <div className="flex-1 grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Position name</Label>
                <Input
                  value={pos.name}
                  onChange={e => update(idx, "name", e.target.value)}
                  placeholder="e.g. Left Chest"
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Surcharge per item (£)</Label>
                <Input
                  type="number"
                  value={pos.surcharge}
                  onChange={e => update(idx, "surcharge", parseFloat(e.target.value) || 0)}
                  min="0"
                  step="0.50"
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <button
              onClick={() => remove(idx)}
              className="mb-0.5 text-muted-foreground hover:text-destructive transition-colors"
              title="Remove position"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {positions.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No positions configured. Add one below.
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={add} className="gap-2">
          <Plus className="w-4 h-4" /> Add Position
        </Button>
        <Button size="sm" onClick={save} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
          Save changes
        </Button>
      </div>

      <div className="rounded-lg border bg-muted/30 p-4 text-sm space-y-1.5">
        <p className="font-medium">How branding positions work</p>
        <ul className="text-muted-foreground text-xs list-disc pl-4 space-y-0.5">
          <li>Customers select positions on each product page before adding to their basket</li>
          <li>Surcharges are charged per garment — a £2.50 surcharge on 10 items adds £25.00</li>
          <li>Positions with £0 surcharge show as "Included" and are pre-ticked by default</li>
          <li>Branding selections appear in order item notes so production staff can see them</li>
        </ul>
      </div>
    </div>
  );
}

function DpdTab() {
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; configured: boolean; message: string; accountNumber?: string } | null>(null);

  async function testConnection() {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/settings/dpd-test`);
      const data = await res.json();
      setResult(data);
      if (data.ok) {
        toast({ title: "DPD connected", description: data.message });
      } else {
        toast({ title: "DPD connection failed", description: data.message, variant: "destructive" });
      }
    } catch (e: any) {
      const msg = e.message ?? "Request failed";
      setResult({ ok: false, configured: false, message: msg });
      toast({ title: "DPD test error", description: msg, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="grid gap-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold">DPD Courier Integration</h2>
        <p className="text-sm text-muted-foreground mt-1">
          DPD bookings are made automatically at dispatch for orders with a DPD shipping method and a delivery address.
          Use this page to verify the API credentials are working.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <p className="text-sm font-medium">Credential status</p>
        <div className="space-y-1.5 text-sm">
          {(["DPD_USERNAME", "DPD_PASSWORD", "DPD_ACCOUNT_NUMBER"] as const).map((key) => (
            <div key={key} className="flex items-center gap-2 text-muted-foreground">
              <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
              <code className="text-xs">{key}</code>
              <span className="text-xs">— set via environment secret</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground pt-1">
          These are stored as Replit environment secrets and cannot be viewed here. To change them, update the secret values in the Replit environment secrets panel.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <p className="text-sm font-medium">Test live connection</p>
        <p className="text-sm text-muted-foreground">
          Attempts to authenticate with the DPD API using the stored credentials. Does not create any booking.
        </p>
        <Button onClick={testConnection} disabled={testing} className="gap-2">
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
          {testing ? "Testing…" : "Test DPD Connection"}
        </Button>

        {result && (
          <div className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${
            result.ok
              ? "bg-green-50 border-green-200 text-green-900"
              : "bg-red-50 border-red-200 text-red-900"
          }`}>
            {result.ok
              ? <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-green-600" />
              : <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-600" />}
            <div>
              <p className="font-medium">{result.ok ? "Connected" : "Failed"}</p>
              <p className="text-xs mt-0.5 opacity-80">{result.message}</p>
              {result.accountNumber && (
                <p className="text-xs mt-0.5 opacity-70">Account: {result.accountNumber}</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
        <p className="font-medium">Why DPD might not book automatically</p>
        <ul className="space-y-1 text-muted-foreground text-xs list-disc pl-4">
          <li>The order has no delivery address set — open the order and add one, then use the <strong>Book DPD</strong> retry button</li>
          <li>The shipping method is not set to DPD, DPD Next Day, or Courier</li>
          <li>The DPD API credentials are incorrect — use the test above to verify</li>
          <li>The DPD API was temporarily unavailable when the order was dispatched — use the <strong>Book DPD</strong> retry button on the order</li>
        </ul>
      </div>
    </div>
  );
}

// ── Shop Page tab ─────────────────────────────────────────────────────────────

interface TeamMember { name: string; role: string; photoUrl: string; email?: string; phone?: string; }

function ShopTab() {
  const { toast } = useToast();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);

  const uploadPhoto = async (file: File, idx: number) => {
    setUploadingIdx(idx);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const r = await fetch(`${API_BASE}/shop/team-members/upload-photo`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(await r.text());
      const { url } = await r.json();
      updateMember(idx, "photoUrl", url);
      toast({ title: "Photo uploaded" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploadingIdx(null);
    }
  };

  useEffect(() => {
    fetch(`${API_BASE}/shop/team-members`)
      .then(r => r.json())
      .then((data: TeamMember[]) => { setMembers(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/shop/team-members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(members),
      });
      if (!res.ok) throw new Error("Save failed");
      toast({ title: "Team members saved" });
    } catch (e: any) {
      toast({ title: "Failed to save", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const addMember = () => setMembers(prev => [...prev, { name: "", role: "", photoUrl: "", email: "", phone: "" }]);
  const removeMember = (i: number) => setMembers(prev => prev.filter((_, idx) => idx !== i));
  const updateMember = (i: number, field: keyof TeamMember, value: string) =>
    setMembers(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: value } : m));

  if (loading) return <div className="text-sm text-muted-foreground py-4">Loading…</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-base">Our Team — About Us page</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              These appear in the "Our Team" section on the shop's About Us page.
              Paste a direct image URL (e.g. from your WordPress media library) for each person's photo.
              Leave the section empty to hide it entirely.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={addMember} className="gap-1.5 shrink-0">
            <Plus className="w-4 h-4" /> Add Member
          </Button>
        </div>

        {members.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground border-2 border-dashed rounded-lg">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No team members yet. Click <strong>Add Member</strong> to add the first one.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {members.map((m, i) => (
              <div key={i} className="grid gap-3 p-3 rounded-lg border bg-muted/20">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Name</Label>
                    <Input
                      value={m.name}
                      onChange={e => updateMember(i, "name", e.target.value)}
                      placeholder="e.g. Sarah Johnson"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Role / Title</Label>
                    <Input
                      value={m.role}
                      onChange={e => updateMember(i, "role", e.target.value)}
                      placeholder="e.g. Sales Director"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Email</Label>
                    <Input
                      type="email"
                      value={m.email ?? ""}
                      onChange={e => updateMember(i, "email", e.target.value)}
                      placeholder="admin@example.com"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Phone</Label>
                    <Input
                      type="tel"
                      value={m.phone ?? ""}
                      onChange={e => updateMember(i, "phone", e.target.value)}
                      placeholder="e.g. +44 7700 900000"
                    />
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1 grid gap-1.5">
                    <Label className="text-xs">Photo</Label>
                    <div className="flex items-center gap-2">
                      {m.photoUrl ? (
                        <img
                          src={m.photoUrl}
                          alt=""
                          className="w-10 h-10 rounded-full object-cover border shrink-0"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                          {m.name ? m.name.charAt(0).toUpperCase() : '?'}
                        </div>
                      )}
                      <label className="cursor-pointer flex-1" title="Upload or paste a photo URL">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploadingIdx === i}
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) uploadPhoto(file, i);
                            e.target.value = "";
                          }}
                        />
                        <div className="flex items-center gap-1.5 text-xs border border-input rounded px-2 py-1.5 hover:bg-muted transition-colors cursor-pointer w-full justify-center">
                          {uploadingIdx === i ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                          {uploadingIdx === i ? "Uploading…" : (m.photoUrl ? "Replace" : "Upload photo")}
                        </div>
                      </label>
                    </div>
                    <Input
                      value={m.photoUrl}
                      onChange={e => updateMember(i, "photoUrl", e.target.value)}
                      placeholder="or paste a photo URL"
                      className="text-xs"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-red-500 hover:bg-red-50 shrink-0"
                    onClick={() => removeMember(i)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button onClick={save} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            {saving ? "Saving…" : "Save Team"}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/30 p-4 text-sm space-y-1">
        <p className="font-medium">Where to find photo URLs</p>
        <p className="text-muted-foreground text-xs">
          In your WordPress admin, go to <strong>Media Library</strong>, click a photo, and copy the <strong>File URL</strong>.
          The section won't appear on the About Us page until at least one team member is saved.
        </p>
      </div>
    </div>
  );
}

// ── Workflows Tab ─────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<string, string> = {
  order_dispatched: "Order Dispatched",
  order_created: "Order Created",
  portal_order_submitted: "Portal Order Submitted",
  enquiry_received: "Enquiry Received",
};

interface WorkflowListItem {
  id: number;
  name: string;
  trigger_type: string;
  is_active: boolean;
  step_count: number;
  created_at: string;
}

function WorkflowsTab() {
  const [, navigate] = useLocation();
  const [toggling, setToggling] = useState<number | null>(null);
  const { toast } = useToast();

  const { data: workflows = [], isLoading, refetch } = useQuery<WorkflowListItem[]>({
    queryKey: ["workflows"],
    queryFn: () => apiFetch("/workflows", { headers: staffAuthHeader() }),
  });

  async function toggleActive(wf: WorkflowListItem) {
    setToggling(wf.id);
    try {
      await apiFetch(`/workflows/${wf.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !wf.is_active }),
        headers: staffAuthHeader(),
      });
      refetch();
    } catch (e: any) {
      toast({ title: "Failed to update", description: e.message, variant: "destructive" });
    } finally {
      setToggling(null);
    }
  }

  async function deleteWorkflow(wf: WorkflowListItem) {
    if (!confirm(`Delete workflow "${wf.name}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/workflows/${wf.id}`, { method: "DELETE", headers: staffAuthHeader() });
      refetch();
      toast({ title: "Workflow deleted" });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-base">Workflow Automations</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Automate emails and WhatsApp messages based on business events.
            </p>
          </div>
          <Button size="sm" onClick={() => navigate("/workflows/new")} className="gap-1.5">
            <Plus className="w-4 h-4" /> New Workflow
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : workflows.length === 0 ? (
          <div className="py-12 text-center border-2 border-dashed rounded-lg">
            <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm text-muted-foreground">No workflows yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Create one to automatically send emails or WhatsApp messages when orders are dispatched, enquiries arrive, and more.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {workflows.map(wf => (
              <div key={wf.id} className="py-3 flex items-center gap-3">
                <button
                  onClick={() => navigate(`/workflows/${wf.id}`)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{wf.name}</span>
                    <Badge variant="outline" className={`text-xs ${wf.is_active ? "border-green-400 text-green-700 bg-green-50" : "text-muted-foreground"}`}>
                      {wf.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {TRIGGER_LABELS[wf.trigger_type] ?? wf.trigger_type} · {wf.step_count} step{wf.step_count !== 1 ? "s" : ""}
                  </p>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    disabled={toggling === wf.id}
                    onClick={() => toggleActive(wf)}
                  >
                    {toggling === wf.id
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : wf.is_active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-red-500 hover:bg-red-50"
                    onClick={() => deleteWorkflow(wf)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-muted/30 p-4 text-sm space-y-2">
        <p className="font-medium">Available merge tags by trigger</p>
        <div className="grid gap-2 text-xs text-muted-foreground">
          <div><span className="font-medium text-foreground">Order Dispatched:</span> {"{{"} order_number {"}}"}, {"{{"} customer_name {"}}"}, {"{{"} contact_email {"}}"}, {"{{"} contact_phone {"}}"}, {"{{"} tracking_number {"}}"}</div>
          <div><span className="font-medium text-foreground">Order Created:</span> {"{{"} order_number {"}}"}, {"{{"} customer_name {"}}"}</div>
          <div><span className="font-medium text-foreground">Portal Order Submitted:</span> {"{{"} order_number {"}}"}, {"{{"} customer_name {"}}"}, {"{{"} contact_email {"}}"}, {"{{"} contact_name {"}}"}</div>
          <div><span className="font-medium text-foreground">Enquiry Received:</span> {"{{"} contact_name {"}}"}, {"{{"} contact_email {"}}"}, {"{{"} contact_phone {"}}"}, {"{{"} product_name {"}}"}, {"{{"} message {"}}"}</div>
        </div>
      </div>
    </div>
  );
}
