import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListProducts } from "@workspace/api-client-react";
import { Link, useParams, useLocation } from "wouter";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Loader2, Trash2, Plus, Copy, Check, Send, Clock,
  Eye, CheckCircle2, ShoppingCart, X, Link as LinkIcon, FileText,
  ChevronDown, Save, Upload, ImageOff, Download, ChevronsUpDown, PackagePlus,
} from "lucide-react";
import { UploadedImage } from "@/components/UploadedImage";
import { useUpload } from "@workspace/object-storage-web";
import { SendQuoteDialog } from "@/components/SendQuoteDialog";

const API_BASE = "/api";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface QuoteItem {
  id: number;
  quoteId: number;
  parentItemId: number | null;
  productId: number | null;
  productName: string;
  productSku: string | null;
  productUrl: string | null;
  colour: string | null;
  size: string | null;
  finishName: string | null;
  quantity: number;
  unitPrice: string;
  vatRate: string;
  notes: string | null;
  sortOrder: number;
}

interface DeliveryAddress {
  id: number;
  customerId: number;
  label: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
  isDefault: boolean;
}

interface Quote {
  id: number;
  quoteNumber: string;
  customerId: number | null;
  customerName: string;
  status: "draft" | "sent" | "viewed" | "ordered" | "expired";
  notes: string | null;
  coverText: string | null;
  expiresAt: string | null;
  customerLogoUrl: string | null;
  token: string;
  createdAt: string;
  updatedAt: string;
  items: QuoteItem[];
  contactFirstName: string | null;
  contactLastName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  deliveryAddressId: number | null;
  deliveryAddress: DeliveryAddress | null;
  customerDeliveryAddresses: DeliveryAddress[];
}

type QuoteStatus = Quote["status"];

const STATUS_STEPS: { key: QuoteStatus; label: string; icon: React.ElementType }[] = [
  { key: "draft",   label: "Draft",   icon: Clock },
  { key: "sent",    label: "Sent",    icon: Send },
  { key: "viewed",  label: "Viewed",  icon: Eye },
  { key: "ordered", label: "Ordered", icon: ShoppingCart },
];

const STATUS_COLOR: Record<QuoteStatus, string> = {
  draft:   "bg-slate-100 text-slate-700 border-slate-300",
  sent:    "bg-blue-100 text-blue-700 border-blue-300",
  viewed:  "bg-amber-100 text-amber-700 border-amber-300",
  ordered: "bg-green-100 text-green-700 border-green-300",
  expired: "bg-red-100 text-red-700 border-red-300",
};

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <Button variant="outline" size="sm" onClick={copy} className="gap-1.5 text-xs shrink-0">
      {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied!" : label}
    </Button>
  );
}

const EMPTY_ITEM = { productId: null as number | null, productName: "", productUrl: "", colour: "", size: "", finishName: "", quantity: 1, unitPrice: 0, notes: "" };
const EMPTY_FINISH = { finishName: "", unitPrice: 0 };

export default function QuoteDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const quoteId = parseInt(id ?? "0");

  const { data: quote, isLoading } = useQuery<Quote>({
    queryKey: ["quote", quoteId],
    queryFn: () => apiFetch(`/quotes/${quoteId}`),
    enabled: !!quoteId,
  });

  const [customerName, setCustomerName] = useState("");
  const [status, setStatus] = useState<QuoteStatus>("draft");
  const [notes, setNotes] = useState("");
  const [coverText, setCoverText] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [customerLogoUrl, setCustomerLogoUrl] = useState<string | null>(null);
  const [deliveryAddressId, setDeliveryAddressId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading: isUploadingLogo } = useUpload({
    onSuccess: (res) => {
      const url = `/api/storage/objects${res.objectPath.replace(/^\/objects/, "")}`;
      setCustomerLogoUrl(url);
      setDirty(true);
    },
  });

  // Product catalogue search — Popover + Command, catalogue-only (no free text)
  const [newItem, setNewItem] = useState({ ...EMPTY_ITEM });
  const [addFinishLine, setAddFinishLine] = useState(false);
  const [finishLine, setFinishLine] = useState({ ...EMPTY_FINISH });
  const [productOpen, setProductOpen] = useState(false);
  const [productSearchTerm, setProductSearchTerm] = useState("");

  const { data: productResults = [] } = useListProducts(
    { search: productSearchTerm },
    { query: { enabled: productSearchTerm.length >= 2 } },
  );
  const productSuggestions = productResults.slice(0, 10);

  // Fetch variants for the currently-selected new item product (for colour dropdown)
  const { data: newItemVariants = [] } = useQuery<{ colour: string | null }[]>({
    queryKey: ["product-variants", newItem.productId],
    queryFn: () => apiFetch(`/products/${newItem.productId}/variants`),
    enabled: !!newItem.productId,
  });
  const newItemColours = [...new Set(newItemVariants.map((v) => v.colour).filter(Boolean) as string[])].sort();

  useEffect(() => {
    if (!quote) return;
    setCustomerName(quote.customerName);
    setStatus(quote.status);
    setNotes(quote.notes ?? "");
    setCoverText(quote.coverText ?? "");
    setCustomerLogoUrl(quote.customerLogoUrl ?? null);
    setDeliveryAddressId(quote.deliveryAddressId ?? null);
    if (quote.expiresAt) {
      setExpiresAt(new Date(quote.expiresAt).toISOString().slice(0, 10));
    } else {
      const d = new Date();
      d.setDate(d.getDate() + 14);
      setExpiresAt(d.toISOString().slice(0, 10));
    }
    setDirty(false);
  }, [quote]);

  const saveQuote = useMutation({
    mutationFn: () => apiFetch(`/quotes/${quoteId}`, {
      method: "PATCH",
      body: JSON.stringify({
        customerName,
        status,
        notes: notes || null,
        coverText: coverText || null,
        expiresAt: expiresAt || null,
        customerLogoUrl: customerLogoUrl ?? null,
        deliveryAddressId: deliveryAddressId ?? null,
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quote", quoteId] });
      qc.invalidateQueries({ queryKey: ["quotes"] });
      setDirty(false);
      toast({ title: "Quote saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteQuote = useMutation({
    mutationFn: () => apiFetch(`/quotes/${quoteId}`, { method: "DELETE" }),
    onSuccess: () => { setLocation("/quotes"); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createOrder = useMutation({
    mutationFn: () => apiFetch<{ orderId: number; orderNumber: string }>(`/quotes/${quoteId}/create-order`, { method: "POST" }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["quote", quoteId] });
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      toast({ title: `Order ${data.orderNumber} created`, description: "Quote marked as ordered. Opening order…" });
      setTimeout(() => setLocation(`/orders/${data.orderId}`), 600);
    },
    onError: (e: Error) => toast({ title: "Failed to create order", description: e.message, variant: "destructive" }),
  });

  const addItem = useMutation({
    mutationFn: async () => {
      const parent = await apiFetch<{ id: number }>(`/quotes/${quoteId}/items`, {
        method: "POST",
        body: JSON.stringify({
          productId: newItem.productId ?? null,
          productName: newItem.productName,
          productUrl: newItem.productUrl || null,
          colour: newItem.colour || null,
          size: newItem.size || null,
          finishName: newItem.finishName || null,
          quantity: newItem.quantity,
          unitPrice: newItem.unitPrice,
          notes: newItem.notes || null,
        }),
      });
      if (addFinishLine && finishLine.finishName.trim()) {
        await apiFetch(`/quotes/${quoteId}/items`, {
          method: "POST",
          body: JSON.stringify({
            parentItemId: parent.id,
            productName: newItem.productName,
            finishName: finishLine.finishName.trim(),
            quantity: 0,
            unitPrice: 0,
          }),
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quote", quoteId] });
      qc.invalidateQueries({ queryKey: ["quotes"] });
      setNewItem({ ...EMPTY_ITEM });
      setFinishLine({ ...EMPTY_FINISH });
      setAddFinishLine(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteItem = useMutation({
    mutationFn: (itemId: number) => apiFetch(`/quotes/${quoteId}/items/${itemId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quote", quoteId] });
      qc.invalidateQueries({ queryKey: ["quotes"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateItem = useMutation({
    mutationFn: ({ itemId, data }: { itemId: number; data: Partial<typeof EMPTY_ITEM> }) =>
      apiFetch(`/quotes/${quoteId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quote", quoteId] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addFinishToItem = useMutation({
    mutationFn: ({ parentItemId, productName }: { parentItemId: number; productName: string }) =>
      apiFetch(`/quotes/${quoteId}/items`, {
        method: "POST",
        body: JSON.stringify({ parentItemId, productName, finishName: "", quantity: 0, unitPrice: 0 }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quote", quoteId] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateDecoration = useMutation({
    mutationFn: ({ itemId, finishName }: { itemId: number; finishName: string }) =>
      apiFetch(`/quotes/${quoteId}/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ finishName }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quote", quoteId] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const markSent = () => {
    setStatus("sent");
    apiFetch(`/quotes/${quoteId}`, { method: "PATCH", body: JSON.stringify({ status: "sent" }) })
      .then(() => {
        qc.invalidateQueries({ queryKey: ["quote", quoteId] });
        qc.invalidateQueries({ queryKey: ["quotes"] });
        toast({ title: "Quote marked as sent" });
        setDirty(false);
      })
      .catch((e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }));
  };

  // GP hooks — must be called unconditionally (before any early returns)
  const productIds = useMemo(
    () => {
      const allItems = quote?.items ?? [];
      return [...new Set(allItems.filter((i) => i.productId != null && !i.parentItemId).map((i) => i.productId!))];
    },
    [quote?.items],
  );
  const { data: gpProducts = [] } = useQuery<{ id: number; supplierPrice: number | null }[]>({
    queryKey: ["quote-gp-products", productIds],
    queryFn: () => Promise.all(productIds.map((pid) => apiFetch<{ id: number; supplierPrice: number | null }>(`/products/${pid}`))),
    enabled: productIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });
  const supplierPriceMap = useMemo(() => {
    const m = new Map<number, number | null>();
    gpProducts.forEach((p) => m.set(p.id, p.supplierPrice));
    return m;
  }, [gpProducts]);

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading quote…
        </div>
      </Layout>
    );
  }

  if (!quote) {
    return (
      <Layout>
        <div className="py-24 text-center text-muted-foreground">
          <p>Quote not found.</p>
          <Button variant="link" onClick={() => setLocation("/quotes")}>← Back to Quotes</Button>
        </div>
      </Layout>
    );
  }

  const items = quote.items ?? [];
  const parentItems = items.filter((i) => !i.parentItemId);
  const childrenByParent = new Map(parentItems.map((p) => [p.id, items.filter((c) => c.parentItemId === p.id)]));
  const colSpan = 7; // Product | Colour | Finish | Qty | Unit Price | Line Total | Delete
  const subtotal = parentItems.reduce((s, i) => s + parseFloat(i.unitPrice) * i.quantity, 0);
  const vat = parentItems.reduce((s, i) => s + parseFloat(i.unitPrice) * i.quantity * parseFloat(i.vatRate), 0);
  const total = subtotal + vat;
  const gpItemsWithCost = parentItems.filter((i) => i.productId != null && (supplierPriceMap.get(i.productId!) ?? null) != null);
  const totalCost = gpItemsWithCost.reduce((s, i) => s + (supplierPriceMap.get(i.productId!)! * i.quantity), 0);
  const gpRevenue = gpItemsWithCost.reduce((s, i) => s + parseFloat(i.unitPrice) * i.quantity, 0);
  const grossProfit = gpRevenue - totalCost;
  const gpPct = gpRevenue > 0 ? (grossProfit / gpRevenue) * 100 : null;
  const gpColor = gpPct == null ? "text-muted-foreground" : gpPct >= 40 ? "text-emerald-600" : gpPct >= 25 ? "text-amber-600" : "text-red-600";
  const gpBg = gpPct == null ? "bg-muted/30" : gpPct >= 40 ? "bg-emerald-50" : gpPct >= 25 ? "bg-amber-50" : "bg-red-50";

  const portalLink = `${window.location.origin}/customer-portal/orders/new?quote=${quote.token}`;
  const fullMessage = `${coverText}\n\nClick the link below to view your quote and place your order:\n${portalLink}`;

  const stepIndex = STATUS_STEPS.findIndex((s) => s.key === quote.status);

  return (
    <Layout>
      <div className="space-y-6 max-w-5xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/quotes">
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground -ml-2">
                <ArrowLeft className="w-4 h-4" /> Quotes
              </Button>
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-mono font-bold text-primary text-lg">{quote.quoteNumber}</span>
            <Badge className={`${STATUS_COLOR[quote.status]} text-xs`}>{quote.status}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => saveQuote.mutate()} disabled={!dirty || saveQuote.isPending} size="sm" className="gap-1.5">
              {saveQuote.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save changes
            </Button>
            <Button
              variant="outline" size="sm"
              className="gap-1.5 text-blue-700 border-blue-300 hover:bg-blue-50"
              onClick={() => setSendOpen(true)}
            >
              <Send className="w-3.5 h-3.5" /> Send
            </Button>
            <a href={`${API_BASE}/quotes/${quoteId}/pdf`} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Download className="w-3.5 h-3.5" /> Download PDF
              </Button>
            </a>
            <Button
              size="sm"
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={createOrder.isPending || quote.status === "ordered" || (quote.items ?? []).filter((i: QuoteItem) => !i.parentItemId).length === 0}
              onClick={() => {
                if (confirm(`Confirm order from ${quote.quoteNumber}? This will create a new order and mark the quote as ordered.`))
                  createOrder.mutate();
              }}
            >
              {createOrder.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackagePlus className="w-3.5 h-3.5" />}
              {quote.status === "ordered" ? "Already ordered" : "Confirm Order"}
            </Button>
            <Button
              variant="outline" size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => { if (confirm(`Delete ${quote.quoteNumber}?`)) deleteQuote.mutate(); }}
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </Button>
          </div>
        </div>

        {/* Status progress */}
        <div className="flex items-center gap-0 rounded-xl border bg-muted/30 px-6 py-4">
          {STATUS_STEPS.map((step, i) => {
            const isActive = i === stepIndex;
            const isDone = i < stepIndex;
            const Icon = step.icon;
            return (
              <div key={step.key} className="flex items-center flex-1">
                <div className={`flex items-center gap-2 ${isActive ? "text-primary font-semibold" : isDone ? "text-primary/60" : "text-muted-foreground/50"}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isActive ? "bg-primary text-white" : isDone ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {isDone ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                  </div>
                  <span className="text-sm hidden sm:block">{step.label}</span>
                </div>
                {i < STATUS_STEPS.length - 1 && (
                  <div className={`flex-1 h-px mx-3 ${i < stepIndex ? "bg-primary/40" : "bg-border"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Quote details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-4 rounded-xl border bg-card p-5">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Quote Details</h3>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Customer Logo</Label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => logoFileInputRef.current?.click()}
                    className="w-20 h-14 rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/40 transition-colors flex items-center justify-center bg-muted/20 overflow-hidden shrink-0"
                    title="Click to upload logo"
                  >
                    {customerLogoUrl ? (
                      <UploadedImage src={customerLogoUrl} alt="Logo" className="w-full h-full object-contain p-1" fallback={<ImageOff className="w-4 h-4 text-muted-foreground" />} />
                    ) : (
                      <Upload className="w-5 h-5 text-muted-foreground" />
                    )}
                  </button>
                  <div className="flex-1 space-y-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full text-xs gap-1.5"
                      onClick={() => logoFileInputRef.current?.click()}
                      disabled={isUploadingLogo}
                    >
                      {isUploadingLogo ? <><Loader2 className="w-3 h-3 animate-spin" />Uploading…</> : <><Upload className="w-3 h-3" />{customerLogoUrl ? "Replace Logo" : "Upload Logo"}</>}
                    </Button>
                    {customerLogoUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs text-muted-foreground gap-1.5"
                        onClick={() => { setCustomerLogoUrl(null); setDirty(true); }}
                      >
                        <X className="w-3 h-3" /> Remove logo
                      </Button>
                    )}
                  </div>
                  <input
                    ref={logoFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Customer Name</Label>
                <Input
                  value={customerName}
                  onChange={(e) => { setCustomerName(e.target.value); setDirty(true); }}
                  placeholder="Customer name"
                />
              </div>

              {/* Contact info from HighLevel sync — read-only */}
              {(quote.contactFirstName || quote.contactLastName || quote.customerPhone || quote.customerEmail) && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contact (HL Sync)</p>
                  {(quote.contactFirstName || quote.contactLastName) && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground w-16 shrink-0">Name</span>
                      <span className="font-medium">{[quote.contactFirstName, quote.contactLastName].filter(Boolean).map(n => n!.replace(/\b\w/g, c => c.toUpperCase())).join(" ")}</span>
                    </div>
                  )}
                  {quote.customerPhone && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground w-16 shrink-0">Phone</span>
                      <a href={`tel:${quote.customerPhone}`} className="font-medium hover:underline">{quote.customerPhone}</a>
                    </div>
                  )}
                  {quote.customerEmail && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground w-16 shrink-0">Email</span>
                      <a href={`mailto:${quote.customerEmail}`} className="font-medium hover:underline truncate">{quote.customerEmail}</a>
                    </div>
                  )}
                </div>
              )}

              {/* Delivery Address */}
              <div className="space-y-1.5">
                <Label>Delivery Address</Label>
                {quote.customerDeliveryAddresses.length > 0 ? (
                  <Select
                    value={deliveryAddressId != null ? String(deliveryAddressId) : "none"}
                    onValueChange={(v) => { setDeliveryAddressId(v === "none" ? null : parseInt(v)); setDirty(true); }}
                  >
                    <SelectTrigger><SelectValue placeholder="— None selected —" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— None selected —</SelectItem>
                      {quote.customerDeliveryAddresses.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {a.label ?? [a.line1, a.city, a.postcode].filter(Boolean).join(", ") ?? `Address ${a.id}`}
                          {a.isDefault ? " ★" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    {quote.customerId ? "No delivery addresses saved for this customer." : "Link a customer to select a delivery address."}
                  </p>
                )}
                {/* Show the selected address details */}
                {deliveryAddressId != null && (() => {
                  const a = quote.customerDeliveryAddresses.find((x) => x.id === deliveryAddressId);
                  if (!a) return null;
                  const lines = [a.line1, a.line2, a.city, a.postcode, a.country].filter(Boolean);
                  return (
                    <div className="rounded-lg bg-muted/40 border px-3 py-2 text-xs text-muted-foreground space-y-0.5">
                      {a.label && <p className="font-semibold text-foreground">{a.label}</p>}
                      {lines.map((l, i) => <p key={i}>{l}</p>)}
                    </div>
                  );
                })()}
              </div>

              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => { setStatus(v as QuoteStatus); setDirty(true); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["draft","sent","viewed","ordered","expired"] as QuoteStatus[]).map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Expiry Date <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => { setExpiresAt(e.target.value); setDirty(true); }}
                />
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-xl border bg-card p-5 space-y-4">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Internal Notes</h3>
              <Textarea
                value={notes}
                onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
                placeholder="Notes about this enquiry — products discussed, sizes, budget, etc."
                rows={5}
                className="resize-none"
              />
            </div>

            {/* GP Summary Card */}
            {parentItems.length > 0 && (
              <div className={`rounded-xl border p-5 space-y-3 ${gpBg}`}>
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Gross Profit</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Quote Revenue</span>
                    <span className="font-medium">£{subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Est. Cost</span>
                    <span className="font-medium">
                      {gpItemsWithCost.length === 0 ? <span className="text-muted-foreground italic">no data</span> : `£${totalCost.toFixed(2)}`}
                    </span>
                  </div>
                  <div className={`flex justify-between pt-2 border-t font-semibold text-base ${gpColor}`}>
                    <span>GP</span>
                    <span>
                      {gpPct != null ? (
                        <>£{grossProfit.toFixed(2)} <span className="text-sm font-medium ml-1">({gpPct.toFixed(1)}%)</span></>
                      ) : (
                        <span className="text-sm font-normal text-muted-foreground italic">—</span>
                      )}
                    </span>
                  </div>
                </div>
                {gpItemsWithCost.length < parentItems.filter(i => i.productId != null).length && gpItemsWithCost.length > 0 && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Based on {gpItemsWithCost.length} of {parentItems.length} item{parentItems.length !== 1 ? "s" : ""} with known supplier price.
                  </p>
                )}
                {gpItemsWithCost.length === 0 && productIds.length > 0 && (
                  <p className="text-xs text-muted-foreground">No supplier prices set on these products.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Items */}
        <div className="rounded-xl border overflow-hidden">
            <div className="px-5 py-3 bg-muted/40 border-b">
              <h3 className="font-semibold text-sm">Quoted Items</h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="w-32">Colour</TableHead>
                  <TableHead className="w-36">Finish / Decoration</TableHead>
                  <TableHead className="w-20 text-right">Qty</TableHead>
                  <TableHead className="w-28 text-right">Unit Price</TableHead>
                  <TableHead className="w-28 text-right">Line Total</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {parentItems.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    decorationItems={childrenByParent.get(item.id) ?? []}
                    onDelete={() => deleteItem.mutate(item.id)}
                    onSave={(data) => updateItem.mutate({ itemId: item.id, data })}
                    onAddDecoration={() => addFinishToItem.mutate({ parentItemId: item.id, productName: item.productName })}
                    onDeleteDecoration={(childId) => deleteItem.mutate(childId)}
                    onSaveDecoration={(childId, finishName) => updateDecoration.mutate({ itemId: childId, finishName })}
                  />
                ))}
                {parentItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-6 text-sm">
                      No items yet — add your first item below.
                    </TableCell>
                  </TableRow>
                )}
                {/* Add row */}
                <TableRow className="bg-muted/20">
                  <TableCell>
                    <Popover open={productOpen} onOpenChange={(open) => { setProductOpen(open); if (!open) setProductSearchTerm(""); }}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          className="h-8 w-full justify-between font-normal text-sm px-2"
                        >
                          {newItem.productId
                            ? <span className="truncate text-left">{newItem.productName}</span>
                            : <span className="text-muted-foreground">Search product catalogue…</span>
                          }
                          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[480px] p-0" align="start">
                        <Command shouldFilter={false}>
                          <CommandInput
                            placeholder="Type to search products and services…"
                            value={productSearchTerm}
                            onValueChange={setProductSearchTerm}
                          />
                          <CommandList>
                            {productSearchTerm.length < 2 ? (
                              <CommandEmpty className="py-4 text-center text-sm text-muted-foreground">
                                Type at least 2 characters to search.
                              </CommandEmpty>
                            ) : productSuggestions.length === 0 ? (
                              <CommandEmpty>No products found.</CommandEmpty>
                            ) : (
                              <CommandGroup>
                                {productSuggestions.map((p) => (
                                  <CommandItem
                                    key={p.id}
                                    value={String(p.id)}
                                    onSelect={() => {
                                      setNewItem((prev) => ({
                                        ...prev,
                                        productId: p.id,
                                        productName: p.sku ? `${p.sku} ${p.name}` : p.name,
                                        productUrl: (p as any).permalink ?? "",
                                        unitPrice: p.unitPrice != null ? Number(p.unitPrice) : prev.unitPrice,
                                        notes: (p as any).description ?? "",
                                      }));
                                      setProductSearchTerm("");
                                      setProductOpen(false);
                                    }}
                                  >
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium truncate">{p.name}</span>
                                        {(p as any).isService && (
                                          <span className="text-[10px] font-semibold uppercase tracking-wide bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded shrink-0">Service</span>
                                        )}
                                      </div>
                                      {(p.sku || p.unitPrice != null) && (
                                        <div className="text-xs text-muted-foreground">
                                          {p.sku ?? ""}{p.unitPrice != null ? `${p.sku ? " · " : ""}£${Number(p.unitPrice).toFixed(2)}` : ""}
                                        </div>
                                      )}
                                    </div>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            )}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </TableCell>
                  <TableCell>
                    {newItemColours.length > 0 ? (
                      <Select
                        value={newItem.colour || "__none__"}
                        onValueChange={(v) => setNewItem((p) => ({ ...p, colour: v === "__none__" ? "" : v }))}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Select colour…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— Any colour —</SelectItem>
                          {newItemColours.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={newItem.colour}
                        onChange={(e) => setNewItem((p) => ({ ...p, colour: e.target.value }))}
                        placeholder="Colour"
                        className="h-8 text-sm"
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      value={newItem.finishName}
                      onChange={(e) => setNewItem((p) => ({ ...p, finishName: e.target.value }))}
                      placeholder="e.g. Logo Embroidery"
                      className="h-8 text-sm"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={1}
                      value={newItem.quantity}
                      onChange={(e) => setNewItem((p) => ({ ...p, quantity: parseInt(e.target.value) || 1 }))}
                      className="h-8 text-sm text-right"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={newItem.unitPrice}
                      onChange={(e) => setNewItem((p) => ({ ...p, unitPrice: parseFloat(e.target.value) || 0 }))}
                      className="h-8 text-sm text-right"
                    />
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    £{(newItem.quantity * newItem.unitPrice).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => addItem.mutate()}
                      disabled={!newItem.productId || addItem.isPending}
                      title="Add item"
                    >
                      {addItem.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    </Button>
                  </TableCell>
                </TableRow>
                {/* Finish line row (additional decoration for new item) */}
                {addFinishLine && (
                  <TableRow className="bg-amber-50/40 dark:bg-amber-950/10">
                    <TableCell colSpan={(hasColour ? 1 : 0) + (hasSize ? 1 : 0) + 2}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground pl-1 whitespace-nowrap">↳ Decoration:</span>
                        <Input
                          value={finishLine.finishName}
                          onChange={(e) => setFinishLine((p) => ({ ...p, finishName: e.target.value }))}
                          placeholder="e.g. Right Chest Name"
                          className="h-8 text-sm"
                          autoFocus
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground text-center" colSpan={3}>included in price</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost" size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => { setAddFinishLine(false); setFinishLine({ ...EMPTY_FINISH }); }}
                        title="Remove finish line"
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {/* Add finish line toggle */}
            {!addFinishLine && (
              <div className="px-4 py-2 border-t bg-muted/10">
                <button
                  type="button"
                  onClick={() => setAddFinishLine(true)}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add finish / decoration line
                </button>
              </div>
            )}

          {/* Totals */}
          {items.length > 0 && (
            <div className="border-t bg-muted/20 px-5 py-4 space-y-1.5">
              <div className="flex justify-end gap-8 text-sm">
                <span className="text-muted-foreground">Subtotal (ex VAT)</span>
                <span className="font-medium w-24 text-right">£{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-end gap-8 text-sm">
                <span className="text-muted-foreground">VAT</span>
                <span className="font-medium w-24 text-right">£{vat.toFixed(2)}</span>
              </div>
              <div className="flex justify-end gap-8 text-sm font-semibold">
                <span>Total (inc VAT)</span>
                <span className="w-24 text-right text-primary">£{total.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Share section */}
        <div className="rounded-xl border overflow-hidden">
          <div className="px-5 py-3 bg-muted/40 border-b flex items-center gap-2">
            <LinkIcon className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm">Share with Customer</h3>
          </div>
          <div className="p-5 space-y-5">
            {/* Portal link */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Portal Link</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-muted rounded-lg px-3 py-2 text-xs font-mono text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap border">
                  {portalLink}
                </div>
                <CopyButton text={portalLink} label="Copy Link" />
              </div>
              <p className="text-xs text-muted-foreground">
                Send this link to the customer. When they open it (while logged in to their portal), their order form will be pre-filled with the items above.
              </p>
            </div>

            {/* Mark as sent */}
            {quote.status === "draft" && (
              <Button onClick={markSent} variant="outline" size="sm" className="gap-2 text-blue-700 border-blue-300 hover:bg-blue-50">
                <Send className="w-3.5 h-3.5" /> Mark as Sent
              </Button>
            )}

            {/* Cover text */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Email Cover Text</Label>
                <div className="flex gap-2">
                  <CopyButton text={coverText} label="Copy Text Only" />
                  <CopyButton text={fullMessage} label="Copy Full Message" />
                </div>
              </div>
              <Textarea
                value={coverText}
                onChange={(e) => { setCoverText(e.target.value); setDirty(true); }}
                rows={12}
                className="font-mono text-xs resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Use <strong>Copy Full Message</strong> to get the cover text with the portal link automatically appended at the bottom.
              </p>
            </div>

            <Button onClick={() => saveQuote.mutate()} disabled={!dirty || saveQuote.isPending} className="gap-1.5">
              {saveQuote.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save changes
            </Button>
          </div>
        </div>
      </div>

      <SendQuoteDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        quote={{ id: quoteId, quoteNumber: quote.quoteNumber, customerName: quote.customerName ?? null, customerEmail: quote.customerEmail ?? null }}
        onSent={() => {
          setSendOpen(false);
          qc.invalidateQueries({ queryKey: ["quote", quoteId] });
          qc.invalidateQueries({ queryKey: ["quotes"] });
        }}
      />
    </Layout>
  );
}

function ItemRow({
  item,
  decorationItems,
  onDelete,
  onSave,
  onAddDecoration,
  onDeleteDecoration,
  onSaveDecoration,
}: {
  item: QuoteItem;
  decorationItems: QuoteItem[];
  onDelete: () => void;
  onSave: (data: { productName?: string; colour?: string | null; finishName?: string | null; quantity?: number; unitPrice?: number; notes?: string | null }) => void;
  onAddDecoration: () => void;
  onDeleteDecoration: (childId: number) => void;
  onSaveDecoration: (childId: number, finishName: string) => void;
}) {
  const [productName, setProductName] = useState(item.productName);
  const [colour, setColour] = useState(item.colour ?? "");
  const [finishName, setFinishName] = useState(item.finishName ?? "");
  const [quantity, setQuantity] = useState(item.quantity);
  const [unitPrice, setUnitPrice] = useState(parseFloat(item.unitPrice));
  const [notes, setNotes] = useState(item.notes ?? "");

  // Fetch variants for colour dropdown
  const { data: itemVariants = [] } = useQuery<{ colour: string | null }[]>({
    queryKey: ["product-variants", item.productId],
    queryFn: () => apiFetch(`/products/${item.productId}/variants`),
    enabled: !!item.productId,
  });
  const itemColours = [...new Set(itemVariants.map((v) => v.colour).filter(Boolean) as string[])].sort();

  const save = () => {
    onSave({ productName, colour: colour || null, finishName: finishName || null, quantity, unitPrice, notes: notes || null });
  };

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-start gap-1.5">
          {item.productSku && !item.productName.startsWith(item.productSku) && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded mt-1">
              {item.productSku}
            </span>
          )}
          <div className="flex-1 min-w-0 space-y-0.5">
            <div className="flex items-center gap-1">
              <Input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                onBlur={save}
                className="h-8 text-sm border-transparent hover:border-input focus:border-input"
              />
              {item.productUrl && (
                <a
                  href={item.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                  title="View on website"
                >
                  <LinkIcon className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={save}
              placeholder="Add description or notes…"
              rows={notes ? Math.min(3, notes.split("\n").length + (notes.length > 80 ? 1 : 0)) : 1}
              className="w-full text-xs text-muted-foreground bg-transparent border border-transparent hover:border-input focus:border-input focus:outline-none rounded px-2 py-1 resize-none leading-relaxed placeholder:text-muted-foreground/40"
            />
          </div>
        </div>
      </TableCell>
      <TableCell>
        {itemColours.length > 0 ? (
          <Select
            value={colour || "__none__"}
            onValueChange={(v) => { const c = v === "__none__" ? "" : v; setColour(c); onSave({ colour: c || null }); }}
          >
            <SelectTrigger className="h-8 text-sm border-transparent hover:border-input focus:border-input">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Any colour —</SelectItem>
              {itemColours.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={colour}
            onChange={(e) => setColour(e.target.value)}
            onBlur={save}
            placeholder="—"
            className="h-8 text-sm border-transparent hover:border-input focus:border-input"
          />
        )}
      </TableCell>
      <TableCell>
        <div className="space-y-1 py-0.5">
          <Input
            value={finishName}
            onChange={(e) => setFinishName(e.target.value)}
            onBlur={save}
            placeholder="+ Add finish…"
            className="h-8 text-sm border-transparent hover:border-input focus:border-input"
          />
          {decorationItems.map((deco) => (
            <DecorationChip
              key={deco.id}
              deco={deco}
              onDelete={() => onDeleteDecoration(deco.id)}
              onSave={(fn) => onSaveDecoration(deco.id, fn)}
            />
          ))}
          <button
            type="button"
            onClick={onAddDecoration}
            className="flex items-center gap-0.5 text-[11px] text-muted-foreground/60 hover:text-primary transition-colors pl-2"
          >
            <Plus className="w-3 h-3" /> Add decoration
          </button>
        </div>
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
          onBlur={save}
          className="h-8 text-sm text-right border-transparent hover:border-input focus:border-input"
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min={0}
          step={0.01}
          value={unitPrice}
          onChange={(e) => setUnitPrice(parseFloat(e.target.value) || 0)}
          onBlur={save}
          className="h-8 text-sm text-right border-transparent hover:border-input focus:border-input"
        />
      </TableCell>
      <TableCell className="text-right text-sm font-medium">
        £{(quantity * unitPrice).toFixed(2)}
      </TableCell>
      <TableCell>
        <Button
          variant="ghost" size="sm"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function DecorationChip({
  deco,
  onDelete,
  onSave,
}: {
  deco: QuoteItem;
  onDelete: () => void;
  onSave: (finishName: string) => void;
}) {
  const [value, setValue] = useState(deco.finishName ?? "");

  return (
    <div className="flex items-center gap-1 pl-1">
      <span className="text-muted-foreground/40 text-xs shrink-0">↳</span>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onSave(value)}
        placeholder="Decoration name…"
        className="h-7 text-xs border-transparent hover:border-input focus:border-input flex-1"
      />
      <Button
        variant="ghost" size="sm"
        className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-destructive shrink-0"
        onClick={onDelete}
        title="Remove decoration"
      >
        <X className="w-3 h-3" />
      </Button>
    </div>
  );
}
