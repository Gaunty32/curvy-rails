import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Gift, Plus, CheckCircle2, ExternalLink, Package, Calendar, ChevronLeft, ChevronRight, Upload, X, ImageIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";
import { useUpload } from "@workspace/object-storage-web";

const API_BASE = "/api";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

interface Offer {
  id: number;
  year: number;
  month: number;
  title: string;
  product_name: string;
  description: string | null;
  image_url: string | null;
  product_url: string | null;
  quantity: number;
  min_spend: string;
  is_active: boolean;
  claim_count: number;
}

interface Claim {
  id: number;
  claimed_at: string;
  order_number: string | null;
  customer_name: string | null;
  customer_display_name: string;
  offer_title: string;
  product_name: string;
  quantity: number;
}

export default function SelectExtra() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading } = useUpload({
    onSuccess: (response) => {
      const servingUrl = `/api/storage${response.objectPath}`;
      setForm(f => ({ ...f, imageUrl: servingUrl }));
      toast({ title: "Image uploaded" });
    },
    onError: (err) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [offerOpen, setOfferOpen] = useState(false);
  const [form, setForm] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    title: "",
    productName: "",
    description: "",
    imageUrl: "",
    productUrl: "",
    quantity: 1,
    minSpend: 250,
    isActive: true,
  });

  const { data: offers = [] } = useQuery<Offer[]>({
    queryKey: ["select-extra-offers"],
    queryFn: () => apiFetch("/select-extra/offers"),
  });

  const { data: claims = [], isLoading: claimsLoading } = useQuery<Claim[]>({
    queryKey: ["select-extra-claims", viewYear, viewMonth],
    queryFn: () => apiFetch(`/select-extra/claims?year=${viewYear}&month=${viewMonth}`),
  });

  const currentOffer = offers.find(o => o.year === viewYear && o.month === viewMonth) ?? null;

  // Next month relative to current view
  const nextMonthView = viewMonth === 12 ? 1 : viewMonth + 1;
  const nextYearView = viewMonth === 12 ? viewYear + 1 : viewYear;
  const nextMonthOffer = offers.find(o => o.year === nextYearView && o.month === nextMonthView) ?? null;

  // Most recent past offer — used as template for new ones
  const latestOffer = [...offers]
    .sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month))
    .find(o => o.year * 12 + o.month <= viewYear * 12 + viewMonth) ?? null;

  // Is the viewed month the real current month?
  const isCurrentRealMonth = viewYear === now.getFullYear() && viewMonth === (now.getMonth() + 1);

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) => apiFetch("/select-extra/offers", {
      method: "POST",
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["select-extra-offers"] });
      setOfferOpen(false);
      toast({ title: "Offer saved" });
    },
    onError: (e: any) => toast({ title: "Error saving offer", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/select-extra/offers/${id}/active`, { method: "PATCH" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["select-extra-offers"] });
      toast({ title: "Offer updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openNewOffer() {
    setForm({
      year: viewYear,
      month: viewMonth,
      title: `Monthly Rewards — ${MONTHS[viewMonth - 1]} ${viewYear}`,
      productName: "",
      description: "",
      imageUrl: "",
      productUrl: "",
      quantity: 1,
      minSpend: 250,
      isActive: true,
    });
    setOfferOpen(true);
  }

  function openEditOffer(offer: Offer) {
    setForm({
      year: offer.year,
      month: offer.month,
      title: offer.title,
      productName: offer.product_name,
      description: offer.description ?? "",
      imageUrl: offer.image_url ?? "",
      productUrl: offer.product_url ?? "",
      quantity: offer.quantity,
      minSpend: parseFloat(offer.min_spend),
      isActive: true,
    });
    setOfferOpen(true);
  }

  function openTemplateOffer(targetYear: number, targetMonth: number, template?: Offer | null) {
    setForm({
      year: targetYear,
      month: targetMonth,
      title: `Monthly Rewards — ${MONTHS[targetMonth - 1]} ${targetYear}`,
      productName: template?.product_name ?? "",
      description: template?.description ?? "",
      imageUrl: template?.image_url ?? "",
      productUrl: template?.product_url ?? "",
      quantity: template?.quantity ?? 1,
      minSpend: template ? parseFloat(template.min_spend) : 250,
      isActive: true,
    });
    setOfferOpen(true);
  }

  function navigateMonth(delta: number) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setViewMonth(m);
    setViewYear(y);
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
              <Gift className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Monthly Rewards</h1>
              <p className="text-sm text-muted-foreground">Monthly rewards programme for portal customers</p>
            </div>
          </div>
          {/* "Plan next month" CTA — only shown when viewing the current real month and no next-month offer exists yet */}
          {isCurrentRealMonth && !nextMonthOffer && (
            <Button onClick={() => openTemplateOffer(nextYearView, nextMonthView, latestOffer)}>
              <Plus className="w-4 h-4 mr-1.5" />
              Plan {MONTHS[nextMonthView - 1]} {nextYearView}
            </Button>
          )}
        </div>

        {/* Next-month ready notice */}
        {isCurrentRealMonth && nextMonthOffer && (
          <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 px-4 py-3 mb-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-emerald-800">
              <Calendar className="w-4 h-4 shrink-0" />
              <span>
                <strong>{MONTHS[nextMonthView - 1]} {nextYearView}</strong> offer is ready
                ({nextMonthOffer.product_name}) — it will go live automatically on the 1st.
              </span>
            </div>
            <Button size="sm" variant="outline"
              className="border-emerald-400 text-emerald-800 hover:bg-emerald-100 shrink-0"
              onClick={() => { setViewYear(nextYearView); setViewMonth(nextMonthView); }}>
              Preview
            </Button>
          </div>
        )}

        {/* Month navigator */}
        <div className="flex items-center gap-3 mb-6">
          <Button variant="outline" size="sm" onClick={() => navigateMonth(-1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-base font-semibold min-w-[140px] text-center">
            {MONTHS[viewMonth - 1]} {viewYear}
          </span>
          <Button variant="outline" size="sm" onClick={() => navigateMonth(1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        {/* Current offer panel */}
        <div className="rounded-xl border bg-card p-5 mb-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold">
                  {currentOffer ? currentOffer.title : `No offer for ${MONTHS[viewMonth - 1]} ${viewYear}`}
                </span>
                {currentOffer && (
                  <Badge variant={currentOffer.is_active ? "default" : "destructive"} className="text-xs">
                    {currentOffer.is_active ? "Live" : "Hidden"}
                  </Badge>
                )}
              </div>
              {currentOffer ? (
                <div className="space-y-0.5">
                  <p className="text-sm text-muted-foreground">
                    <Package className="w-3.5 h-3.5 inline mr-1" />
                    {currentOffer.product_name} × {currentOffer.quantity}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Min. spend: <strong>£{parseFloat(currentOffer.min_spend).toFixed(2)}</strong> (excl. VAT)
                  </p>
                  {currentOffer.description && (
                    <p className="text-xs text-muted-foreground mt-1">{currentOffer.description}</p>
                  )}
                  {currentOffer.product_url && (
                    <a href={currentOffer.product_url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-primary flex items-center gap-1 mt-1 hover:underline">
                      View product <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Create an offer to advertise a free gift to portal customers this month.</p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              {currentOffer ? (
                <>
                  <Button
                    variant="outline" size="sm"
                    disabled={toggleMutation.isPending}
                    className={currentOffer.is_active
                      ? "text-muted-foreground hover:text-destructive hover:border-destructive/50"
                      : "text-emerald-700 border-emerald-300 hover:bg-emerald-50"}
                    onClick={() => toggleMutation.mutate(currentOffer.id)}
                    title={currentOffer.is_active ? "Emergency hide — removes offer from portal immediately" : "Re-enable — offer goes live on portal"}
                  >
                    {currentOffer.is_active ? "Hide" : "Re-enable"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEditOffer(currentOffer)}>
                    Edit
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={openNewOffer}>
                  <Plus className="w-4 h-4 mr-1.5" /> Create offer
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Claims table */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Claims</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {claimsLoading ? "Loading…" : `${claims.length} customer${claims.length !== 1 ? "s" : ""} claimed this month`}
              </p>
            </div>
            {currentOffer && (
              <Badge variant="secondary" className="text-xs">
                {currentOffer.claim_count} / portal customers
              </Badge>
            )}
          </div>

          {claims.length === 0 && !claimsLoading ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              <Gift className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
              No claims yet for {MONTHS[viewMonth - 1]} {viewYear}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Gift</TableHead>
                  <TableHead>Claimed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.map(claim => (
                  <TableRow key={claim.id}>
                    <TableCell className="font-medium">{claim.customer_display_name}</TableCell>
                    <TableCell>
                      {claim.order_number
                        ? <span className="font-mono text-sm">{claim.order_number}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">{claim.product_name} × {claim.quantity}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(claim.claimed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* All offers history */}
        {offers.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">All Offers</h3>
            <div className="space-y-2">
              {offers.map(offer => {
                const offerKey = offer.year * 12 + offer.month;
                const nowKey = now.getFullYear() * 12 + (now.getMonth() + 1);
                const isPast = offerKey < nowKey;
                const isFuture = offerKey > nowKey;
                const statusLabel = isPast
                  ? "Expired"
                  : isFuture
                    ? (offer.is_active ? "Ready" : "Hidden")
                    : (offer.is_active ? "Live" : "Hidden");
                const statusVariant: "default" | "secondary" | "outline" | "destructive" =
                  isPast ? "secondary"
                  : isFuture ? "outline"
                  : offer.is_active ? "default" : "destructive";

                return (
                  <div
                    key={offer.id}
                    className="rounded-lg border bg-card px-4 py-3 flex items-center justify-between gap-3"
                  >
                    <button
                      className="flex-1 min-w-0 text-left flex items-center gap-3"
                      onClick={() => { setViewYear(offer.year); setViewMonth(offer.month); }}
                    >
                      <div className="min-w-0">
                        <span className="text-sm font-medium">{MONTHS[offer.month - 1]} {offer.year}</span>
                        <span className="text-xs text-muted-foreground ml-2 truncate">{offer.product_name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">{offer.claim_count} claims</span>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={statusVariant} className={`text-xs ${isFuture && offer.is_active ? "border-emerald-400 text-emerald-700" : ""}`}>
                        {statusLabel}
                      </Badge>
                      {!isPast && (
                        <Button
                          variant="ghost" size="sm"
                          className={`h-7 px-2 text-xs ${offer.is_active ? "text-muted-foreground hover:text-destructive" : "text-emerald-700 hover:text-emerald-900"}`}
                          disabled={toggleMutation.isPending}
                          onClick={() => toggleMutation.mutate(offer.id)}
                          title={offer.is_active ? "Hide from portal" : "Re-enable on portal"}
                        >
                          {offer.is_active ? "Hide" : "Re-enable"}
                        </Button>
                      )}
                      {isPast && (
                        <Button
                          variant="ghost" size="sm"
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-amber-700"
                          onClick={() => openTemplateOffer(nextYearView, nextMonthView, offer)}
                          title={`Use ${MONTHS[offer.month - 1]} offer as template for ${MONTHS[nextMonthView - 1]} ${nextYearView}`}
                        >
                          Use as template
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Create / Edit offer dialog */}
      <Dialog open={offerOpen} onOpenChange={setOfferOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {offers.find(o => o.year === form.year && o.month === form.month) ? "Edit Offer" : "Create Offer"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Month</Label>
                <select
                  className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.month}
                   onChange={e => setForm(f => ({ ...f, month: Number(e.target.value), title: `Monthly Rewards — ${MONTHS[Number(e.target.value) - 1]} ${form.year}` }))}
                >
                  {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div>
                <Label>Year</Label>
                <Input type="number" value={form.year} min={2024} max={2035}
                   onChange={e => setForm(f => ({ ...f, year: Number(e.target.value), title: `Monthly Rewards — ${MONTHS[form.month - 1]} ${e.target.value}` }))} />
              </div>
            </div>
            <div>
              <Label>Offer title</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Product name</Label>
              <Input value={form.productName} onChange={e => setForm(f => ({ ...f, productName: e.target.value }))} className="mt-1"
                placeholder="e.g. 12× Handled Aluminium Water Bottle" />
            </div>
            <div>
              <Label>Description (shown to customers)</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="mt-1" rows={3} />
            </div>
            {/* Image upload */}
            <div>
              <Label>Product image (optional)</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) await uploadFile(file);
                  e.target.value = "";
                }}
              />
              {form.imageUrl ? (
                <div className="mt-1 flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
                  <img src={form.imageUrl} alt="Product" className="w-12 h-12 object-contain rounded shrink-0 bg-white border" />
                  <span className="flex-1 text-xs text-muted-foreground truncate">{form.imageUrl}</span>
                  <Button
                    type="button" size="sm" variant="ghost"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => setForm(f => ({ ...f, imageUrl: "" }))}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="mt-1 flex gap-2">
                  <Button
                    type="button" variant="outline" size="sm"
                    className="gap-1.5" disabled={isUploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {isUploading ? "Uploading…" : "Upload file"}
                  </Button>
                  <div className="relative flex-1">
                    <ImageIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      value={form.imageUrl}
                      onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))}
                      placeholder="or paste image URL…"
                      className="pl-8 text-sm"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Quantity included</Label>
                <Input type="number" value={form.quantity} min={1}
                  onChange={e => setForm(f => ({ ...f, quantity: Number(e.target.value) }))} className="mt-1" />
              </div>
              <div>
                <Label>Min. spend (£ excl. VAT)</Label>
                <Input type="number" value={form.minSpend} min={1} step={0.01}
                  onChange={e => setForm(f => ({ ...f, minSpend: Number(e.target.value) }))} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Product URL (optional)</Label>
              <Input value={form.productUrl} onChange={e => setForm(f => ({ ...f, productUrl: e.target.value }))} className="mt-1"
                placeholder="https://…" />
            </div>
            <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
              This offer will go live automatically on the 1st of the selected month and expire at the end of that month.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOfferOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending || !form.productName || !form.title}>
              Save offer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
