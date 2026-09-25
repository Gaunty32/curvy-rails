import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { UploadedImage } from "@/components/UploadedImage";
import { KitDesignerText } from "@/components/KitDesignerText";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn, toTitleCase } from "@/lib/utils";
import { sortSizesWithOrder, sortBySizeWithOrder } from "@/lib/sizeUtils";
import { useSizeOrder } from "@/hooks/useSizeOrder";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Edit2, Trash2, Loader2, X, Building2, MapPin, Users, History, Layers, Shirt, UserCheck, Boxes, PoundSterling, ShoppingBag, Check, ChevronsUpDown, Palette, Ruler, Sparkles, TrendingUp, AlertCircle, ImageIcon, Upload, Eye, Globe, Copy, CheckCircle2, LogIn, UserX, CreditCard, Phone, Package, Tag, ChevronDown, ChevronRight, Smartphone, BookOpen, Camera, FileText, FileSpreadsheet, Warehouse, Mail, Search, FolderOpen } from "lucide-react";
import { ImportSpreadsheetDialog } from "@/components/ImportSpreadsheetDialog";
import { FileDropZone, FileDropZoneContent } from "@/components/FileDropZone";

function formatUKPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("07")) return `${d.slice(0,5)} ${d.slice(5,8)} ${d.slice(8)}`;
  if (d.length === 11 && d.startsWith("01")) return `${d.slice(0,5)} ${d.slice(5)}`;
  if (d.length === 11 && d.startsWith("02")) return `${d.slice(0,3)} ${d.slice(3,7)} ${d.slice(7)}`;
  if (d.length === 11 && d.startsWith("03")) return `${d.slice(0,4)} ${d.slice(4,7)} ${d.slice(7)}`;
  return raw;
}
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { formatCurrency, formatDate } from "@/lib/utils";
import { pdfToJpegBlob } from "@/lib/pdf-thumbnail";
import { useGetCustomer, useListProducts, useCreateOrder, getGetCustomerQueryKey } from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { Link } from "wouter";

const API_BASE = "/api";


async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `HTTP ${res.status}`;
    try { const j = JSON.parse(text); if (j?.error) message = j.error; } catch {}
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

function useSubResource<T>(customerId: number | null, key: string) {
  return useQuery<T[]>({
    queryKey: ["customer", customerId, key],
    queryFn: () => apiFetch(`/customers/${customerId}/${key}`),
    enabled: !!customerId,
    staleTime: 1000 * 60 * 5,
  });
}

function SubTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <Table>{children}</Table>
    </div>
  );
}

function EmptyState({ icon: Icon, label, onAdd }: { icon: React.ElementType; label: string; onAdd: () => void }) {
  return (
    <div className="py-12 text-center text-muted-foreground">
      <Icon className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
      <p className="text-sm">No {label} yet</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onAdd}>
        <Plus className="w-3 h-3 mr-1" /> Add {label}
      </Button>
    </div>
  );
}

// ─── Delivery Addresses Tab ───────────────────────────────────────────────────

function AddressesTab({ customerId, customer }: { customerId: number; customer: any }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: addresses, isLoading } = useQuery<any[]>({
    queryKey: ["customer", customerId, "addresses"],
    queryFn: () => apiFetch(`/customers/${customerId}/addresses`),
  });
  const { data: invoiceAddresses = [] } = useQuery<any[]>({
    queryKey: ["customer", customerId, "invoice-addresses"],
    queryFn: () => apiFetch(`/customers/${customerId}/invoice-addresses`),
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const blank = { label: "", line1: "", line2: "", city: "", postcode: "", country: "United Kingdom", notes: "", invoiceAddressId: null as number | null };
  const [form, setForm] = useState(blank);

  const inv = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "addresses"] });

  const save = useMutation({
    mutationFn: (data: any) => editing
      ? apiFetch(`/customers/${customerId}/addresses/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch(`/customers/${customerId}/addresses`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { inv(); toast({ title: "Saved" }); setOpen(false); setEditing(null); },
    onError: () => toast({ title: "Error", description: "Could not save address", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/addresses/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Deleted" }); },
  });

  const openAdd = () => { setForm(blank); setEditing(null); setOpen(true); };
  const openEdit = (a: any) => {
    setForm({ label: a.label||"", line1: a.line1||"", line2: a.line2||"", city: a.city||"", postcode: a.postcode||"", country: a.country||"United Kingdom", notes: a.notes||"", invoiceAddressId: a.invoiceAddressId ?? null });
    setEditing(a);
    setOpen(true);
  };

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Address</Button>
      </div>
      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        : !addresses?.length ? <EmptyState icon={MapPin} label="delivery addresses" onAdd={openAdd} />
        : <SubTable>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>Label</TableHead>
            <TableHead>Address</TableHead>
            <TableHead className="hidden md:table-cell">City</TableHead>
            <TableHead className="hidden md:table-cell">Postcode</TableHead>
            <TableHead className="hidden lg:table-cell">Invoice Address</TableHead>
            <TableHead className="w-20 text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {addresses.map((a: any) => (
              <TableRow key={a.id} className="group hover:bg-muted/30">
                <TableCell className="font-medium">{a.label || '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{[a.line1, a.line2].filter(Boolean).join(', ') || '—'}</TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{a.city || '—'}</TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{a.postcode || '—'}</TableCell>
                <TableCell className="hidden lg:table-cell text-sm">
                  {a.invoiceAddress
                    ? <span className="flex items-center gap-1.5">
                        <FileText className="w-3 h-3 text-primary shrink-0" />
                        <span className="font-medium text-foreground">{a.invoiceAddress.label || a.invoiceAddress.name || [a.invoiceAddress.address, a.invoiceAddress.city].filter(Boolean).join(', ')}</span>
                      </span>
                    : <span className="text-muted-foreground/40 italic text-xs">Not set</span>}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(a)}><Edit2 className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Delete this address?") && del.mutate(a.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </SubTable>}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader><DialogTitle>{editing ? "Edit Address" : "Add Delivery Address"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2"><Label>Label (e.g. Warehouse, Head Office)</Label>
              <Input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Address Line 1</Label>
              <Input value={form.line1} onChange={e => setForm({ ...form, line1: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Address Line 2</Label>
              <Input value={form.line2} onChange={e => setForm({ ...form, line2: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2"><Label>City</Label><Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Postcode</Label><Input value={form.postcode} onChange={e => setForm({ ...form, postcode: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Country</Label><Input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} /></div>
            </div>
            <div className="grid gap-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="grid gap-2">
              <Label>Invoice Address</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={form.invoiceAddressId != null ? String(form.invoiceAddressId) : ""}
                onChange={e => setForm({ ...form, invoiceAddressId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">— None —</option>
                {(invoiceAddresses as any[]).map((ia: any) => (
                  <option key={ia.id} value={ia.id}>
                    {[ia.label, ia.name, [ia.address, ia.city, ia.postcode].filter(Boolean).join(', ')].filter(Boolean).join(' — ')}
                  </option>
                ))}
              </select>
              {(invoiceAddresses as any[]).length === 0 && (
                <p className="text-xs text-muted-foreground">No invoice addresses set up yet. Add them in the Invoice Addresses tab first.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Invoice Addresses Tab ────────────────────────────────────────────────────

function InvoiceAddressesTab({ customerId, customer }: { customerId: number; customer: any }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: addresses, isLoading } = useQuery<any[]>({
    queryKey: ["customer", customerId, "invoice-addresses"],
    queryFn: () => apiFetch(`/customers/${customerId}/invoice-addresses`),
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const blank = { label: "", name: "", address: "", line2: "", city: "", postcode: "", billingEmail: "" };
  const [form, setForm] = useState(blank);

  const inv = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "invoice-addresses"] });

  const save = useMutation({
    mutationFn: (data: any) => editing
      ? apiFetch(`/customers/${customerId}/invoice-addresses/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch(`/customers/${customerId}/invoice-addresses`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { inv(); toast({ title: "Saved" }); setOpen(false); setEditing(null); },
    onError: () => toast({ title: "Error", description: "Could not save invoice address", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/invoice-addresses/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Deleted" }); },
  });

  const openAdd = () => {
    setForm({ label: "", name: customer?.invoiceName || customer?.name || "", address: customer?.invoiceAddress || customer?.address || "", line2: "", city: customer?.invoiceCity || customer?.city || "", postcode: customer?.invoicePostcode || customer?.postcode || "", billingEmail: customer?.billingEmail || customer?.email || "" });
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (a: any) => {
    setForm({ label: a.label || "", name: a.name || "", address: a.address || "", line2: a.line2 || "", city: a.city || "", postcode: a.postcode || "", billingEmail: a.billingEmail || "" });
    setEditing(a);
    setOpen(true);
  };

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Invoice Address</Button>
      </div>
      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        : !addresses?.length
          ? <EmptyState icon={FileText} label="invoice addresses" onAdd={openAdd} />
          : <SubTable>
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead>Label</TableHead>
              <TableHead>Invoice Name</TableHead>
              <TableHead>Address</TableHead>
              <TableHead className="hidden md:table-cell">Billing Email</TableHead>
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {addresses.map((a: any) => (
                <TableRow key={a.id} className="group hover:bg-muted/30">
                  <TableCell className="font-medium">{a.label || '—'}</TableCell>
                  <TableCell className="text-sm">{a.name || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{[a.address, a.city, a.postcode].filter(Boolean).join(', ') || '—'}</TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{a.billingEmail || '—'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(a)}><Edit2 className="w-3 h-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Delete this invoice address?") && del.mutate(a.id)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </SubTable>}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader><DialogTitle>{editing ? "Edit Invoice Address" : "Add Invoice Address"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2"><Label>Label (e.g. Accounts, Group Finance)</Label>
              <Input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Invoice Account Name</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Name as it should appear on invoice" /></div>
            <div className="grid gap-2"><Label>Address Line 1</Label>
              <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Address Line 2</Label>
              <Input value={form.line2} onChange={e => setForm({ ...form, line2: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>City</Label><Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Postcode</Label><Input value={form.postcode} onChange={e => setForm({ ...form, postcode: e.target.value })} /></div>
            </div>
            <div className="grid gap-2"><Label>Billing Email</Label>
              <Input type="email" value={form.billingEmail} onChange={e => setForm({ ...form, billingEmail: e.target.value })} placeholder="accounts@company.com" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Contacts Tab ─────────────────────────────────────────────────────────────

function ContactsTab({ customerId, customer }: { customerId: number; customer: any }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: contacts, isLoading } = useSubResource<any>(customerId, "contacts");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const blank = { firstName: "", lastName: "", jobTitle: "", email: "", phone: "", notes: "" };
  const [form, setForm] = useState(blank);

  const inv = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "contacts"] });

  const save = useMutation({
    mutationFn: (data: any) => editing
      ? apiFetch(`/customers/${customerId}/contacts/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch(`/customers/${customerId}/contacts`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { inv(); toast({ title: "Saved" }); setOpen(false); setEditing(null); },
    onError: () => toast({ title: "Error", description: "Could not save contact", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/contacts/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Deleted" }); },
  });

  const openAdd = () => {
    setForm({
      firstName: customer?.contactFirstName || "",
      lastName: customer?.contactLastName || "",
      jobTitle: "",
      email: customer?.email || "",
      phone: customer?.phone || "",
      notes: "",
    });
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (c: any) => { setForm({ firstName: c.firstName||"", lastName: c.lastName||"", jobTitle: c.jobTitle||"", email: c.email||"", phone: c.phone||"", notes: c.notes||"" }); setEditing(c); setOpen(true); };

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Contact</Button>
      </div>
      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        : !contacts?.length ? <EmptyState icon={Users} label="contacts" onAdd={openAdd} />
        : <SubTable>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Job Title</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="hidden md:table-cell">Phone</TableHead>
            <TableHead className="w-20 text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {contacts.map((c: any) => (
              <TableRow key={c.id} className="group hover:bg-muted/30">
                <TableCell className="font-medium">{toTitleCase([c.firstName, c.lastName].filter(Boolean).join(' '))}</TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{c.jobTitle || '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.email?.toLowerCase() || '—'}</TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                  {c.phone ? (
                    <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="flex items-center gap-1 hover:text-primary transition-colors">
                      <Phone className="w-3 h-3 shrink-0" /> {formatUKPhone(c.phone)}
                    </a>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(c)}><Edit2 className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Delete this contact?") && del.mutate(c.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </SubTable>}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader><DialogTitle>{editing ? "Edit Contact" : "Add Contact"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>First Name *</Label><Input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Last Name</Label><Input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} /></div>
            </div>
            <div className="grid gap-2"><Label>Job Title</Label><Input value={form.jobTitle} onChange={e => setForm({ ...form, jobTitle: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div className="grid gap-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.firstName}>{save.isPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Order History Tab ────────────────────────────────────────────────────────

function OrderHistoryTab({ customerId }: { customerId: number }) {
  const { data: orders, isLoading } = useSubResource<any>(customerId, "orders");

  const statusColour: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700",
    confirmed: "bg-blue-100 text-blue-700",
    in_production: "bg-yellow-100 text-yellow-700",
    dispatched: "bg-purple-100 text-purple-700",
    delivered: "bg-green-100 text-green-700",
    cancelled: "bg-red-100 text-red-700",
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  if (!orders?.length) return (
    <div className="py-12 text-center text-muted-foreground">
      <History className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
      <p className="text-sm">No orders found for this customer</p>
    </div>
  );

  return (
    <SubTable>
      <TableHeader><TableRow className="hover:bg-transparent">
        <TableHead>Order</TableHead>
        <TableHead>Date</TableHead>
        <TableHead>Status</TableHead>
        <TableHead className="text-right">Total</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {orders.map((o: any) => (
          <TableRow key={o.id} className="hover:bg-muted/30">
            <TableCell>
              <Link href={`/orders/${o.id}`} className="text-primary hover:underline font-medium">{o.orderNumber}</Link>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{formatDate(o.createdAt)}</TableCell>
            <TableCell>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium tracking-wide ${statusColour[o.status] || statusColour.draft}`}>
                {o.status ? (o.status.replace(/_/g, ' ').charAt(0).toUpperCase() + o.status.replace(/_/g, ' ').slice(1).toLowerCase()) : ''}
              </span>
            </TableCell>
            <TableCell className="text-right font-medium">{formatCurrency(o.totalAmount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </SubTable>
  );
}

// ─── Processes Tab ────────────────────────────────────────────────────────────

const PROCESS_TYPES = ["embroidery", "print", "DTF", "other"] as const;
const PROCESS_TYPE_LABELS: Record<string, string> = { embroidery: "Embroidery", print: "Print", DTF: "DTF", other: "Other" };

interface ProcessStockItem { id: number; name: string; sku: string | null; unitCost: number; supplierId: number | null; stockQuantity: number; }

const blankDtf = { supplierId: "", sku: "", orderQty: "0", stockQty: "0" };

function ProcessesTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: processes, isLoading } = useSubResource<any>(customerId, "processes");
  const { data: allProcessStock } = useQuery<ProcessStockItem[]>({
    queryKey: ["process-stock", "customer", customerId],
    queryFn: () => apiFetch(`/process-stock?customerId=${customerId}`),
  });
  const { data: suppliers } = useQuery<any[]>({
    queryKey: ["suppliers"],
    queryFn: () => apiFetch("/suppliers"),
  });
  const [isFetchingSku, setIsFetchingSku] = useState(false);

  const fetchAndSetSku = async () => {
    setIsFetchingSku(true);
    try {
      const { sku } = await apiFetch<{ sku: string }>("/process-stock/suggest-sku");
      setDtfForm(f => ({ ...f, sku }));
    } catch {
      // leave blank, server will generate on save
    } finally {
      setIsFetchingSku(false);
    }
  };
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const blank = { name: "", type: "", placement: "Left Chest", price: "", processStockId: "", imageUrl: "", fileUrl: "", notes: "" };
  const [form, setForm] = useState(blank);
  const [dtfForm, setDtfForm] = useState(blankDtf);
  const [isSaving, setIsSaving] = useState(false);

  const { uploadFile: uploadThumbnail, isUploading: isUploadingThumb } = useUpload({
    onSuccess: (res) => setForm(f => ({ ...f, imageUrl: `/api/storage${res.objectPath}` })),
    onError: () => toast({ title: "Upload failed", description: "Could not upload image", variant: "destructive" }),
  });
  const { uploadFile: uploadOriginal, isUploading: isUploadingOriginal } = useUpload({
    onSuccess: (res) => setForm(f => ({ ...f, fileUrl: `/api/storage${res.objectPath}` })),
    onError: () => {},
  });
  const isUploading = isUploadingThumb || isUploadingOriginal;

  const handleProcessImageUpload = async (file: File) => {
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      try {
        toast({ title: "Generating preview…", description: "Converting PDF to image" });
        const [jpegBlob] = await Promise.all([
          pdfToJpegBlob(file),
          uploadOriginal(file),
        ]);
        const jpegFile = new File([jpegBlob], file.name.replace(/\.pdf$/i, ".jpg"), { type: "image/jpeg" });
        await uploadThumbnail(jpegFile);
        toast({ title: "PDF uploaded with preview" });
      } catch {
        toast({ title: "PDF upload failed", description: "Could not process this PDF", variant: "destructive" });
      }
    } else {
      setForm(f => ({ ...f, fileUrl: "" }));
      await uploadThumbnail(file);
      toast({ title: "Image uploaded" });
    }
  };

  const invStock = () => qc.invalidateQueries({ queryKey: ["process-stock", "customer", customerId] });
  const inv = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "processes"] });
  const invPO = () => qc.invalidateQueries({ queryKey: ["purchase-orders"] });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/processes/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Deleted" }); },
  });

  const typeColour: Record<string, string> = { embroidery: "bg-purple-100 text-purple-700", print: "bg-blue-100 text-blue-700", other: "bg-gray-100 text-gray-700" };

  const openAdd = () => { setForm(blank); setDtfForm(blankDtf); setEditing(null); setOpen(true); };
  const openEdit = (p: any) => {
    setForm({
      name: p.name || "",
      type: p.type || "",
      placement: p.placement || "",
      price: p.price != null ? String(p.price) : "",
      processStockId: p.processStockId != null ? String(p.processStockId) : "",
      imageUrl: p.imageUrl || "",
      fileUrl: p.fileUrl || "",
      notes: p.notes || "",
    });
    if (p.type === "DTF" && p.processStockId && allProcessStock) {
      const stockItem = allProcessStock.find((s: ProcessStockItem) => s.id === p.processStockId);
      setDtfForm(stockItem ? {
        supplierId: stockItem.supplierId != null ? String(stockItem.supplierId) : "",
        sku: stockItem.sku || "",
        orderQty: "0",
        stockQty: String(stockItem.stockQuantity ?? 0),
      } : blankDtf);
    } else {
      setDtfForm(blankDtf);
    }
    setEditing(p);
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.type || isSaving) return;
    setIsSaving(true);
    try {
      let stockId: number | null = form.processStockId ? parseInt(form.processStockId, 10) : null;

      if (form.type === "DTF") {
        const stockPayload = {
          name: form.name.trim(),
          sku: dtfForm.sku.trim() || null,
          supplierId: dtfForm.supplierId ? parseInt(dtfForm.supplierId, 10) : null,
          stockQuantity: parseInt(dtfForm.stockQty || "0", 10),
          customerId,
        };
        if (stockId) {
          await apiFetch(`/process-stock/${stockId}`, { method: "PATCH", body: JSON.stringify(stockPayload) });
        } else {
          const newStock = await apiFetch("/process-stock", { method: "POST", body: JSON.stringify(stockPayload) });
          stockId = newStock.id;
        }
        const orderQty = parseInt(dtfForm.orderQty || "0", 10);
        if (orderQty > 0) {
          const supplier = suppliers?.find((s: any) => s.id === parseInt(dtfForm.supplierId || "0", 10));
          await apiFetch("/purchasing/purchase-orders/for-process-stock", {
            method: "POST",
            body: JSON.stringify({
              supplierId: dtfForm.supplierId ? parseInt(dtfForm.supplierId, 10) : null,
              supplierName: supplier?.name || "Unknown Supplier",
              supplierEmail: supplier?.email || null,
              notes: `Process stock reorder: ${form.name.trim()}`,
              items: [{
                productName: form.name.trim(),
                supplierCode: dtfForm.sku.trim() || null,
                quantityOrdered: orderQty,
              }],
            }),
          });
          invPO();
        }
      }

      const processPayload = {
        name: form.name,
        type: form.type || null,
        placement: form.placement || null,
        price: form.price ? parseFloat(form.price) : null,
        processStockId: stockId,
        imageUrl: form.imageUrl || null,
        fileUrl: form.fileUrl || null,
        notes: form.notes || null,
      };
      await (editing
        ? apiFetch(`/customers/${customerId}/processes/${editing.id}`, { method: "PATCH", body: JSON.stringify(processPayload) })
        : apiFetch(`/customers/${customerId}/processes`, { method: "POST", body: JSON.stringify(processPayload) })
      );

      inv();
      invStock();
      const orderQty = parseInt(dtfForm.orderQty || "0", 10);
      toast({
        title: "Saved",
        description: form.type === "DTF" && orderQty > 0 ? "Draft purchase order created in Purchasing." : undefined,
      });
      setOpen(false);
      setEditing(null);
    } catch (e: any) {
      toast({ title: "Error saving process", description: e.message || "Could not save process", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const getStockName = (id: number | null) => {
    if (!id || !allProcessStock) return null;
    const s = allProcessStock.find(s => s.id === id);
    if (!s) return null;
    return s.sku ? `${s.sku} — ${s.name}` : s.name;
  };

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Process</Button>
      </div>
      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        : !processes?.length ? <EmptyState icon={Layers} label="processes" onAdd={openAdd} />
        : <SubTable>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead className="w-20">Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="hidden md:table-cell">Placement</TableHead>
            <TableHead className="hidden lg:table-cell">Process Stock</TableHead>
            <TableHead className="hidden md:table-cell w-24 text-right">Price</TableHead>
            <TableHead className="w-12">Image</TableHead>
            <TableHead className="w-20 text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {processes.map((p: any) => (
              <TableRow key={p.id} className="group hover:bg-muted/30">
                <TableCell>
                  {p.code && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded font-mono text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                      {p.code}
                    </span>
                  )}
                </TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>
                  {p.type && <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${typeColour[p.type] || typeColour.other}`}>{p.type}</span>}
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{p.placement || '—'}</TableCell>
                <TableCell className="hidden lg:table-cell">
                  {p.processStockId ? (
                    <span className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                      <Boxes className="w-3 h-3" />{getStockName(p.processStockId) ?? `#${p.processStockId}`}
                    </span>
                  ) : <span className="text-muted-foreground text-sm">—</span>}
                </TableCell>
                <TableCell className="hidden md:table-cell text-right text-sm font-medium">
                  {p.price != null ? `£${parseFloat(p.price).toFixed(2)}` : <span className="text-muted-foreground/40">—</span>}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    {p.imageUrl ? (
                      <HoverCard openDelay={200} closeDelay={100}>
                        <HoverCardTrigger asChild>
                          <a href={p.imageUrl} target="_blank" rel="noopener noreferrer">
                            <UploadedImage
                              src={p.imageUrl}
                              alt={p.name}
                              className="w-10 h-10 object-contain bg-white rounded border border-border hover:border-primary/50 transition-all p-0.5 cursor-zoom-in"
                              fallback={
                                <span className="flex flex-col items-center gap-0.5 text-amber-600 hover:text-amber-700 transition-colors">
                                  <FileText className="w-5 h-5" />
                                  <span className="text-[9px] font-medium">View</span>
                                </span>
                              }
                            />
                          </a>
                        </HoverCardTrigger>
                        <HoverCardContent side="right" align="start" className="w-auto p-2">
                          <UploadedImage
                            src={p.imageUrl}
                            alt={p.name}
                            className="max-w-[240px] max-h-[240px] object-contain rounded"
                            fallback={<span className="text-xs text-muted-foreground">Preview unavailable</span>}
                          />
                        </HoverCardContent>
                      </HoverCard>
                    ) : (
                      <span className="text-muted-foreground/30"><ImageIcon className="w-4 h-4" /></span>
                    )}
                    {p.fileUrl && (
                      <HoverCard openDelay={200} closeDelay={100}>
                        <HoverCardTrigger asChild>
                          <a href={p.fileUrl} target="_blank" rel="noopener noreferrer">
                            <span className="flex flex-col items-center gap-0.5 text-blue-500 hover:text-blue-700 transition-colors">
                              <FileText className="w-4 h-4" />
                              <span className="text-[9px] font-medium">PDF</span>
                            </span>
                          </a>
                        </HoverCardTrigger>
                        <HoverCardContent side="right" align="start" className="w-auto p-0 overflow-hidden">
                          <iframe
                            src={`${p.fileUrl}#toolbar=0&navpanes=0&view=FitH`}
                            className="w-64 h-80 border-0 rounded"
                            title={`${p.name} PDF preview`}
                          />
                        </HoverCardContent>
                      </HoverCard>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(p)}><Edit2 className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Delete this process?") && del.mutate(p.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </SubTable>}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editing ? "Edit Process" : "Add Process"}
              {editing?.code && (
                <span className="inline-flex items-center px-2 py-0.5 rounded font-mono text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  {editing.code}
                </span>
              )}
              {!editing && (
                <span className="text-xs font-normal text-muted-foreground">Code will be assigned on save</span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2"><Label>Name *</Label>
              <Input placeholder="e.g. Left Chest Embroidery Logo" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Type <span className="text-destructive">*</span></Label>
                <Select value={form.type || ""} onValueChange={v => {
                  setForm(f => ({ ...f, type: v, processStockId: v === "DTF" ? f.processStockId : "" }));
                  if (v === "DTF" && !editing) {
                    const raptor = suppliers?.find((s: any) => s.name.toLowerCase().includes("raptor"));
                    setDtfForm({ ...blankDtf, supplierId: raptor ? String(raptor.id) : "" });
                    fetchAndSetSku();
                  }
                }}>
                  <SelectTrigger className={!form.type ? "border-destructive focus:ring-destructive" : ""}><SelectValue placeholder="Select type…" /></SelectTrigger>
                  <SelectContent>
                    {PROCESS_TYPES.map(t => <SelectItem key={t} value={t}>{PROCESS_TYPE_LABELS[t] ?? t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Placement</Label>
                {(() => {
                  const placements = ["Left Chest", "Right Chest", "Centre Chest", "Full Back", "Top Back", "Left Sleeve", "Right Sleeve", "Hood", "Cap Front", "Collar", "Cuff"];
                  const isCustom = form.placement && !placements.includes(form.placement);
                  return (
                    <div className="space-y-1.5">
                      <Select value={isCustom ? "__custom__" : (form.placement || "none")} onValueChange={v => {
                        if (v === "none") setForm(f => ({ ...f, placement: "" }));
                        else if (v !== "__custom__") setForm(f => ({ ...f, placement: v }));
                      }}>
                        <SelectTrigger className="text-sm"><SelectValue placeholder="Select placement…" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {placements.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                          {isCustom && <SelectItem value="__custom__">{form.placement} (custom)</SelectItem>}
                          <SelectItem value="__custom__">Other…</SelectItem>
                        </SelectContent>
                      </Select>
                      {(isCustom || form.placement === "__custom__") && (
                        <Input
                          autoFocus
                          placeholder="e.g. Lower Back"
                          value={form.placement === "__custom__" ? "" : form.placement}
                          onChange={e => setForm(f => ({ ...f, placement: e.target.value }))}
                          className="text-sm"
                        />
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Price per unit <span className="text-muted-foreground font-normal">(£, optional)</span></Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  className="pl-7"
                  value={form.price}
                  onChange={e => setForm({ ...form, price: e.target.value })}
                />
              </div>
            </div>
            {form.type === "DTF" && (
              <div className="rounded-md border border-amber-200 bg-amber-50/40 p-3 grid gap-3">
                <div className="text-xs font-semibold text-amber-800 uppercase tracking-wide flex items-center gap-1.5">
                  <Boxes className="w-3 h-3" /> DTF Stock Details
                  {form.processStockId && (() => {
                    const s = allProcessStock?.find(x => x.id === parseInt(form.processStockId));
                    return s ? (
                      <span className={cn("ml-auto font-normal text-[11px] px-1.5 py-0.5 rounded-full", s.stockQuantity === 0 ? "bg-amber-200 text-amber-800" : "bg-green-100 text-green-700")}>
                        {s.stockQuantity === 0 ? "⚠ No stock" : `${s.stockQuantity} in stock`}
                      </span>
                    ) : null;
                  })()}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Supplier</Label>
                    <Select value={dtfForm.supplierId || "none"} onValueChange={v => setDtfForm(f => ({ ...f, supplierId: v === "none" ? "" : v }))}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select supplier" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No supplier</SelectItem>
                        {suppliers?.map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Product Code (SKU)</Label>
                    <div className="relative">
                      <Input className="h-8 text-sm font-mono" placeholder={isFetchingSku ? "Fetching…" : "e.g. PS0005"}
                        value={dtfForm.sku} onChange={e => setDtfForm(f => ({ ...f, sku: e.target.value }))}
                        disabled={isFetchingSku} />
                      {isFetchingSku && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label className="text-xs flex items-center gap-1"><Boxes className="w-3 h-3" /> Stock Available Qty</Label>
                    <Input className="h-8 text-sm" type="number" min="0" step="1" placeholder="0"
                      value={dtfForm.stockQty} onChange={e => setDtfForm(f => ({ ...f, stockQty: e.target.value }))} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs flex items-center gap-1"><ShoppingBag className="w-3 h-3" /> Draft PO Qty <span className="font-normal text-muted-foreground">(0 = skip)</span></Label>
                    <Input className="h-8 text-sm" type="number" min="0" step="1" placeholder="0"
                      value={dtfForm.orderQty} onChange={e => setDtfForm(f => ({ ...f, orderQty: e.target.value }))} />
                  </div>
                </div>
              </div>
            )}
            <div className="grid gap-2">
              <Label className="flex items-center gap-1"><ImageIcon className="w-3 h-3" /> Reference Image</Label>
              {form.imageUrl ? (
                <div className="relative group w-full">
                  <UploadedImage
                    src={form.imageUrl}
                    alt="Process reference"
                    className="w-full h-36 object-contain rounded-md border border-border bg-muted/30"
                    fallback={
                      <div className="w-full h-36 rounded-md border border-amber-200 bg-amber-50/60 flex flex-col items-center justify-center gap-2 text-amber-700">
                        <FileText className="w-10 h-10 text-amber-500" />
                        <span className="text-xs font-medium">File stored – not an image</span>
                        <a href={form.imageUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline text-amber-600 hover:text-amber-800">Open file ↗</a>
                      </div>
                    }
                  />
                  {/* Original PDF download link — shown below the preview when available */}
                  {form.fileUrl && (
                    <a
                      href={form.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute bottom-2 left-2 inline-flex items-center gap-1 bg-black/70 hover:bg-black/90 text-white rounded px-2 py-1 text-[10px] font-medium transition-colors"
                    >
                      <FileText className="w-3 h-3" /> Original PDF
                    </a>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-md flex items-center justify-center gap-2">
                    <a href={form.fileUrl || form.imageUrl} target="_blank" rel="noopener noreferrer">
                      <Button type="button" size="sm" variant="secondary" className="h-7 gap-1 text-xs"><Eye className="w-3 h-3" /> {form.fileUrl ? "Open PDF" : "View"}</Button>
                    </a>
                    <Button type="button" size="sm" variant="destructive" className="h-7 gap-1 text-xs" onClick={() => setForm(f => ({ ...f, imageUrl: "", fileUrl: "" }))}><X className="w-3 h-3" /> Remove</Button>
                  </div>
                </div>
              ) : (
                <FileDropZone
                  onFile={handleProcessImageUpload}
                  accept="image/*,application/pdf,.pdf"
                  disabled={isUploading}
                  dialogOpen={open}
                  className="h-24"
                >
                  <FileDropZoneContent
                    uploading={isUploading}
                    label="Click or drag to upload image or PDF"
                    hint="JPG, PNG, WebP · PDF (auto-preview)"
                  />
                </FileDropZone>
              )}
            </div>

            <div className="grid gap-2"><Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving || !form.name || !form.type || isUploading}>
              {isSaving ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Saving...</> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Finishes Tab ─────────────────────────────────────────────────────────────

function FinishesTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: finishes, isLoading } = useSubResource<any>(customerId, "finishes");
  const { data: processes } = useSubResource<any>(customerId, "processes");
  const { data: roles } = useSubResource<any>(customerId, "roles");
  const { data: allProducts } = useListProducts();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const blank = { name: "", notes: "", roleId: null as number | null };
  const [form, setForm] = useState<{ name: string; notes: string; roleId: number | null }>(blank);

  const inv = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "finishes"] });

  const save = useMutation({
    mutationFn: (data: any) => editing
      ? apiFetch(`/customers/${customerId}/finishes/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch(`/customers/${customerId}/finishes`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { inv(); toast({ title: "Saved" }); setOpen(false); setEditing(null); },
    onError: () => toast({ title: "Error", description: "Could not save finish", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/finishes/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Deleted" }); },
  });

  const addProcess = useMutation({
    mutationFn: ({ finishId, processId }: { finishId: number; processId: number }) =>
      apiFetch(`/customers/${customerId}/finishes/${finishId}/processes/${processId}`, { method: "POST" }),
    onSuccess: () => inv(),
    onError: () => toast({ title: "Error", description: "Could not add process", variant: "destructive" }),
  });

  const removeProcess = useMutation({
    mutationFn: ({ finishId, processId }: { finishId: number; processId: number }) =>
      apiFetch(`/customers/${customerId}/finishes/${finishId}/processes/${processId}`, { method: "DELETE" }),
    onSuccess: () => inv(),
  });

  const addGarment = useMutation({
    mutationFn: ({ finishId, productId, colour }: { finishId: number; productId: number; colour?: string | null }) =>
      apiFetch(`/customers/${customerId}/finishes/${finishId}/products/${productId}`, { method: "POST", body: JSON.stringify({ colour: colour ?? null }) }),
    onSuccess: () => inv(),
    onError: () => toast({ title: "Error", description: "Could not add garment", variant: "destructive" }),
  });

  const removeGarment = useMutation({
    mutationFn: ({ finishId, garmentId }: { finishId: number; garmentId: number }) =>
      apiFetch(`/customers/${customerId}/finishes/${finishId}/garments/${garmentId}`, { method: "DELETE" }),
    onSuccess: () => inv(),
  });

  const typeColour: Record<string, string> = {
    embroidery: "bg-purple-100 text-purple-700",
    print: "bg-blue-100 text-blue-700",
    transfer: "bg-orange-100 text-orange-700",
    other: "bg-gray-100 text-gray-700",
  };

  const openAdd = () => { setForm(blank); setEditing(null); setOpen(true); };
  const openEdit = (f: any) => { setForm({ name: f.name||"", notes: [f.description, f.notes].filter(Boolean).join("\n").trim(), roleId: f.roleId ?? f.role_id ?? null }); setEditing(f); setOpen(true); };

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const [garmentPopover, setGarmentPopover] = useState<Set<number>>(new Set());
  const [garmentSearch, setGarmentSearch] = useState<Record<number, string>>({});
  const toggleGarmentPopover = (id: number) => setGarmentPopover(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const [garmentPending, setGarmentPending] = useState<Record<number, { product: any; variants: any[] }>>({});

  const selectGarmentProduct = async (finishId: number, product: any) => {
    setGarmentSearch(prev => ({ ...prev, [finishId]: "" }));
    try {
      const variants = await apiFetch(`/products/${product.id}/variants`);
      const colours = [...new Set((variants as any[]).map((v: any) => v.colour).filter(Boolean))];
      if (colours.length === 0) {
        addGarment.mutate({ finishId, productId: product.id, colour: null });
        toggleGarmentPopover(finishId);
      } else {
        setGarmentPending(prev => ({ ...prev, [finishId]: { product, variants: colours as string[] } }));
      }
    } catch {
      addGarment.mutate({ finishId, productId: product.id, colour: null });
      toggleGarmentPopover(finishId);
    }
  };

  const confirmGarmentColour = (finishId: number, colour: string | null) => {
    const pending = garmentPending[finishId];
    if (!pending) return;
    addGarment.mutate({ finishId, productId: pending.product.id, colour });
    setGarmentPending(prev => { const n = { ...prev }; delete n[finishId]; return n; });
    toggleGarmentPopover(finishId);
  };

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Finish</Button>
      </div>
      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        : !finishes?.length ? <EmptyState icon={Shirt} label="finishes" onAdd={openAdd} />
        : <div className="border border-border/50 rounded-lg overflow-hidden divide-y divide-border/40">
          {finishes.map((f: any) => {
            const isOpen = expanded.has(f.id);
            const attachedProcessIds = new Set(f.processes?.map((p: any) => p.processId));
            const availableProcesses = (processes || []).filter((p: any) => !attachedProcessIds.has(p.id));
            const attachedProductIds = new Set(f.garments?.map((g: any) => g.productId));
            const availableProducts = (allProducts || []).filter((p: any) => !attachedProductIds.has(p.id));
            const processCount = f.processes?.length ?? 0;
            const garmentCount = f.garments?.length ?? 0;

            return (
              <div key={f.id} className="bg-background">
                {/* Collapsed header row */}
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 cursor-pointer select-none" onClick={() => toggle(f.id)}>
                  <span className={`transition-transform duration-150 text-muted-foreground ${isOpen ? "rotate-90" : ""}`}>
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
                  </span>
                  {f.code && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded font-mono text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200 shrink-0">
                      {f.code}
                    </span>
                  )}
                  <span className="font-medium text-foreground flex-1 truncate">{f.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {(f.roleId ?? f.role_id) && (() => {
                      const r = (roles || []).find((r: any) => r.id === (f.roleId ?? f.role_id));
                      return r ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 shrink-0">{r.name}</span>
                      ) : null;
                    })()}
                    {processCount > 0 && (
                      <span className="text-xs text-muted-foreground">{processCount} process{processCount !== 1 ? "es" : ""}</span>
                    )}
                    {garmentCount > 0 && (
                      <span className="text-xs text-muted-foreground">{garmentCount} garment{garmentCount !== 1 ? "s" : ""}</span>
                    )}
                    {f.totalCost > 0 && (
                      <span className="text-xs font-semibold text-emerald-700 tabular-nums">£{f.totalCost.toFixed(2)}</span>
                    )}
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-blue-600 hover:bg-blue-50" onClick={e => { e.stopPropagation(); openEdit(f); }}><Edit2 className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-red-600 hover:bg-red-50" onClick={e => { e.stopPropagation(); confirm("Delete this finish?") && del.mutate(f.id); }}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </div>

                {/* Expanded body */}
                {isOpen && (
                  <div className="px-4 pb-4 pt-1 bg-muted/10 space-y-4 border-t border-border/30">
                    {/* Processes */}
                    <div>
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Processes</p>
                      {f.processes?.length > 0 ? (
                        <div className="space-y-1">
                          {f.processes.map((p: any) => (
                            <div key={p.id} className="flex items-center gap-2 rounded px-2 py-1.5 bg-background border border-border/40 text-sm">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${typeColour[p.type] || typeColour.other}`}>
                                {p.type || "—"}
                              </span>
                              <span className="font-medium flex-1 truncate">{p.name}</span>
                              {p.placement && <span className="text-muted-foreground text-xs hidden sm:block shrink-0">{p.placement}</span>}
                              {p.price != null && <span className="tabular-nums text-xs font-semibold shrink-0">{formatCurrency(p.price)}</span>}
                              <button onClick={() => removeProcess.mutate({ finishId: f.id, processId: p.processId })} className="text-muted-foreground hover:text-red-500 transition-colors shrink-0">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                          {f.totalCost > 0 && (
                            <div className="flex justify-end pr-6 pt-0.5">
                              <span className="text-xs font-semibold text-emerald-700">Total: {formatCurrency(f.totalCost)}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No processes added yet</p>
                      )}
                      {availableProcesses.length > 0 && (
                        <div className="mt-2">
                          <Select onValueChange={(v) => addProcess.mutate({ finishId: f.id, processId: Number(v) })}>
                            <SelectTrigger className="h-7 text-xs w-auto border-dashed text-muted-foreground">
                              <Plus className="w-3 h-3 mr-1" /><span>Add process</span>
                            </SelectTrigger>
                            <SelectContent>
                              {availableProcesses.map((p: any) => (
                                <SelectItem key={p.id} value={String(p.id)}>
                                  {p.name}{p.price != null ? ` — ${formatCurrency(p.price)}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {!processes?.length && <p className="text-xs text-muted-foreground italic mt-1">Set up processes in the Processes tab first</p>}
                    </div>

                    {/* Garments */}
                    <div>
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Garments</p>
                      <div className="flex flex-wrap gap-1.5">
                        {f.garments?.map((g: any) => (
                          <span key={g.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                            {g.sku && <span className="font-mono text-[10px] text-blue-500">{g.sku}</span>}
                            <span>{g.name}</span>
                            {g.colour && <span className="bg-blue-100 text-blue-600 px-1 rounded text-[10px] font-semibold">{g.colour}</span>}
                            <button onClick={() => removeGarment.mutate({ finishId: f.id, garmentId: g.id })} className="hover:opacity-70 ml-0.5"><X className="w-3 h-3" /></button>
                          </span>
                        ))}
                        <Popover open={garmentPopover.has(f.id)} onOpenChange={open => { if (!open) { toggleGarmentPopover(f.id); setGarmentPending(prev => { const n = { ...prev }; delete n[f.id]; return n; }); } else { toggleGarmentPopover(f.id); } }}>
                          <PopoverTrigger asChild>
                            <button className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors">
                              <Plus className="w-3 h-3" />Add garment
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="p-0 w-80" align="start">
                            {garmentPending[f.id] ? (
                              /* Step 2: pick colour */
                              <div className="p-3 space-y-3">
                                <div className="flex items-center gap-2">
                                  <button onClick={() => setGarmentPending(prev => { const n = { ...prev }; delete n[f.id]; return n; })} className="text-muted-foreground hover:text-foreground">
                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
                                  </button>
                                  <div>
                                    <p className="text-xs font-semibold text-foreground">{garmentPending[f.id].product.sku && <span className="font-mono mr-1">{garmentPending[f.id].product.sku}</span>}{garmentPending[f.id].product.name}</p>
                                    <p className="text-[11px] text-muted-foreground">Select a colour</p>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {(garmentPending[f.id].variants as string[]).map((col: string) => (
                                    <button
                                      key={col}
                                      onClick={() => confirmGarmentColour(f.id, col)}
                                      className="px-2.5 py-1 rounded-full text-xs font-medium border border-border hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors"
                                    >
                                      {col}
                                    </button>
                                  ))}
                                  <button
                                    onClick={() => confirmGarmentColour(f.id, null)}
                                    className="px-2.5 py-1 rounded-full text-xs font-medium border border-dashed border-border text-muted-foreground hover:bg-muted transition-colors"
                                  >
                                    Any / no colour
                                  </button>
                                </div>
                              </div>
                            ) : (
                              /* Step 1: search products */
                              <Command>
                                <CommandInput
                                  placeholder="Search by code or name…"
                                  value={garmentSearch[f.id] || ""}
                                  onValueChange={v => setGarmentSearch(prev => ({ ...prev, [f.id]: v }))}
                                />
                                <CommandList>
                                  <CommandEmpty>No products found</CommandEmpty>
                                  <CommandGroup>
                                    {availableProducts
                                      .filter((p: any) => {
                                        const q = (garmentSearch[f.id] || "").toLowerCase();
                                        if (!q) return true;
                                        return (p.sku || "").toLowerCase().includes(q) || (p.name || "").toLowerCase().includes(q);
                                      })
                                      .map((p: any) => (
                                        <CommandItem
                                          key={p.id}
                                          value={`${p.sku || ""} ${p.name}`}
                                          onSelect={() => selectGarmentProduct(f.id, p)}
                                        >
                                          {p.sku && <span className="font-mono font-semibold text-xs text-foreground mr-1.5 shrink-0">{p.sku}</span>}
                                          <span className="text-muted-foreground truncate">{p.name}</span>
                                        </CommandItem>
                                      ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            )}
                          </PopoverContent>
                        </Popover>
                        {!f.garments?.length && !availableProducts?.length && <p className="text-xs text-muted-foreground italic">No garments — add products first</p>}
                        {!f.garments?.length && availableProducts?.length > 0 && <p className="text-xs text-muted-foreground italic">No garments assigned yet</p>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editing ? "Edit Finish" : "Add Finish"}
              {editing?.code && (
                <span className="inline-flex items-center px-2 py-0.5 rounded font-mono text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200">
                  {editing.code}
                </span>
              )}
              {!editing && (
                <span className="text-xs font-normal text-muted-foreground">Code will be assigned on save</span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2"><Label>Name *</Label>
              <Input placeholder="e.g. Full Company Branding Package" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid gap-2">
              <Label>Role <span className="text-muted-foreground font-normal">(optional — restricts portal visibility)</span></Label>
              <Select value={form.roleId != null ? String(form.roleId) : "__all__"} onValueChange={v => setForm({ ...form, roleId: v === "__all__" ? null : Number(v) })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All roles" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All roles (no restriction)</SelectItem>
                  {(roles || []).map((r: any) => (
                    <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2"><Label>Notes</Label>
              <Textarea rows={3} placeholder="Description, placement details, internal notes..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.name}>{save.isPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Shared: Manager Combobox ─────────────────────────────────────────────────

function ManagerCombobox({ employees, value, onChange }: {
  employees: any[];
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = employees.find(e => e.id === value);
  const label = selected ? [selected.firstName, selected.lastName].filter(Boolean).join(" ") : "No manager";
  const filtered = search.trim()
    ? employees.filter(e => [e.firstName, e.lastName, e.jobTitle].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()))
    : employees;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm hover:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-ring",
            !value && "text-muted-foreground"
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="w-4 h-4 shrink-0 opacity-50 ml-2" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search employees…" value={search} onValueChange={setSearch} />
          <CommandList className="max-h-56">
            <CommandEmpty>No employees found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="none" onSelect={() => { onChange(null); setOpen(false); setSearch(""); }}>
                <Check className={cn("w-4 h-4 mr-2 shrink-0", !value ? "opacity-100" : "opacity-0")} />
                <span className="text-muted-foreground">No manager</span>
              </CommandItem>
              {filtered.map(e => {
                const name = [e.firstName, e.lastName].filter(Boolean).join(" ");
                return (
                  <CommandItem key={e.id} value={String(e.id)} onSelect={() => { onChange(e.id); setOpen(false); setSearch(""); }}>
                    <Check className={cn("w-4 h-4 mr-2 shrink-0", value === e.id ? "opacity-100" : "opacity-0")} />
                    <span>{name}{e.jobTitle ? <span className="ml-1.5 text-muted-foreground text-xs">— {e.jobTitle}</span> : null}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function DeliveryAddressCombobox({ addresses, value, onChange }: {
  addresses: any[];
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = addresses.find(a => a.id === value);
  const label = selected
    ? (selected.label || [selected.line1, selected.city, selected.postcode].filter(Boolean).join(", ") || "Unknown address")
    : "Use order default";
  const filtered = search.trim()
    ? addresses.filter(a => {
        const text = [a.label, a.line1, a.line2, a.city, a.postcode].filter(Boolean).join(" ").toLowerCase();
        return text.includes(search.toLowerCase());
      })
    : addresses;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm hover:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-ring",
            !value && "text-muted-foreground"
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="w-4 h-4 shrink-0 opacity-50 ml-2" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search addresses…" value={search} onValueChange={setSearch} />
          <CommandList className="max-h-64">
            <CommandEmpty>No addresses found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="none" onSelect={() => { onChange(null); setOpen(false); setSearch(""); }}>
                <Check className={cn("w-4 h-4 mr-2 shrink-0", !value ? "opacity-100" : "opacity-0")} />
                <span className="text-muted-foreground">Use order default</span>
              </CommandItem>
              {filtered.map((a: any) => {
                const addrLabel = a.label || [a.line1, a.city, a.postcode].filter(Boolean).join(", ") || "Unnamed address";
                const subtext = a.label ? [a.line1, a.city, a.postcode].filter(Boolean).join(", ") : null;
                return (
                  <CommandItem key={a.id} value={String(a.id)} onSelect={() => { onChange(a.id); setOpen(false); setSearch(""); }}>
                    <Check className={cn("w-4 h-4 mr-2 shrink-0", value === a.id ? "opacity-100" : "opacity-0")} />
                    <span>
                      {addrLabel}
                      {subtext && <span className="ml-1.5 text-muted-foreground text-xs">— {subtext}</span>}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Teams Tab ────────────────────────────────────────────────────────────────

const TEAM_CHIP_COLORS = [
  "bg-blue-100 text-blue-700 ring-blue-200",
  "bg-violet-100 text-violet-700 ring-violet-200",
  "bg-emerald-100 text-emerald-700 ring-emerald-200",
  "bg-orange-100 text-orange-700 ring-orange-200",
  "bg-rose-100 text-rose-700 ring-rose-200",
  "bg-teal-100 text-teal-700 ring-teal-200",
  "bg-indigo-100 text-indigo-700 ring-indigo-200",
  "bg-amber-100 text-amber-700 ring-amber-200",
  "bg-cyan-100 text-cyan-700 ring-cyan-200",
  "bg-fuchsia-100 text-fuchsia-700 ring-fuchsia-200",
];
const teamChipColor = (id: number) => TEAM_CHIP_COLORS[Math.abs(id) % TEAM_CHIP_COLORS.length];

function TeamExplosion({ x, y, onDone }: { x: number; y: number; onDone: () => void }) {
  const particles = useMemo(() =>
    Array.from({ length: 16 }, (_, i) => ({
      angle: (i / 16) * Math.PI * 2,
      dist: 40 + Math.random() * 60,
      color: ["#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#8b5cf6"][i % 6],
      size: 5 + Math.random() * 6,
    })), []);
  useEffect(() => { const t = setTimeout(onDone, 700); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className="fixed inset-0 pointer-events-none z-[9999]">
      {particles.map((p, i) => (
        <div key={i} className="absolute rounded-full animate-ping"
          style={{
            left: x, top: y, width: p.size, height: p.size,
            background: p.color, opacity: 0,
            transform: `translate(${Math.cos(p.angle) * p.dist}px, ${Math.sin(p.angle) * p.dist}px)`,
            animation: `team-explode 600ms ease-out ${i * 20}ms forwards`,
          }}
        />
      ))}
      <style>{`@keyframes team-explode { 0%{opacity:1;transform:translate(0,0) scale(1)} 100%{opacity:0;transform:translate(${Math.cos(Math.PI / 4) * 80}px,${Math.sin(Math.PI / 4) * 80}px) scale(0)} }`}</style>
    </div>
  );
}

function TeamMemberChip({ emp, onDragStart, onDragEnd, isDragging }: {
  emp: any;
  onDragStart: () => void;
  onDragEnd: () => void;
  isDragging: boolean;
}) {
  const col = teamChipColor(emp.id);
  return (
    <div
      draggable
      onDragStart={(e) => { onDragStart(); e.dataTransfer.effectAllowed = "move"; }}
      onDragEnd={onDragEnd}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2.5 py-2 bg-background select-none transition-all",
        isDragging ? "opacity-30 border-dashed scale-95" : "hover:border-primary/40 hover:shadow-sm cursor-grab active:cursor-grabbing"
      )}
    >
      <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ring-1", col)}>
        {(emp.firstName?.[0] ?? "")}{(emp.lastName?.[0] ?? "")}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-xs leading-tight truncate">
          {[emp.firstName, emp.lastName].filter(Boolean).join(" ")}
        </p>
        <p className="text-[10px] text-muted-foreground truncate">
          {[emp.employeeNumber && `#${emp.employeeNumber}`, emp.roleName].filter(Boolean).join(" · ")}
        </p>
      </div>
    </div>
  );
}

function TeamsTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: teams = [], isLoading: teamsLoading } = useSubResource<any>(customerId, "teams");
  const { data: employees = [], isLoading: empsLoading } = useQuery<any[]>({
    queryKey: ["customer", customerId, "employees", false],
    queryFn: () => apiFetch(`/customers/${customerId}/employees`),
    enabled: !!customerId,
  });
  const { data: addresses = [] } = useSubResource<any>(customerId, "addresses");

  const activeEmployees = useMemo(() => (employees as any[]).filter((e: any) => e.isActive !== false), [employees]);

  // Group by teamId; null = unassigned
  const groups = useMemo(() => {
    const m = new Map<number | null, any[]>();
    for (const e of activeEmployees) {
      const key = e.teamId != null ? Number(e.teamId) : null;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    }
    return m;
  }, [activeEmployees]);

  const unassigned = groups.get(null) ?? [];

  // Drag state
  const [dragEmpId, setDragEmpId] = useState<number | null>(null);
  const [dragOverKey, setDragOverKey] = useState<number | null | undefined>(undefined);
  const [dragOverBin, setDragOverBin] = useState(false);
  const [explosionPos, setExplosionPos] = useState<{ x: number; y: number } | null>(null);

  const invEmps = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["customer", customerId, "employees"] });
  }, [qc, customerId]);

  const reassign = useMutation({
    mutationFn: ({ id, teamId }: { id: number; teamId: number | null }) =>
      apiFetch(`/customers/${customerId}/employees/${id}`, { method: "PATCH", body: JSON.stringify({ teamId }) }),
    onSuccess: () => { invEmps(); toast({ title: "Employee reassigned" }); },
    onError: () => toast({ title: "Failed to reassign", variant: "destructive" }),
  });

  const deactivate = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/customers/${customerId}/employees/${id}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) }),
    onSuccess: () => { invEmps(); toast({ title: "Employee deactivated" }); },
    onError: () => toast({ title: "Failed to deactivate", variant: "destructive" }),
  });

  const handleDrop = (newTeamId: number | null) => {
    if (dragEmpId == null) return;
    const emp = activeEmployees.find((e: any) => e.id === dragEmpId);
    if (!emp) return;
    const currentTeamId = emp.teamId != null ? Number(emp.teamId) : null;
    if (currentTeamId === newTeamId) { setDragEmpId(null); setDragOverKey(undefined); return; }
    reassign.mutate({ id: dragEmpId, teamId: newTeamId });
    setDragEmpId(null);
    setDragOverKey(undefined);
  };

  const handleBinDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (dragEmpId == null) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const empId = dragEmpId;
    setDragEmpId(null);
    setDragOverKey(undefined);
    setDragOverBin(false);
    setExplosionPos({ x, y });
    deactivate.mutate(empId);
  }, [dragEmpId, deactivate]);

  // Team CRUD
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const blank = { name: "", description: "", managerId: null as number | null, deliveryAddressId: null as number | null };
  const [form, setForm] = useState(blank);

  const invTeams = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "teams"] });

  const save = useMutation({
    mutationFn: (data: any) => editing
      ? apiFetch(`/customers/${customerId}/teams/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch(`/customers/${customerId}/teams`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { invTeams(); invEmps(); toast({ title: "Saved" }); setOpen(false); setEditing(null); },
    onError: () => toast({ title: "Error", description: "Could not save team", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/teams/${id}`, { method: "DELETE" }),
    onSuccess: () => { invTeams(); invEmps(); toast({ title: "Deleted" }); },
  });

  const openAdd = () => { setForm(blank); setEditing(null); setOpen(true); };
  const openEdit = (t: any) => {
    setForm({
      name: t.name || "",
      description: t.description || "",
      managerId: t.managerId ?? null,
      deliveryAddressId: t.deliveryAddressId ?? null,
    });
    setEditing(t);
    setOpen(true);
  };

  const teamsList: any[] = teams as any[];
  const isDropTarget = (key: number | null) => dragEmpId != null && dragOverKey === key;

  const isDragging = dragEmpId != null;

  if (teamsLoading || empsLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">
          {isDragging
            ? "Drop onto a team tile to reassign, or the bin to deactivate →"
            : "Drag employees between team tiles to reassign them."}
        </p>
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Team</Button>
      </div>

      <div className="flex gap-4 items-start">
        {/* Tile grid */}
        <div className="flex-1 min-w-0">
          {teamsList.length === 0 ? (
            <EmptyState icon={Users} label="teams" onAdd={openAdd} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {/* Named team tiles */}
              {teamsList.map((team: any) => {
                const members = groups.get(Number(team.id)) ?? [];
                const dropTarget = isDropTarget(Number(team.id));
                const col = teamChipColor(team.id);

                return (
                  <div
                    key={team.id}
                    className={cn(
                      "flex flex-col rounded-2xl border bg-card overflow-hidden transition-all duration-150",
                      dropTarget ? "border-primary ring-2 ring-primary/30 shadow-xl" : "shadow-sm hover:shadow-md"
                    )}
                    onDragOver={(e) => { if (isDragging) { e.preventDefault(); setDragOverKey(Number(team.id)); } }}
                    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverKey(undefined); }}
                    onDrop={(e) => { e.preventDefault(); handleDrop(Number(team.id)); }}
                  >
                    {/* Tile header */}
                    <div className="p-5 flex flex-col items-center text-center border-b bg-gradient-to-b from-muted/40 to-transparent">
                      <div className={cn("w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold mb-3 ring-4 ring-white shadow-md", col)}>
                        {team.name.slice(0, 2).toUpperCase()}
                      </div>
                      <p className="font-bold text-sm leading-tight">{team.name}</p>
                      {team.managerName && (
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <UserCheck className="w-3 h-3 shrink-0" />
                          {team.managerName}
                        </p>
                      )}
                      {team.description && (
                        <p className="text-xs text-muted-foreground/60 mt-0.5 italic line-clamp-1">{team.description}</p>
                      )}
                      {team.deliveryAddressId && (
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span className="truncate">
                            {team.deliveryAddressLabel || team.deliveryAddressLine1 || team.deliveryAddressPostcode}
                          </span>
                        </p>
                      )}
                      <p className="text-xs font-medium text-muted-foreground mt-1">
                        {members.length} member{members.length !== 1 ? "s" : ""}
                      </p>
                      <div className="flex items-center gap-0.5 mt-2">
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={() => openEdit(team)} title="Edit team">
                          <Edit2 className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400 hover:text-red-600 hover:bg-red-50"
                          onClick={() => { if (confirm(`Delete team "${team.name}"?`)) del.mutate(team.id); }} title="Delete team">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>

                    {/* Member chips */}
                    <div className={cn(
                      "flex-1 p-2 space-y-1.5 min-h-[72px] max-h-56 overflow-y-auto transition-colors",
                      dropTarget && "bg-primary/5"
                    )}>
                      {members.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-4 italic select-none">
                          {isDragging ? "↓ Drop here to assign" : "No members yet"}
                        </p>
                      ) : members.map((emp: any) => (
                        <TeamMemberChip
                          key={emp.id}
                          emp={emp}
                          isDragging={dragEmpId === emp.id}
                          onDragStart={() => setDragEmpId(emp.id)}
                          onDragEnd={() => { setDragEmpId(null); setDragOverKey(undefined); setDragOverBin(false); }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Unassigned tile (only shown when there are unassigned employees) */}
              {unassigned.length > 0 && (
                <div
                  className={cn(
                    "flex flex-col rounded-2xl border bg-card overflow-hidden transition-all duration-150 shadow-sm",
                    isDropTarget(null) ? "border-primary ring-2 ring-primary/30 shadow-xl" : "border-dashed border-border/50"
                  )}
                  onDragOver={(e) => { if (isDragging) { e.preventDefault(); setDragOverKey(null); } }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverKey(undefined); }}
                  onDrop={(e) => { e.preventDefault(); handleDrop(null); }}
                >
                  <div className="p-5 flex flex-col items-center text-center border-b bg-muted/20">
                    <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-3 ring-4 ring-white shadow-sm">
                      <Users className="w-6 h-6 text-muted-foreground/60" />
                    </div>
                    <p className="font-bold text-sm">Unassigned</p>
                    <p className="text-xs text-muted-foreground mt-0.5">No team assigned</p>
                    <p className="text-xs font-medium text-muted-foreground mt-1">
                      {unassigned.length} member{unassigned.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className={cn("flex-1 p-2 space-y-1.5 min-h-[72px] max-h-56 overflow-y-auto", isDropTarget(null) && "bg-primary/5")}>
                    {unassigned.map((emp: any) => (
                      <TeamMemberChip
                        key={emp.id}
                        emp={emp}
                        isDragging={dragEmpId === emp.id}
                        onDragStart={() => setDragEmpId(emp.id)}
                        onDragEnd={() => { setDragEmpId(null); setDragOverKey(undefined); setDragOverBin(false); }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right-side bin */}
        <div
          className={cn(
            "sticky top-24 w-24 shrink-0 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 px-2 py-7 text-center select-none transition-all duration-200",
            isDragging
              ? dragOverBin
                ? "border-red-500 bg-red-500 text-white shadow-xl scale-105"
                : "border-red-300 bg-red-50 text-red-500 border-dashed"
              : "border-dashed border-border/20 bg-muted/5 text-muted-foreground/20"
          )}
          onDragOver={isDragging ? (e) => { e.preventDefault(); setDragOverBin(true); } : undefined}
          onDragLeave={isDragging ? () => setDragOverBin(false) : undefined}
          onDrop={isDragging ? handleBinDrop : undefined}
        >
          <Trash2 className={cn("w-7 h-7 transition-all duration-150", dragOverBin ? "scale-125" : isDragging ? "scale-110" : "scale-100")} />
          <div className="space-y-0.5">
            <p className="text-[11px] font-semibold leading-tight">
              {dragOverBin ? "Release!" : isDragging ? "Drop here" : "Leavers"}
            </p>
            <p className="text-[10px] leading-tight opacity-80">
              {dragOverBin ? "Goes inactive" : isDragging ? "to deactivate" : "Drag to deactivate"}
            </p>
          </div>
        </div>
      </div>

      {/* Explosion animation */}
      {explosionPos && (
        <TeamExplosion x={explosionPos.x} y={explosionPos.y} onDone={() => setExplosionPos(null)} />
      )}

      {/* Team CRUD dialog */}
      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader><DialogTitle>{editing ? "Edit Team" : "Add Team"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Team Name *</Label>
              <Input placeholder="e.g. Picking, Packing, High Bay" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Team Manager</Label>
              <ManagerCombobox
                employees={activeEmployees}
                value={form.managerId}
                onChange={v => setForm({ ...form, managerId: v })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Delivery Address</Label>
              <Select
                value={form.deliveryAddressId == null ? "default" : String(form.deliveryAddressId)}
                onValueChange={value => setForm({ ...form, deliveryAddressId: value === "default" ? null : Number(value) })}
              >
                <SelectTrigger><SelectValue placeholder="Use customer default address" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Use customer default address</SelectItem>
                  {(addresses as any[]).map((address: any) => (
                    <SelectItem key={address.id} value={String(address.id)}>
                      {address.label || address.line1 || address.postcode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Used for team members unless an employee has their own delivery address.
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <Textarea rows={2} placeholder="Optional description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.name}>
              {save.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Roles Tab ────────────────────────────────────────────────────────────────

function RolesTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: roles, isLoading } = useSubResource<any>(customerId, "roles");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const blank = { name: "", description: "", annualAllowance: "" };
  const [form, setForm] = useState(blank);

  const inv = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "roles"] });

  const save = useMutation({
    mutationFn: (data: any) => editing
      ? apiFetch(`/customers/${customerId}/roles/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch(`/customers/${customerId}/roles`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { inv(); toast({ title: "Saved" }); setOpen(false); setEditing(null); },
    onError: () => toast({ title: "Error", description: "Could not save role", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/roles/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Deleted" }); },
  });

  const openAdd = () => { setForm(blank); setEditing(null); setOpen(true); };
  const openEdit = (r: any) => {
    setForm({
      name: r.name || "",
      description: r.description || "",
      annualAllowance: r.annual_allowance != null ? String(r.annual_allowance) : "",
    });
    setEditing(r);
    setOpen(true);
  };

  const handleSave = () => {
    const payload: any = { name: form.name, description: form.description || null };
    payload.annualAllowance = form.annualAllowance.trim() !== "" ? parseFloat(form.annualAllowance) : null;
    save.mutate(payload);
  };

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">Roles define job types — each role can have its own wardrobe in the Wardrobe tab.</p>
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Role</Button>
      </div>

      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        : !roles?.length ? <EmptyState icon={Layers} label="roles" onAdd={openAdd} />
        : <SubTable>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>Role Name</TableHead>
            <TableHead className="hidden md:table-cell">Description</TableHead>
            <TableHead className="hidden sm:table-cell text-right">Annual Allowance</TableHead>
            <TableHead className="w-20 text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {roles.map((r: any) => (
              <TableRow key={r.id} className="group hover:bg-muted/30">
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{r.description || '—'}</TableCell>
                <TableCell className="hidden sm:table-cell text-right text-sm text-muted-foreground">
                  {r.annual_allowance != null ? `£${parseFloat(r.annual_allowance).toFixed(2)}` : <span className="text-muted-foreground/40">No limit</span>}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(r)}><Edit2 className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Delete this role?") && del.mutate(r.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </SubTable>}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader><DialogTitle>{editing ? "Edit Role" : "Add Role"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2"><Label>Role Name *</Label><Input placeholder="e.g. Manager, Driver, Sales Rep" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Description</Label><Textarea rows={2} placeholder="Optional description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid gap-2">
              <Label className="flex items-center gap-1.5">
                Annual Allowance (£)
                <span className="text-muted-foreground font-normal text-xs ml-1">— leave blank for no limit</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 250.00"
                  className="pl-7"
                  value={form.annualAllowance}
                  onChange={e => setForm({ ...form, annualAllowance: e.target.value })}
                />
              </div>
              <p className="text-xs text-muted-foreground">Default budget for all employees in this role. Can be overridden per employee.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={save.isPending || !form.name}>{save.isPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Employees Tab ────────────────────────────────────────────────────────────

function EmployeesTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showInactive, setShowInactive] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const { data: roles } = useSubResource<any>(customerId, "roles");
  const { data: teams } = useSubResource<any>(customerId, "teams");
  const { data: addresses } = useSubResource<any>(customerId, "addresses");

  const { data: employees, isLoading } = useQuery<any[]>({
    queryKey: ["customer", customerId, "employees", showInactive],
    queryFn: () => apiFetch(`/customers/${customerId}/employees${showInactive ? "?showInactive=true" : ""}`),
    enabled: !!customerId,
  });

  const { data: portalUsers } = useQuery<any[]>({
    queryKey: ["portal-users", customerId],
    queryFn: () => apiFetch(`/portal/admin/users/${customerId}`),
    enabled: !!customerId,
  });
  const portalEmailSet = new Set((portalUsers ?? []).map((u: any) => (u.email ?? "").toLowerCase()));

  const [empInviteOpen, setEmpInviteOpen] = useState(false);
  const [empInviteEmail, setEmpInviteEmail] = useState("");
  const [empInviteRole, setEmpInviteRole] = useState<"manager" | "dept_manager" | "member">("dept_manager");
  const [empInviteResult, setEmpInviteResult] = useState<any>(null);
  const [empInviteCopied, setEmpInviteCopied] = useState(false);

  const openEmpInvite = (email: string) => {
    setEmpInviteEmail(email);
    setEmpInviteResult(null);
    setEmpInviteCopied(false);
    setEmpInviteOpen(true);
  };

  const sendEmpInvite = useMutation({
    mutationFn: () => apiFetch("/portal/admin/invite", {
      method: "POST",
      body: JSON.stringify({ customerId, email: empInviteEmail, portalRole: empInviteRole }),
    }),
    onSuccess: (data: any) => {
      setEmpInviteResult(data);
      qc.invalidateQueries({ queryKey: ["portal-users", customerId] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [sizes, setSizes] = useState<{ label: string; size: string }[]>([]);
  const [nameSearch, setNameSearch] = useState("");
  const [empRoleFilter, setEmpRoleFilter] = useState<number | null | "all">("all");
  const [empManagerFilter, setEmpManagerFilter] = useState<number | null | "all">("all");
  const [empTeamFilter, setEmpTeamFilter] = useState<number | null | "all">("all");
  const [empNumSearch, setEmpNumSearch] = useState("");
  const [empEmailSearch, setEmpEmailSearch] = useState("");
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [teamAddMode, setTeamAddMode] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkRoleId, setBulkRoleId] = useState<number | "none">("none");

  const bulkUpdateRole = useMutation({
    mutationFn: ({ employeeIds, roleId }: { employeeIds: number[]; roleId: number | null }) =>
      apiFetch(`/customers/${customerId}/employees/bulk-role`, {
        method: "POST",
        body: JSON.stringify({ employeeIds, roleId }),
      }),
    onSuccess: (_data, vars) => {
      inv();
      setSelectedIds(new Set());
      setBulkRoleId("none");
      toast({ title: `Role updated on ${vars.employeeIds.length} employee${vars.employeeIds.length === 1 ? "" : "s"}` });
    },
    onError: (err: any) => toast({ title: "Bulk update failed", description: err?.message, variant: "destructive" }),
  });

  const addTeamInline = useMutation({
    mutationFn: (name: string) => apiFetch(`/customers/${customerId}/teams`, { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: (newTeam: any) => {
      qc.invalidateQueries({ queryKey: ["customer", customerId, "teams"] });
      setForm(f => ({ ...f, teamId: newTeam.id }));
      setTeamAddMode(false);
      setNewTeamName("");
    },
    onError: (err: any) => toast({ title: "Could not create team", description: err?.message, variant: "destructive" }),
  });

  const blank = { firstName: "", lastName: "", employeeNumber: "", jobTitle: "", department: "", roleId: null as number | null, teamId: null as number | null, managerId: null as number | null, deliveryAddressId: null as number | null, email: "", phone: "", notes: "" };
  const [form, setForm] = useState<typeof blank>(blank);

  const inv = () => {
    qc.refetchQueries({ queryKey: ["customer", customerId, "employees"], type: "active" });
    qc.invalidateQueries({ queryKey: ["customer", customerId, "employees"] });
  };

  const save = useMutation({
    mutationFn: async (data: any) => {
      const emp = editing
        ? await apiFetch(`/customers/${customerId}/employees/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
        : await apiFetch(`/customers/${customerId}/employees`, { method: "POST", body: JSON.stringify(data) });
      const empAny = emp as any;
      const empId = empAny.id;
      if (editing) {
        await apiFetch(`/customers/${customerId}/employees/${empId}/sizes`, { method: "DELETE" }).catch(() => {});
        const existingSizes = editing.sizes || [];
        for (const s of existingSizes) {
          await apiFetch(`/customers/${customerId}/employees/${empId}/sizes/${s.id}`, { method: "DELETE" }).catch(() => {});
        }
      }
      for (const s of sizes) {
        if (s.label && s.size) {
          await apiFetch(`/customers/${customerId}/employees/${empId}/sizes`, { method: "POST", body: JSON.stringify(s) });
        }
      }
      return emp;
    },
    onSuccess: () => { inv(); toast({ title: "Saved" }); setOpen(false); setEditing(null); },
    onError: (err: any) => toast({ title: "Could not save employee", description: err?.message ?? "An unexpected error occurred", variant: "destructive" }),
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiFetch(`/customers/${customerId}/employees/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
    onSuccess: () => { inv(); toast({ title: "Updated" }); },
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/employees/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Deleted" }); },
  });

  const openAdd = () => { setForm(blank); setSizes([]); setEditing(null); setTeamAddMode(false); setNewTeamName(""); setOpen(true); };
  const openEdit = (e: any) => {
    setForm({
      firstName: e.firstName || "", lastName: e.lastName || "",
      employeeNumber: e.employeeNumber || "",
      jobTitle: e.jobTitle || "", department: e.department || "", roleId: e.roleId ?? null, teamId: e.teamId ?? null, managerId: e.managerId ?? null,
      deliveryAddressId: e.deliveryAddressId ?? null,
      email: e.email || "", phone: e.phone || "",
      notes: e.notes || "",
    });
    setSizes((e.sizes || []).map((s: any) => ({ label: s.label, size: s.size })));
    setEditing(e);
    setTeamAddMode(false);
    setNewTeamName("");
    setOpen(true);
  };

  const addSizeRow = () => setSizes(s => [...s, { label: "", size: "" }]);
  const updateSize = (i: number, field: "label" | "size", val: string) =>
    setSizes(s => s.map((row, idx) => idx === i ? { ...row, [field]: val } : row));
  const removeSize = (i: number) => setSizes(s => s.filter((_, idx) => idx !== i));

  const activeCount = employees?.filter(e => e.isActive).length ?? 0;
  const inactiveCount = employees?.filter(e => !e.isActive).length ?? 0;

  const handleSave = () => {
    if (!dupWarning) {
      const nameToCheck = [form.firstName.trim(), form.lastName.trim()].filter(Boolean).join(' ').toLowerCase();
      const dup = (employees ?? []).find((e: any) => {
        if (editing && e.id === editing.id) return false;
        const existing = [e.firstName, e.lastName].filter(Boolean).join(' ').toLowerCase();
        return existing === nameToCheck;
      });
      if (dup) {
        setDupWarning([dup.firstName, dup.lastName].filter(Boolean).join(' '));
        return;
      }
    }
    setDupWarning(null);
    save.mutate(form);
  };

  const filteredEmployees = (employees ?? []).filter((e: any) => {
    const fullName = [e.firstName, e.lastName].filter(Boolean).join(' ').toLowerCase();
    const matchesName = !nameSearch.trim() || fullName.includes(nameSearch.toLowerCase().trim());
    const matchesRole = empRoleFilter === "all" || e.roleId === empRoleFilter;
    const matchesManager = empManagerFilter === "all" || e.managerId === empManagerFilter;
    const matchesTeam = empTeamFilter === "all" || e.teamId === empTeamFilter;
    const matchesEmpNum = !empNumSearch.trim() || (e.employeeNumber ?? "").toLowerCase().includes(empNumSearch.toLowerCase().trim());
    const matchesEmail = !empEmailSearch.trim() || (e.email ?? "").toLowerCase().includes(empEmailSearch.toLowerCase().trim());
    return matchesName && matchesRole && matchesManager && matchesTeam && matchesEmpNum && matchesEmail;
  });
  const hasEmployeeFilters =
    !!nameSearch.trim() ||
    !!empNumSearch.trim() ||
    !!empEmailSearch.trim() ||
    empRoleFilter !== "all" ||
    empManagerFilter !== "all" ||
    empTeamFilter !== "all";
  const clearEmployeeFilters = () => {
    setNameSearch("");
    setEmpNumSearch("");
    setEmpEmailSearch("");
    setEmpRoleFilter("all");
    setEmpManagerFilter("all");
    setEmpTeamFilter("all");
  };

  return (
    <>
      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowInactive(false)}
            className={cn("px-3 py-1 rounded-full text-xs font-medium transition-colors",
              !showInactive ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}
          >
            Active {activeCount > 0 && `(${activeCount})`}
          </button>
          <button
            onClick={() => setShowInactive(true)}
            className={cn("px-3 py-1 rounded-full text-xs font-medium transition-colors",
              showInactive ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}
          >
            All incl. inactive {inactiveCount > 0 && `(+${inactiveCount} hidden)`}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowImportDialog(true)} className="gap-1.5">
            <FileSpreadsheet className="w-4 h-4" /> Import
          </Button>
          <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Employee</Button>
        </div>
      </div>


      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        : !employees?.length ? <EmptyState icon={UserCheck} label="employees" onAdd={openAdd} />
        : filteredEmployees.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            <p>No employees match your current filters.</p>
            {hasEmployeeFilters && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={clearEmployeeFilters}
              >
                Clear filters and show all employees
              </Button>
            )}
          </div>
        )
        : <>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 mb-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-sm">
              <span className="font-medium text-primary shrink-0">{selectedIds.size} selected</span>
              <span className="text-muted-foreground shrink-0">Set role:</span>
              <Select value={bulkRoleId === "none" ? "none" : String(bulkRoleId)} onValueChange={v => setBulkRoleId(v === "none" ? "none" : Number(v))}>
                <SelectTrigger className="h-7 w-44 text-xs"><SelectValue placeholder="Choose role…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No role</SelectItem>
                  {(roles as any[])?.map((r: any) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-7 text-xs px-3" disabled={bulkUpdateRole.isPending}
                onClick={() => bulkUpdateRole.mutate({ employeeIds: [...selectedIds], roleId: bulkRoleId === "none" ? null : bulkRoleId as number })}>
                {bulkUpdateRole.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Apply"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs px-2 ml-auto" onClick={() => setSelectedIds(new Set())}>Clear</Button>
            </div>
          )}
          <SubTable>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8 pr-0">
                <input type="checkbox" className="rounded border-border cursor-pointer"
                  checked={filteredEmployees.length > 0 && filteredEmployees.every((e: any) => selectedIds.has(e.id))}
                  onChange={e => {
                    if (e.target.checked) setSelectedIds(new Set(filteredEmployees.map((e: any) => e.id)));
                    else setSelectedIds(new Set());
                  }}
                />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="hidden xs:table-cell w-28">Emp No.</TableHead>
              <TableHead className="hidden sm:table-cell">Team</TableHead>
              <TableHead className="hidden lg:table-cell">Supervisor</TableHead>
              <TableHead className="hidden md:table-cell">Role</TableHead>
              <TableHead className="hidden lg:table-cell">Email</TableHead>
              <TableHead className="hidden xl:table-cell">Delivery Address</TableHead>
              <TableHead className="text-right w-28">Actions</TableHead>
            </TableRow>
            <TableRow className="hover:bg-transparent border-b border-border/50">
              <TableHead className="py-1 pr-0 w-8" />
              <TableHead className="py-1">
                <input
                  className="h-6 w-full rounded border border-input bg-background px-2 text-xs placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Filter name…"
                  value={nameSearch}
                  onChange={e => setNameSearch(e.target.value)}
                />
              </TableHead>
              <TableHead className="hidden xs:table-cell py-1 w-28">
                <input
                  className="h-6 w-full rounded border border-input bg-background px-2 text-xs placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Filter…"
                  value={empNumSearch}
                  onChange={e => setEmpNumSearch(e.target.value)}
                />
              </TableHead>
              <TableHead className="hidden sm:table-cell py-1">
                <select
                  className="h-6 w-full rounded border border-input bg-background px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={empTeamFilter === "all" ? "__all__" : empTeamFilter === null ? "__none__" : String(empTeamFilter)}
                  onChange={e => {
                    const v = e.target.value;
                    setEmpTeamFilter(v === "__all__" ? "all" : v === "__none__" ? null : Number(v));
                  }}
                >
                  <option value="__all__">All teams</option>
                  <option value="__none__">No team</option>
                  {(teams as any[])?.map((t: any) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
                </select>
              </TableHead>
              <TableHead className="hidden lg:table-cell py-1" />
              <TableHead className="hidden md:table-cell py-1">
                <select
                  className="h-6 w-full rounded border border-input bg-background px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={empRoleFilter === "all" ? "__all__" : empRoleFilter === null ? "__none__" : String(empRoleFilter)}
                  onChange={e => {
                    const v = e.target.value;
                    setEmpRoleFilter(v === "__all__" ? "all" : v === "__none__" ? null : Number(v));
                  }}
                >
                  <option value="__all__">All roles</option>
                  <option value="__none__">No role</option>
                  {(roles as any[])?.map((r: any) => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
                </select>
              </TableHead>
              <TableHead className="hidden lg:table-cell py-1">
                <input
                  className="h-6 w-full rounded border border-input bg-background px-2 text-xs placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Filter email…"
                  value={empEmailSearch}
                  onChange={e => setEmpEmailSearch(e.target.value)}
                />
              </TableHead>
              <TableHead className="hidden xl:table-cell py-1" />
              <TableHead className="py-1 w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEmployees.map((e: any) => (
              <TableRow key={e.id} className={cn("group hover:bg-muted/30", !e.isActive && "opacity-50", selectedIds.has(e.id) && "bg-primary/5")}>
                <TableCell className="pr-0">
                  <input type="checkbox" className="rounded border-border cursor-pointer"
                    checked={selectedIds.has(e.id)}
                    onChange={ev => {
                      const next = new Set(selectedIds);
                      if (ev.target.checked) next.add(e.id); else next.delete(e.id);
                      setSelectedIds(next);
                    }}
                  />
                </TableCell>
                <TableCell>
                  <p className="font-medium">{[e.firstName, e.lastName].filter(Boolean).join(' ')}</p>
                  {!e.isActive && <span className="text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-100 rounded px-1">Inactive</span>}
                </TableCell>
                <TableCell className="hidden xs:table-cell text-sm font-mono text-muted-foreground w-28">
                  {e.employeeNumber || <span className="text-muted-foreground/30">—</span>}
                </TableCell>
                <TableCell className="hidden sm:table-cell text-sm">
                  {e.teamName
                    ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">{e.teamName}</span>
                    : <span className="text-muted-foreground/40">—</span>}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-sm">
                  {e.managerName ?? <span className="text-amber-700 font-medium">Not assigned</span>}
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm">
                  {e.roleName
                    ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">{e.roleName}</span>
                    : <span className="text-muted-foreground/40">—</span>}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{e.email || '—'}</TableCell>
                <TableCell className="hidden xl:table-cell text-sm">
                  {(() => {
                    if (!e.deliveryAddressId) return <span className="text-muted-foreground/40">—</span>;
                    const addr = (addresses as any[])?.find((a: any) => a.id === e.deliveryAddressId);
                    if (!addr) return <span className="text-muted-foreground/40">—</span>;
                    return (
                      <div>
                        {addr.label && <p className="font-medium text-foreground text-xs">{addr.label}</p>}
                        <p className="text-xs text-muted-foreground">{[addr.line1, addr.city, addr.postcode].filter(Boolean).join(", ")}</p>
                      </div>
                    );
                  })()}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {e.email && !portalEmailSet.has(e.email.toLowerCase()) && (
                      <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 text-indigo-600 hover:bg-indigo-50"
                        title="Send portal invite"
                        onClick={() => openEmpInvite(e.email)}
                      >
                        <Globe className="w-3 h-3" />
                      </Button>
                    )}
                    {e.email && portalEmailSet.has(e.email.toLowerCase()) && (
                      <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 text-primary hover:bg-primary/10"
                        title="Send portal link"
                        onClick={() => openEmpInvite(e.email)}
                      >
                        <LogIn className="w-3 h-3" />
                      </Button>
                    )}
                    {!e.isActive ? (
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-green-600 hover:bg-green-50 px-2" onClick={() => setActive.mutate({ id: e.id, isActive: true })}>
                        Reactivate
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-600 hover:bg-amber-50" title="Deactivate" onClick={() => confirm("Deactivate this employee? They will be hidden from orders but kept for reporting.") && setActive.mutate({ id: e.id, isActive: false })}>
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(e)}><Edit2 className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Permanently delete this employee?") && del.mutate(e.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </SubTable>
        </>}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); setDupWarning(null); } }}>
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Employee" : "Add Employee"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>First Name *</Label><Input value={form.firstName} onChange={e => { setDupWarning(null); setForm({ ...form, firstName: e.target.value }); }} /></div>
              <div className="grid gap-2"><Label>Last Name</Label><Input value={form.lastName} onChange={e => { setDupWarning(null); setForm({ ...form, lastName: e.target.value }); }} /></div>
            </div>
            <div className="grid gap-2"><Label>Employee Number</Label><Input placeholder="e.g. EMP-001" value={form.employeeNumber} onChange={e => setForm({ ...form, employeeNumber: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>Job Title</Label><Input placeholder="e.g. Sales Manager" value={form.jobTitle} onChange={e => setForm({ ...form, jobTitle: e.target.value })} /></div>
              <div className="grid gap-2">
                <Label>Role</Label>
                <Select value={form.roleId ? form.roleId.toString() : "none"} onValueChange={v => setForm({ ...form, roleId: v === "none" ? null : Number(v) })}>
                  <SelectTrigger><SelectValue placeholder="No role" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No role</SelectItem>
                    {(roles as any[])?.map((r: any) => <SelectItem key={r.id} value={r.id.toString()}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Department (printed on grouped packing labels when enabled)</Label>
              <Input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} placeholder="Employee's department" />
            </div>
            <div className="grid gap-2">
              <Label>Team</Label>
              {teamAddMode ? (
                <div className="flex gap-2">
                  <Input
                    autoFocus
                    placeholder="New team name"
                    value={newTeamName}
                    onChange={e => setNewTeamName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") { e.preventDefault(); if (newTeamName.trim()) addTeamInline.mutate(newTeamName.trim()); }
                      if (e.key === "Escape") { setTeamAddMode(false); setNewTeamName(""); }
                    }}
                  />
                  <Button type="button" size="sm" onClick={() => { if (newTeamName.trim()) addTeamInline.mutate(newTeamName.trim()); }} disabled={!newTeamName.trim() || addTeamInline.isPending}>
                    {addTeamInline.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Add"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setTeamAddMode(false); setNewTeamName(""); }}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <Select
                  value={form.teamId != null ? String(form.teamId) : "none"}
                  onValueChange={v => {
                    if (v === "__add_new__") { setTeamAddMode(true); setNewTeamName(""); }
                    else setForm({ ...form, teamId: v === "none" ? null : Number(v) });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No team">
                      {form.teamId != null
                        ? ((teams as any[])?.find((t: any) => String(t.id) === String(form.teamId))?.name ?? editing?.teamName ?? "")
                        : "No team"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No team</SelectItem>
                    {(teams as any[])?.map((t: any) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
                    <SelectItem value="__add_new__" className="text-primary font-medium">+ Add new team…</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="grid gap-2">
              <Label>Supervisor / Manager</Label>
              <ManagerCombobox
                employees={(employees as any[])?.filter((e: any) => e.id !== editing?.id && e.isActive !== false) ?? []}
                value={form.managerId}
                onChange={v => setForm({ ...form, managerId: v })}
              />
              <p className="text-xs text-muted-foreground">Used to group items and label supervisor deliveries when manager-grouped packing is enabled for this customer.</p>
            </div>
            <div className="grid gap-2">
              <Label>Delivery Address</Label>
              <DeliveryAddressCombobox
                addresses={(addresses as any[]) ?? []}
                value={form.deliveryAddressId}
                onChange={v => setForm({ ...form, deliveryAddressId: v })}
              />
              <p className="text-xs text-muted-foreground">When set, orders for this employee default to this address.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            </div>

            <div className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-medium">Preferred Sizes</Label>
                <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={addSizeRow}><Plus className="w-3 h-3 mr-1" />Add size</Button>
              </div>
              {sizes.length === 0 && <p className="text-xs text-muted-foreground italic">No sizes saved — click "Add size" to add one.</p>}
              <div className="grid gap-2">
                {sizes.map((s, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input className="flex-1" placeholder="Label (e.g. Shirt)" value={s.label} onChange={e => updateSize(i, "label", e.target.value)} />
                    <Input className="flex-1" placeholder="Size (e.g. L)" value={s.size} onChange={e => updateSize(i, "size", e.target.value)} />
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-600 shrink-0" onClick={() => removeSize(i)}><X className="w-3 h-3" /></Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          {dupWarning && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
              <span>An employee named <strong>{dupWarning}</strong> already exists. This may be intentional — click <strong>Save anyway</strong> to proceed, or edit the name above.</span>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); setDupWarning(null); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={save.isPending || !form.firstName}>
              {save.isPending ? "Saving..." : dupWarning ? "Save anyway" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportSpreadsheetDialog
        customerId={customerId}
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onImported={() => {
          qc.invalidateQueries({ queryKey: ["customer", customerId, "employees"] });
          qc.invalidateQueries({ queryKey: ["customer", customerId, "teams"] });
          qc.invalidateQueries({ queryKey: ["customer", customerId, "roles"] });
          qc.invalidateQueries({ queryKey: ["customer", customerId, "addresses"] });
        }}
      />

      {/* Employee portal invite / resend dialog */}
      <Dialog open={empInviteOpen} onOpenChange={v => { if (!v) { setEmpInviteOpen(false); setEmpInviteResult(null); } }}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogIn className="w-4 h-4" />
              {empInviteResult ? "Link Generated" : "Send Portal Invite"}
            </DialogTitle>
          </DialogHeader>
          {!empInviteResult ? (
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label>Email</Label>
                <Input type="email" value={empInviteEmail} readOnly className="bg-muted/40 text-muted-foreground" />
              </div>
              <div className="grid gap-2">
                <Label>Portal Role</Label>
                <Select value={empInviteRole} onValueChange={(v: any) => setEmpInviteRole(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manager">
                      <div><div className="font-medium">Manager</div><div className="text-xs text-muted-foreground">Can submit orders and approve dept manager orders</div></div>
                    </SelectItem>
                    <SelectItem value="dept_manager">
                      <div><div className="font-medium">Dept Manager</div><div className="text-xs text-muted-foreground">Can create orders for their team (pending approval)</div></div>
                    </SelectItem>
                    <SelectItem value="member">
                      <div><div className="font-medium">Member</div><div className="text-xs text-muted-foreground">View-only access</div></div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 py-2">
              {empInviteResult.emailSent ? (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
                  <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-800">Email sent to {empInviteResult.email}</p>
                    <p className="text-xs text-green-700 mt-0.5">Copy the link below as a backup in case it goes to spam.</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                  <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">Email not sent — copy and share manually</p>
                    <p className="text-xs text-amber-700 mt-0.5">Send this link to {empInviteResult.email} via Teams, Slack, or another channel.</p>
                  </div>
                </div>
              )}
              <div className="grid gap-2">
                <Label>Sign-in Link</Label>
                <div className="flex gap-2">
                  <Input readOnly value={window.location.origin + empInviteResult.inviteUrl} className="font-mono text-xs" />
                  <Button variant="outline" size="sm" className="shrink-0 gap-1" onClick={() => {
                    navigator.clipboard.writeText(window.location.origin + empInviteResult.inviteUrl);
                    setEmpInviteCopied(true);
                    setTimeout(() => setEmpInviteCopied(false), 2000);
                  }}>
                    {empInviteCopied ? <><CheckCircle2 className="w-3 h-3 text-green-600" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEmpInviteOpen(false); setEmpInviteResult(null); }}>
              {empInviteResult ? "Close" : "Cancel"}
            </Button>
            {!empInviteResult && (
              <Button onClick={() => sendEmpInvite.mutate()} disabled={!empInviteEmail || sendEmpInvite.isPending}>
                {sendEmpInvite.isPending ? "Generating…" : "Generate Sign-in Link"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Wardrobe (Finished Items) Tab ───────────────────────────────────────────

interface WardrobeGroup {
  key: string;
  items: FinishedItem[];
  name: string;
  roleId: number | null;
  roleName: string | null;
  productId: number;
  productName: string | null;
  productSku: string | null;
  finishId: number | null;
  finishName: string | null;
  colour: string | null;
  colours: string[];
  sleeve: string | null;
  unitPrice: number;
  productUnitPrice: number | null;
  specialPrice: number | null;
  totalStock: number;
  sizes: (string | null)[];
}

interface FinishedItem {
  id: number;
  customerId: number;
  roleId: number | null;
  roleName: string | null;
  name: string;
  productId: number;
  productName: string | null;
  productSku: string | null;
  finishId: number | null;
  finishName: string | null;
  colour: string | null;
  sleeve: string | null;
  size: string | null;
  unitPrice: number;
  productUnitPrice: number | null;
  specialPrice: number | null;
  stockQuantity: number;
  notes: string | null;
}

// ─── Portal Access Tab ────────────────────────────────────────────────────────

const PORTAL_ROLES = [
  { value: "manager", label: "Manager", description: "Can submit orders directly to the configured shop and approve department manager orders" },
  { value: "dept_manager", label: "Dept Manager", description: "Can create orders for their team (pending manager approval)" },
  { value: "member", label: "Member", description: "View-only access" },
] as const;

function roleBadge(role: string) {
  if (role === "manager") return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">Manager</span>;
  if (role === "dept_manager") return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">Dept Manager</span>;
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Member</span>;
}

function PortalAccessTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSelection, setInviteSelection] = useState<string>(""); // "emp:{id}" | "other" | ""
  const [inviteRole, setInviteRole] = useState<"manager" | "dept_manager" | "member">("member");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ inviteUrl: string; email: string } | null>(null);
  const [mobileEmailOpen, setMobileEmailOpen] = useState(false);
  const [mobileEmailAddr, setMobileEmailAddr] = useState("");
  const [mobileEmailName, setMobileEmailName] = useState("");
  const [copied, setCopied] = useState(false);
  const [previewHref, setPreviewHref] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [empPickerOpen, setEmpPickerOpen] = useState(false);
  const [empPickerSearch, setEmpPickerSearch] = useState("");
  const [pickedEmployeeId, setPickedEmployeeId] = useState<number | null>(null);
  const [pickedPortalUserId, setPickedPortalUserId] = useState<number | null>(null);
  const [pickerRole, setPickerRole] = useState<"member" | "dept_manager" | "manager">("member");
  const [editEmailUser, setEditEmailUser] = useState<any | null>(null);
  const [editEmailValue, setEditEmailValue] = useState("");

  const { data: portalUsers, isLoading } = useQuery<any[]>({
    queryKey: ["portal-users", customerId],
    queryFn: () => apiFetch(`/portal/admin/users/${customerId}`),
  });

  const { data: customerDetail } = useQuery<any>({
    queryKey: ["portal-customer-detail", customerId],
    queryFn: () => apiFetch(`/portal/admin/customer-detail/${customerId}`),
  });
  const { data: managerPackingSetting, isError: managerPackingSettingError, error: managerPackingError } = useQuery<{ enabled: boolean }>({
    queryKey: ["customer-manager-packing", customerId],
    queryFn: () => apiFetch(`/dispatch/customers/${customerId}/manager-packing`),
  });
  const employees: any[] = customerDetail?.employees ?? [];
  // Use lowercase for deduplication so case differences don't create duplicates
  const existingEmailsLower = new Set((portalUsers ?? []).map((u: any) => (u.email ?? "").toLowerCase()));
  const suggestedEmployees = employees.filter(e => e.email && !existingEmailsLower.has(e.email.toLowerCase()));

  // Build a name lookup from employees so portal users show their real name
  const employeeByEmail = new Map<string, string>();
  for (const e of employees) {
    if (e.email && e.name) employeeByEmail.set(e.email.toLowerCase(), e.name);
  }

  // Combined recipient list: existing portal users first (resend), then uninvited employees
  const inviteRecipientOptions: Array<{ value: string; name: string; email: string; isPortalUser?: boolean }> = [
    ...(portalUsers ?? []).filter((u: any) => u.email).map((u: any) => ({
      value: `portal:${u.id}`,
      name: employeeByEmail.get(u.email.toLowerCase()) ?? u.email,
      email: u.email,
      isPortalUser: true,
    })),
    ...suggestedEmployees.map((e: any) => ({
      value: `emp:${e.id}`,
      name: e.name,
      email: e.email,
    })),
  ];

  const [defaultShipping, setDefaultShipping] = useState<string>("");
  useEffect(() => {
    setDefaultShipping(customerDetail?.defaultShippingOption ?? "");
  }, [customerDetail?.defaultShippingOption]);

  const updateSettings = useMutation({
    mutationFn: (defaultShippingOption: string | null) =>
      apiFetch(`/portal/admin/customers/${customerId}/settings`, {
        method: "PATCH",
        body: JSON.stringify({ defaultShippingOption }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-customer-detail", customerId] });
      toast({ title: "Default shipping saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updatePortalSuspension = useMutation({
    mutationFn: (portalSuspended: boolean) =>
      apiFetch(`/portal/admin/customers/${customerId}/settings`, {
        method: "PATCH",
        body: JSON.stringify({ portalSuspended }),
      }),
    onSuccess: (_data, portalSuspended) => {
      qc.invalidateQueries({ queryKey: ["portal-customer-detail", customerId] });
      toast({
        title: portalSuspended ? "Portal access suspended" : "Portal access restored",
        description: portalSuspended
          ? "All customer logins and staff previews are now blocked."
          : "Customer logins and staff previews can access the portal again.",
      });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateManagerPacking = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch(`/dispatch/customers/${customerId}/manager-packing`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer-manager-packing", customerId] });
      toast({ title: "Dispatch packing setting saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const sendInvite = useMutation({
    mutationFn: () => apiFetch("/portal/admin/invite", {
      method: "POST",
      body: JSON.stringify({ customerId, email: inviteEmail, portalRole: inviteRole }),
    }),
    onSuccess: (data: any) => {
      setInviteResult(data);
      setInviteEmail("");
      qc.invalidateQueries({ queryKey: ["portal-users", customerId] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const sendMobileInstructions = useMutation({
    mutationFn: ({ email, name }: { email: string; name: string }) =>
      apiFetch(`/portal/admin/send-mobile-instructions/${customerId}`, {
        method: "POST", body: JSON.stringify({ email, name }),
      }),
    onSuccess: (data: any) => {
      toast({ title: "Email sent", description: `Mobile app instructions sent to ${data.sentTo}` });
      setMobileEmailOpen(false);
      setMobileEmailAddr(""); setMobileEmailName("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const revokeUser = useMutation({
    mutationFn: (userId: number) => apiFetch(`/portal/admin/users/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-users", customerId] });
      toast({ title: "Access revoked" });
    },
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, portalRole }: { userId: number; portalRole: string }) =>
      apiFetch(`/portal/admin/users/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ portalRole }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-users", customerId] });
      toast({ title: "Role updated" });
    },
  });

  const changePricing = useMutation({
    mutationFn: ({ userId, showPricing }: { userId: number; showPricing: boolean }) =>
      apiFetch(`/portal/admin/users/${userId}/show-pricing`, {
        method: "PATCH",
        body: JSON.stringify({ showPricing }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-users", customerId] }),
  });

  const changeEmail = useMutation({
    mutationFn: ({ userId, email }: { userId: number; email: string }) =>
      apiFetch(`/portal/admin/users/${userId}/email`, {
        method: "PATCH",
        body: JSON.stringify({ email }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-users", customerId] });
      toast({ title: "Email updated" });
      setEditEmailUser(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const copyLink = (url: string) => {
    const fullUrl = window.location.origin + url;
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const openPreview = async (role: "manager" | "dept_manager" | "member" = "manager", employeeId?: number | null, portalUserId?: number | null) => {
    setPreviewLoading(true);
    // Open a blank tab synchronously (within the click handler) so the browser
    // doesn't treat it as a popup. We navigate it to the real URL once we have the token.
    const newWindow = window.open("", "_blank");
    try {
      const data: any = await apiFetch(`/portal/admin/preview/${customerId}?role=${role}`, {
        method: "POST",
        body: JSON.stringify({ employeeId: employeeId ?? null, portalUserId: portalUserId ?? null }),
      });
      const href = window.location.origin + data.previewUrl;
      if (newWindow && !newWindow.closed) {
        newWindow.location.href = href;
      } else {
        // Fallback: popup was blocked — show the dialog with the link
        setPreviewHref(href);
      }
    } catch {
      if (newWindow && !newWindow.closed) newWindow.close();
      toast({ title: "Could not open preview", variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  };

  const statusBadge = (u: any) => {
    if (u.status === "active") return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">Active</span>;
    if (u.status === "invited") return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">Invited</span>;
    if (u.status === "pending") return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">Not Sent</span>;
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">{u.status}</span>;
  };

  const SHIPPING_OPTIONS = [
    { id: "free_local", label: "Local delivery" },
    { id: "dpd_next_day", label: "Courier" },
    { id: "warehouse_collection", label: "Warehouse collection" },
    { id: "office_collection", label: "Office collection" },
  ];

  return (
    <div className="space-y-4">
      <div className={cn(
        "rounded-lg border p-4 flex items-center gap-4",
        customerDetail?.portalSuspended
          ? "border-red-300 bg-red-50"
          : "bg-muted/30"
      )}>
        <div className="flex-1 min-w-0">
          <p className={cn("text-sm font-semibold", customerDetail?.portalSuspended && "text-red-800")}>
            Suspend all portal access
          </p>
          <p className={cn("text-xs mt-0.5", customerDetail?.portalSuspended ? "text-red-700" : "text-muted-foreground")}>
            {customerDetail?.portalSuspended
              ? "Suspended users and staff previews see: PORTAL ACCESS SUSPENDED. ACCOUNT OVERDUE."
              : "Immediately block every portal user and staff customer preview for this account."}
          </p>
        </div>
        <Switch
          checked={customerDetail?.portalSuspended === true}
          disabled={updatePortalSuspension.isPending}
          onCheckedChange={(checked) => updatePortalSuspension.mutate(checked)}
          aria-label="Suspend all portal access"
        />
      </div>

      {/* Default shipping option */}
      <div className="rounded-lg border bg-muted/30 p-4 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Default shipping option</p>
          <p className="text-xs text-muted-foreground mt-0.5">Pre-selected when this customer places an order — they can still change it.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            value={defaultShipping}
            onChange={e => setDefaultShipping(e.target.value)}
          >
            <option value="">(none — customer chooses)</option>
            {SHIPPING_OPTIONS.map(o => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={updateSettings.isPending || defaultShipping === (customerDetail?.defaultShippingOption ?? "")}
            onClick={() => updateSettings.mutate(defaultShipping || null)}
          >
            Save
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/30 p-4 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Manager-grouped packing and labels</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            When enabled, ready items for this customer are grouped by each recipient’s assigned supervisor and handled in the separate dispatch packing queue. Packing sheets and package labels are available, and wearer labels include the employee’s department. This is off by default; assign supervisors to employees before using it.
          </p>
          {managerPackingSettingError && <p className="text-xs text-destructive mt-1">{(managerPackingError as Error).message || "Could not load this dispatch setting."}</p>}
        </div>
        <Switch
          checked={managerPackingSetting?.enabled === true}
          disabled={!managerPackingSetting || updateManagerPacking.isPending}
          onCheckedChange={(checked) => updateManagerPacking.mutate(checked)}
          aria-label="Enable manager-grouped packing and labels"
        />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Globe className="w-4 h-4 text-primary" /> Portal Access</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Manage who can log into the customer ordering portal for this account.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setPickerRole("member"); setPickedEmployeeId(null); setEmpPickerSearch(""); setEmpPickerOpen(true); }} disabled={previewLoading}>
            <Eye className="w-3.5 h-3.5" /> Preview as Employee
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setPickerRole("dept_manager"); setPickedEmployeeId(null); setPickedPortalUserId(null); setEmpPickerSearch(""); setEmpPickerOpen(true); }} disabled={previewLoading}>
            <Eye className="w-3.5 h-3.5" /> Preview as Team Manager
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setPickerRole("manager"); setPickedEmployeeId(null); setEmpPickerSearch(""); setEmpPickerOpen(true); }} disabled={previewLoading}>
            <Eye className="w-3.5 h-3.5" /> Preview as Manager
          </Button>

          {/* Employee picker — choose which employee to preview as */}
          <Dialog open={empPickerOpen} onOpenChange={v => { if (!v) setEmpPickerOpen(false); }}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  {pickerRole === "manager" ? "Preview as Manager" : pickerRole === "dept_manager" ? "Preview as Team Manager" : "Preview as Employee"}
                </DialogTitle>
                <DialogDescription>
                  {pickerRole === "manager"
                    ? "Choose which manager to view the portal as — you'll see all orders and the approval queue."
                    : pickerRole === "dept_manager"
                    ? "Choose which team manager to view the portal as — they'll see their own orders and My Team page."
                    : "Choose which employee to view the portal as — their wardrobe and sizes will be shown."}
                </DialogDescription>
              </DialogHeader>
              <div className="py-1 space-y-2">
                <Input
                  placeholder="Search by name, job title…"
                  value={empPickerSearch}
                  onChange={e => setEmpPickerSearch(e.target.value)}
                  autoFocus
                />
                <div className="max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border">
                  <button
                    type="button"
                    onClick={() => setPickedEmployeeId(null)}
                    className={cn("w-full text-left px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors flex items-center gap-2", pickedEmployeeId === null && "bg-primary/10")}
                  >
                    <Check className={cn("w-3.5 h-3.5 shrink-0 text-primary", pickedEmployeeId === null ? "opacity-100" : "opacity-0")} />
                    <div>
                      <p className="font-medium">
                        {pickerRole === "manager" ? "Generic manager" : pickerRole === "dept_manager" ? "Generic team manager" : "Generic employee"}
                      </p>
                      <p className="text-xs text-muted-foreground">No specific person — no wardrobe pre-filter</p>
                    </div>
                  </button>
                  {pickerRole === "dept_manager"
                    ? (portalUsers ?? [])
                        .filter((u: any) => u.portal_role === "dept_manager")
                        .filter((u: any) => {
                          const term = empPickerSearch.toLowerCase().trim();
                          if (!term) return true;
                          return (u.email ?? "").toLowerCase().includes(term);
                        })
                        .map((u: any) => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => setPickedPortalUserId(u.id)}
                            onDoubleClick={() => {
                              setEmpPickerOpen(false);
                              openPreview("dept_manager", u.linked_employee_id ?? null, u.id);
                            }}
                            className={cn("w-full text-left px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors flex items-center gap-2", pickedPortalUserId === u.id && "bg-primary/10")}
                          >
                            <Check className={cn("w-3.5 h-3.5 shrink-0 text-primary", pickedPortalUserId === u.id ? "opacity-100" : "opacity-0")} />
                            <div className="min-w-0">
                              <p className="font-medium break-all">{u.email}</p>
                              <p className="text-xs text-muted-foreground truncate capitalize">{u.status}</p>
                            </div>
                          </button>
                        ))
                    : employees
                        .filter((e: any) => {
                          const term = empPickerSearch.toLowerCase().trim();
                          if (!term) return true;
                          return [e.name, e.first_name, e.last_name, e.job_title, e.role_name, e.email].filter(Boolean).join(" ").toLowerCase().includes(term);
                        })
                        .map((e: any) => {
                          const name = e.name || [e.first_name, e.last_name].filter(Boolean).join(" ") || "—";
                          const subtitle = [e.job_title, e.role_name, e.manager_name].filter(Boolean).join(" · ");
                          return (
                            <button
                              key={e.id}
                              type="button"
                              onClick={() => setPickedEmployeeId(e.id)}
                              onDoubleClick={() => {
                                setEmpPickerOpen(false);
                                openPreview(pickerRole, e.id);
                              }}
                              className={cn("w-full text-left px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors flex items-center gap-2", pickedEmployeeId === e.id && "bg-primary/10")}
                            >
                              <Check className={cn("w-3.5 h-3.5 shrink-0 text-primary", pickedEmployeeId === e.id ? "opacity-100" : "opacity-0")} />
                              <div className="min-w-0">
                                <p className="font-medium truncate">{name}</p>
                                {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
                              </div>
                            </button>
                          );
                        })
                  }
                  {employees.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-6">No active employees found.<br /><span className="text-xs">Add employees in the Employees tab first.</span></p>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEmpPickerOpen(false)}>Cancel</Button>
                <Button
                  disabled={previewLoading}
                  onClick={() => {
                    setEmpPickerOpen(false);
                    if (pickerRole === "dept_manager") {
                      const selectedUser = pickedPortalUserId !== null
                        ? (portalUsers ?? []).find((u: any) => u.id === pickedPortalUserId)
                        : null;
                      openPreview("dept_manager", selectedUser?.linked_employee_id ?? null, pickedPortalUserId);
                    } else {
                      openPreview(pickerRole, pickedEmployeeId);
                    }
                  }}
                >
                  {previewLoading ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Opening…</> : "Open Preview"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Preview link dialog — opens after token is generated */}
          <Dialog open={!!previewHref} onOpenChange={(o) => { if (!o) setPreviewHref(null); }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Eye className="w-4 h-4" /> Portal Preview Ready</DialogTitle>
                <DialogDescription>Click the button below to open the portal preview. The link expires in 2 hours.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3 pt-1">
                <Button
                  className="w-full gap-2"
                  onClick={() => {
                    const href = previewHref;
                    setPreviewHref(null);
                    if (href) window.open(href, "_blank", "noopener,noreferrer");
                  }}
                >
                  <Eye className="w-4 h-4" /> Open Portal Preview
                </Button>
                <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2">
                  <span className="text-xs text-muted-foreground truncate flex-1 font-mono">{previewHref}</span>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    onClick={() => { navigator.clipboard.writeText(previewHref ?? ""); toast({ title: "Link copied" }); }}
                  >
                    Copy
                  </button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setMobileEmailAddr(""); setMobileEmailName(""); setMobileEmailOpen(true); }}>
            <Smartphone className="w-3.5 h-3.5" /> Send App Instructions
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => { setInviteResult(null); setInviteEmail(""); setInviteRole("member"); setInviteOpen(true); }}>
            <LogIn className="w-3.5 h-3.5" /> Invite User
          </Button>

          {/* Mobile instructions dialog */}
          <Dialog open={mobileEmailOpen} onOpenChange={v => { if (!v) setMobileEmailOpen(false); }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Smartphone className="w-4 h-4" /> Send Mobile App Instructions</DialogTitle>
                <DialogDescription>Send an email explaining how to add the portal to their phone home screen like a native app.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-1">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Recipient name</Label>
                  <Input placeholder="e.g. Jane Smith" value={mobileEmailName} onChange={e => setMobileEmailName(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Email address *</Label>
                  <Input type="email" placeholder="contact@customer.com" value={mobileEmailAddr} onChange={e => setMobileEmailAddr(e.target.value)} />
                </div>
                {suggestedEmployees.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    <span className="text-[10px] text-muted-foreground w-full">Quick-fill from employees:</span>
                    {suggestedEmployees.slice(0, 5).map((e: any) => (
                      <button key={e.id} type="button" onClick={() => { setMobileEmailAddr(e.email); setMobileEmailName([e.firstName, e.lastName].filter(Boolean).join(" ")); }}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-muted hover:bg-muted/80 border border-border text-muted-foreground transition-colors">
                        {[e.firstName, e.lastName].filter(Boolean).join(" ")}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setMobileEmailOpen(false)}>Cancel</Button>
                <Button onClick={() => sendMobileInstructions.mutate({ email: mobileEmailAddr, name: mobileEmailName })} disabled={!mobileEmailAddr || sendMobileInstructions.isPending}>
                  {sendMobileInstructions.isPending ? "Sending…" : "Send Email"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : !portalUsers?.length ? (
        <div className="flex flex-col items-center justify-center py-10 text-center border-2 border-dashed border-border rounded-lg">
          <Globe className="w-8 h-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm font-medium text-muted-foreground">No portal users yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Invite a customer contact to give them portal access</p>
        </div>
      ) : (
        <SubTable>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>Email</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="hidden md:table-cell">See Prices</TableHead>
            <TableHead className="hidden md:table-cell">Invite Sent</TableHead>
            <TableHead className="hidden md:table-cell">Last Login</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {portalUsers.map((u: any) => (
              <TableRow key={u.id} className="group hover:bg-muted/30">
                <TableCell className="font-medium text-sm">{u.email?.toLowerCase()}</TableCell>
                <TableCell>{statusBadge(u)}</TableCell>
                <TableCell>
                  <Select
                    value={u.portal_role ?? "member"}
                    onValueChange={(v) => changeRole.mutate({ userId: u.id, portalRole: v })}
                  >
                    <SelectTrigger className="h-7 w-36 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manager" className="text-xs">Manager</SelectItem>
                      <SelectItem value="dept_manager" className="text-xs">Dept Manager</SelectItem>
                      <SelectItem value="member" className="text-xs">Member</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Switch
                    checked={u.show_pricing === true}
                    onCheckedChange={(v) => changePricing.mutate({ userId: u.id, showPricing: v })}
                    aria-label="Can see pricing"
                  />
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                  {u.invite_sent_at ? (
                    <span className="flex flex-col leading-tight">
                      <span>{formatDate(u.invite_sent_at)}</span>
                      <span className="text-xs text-muted-foreground/60">
                        {new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(u.invite_sent_at))}
                      </span>
                    </span>
                  ) : <span className="text-muted-foreground/50">—</span>}
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                  {u.last_login_at ? formatDate(u.last_login_at) : <span className="text-muted-foreground/50">Never</span>}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1 border-primary/40 text-primary hover:bg-primary/10"
                      onClick={() => { setInviteEmail(u.email); setInviteRole(u.portal_role ?? "member"); setInviteResult(null); setInviteOpen(true); }}>
                      <LogIn className="w-3 h-3" />{!u.last_login_at ? "Send Invite" : "Send link"}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Edit email address"
                      onClick={() => { setEditEmailUser(u); setEditEmailValue(u.email ?? ""); }}>
                      <Edit2 className="w-3 h-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => confirm(`Revoke portal access for ${u.email}?`) && revokeUser.mutate(u.id)}>
                      <UserX className="w-3 h-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </SubTable>
      )}

      {/* Edit email dialog */}
      <Dialog open={!!editEmailUser} onOpenChange={v => { if (!v) setEditEmailUser(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Edit2 className="w-4 h-4" /> Edit Email Address</DialogTitle>
            <DialogDescription>Update the email address for this portal user. They will need to use the new address to log in.</DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Current email</Label>
              <p className="text-sm text-muted-foreground font-mono">{editEmailUser?.email}</p>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">New email *</Label>
              <Input
                type="email"
                placeholder="new@example.com"
                value={editEmailValue}
                onChange={e => setEditEmailValue(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && editEmailValue && editEmailUser) changeEmail.mutate({ userId: editEmailUser.id, email: editEmailValue }); }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEmailUser(null)}>Cancel</Button>
            <Button
              onClick={() => editEmailUser && changeEmail.mutate({ userId: editEmailUser.id, email: editEmailValue })}
              disabled={!editEmailValue || editEmailValue === editEmailUser?.email || changeEmail.isPending}
            >
              {changeEmail.isPending ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Invite portal user dialog */}
      <Dialog open={inviteOpen} onOpenChange={v => { if (!v) { setInviteOpen(false); setInviteResult(null); setInviteSelection(""); setInviteEmail(""); } }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Invite Customer to Portal
            </DialogTitle>
          </DialogHeader>

          {!inviteResult ? (
            <div className="grid gap-4 py-2">
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-blue-50 border border-blue-200">
                <Globe className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-800">
                  Generates a sign-in link for the customer. If email is working, we'll send it automatically — otherwise you can copy and share the link yourself.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit gap-1.5"
                onClick={() => window.open(`${API_BASE}/portal/admin/invite/preview?customerId=${customerId}`, "_blank")}
              >
                <Mail className="w-3.5 h-3.5" />
                Preview email
              </Button>
              <div className="grid gap-2">
                <Label>Recipient *</Label>
                {inviteRecipientOptions.length > 0 ? (
                  <Select
                    value={inviteSelection}
                    onValueChange={val => {
                      setInviteSelection(val);
                      if (val === "other") {
                        setInviteEmail("");
                      } else {
                        const opt = inviteRecipientOptions.find(o => o.value === val);
                        setInviteEmail(opt?.email ?? "");
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a recipient…" />
                    </SelectTrigger>
                    <SelectContent>
                      {inviteRecipientOptions.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{opt.name}</span>
                            {opt.email && <span className="text-muted-foreground text-xs">{opt.email.toLowerCase()}</span>}
                          </div>
                        </SelectItem>
                      ))}
                      <SelectItem value="other">
                        <span className="text-muted-foreground">Other (enter email manually)…</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input type="email" placeholder="contact@customer.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
                )}
              </div>
              {suggestedEmployees.length > 0 && inviteSelection === "other" && (
                <div className="grid gap-2">
                  <Label>Email Address *</Label>
                  <Input type="email" placeholder="contact@customer.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} autoFocus />
                </div>
              )}
              <div className="grid gap-2">
                <Label>Portal Role</Label>
                <Select value={inviteRole} onValueChange={(v: any) => setInviteRole(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PORTAL_ROLES.map(r => (
                      <SelectItem key={r.value} value={r.value}>
                        <div>
                          <div className="font-medium">{r.label}</div>
                          <div className="text-xs text-muted-foreground">{r.description}</div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 py-2">
              {inviteResult.emailSent ? (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
                  <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-800">Email sent to {inviteResult.email}</p>
                    <p className="text-xs text-green-700 mt-0.5">The invite link has been emailed. Copy the link below as a backup in case it goes to spam.</p>
                  </div>
                </div>
              ) : inviteResult.emailError ? (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-red-50 border border-red-200">
                  <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-red-800">Email failed — copy and share the link manually</p>
                    <p className="text-xs text-red-700 mt-0.5 font-mono">{inviteResult.emailError}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                  <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">Email not configured — copy and share the link manually</p>
                    <p className="text-xs text-amber-700 mt-0.5">Send this link to {inviteResult.email} via Teams, Slack, or another channel.</p>
                  </div>
                </div>
              )}
              <div className="grid gap-2">
                <Label>Invite Link</Label>
                <div className="flex gap-2">
                  <Input readOnly value={window.location.origin + inviteResult.inviteUrl} className="font-mono text-xs" />
                  <Button variant="outline" size="sm" className="shrink-0 gap-1" onClick={() => copyLink(inviteResult.inviteUrl)}>
                    {copied ? <><CheckCircle2 className="w-3 h-3 text-green-600" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setInviteOpen(false); setInviteResult(null); }}>
              {inviteResult ? "Close" : "Cancel"}
            </Button>
            {!inviteResult && (
              <Button onClick={() => sendInvite.mutate()} disabled={!inviteEmail || sendInvite.isPending}>
                {sendInvite.isPending ? "Generating…" : "Generate Sign-in Link"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function WardrobeStockCell({ item, onSave }: { item: FinishedItem; onSave: (qty: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(item.stockQuantity));
  const low = item.stockQuantity <= 5;
  const commit = () => {
    const num = parseInt(draft, 10);
    if (!isNaN(num) && num >= 0 && num !== item.stockQuantity) onSave(num);
    else setDraft(String(item.stockQuantity));
    setEditing(false);
  };
  if (editing) {
    return (
      <input
        type="number" min={0} value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(String(item.stockQuantity)); setEditing(false); } }}
        className="w-16 text-right border rounded px-2 py-0.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        autoFocus
      />
    );
  }
  return (
    <button
      onClick={() => { setDraft(String(item.stockQuantity)); setEditing(true); }}
      className={cn("tabular-nums font-mono text-sm px-2 py-0.5 rounded hover:bg-muted transition-colors", low ? "text-amber-700 font-semibold" : "text-muted-foreground")}
      title="Click to update stock"
    >
      {low && item.stockQuantity <= 0 ? "0" : item.stockQuantity}
    </button>
  );
}

function WardrobeTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const sizeOrder = useSizeOrder();
  const { data: products } = useListProducts();
  const { data: items, isLoading } = useSubResource<FinishedItem>(customerId, "finished-items");
  const { data: finishes } = useSubResource<any>(customerId, "finishes");
  const { data: roles } = useSubResource<any>(customerId, "roles");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FinishedItem | null>(null);
  const [editingGroup, setEditingGroup] = useState<WardrobeGroup | null>(null);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<number | null | "all">("all");
  const [variantColours, setVariantColours] = useState<string[]>([]);
  const [variantSleeves, setVariantSleeves] = useState<string[]>([]);
  const [variantSizes, setVariantSizes] = useState<string[]>([]);
  const [selectedColours, setSelectedColours] = useState<string[]>([]);
  const [selectedSleeves, setSelectedSleeves] = useState<string[]>([]);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [freeTextColours, setFreeTextColours] = useState<string[]>([""]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [wardrobeSearch, setWardrobeSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [catalogueAddOpen, setCatalogueAddOpen] = useState(false);
  const [catalogueSearch, setCatalogueSearch] = useState("");
  const [catalogueProductIds, setCatalogueProductIds] = useState<Set<number>>(new Set());
  const [catalogueRoleId, setCatalogueRoleId] = useState<number | null>(null);
  const [catalogueAdding, setCatalogueAdding] = useState(false);

  const blank = { name: "", roleId: null as number | null, productId: 0, finishId: null as number | null, colour: "", sleeve: "", size: "", unitPrice: "", specialPrice: "", stockQuantity: "0", notes: "" };
  const [form, setForm] = useState<typeof blank>(blank);

  const refreshWardrobe = () => qc.refetchQueries({
    queryKey: ["customer", customerId, "finished-items"],
    exact: true,
  });

  const save = useMutation({
    mutationFn: (data: any) => editing
      ? apiFetch(`/customers/${customerId}/finished-items/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch(`/customers/${customerId}/finished-items`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: async () => {
      await refreshWardrobe();
      toast({ title: "Saved" });
      setOpen(false);
      setEditing(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message || "Could not save item", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/finished-items/${id}`, { method: "DELETE" }),
    onSuccess: async () => { await refreshWardrobe(); toast({ title: "Deleted" }); },
  });

  const dup = useMutation({
    mutationFn: (item: FinishedItem) => apiFetch(`/customers/${customerId}/finished-items`, {
      method: "POST",
      body: JSON.stringify({
        name: `${item.name} (copy)`,
        roleId: item.roleId ?? null,
        productId: item.productId,
        finishId: item.finishId ?? null,
        colour: item.colour ?? null,
        size: item.size ?? null,
        unitPrice: item.unitPrice,
        specialPrice: item.specialPrice ?? null,
        notes: item.notes ?? null,
      }),
    }),
    onSuccess: async () => { await refreshWardrobe(); toast({ title: "Item duplicated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message || "Could not duplicate", variant: "destructive" }),
  });

  const toggleExpanded = (key: string) => setExpandedGroups(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const openAdd = () => { setForm(blank); setEditing(null); setEditingGroup(null); setProductSearchOpen(false); setProductSearch(""); setVariantColours([]); setVariantSleeves([]); setVariantSizes([]); setSelectedColours([]); setSelectedSleeves([]); setSelectedSizes([]); setFreeTextColours([""]); setOpen(true); };

  const openCatalogueAdd = () => {
    const workshopRole = (roles as any[])?.find((role: any) => role.name?.trim().toLowerCase() === "workshop");
    setCatalogueRoleId(typeof roleFilter === "number" ? roleFilter : workshopRole?.id ?? null);
    setCatalogueSearch("");
    setCatalogueProductIds(new Set());
    setCatalogueAddOpen(true);
  };

  const toggleCatalogueProduct = (productId: number) => {
    setCatalogueProductIds(previous => {
      const next = new Set(previous);
      if (next.has(productId)) next.delete(productId); else next.add(productId);
      return next;
    });
  };

  const catalogueProducts = (products ?? []).filter(product => {
    const query = catalogueSearch.trim().toLowerCase();
    return !query
      || product.name?.toLowerCase().includes(query)
      || product.sku?.toLowerCase().includes(query);
  });

  const isCatalogueProductAlreadyAdded = (productId: number) => (items ?? []).some(item =>
    item.productId === productId
    && item.roleId === catalogueRoleId
    && item.finishId == null
    && !item.colour
    && !item.sleeve
    && !item.size
  );

  const addCatalogueProducts = async () => {
    const selected = (products ?? []).filter(product => catalogueProductIds.has(product.id));
    if (!selected.length) return;
    setCatalogueAdding(true);
    try {
      const results = await Promise.allSettled(selected.map(product =>
        apiFetch(`/customers/${customerId}/finished-items`, {
          method: "POST",
          body: JSON.stringify({
            name: product.name,
            roleId: catalogueRoleId,
            productId: product.id,
            finishId: null,
            colour: null,
            sleeve: null,
            size: null,
            unitPrice: Number(product.unitPrice ?? 0),
            specialPrice: null,
            stockQuantity: 0,
            notes: null,
          }),
        })
      ));
      const added = results.filter(result => result.status === "fulfilled").length;
      const failed = results.filter(result => result.status === "rejected");
      await refreshWardrobe();
      if (added > 0) {
        toast({
          title: `${added} catalogue ${added === 1 ? "product" : "products"} added`,
          description: "They are now customer-specific wardrobe items.",
        });
      }
      if (failed.length > 0) {
        const firstError = failed[0] as PromiseRejectedResult;
        toast({
          title: `${failed.length} item${failed.length === 1 ? "" : "s"} not added`,
          description: firstError.reason?.message || "Some selected products were already in this wardrobe.",
          variant: "destructive",
        });
      }
      if (added > 0) setCatalogueAddOpen(false);
    } finally {
      setCatalogueAdding(false);
    }
  };

  const toggleColour = (col: string) => {
    setSelectedColours(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);
  };

  const toggleSleeve = (sl: string) => {
    setSelectedSleeves(prev => prev.includes(sl) ? prev.filter(s => s !== sl) : [...prev, sl]);
  };

  const toggleSize = (sz: string) => {
    setSelectedSizes(prev => prev.includes(sz) ? prev.filter(s => s !== sz) : [...prev, sz]);
  };
  const openEdit = (item: FinishedItem) => {
    setForm({
      name: item.name,
      roleId: item.roleId ?? null,
      productId: item.productId,
      finishId: item.finishId ?? null,
      colour: item.colour ?? "",
      sleeve: item.sleeve ?? "",
      size: item.size ?? "",
      unitPrice: item.unitPrice.toFixed(2),
      specialPrice: item.specialPrice != null ? item.specialPrice.toFixed(2) : "",
      stockQuantity: String(item.stockQuantity ?? 0),
      notes: item.notes ?? "",
    });
    setEditing(item);
    setEditingGroup(null);
    setProductSearchOpen(false);
    setVariantColours([]);
    setVariantSleeves([]);
    setVariantSizes([]);
    setSelectedColours([]);
    setSelectedSleeves([]);
    setSelectedSizes([]);
    setFreeTextColours([""]);
    // Load variant colours, sleeves and sizes
    Promise.all([
      apiFetch<any[]>(`/products/${item.productId}/variants`),
      apiFetch<any[]>(`/products/${item.productId}/attributes`),
    ]).then(([variants, attrs]) => {
      const colours = [...new Set(variants.map((x: any) => x.colour).filter(Boolean))] as string[];
      const variantSizes = variants.map((x: any) => x.size).filter(Boolean) as string[];
      const attrSizes = attrs.filter((a: any) => a.type === "size").map((a: any) => a.value) as string[];
      const attrSleeves = attrs.filter((a: any) => a.type === "sleeve").map((a: any) => a.value as string).filter(Boolean);
      const variantSleevesFromVariants = [...new Set(variants.map((x: any) => x.sleeve as string).filter(Boolean))];
      const variantSleeveList = [...new Set([...attrSleeves, ...variantSleevesFromVariants])];
      const sizes = sortSizesWithOrder([...new Set([...attrSizes, ...variantSizes])], sizeOrder);
      setVariantColours(colours);
      setVariantSleeves(variantSleeveList);
      setVariantSizes(sizes);
    }).catch(() => {});
    setOpen(true);
  };

  const selectedProduct = products?.find(p => p.id === form.productId);

  const handleProductSelect = (productId: number) => {
    const prod = products?.find(p => p.id === productId);
    if (!prod) return;
    setProductSearchOpen(false);
    // WooCommerce product prices include the first logo/finish.
    // If a finish with extra logos is already selected, keep those additions.
    setForm(f => {
      const newBase = prod.unitPrice;
      const newPrice = calcPriceForFinish(newBase, f.finishId);
      return { ...f, productId: prod.id, unitPrice: newPrice.toFixed(2), colour: "", sleeve: "", size: "", name: f.name || prod.name };
    });
    setVariantColours([]);
    setVariantSleeves([]);
    setVariantSizes([]);
    setSelectedColours([]);
    setSelectedSleeves([]);
    setSelectedSizes([]);
    Promise.all([
      apiFetch<any[]>(`/products/${prod.id}/variants`),
      apiFetch<any[]>(`/products/${prod.id}/attributes`),
    ]).then(([variants, attrs]) => {
      const colours = [...new Set(variants.map((x: any) => x.colour).filter(Boolean))] as string[];
      const variantSizes = variants.map((x: any) => x.size).filter(Boolean) as string[];
      const attrSizes = attrs.filter((a: any) => a.type === "size").map((a: any) => a.value) as string[];
      const attrSleeves = attrs.filter((a: any) => a.type === "sleeve").map((a: any) => a.value as string).filter(Boolean);
      const variantSleevesFromVariants = [...new Set(variants.map((x: any) => x.sleeve as string).filter(Boolean))];
      const variantSleeveList = [...new Set([...attrSleeves, ...variantSleevesFromVariants])];
      const sizes = sortSizesWithOrder([...new Set([...attrSizes, ...variantSizes])], sizeOrder);
      setVariantColours(colours);
      setVariantSleeves(variantSleeveList);
      setVariantSizes(sizes);
      setSelectedColours([]);
      setSelectedSleeves(variantSleeveList);
      setSelectedSizes(sizes);
    }).catch(() => {});
  };

  const calcPriceForFinish = (basePrice: number, finishId: number | null): number => {
    if (!finishId) return basePrice;
    const finish = finishes?.find((f: any) => f.id === finishId);
    if (!finish || !finish.processes?.length) return basePrice;
    // WooCommerce price already includes the standard £4 primary/main logo.
    // Add the cost of any additional logos on top. Do not infer the included
    // logo from the highest price, because the agreed primary logo is identified
    // by its £4 process rate.
    const prices: number[] = finish.processes.map((p: any) => p.price ?? 0).sort((a: number, b: number) => a - b);
    const included = prices.find(price => Math.abs(Number(price) - 4) < 0.005) ?? 0;
    const extra = finish.totalCost - included;
    return basePrice + Math.max(0, extra);
  };

  const handleFinishChange = (value: string) => {
    const base = selectedProduct?.unitPrice ?? parseFloat(form.unitPrice) ?? 0;
    if (value === "none") {
      setForm(f => ({ ...f, finishId: null, unitPrice: base.toFixed(2) }));
    } else {
      const finishId = Number(value);
      const newPrice = calcPriceForFinish(base, finishId);
      setForm(f => ({ ...f, finishId, unitPrice: newPrice.toFixed(2) }));
    }
  };

  const handleSave = async () => {
    if (!form.productId || !form.unitPrice) return;
    const effectiveName = form.name.trim() || selectedProduct?.name || "";
    const base = {
      name: effectiveName,
      roleId: form.roleId || null,
      productId: form.productId,
      finishId: form.finishId || null,
      unitPrice: parseFloat(form.unitPrice),
      specialPrice: form.specialPrice ? parseFloat(form.specialPrice) : null,
      stockQuantity: parseInt(form.stockQuantity, 10) || 0,
      notes: form.notes || null,
    };

    // Group edit: update shared fields on all items; if extra colours selected, create copies for each
    if (editingGroup) {
      setSaving(true);
      try {
        // Determine target colours — multi-select chips take precedence over free-text colour
        const targetColours: (string | null)[] = variantColours.length > 0 && selectedColours.length > 0
          ? selectedColours
          : [form.colour || null];
        const [firstColour, ...extraColours] = targetColours;

        // Patch all existing items with the first selected colour (preserving each item's size)
        await Promise.all(editingGroup.items.map(item =>
          apiFetch(`/customers/${customerId}/finished-items/${item.id}`, {
            method: "PATCH",
            body: JSON.stringify({ ...base, colour: firstColour ?? null, sleeve: form.sleeve || null, size: item.size }),
          })
        ));

        // Create new items for each additional colour (one per size from the group)
        for (const colour of extraColours) {
          for (const item of editingGroup.items) {
            await apiFetch(`/customers/${customerId}/finished-items`, {
              method: "POST",
              body: JSON.stringify({ ...base, colour: colour ?? null, sleeve: form.sleeve || null, size: item.size }),
            }).catch(() => {}); // Skip silently if the colour+size already exists
          }
        }

        await refreshWardrobe();
        const colourNote = extraColours.length > 0 ? ` + ${extraColours.length} new colour${extraColours.length > 1 ? "s" : ""} added` : "";
        toast({ title: `Group updated (${editingGroup.items.length} sizes${colourNote})` });
        setOpen(false); setEditing(null); setEditingGroup(null);
      } catch (e: any) {
        toast({ title: "Error", description: e.message || "Could not save", variant: "destructive" });
      } finally { setSaving(false); }
      return;
    }

    // Single item edit
    if (editing) {
      save.mutate({ ...base, colour: form.colour || null, sleeve: form.sleeve || null, size: form.size || null });
      return;
    }

    // Add mode: build colour list from chips (variant) or free-text inputs
    let colours: (string | null)[];
    if (variantColours.length > 0) {
      colours = selectedColours.length > 0 ? selectedColours : [null as string | null];
    } else {
      const free = freeTextColours.filter(Boolean);
      colours = free.length > 0 ? free : [form.colour || null];
    }
    const sleevesForCombos: (string | null)[] = selectedSleeves.length > 0 ? selectedSleeves : [null as string | null];
    const sizes = selectedSizes.length > 0 ? selectedSizes : [null as string | null];
    const combos = colours.flatMap(col => sleevesForCombos.flatMap(sl => sizes.map(sz => ({ colour: col, sleeve: sl, size: sz }))));

    if (combos.length === 1) {
      save.mutate({ ...base, colour: combos[0].colour, sleeve: combos[0].sleeve, size: combos[0].size });
      return;
    }

    setSaving(true);
    try {
      await Promise.all(combos.map(({ colour, sleeve, size }) =>
        apiFetch(`/customers/${customerId}/finished-items`, {
          method: "POST",
          body: JSON.stringify({ ...base, colour, sleeve, size }),
        })
      ));
      await refreshWardrobe();
      toast({ title: `${combos.length} items added` });
      setOpen(false);
      setEditing(null);
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Could not save items", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const wardrobeQ = wardrobeSearch.toLowerCase().trim();
  const filteredItems = items?.filter(item => {
    const roleMatch = roleFilter === "all" ? true : roleFilter === null ? item.roleId === null : item.roleId === roleFilter;
    if (!roleMatch) return false;
    if (!wardrobeQ) return true;
    return (
      item.name?.toLowerCase().includes(wardrobeQ) ||
      item.productName?.toLowerCase().includes(wardrobeQ) ||
      item.finishName?.toLowerCase().includes(wardrobeQ) ||
      item.colour?.toLowerCase().includes(wardrobeQ) ||
      item.productSku?.toLowerCase().includes(wardrobeQ)
    );
  }) ?? [];

  const groups = useMemo<WardrobeGroup[]>(() => {
    const map = new Map<string, WardrobeGroup>();
    for (const item of filteredItems) {
      // Key excludes colour so same item in multiple colours collapses to one row
      const key = [item.name, item.roleId ?? "", item.productId, item.finishId ?? ""].join("|");
      if (!map.has(key)) {
        map.set(key, { key, items: [], name: item.name, roleId: item.roleId, roleName: item.roleName, productId: item.productId, productName: item.productName, productSku: item.productSku, finishId: item.finishId, finishName: item.finishName, colour: item.colour, colours: [], sleeve: item.sleeve ?? null, unitPrice: item.unitPrice, productUnitPrice: item.productUnitPrice ?? null, specialPrice: item.specialPrice, totalStock: 0, sizes: [] });
      }
      const g = map.get(key)!;
      if (g.sleeve !== (item.sleeve ?? null)) g.sleeve = null;
      g.items.push(item);
      g.totalStock += (item.stockQuantity ?? 0);
      g.sizes.push(item.size);
      if (item.colour && !g.colours.includes(item.colour)) g.colours.push(item.colour);
    }
    return [...map.values()];
  }, [filteredItems]);

  const openGroupEdit = (group: WardrobeGroup) => {
    const first = group.items[0];
    setForm({ name: group.name, roleId: group.roleId ?? null, productId: group.productId, finishId: group.finishId ?? null, colour: group.colour ?? "", sleeve: group.sleeve ?? "", size: "", unitPrice: group.unitPrice.toFixed(2), specialPrice: group.specialPrice != null ? group.specialPrice.toFixed(2) : "", stockQuantity: "0", notes: first.notes ?? "" });
    setEditing(first);
    setEditingGroup(group);
    setProductSearchOpen(false);
    // Pre-select ALL current colours so they show as already ticked
    setVariantColours([]); setVariantSleeves([]); setVariantSizes([]);
    setSelectedColours(group.colours.length > 0 ? group.colours : group.colour ? [group.colour] : []); setSelectedSleeves([]); setSelectedSizes([]);
    Promise.all([apiFetch<any[]>(`/products/${group.productId}/variants`), apiFetch<any[]>(`/products/${group.productId}/attributes`)]).then(([variants, attrs]) => {
      const colours = [...new Set(variants.map((x: any) => x.colour).filter(Boolean))] as string[];
      const vs = variants.map((x: any) => x.size).filter(Boolean) as string[];
      const as2 = attrs.filter((a: any) => a.type === "size").map((a: any) => a.value) as string[];
      const attrSleeves = attrs.filter((a: any) => a.type === "sleeve").map((a: any) => a.value as string).filter(Boolean);
      setVariantColours(colours);
      setVariantSleeves([...new Set(attrSleeves)]);
      setVariantSizes([...new Set([...as2, ...vs])]);
    }).catch(() => {});
    setOpen(true);
  };

  const WardrobeItemRow = ({ item }: { item: FinishedItem }) => (
    <TableRow key={item.id} className="group hover:bg-muted/30">
      <TableCell className="font-medium">
        <div>
          <p>{item.name}</p>
          {item.roleName && <span className="text-[10px] font-medium text-primary/70 bg-primary/5 border border-primary/10 rounded px-1">{item.roleName}</span>}
        </div>
      </TableCell>
      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
        {item.productName || "—"}
        {item.productSku && <span className="ml-1 text-xs text-muted-foreground/60">({item.productSku})</span>}
      </TableCell>
      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
        {item.finishName
          ? <span className="inline-flex items-center gap-1"><Sparkles className="w-3 h-3 text-amber-500" />{item.finishName}</span>
          : <span className="text-muted-foreground/50">Plain</span>}
      </TableCell>
      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
        {[item.colour, item.sleeve, item.size].filter(Boolean).join(" / ") || "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{formatCurrency(item.productUnitPrice ?? item.unitPrice)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {item.specialPrice != null
          ? <span className="font-semibold text-emerald-600">{formatCurrency(item.specialPrice)}</span>
          : <span className="text-muted-foreground/40 text-xs">—</span>}
      </TableCell>
      <TableCell className="text-right">
        <WardrobeStockCell item={item} onSave={(qty) => save.mutate({ name: item.name, roleId: item.roleId, productId: item.productId, finishId: item.finishId, colour: item.colour, sleeve: item.sleeve, size: item.size, unitPrice: item.unitPrice, specialPrice: item.specialPrice, stockQuantity: qty, notes: item.notes })} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-muted" title="Duplicate item" onClick={() => dup.mutate(item)} disabled={dup.isPending}><Copy className="w-3 h-3" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(item)}><Edit2 className="w-3 h-3" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Delete this finished item?") && del.mutate(item.id)}><Trash2 className="w-3 h-3" /></Button>
        </div>
      </TableCell>
    </TableRow>
  );

  const WardrobeGroupRow = ({ group }: { group: WardrobeGroup }) => {
    const isMulti = group.items.length > 1;
    const isExpanded = expandedGroups.has(group.key);
    const deleteGroup = () => {
      const msg = isMulti ? `Delete all ${group.items.length} sizes of "${group.name}"?` : `Delete "${group.name}"?`;
      if (!confirm(msg)) return;
      group.items.forEach(item => del.mutate(item.id));
    };
    return (
      <>
        <TableRow className="group hover:bg-muted/30">
          <TableCell className="font-medium">
            <div className="flex items-center gap-1">
              {isMulti && (
                <button className="text-muted-foreground hover:text-foreground shrink-0" onClick={() => toggleExpanded(group.key)} title={isExpanded ? "Collapse" : "Expand sizes"}>
                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
              )}
              <div>
                <p>{group.name}</p>
                {group.roleName && <span className="text-[10px] font-medium text-primary/70 bg-primary/5 border border-primary/10 rounded px-1">{group.roleName}</span>}
              </div>
            </div>
          </TableCell>
          <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
            {group.productName || "—"}
            {group.productSku && <span className="ml-1 text-xs text-muted-foreground/60">({group.productSku})</span>}
          </TableCell>
          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
            {group.finishName
              ? <span className="inline-flex items-center gap-1"><Sparkles className="w-3 h-3 text-amber-500" />{group.finishName}</span>
              : <span className="text-muted-foreground/50">Plain</span>}
          </TableCell>
          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
            <div className="space-y-0.5">
              {group.colours.length > 1 ? (
                <div className="flex flex-wrap gap-0.5">
                  {group.colours.map((c, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded text-[10px] bg-blue-50 border border-blue-200 font-medium text-blue-700">{c}</span>
                  ))}
                </div>
              ) : (
                [group.colour, group.sleeve].filter(Boolean).map((v, i) => (
                  <span key={i} className="text-foreground/70">{v} </span>
                ))
              )}
              {isMulti && (
                <div className="flex flex-wrap gap-0.5">
                  {sortSizesWithOrder([...new Set(group.sizes.filter(Boolean) as string[])], sizeOrder).map((sz, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded text-[10px] bg-muted border border-border font-medium text-foreground/60">{sz}</span>
                  ))}
                  {group.sizes.some(s => !s) && <span className="px-1.5 py-0.5 rounded text-[10px] bg-muted border border-border font-medium text-foreground/60">—</span>}
                </div>
              )}
              {!isMulti && (
                <span>{group.items[0].size || ""}</span>
              )}
            </div>
          </TableCell>
          <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{formatCurrency(group.productUnitPrice ?? group.unitPrice)}</TableCell>
          <TableCell className="text-right tabular-nums">
            {group.specialPrice != null
              ? <span className="font-semibold text-emerald-600">{formatCurrency(group.specialPrice)}</span>
              : <span className="text-muted-foreground/40 text-xs">—</span>}
          </TableCell>
          <TableCell className="text-right">
            {isMulti ? (
              <span className="tabular-nums text-sm text-muted-foreground">{group.totalStock}</span>
            ) : (
              <WardrobeStockCell item={group.items[0]} onSave={(qty) => save.mutate({ name: group.name, roleId: group.roleId, productId: group.productId, finishId: group.finishId, colour: group.colour, sleeve: group.sleeve, size: group.items[0].size, unitPrice: group.unitPrice, specialPrice: group.specialPrice, stockQuantity: qty, notes: group.items[0].notes })} />
            )}
          </TableCell>
          <TableCell className="text-right">
            <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {!isMulti && group.colours.length <= 1 && <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-muted" title="Duplicate" onClick={() => dup.mutate(group.items[0])} disabled={dup.isPending}><Copy className="w-3 h-3" /></Button>}
              <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" title={isMulti || group.colours.length > 1 ? "Edit group" : "Edit"} onClick={() => (isMulti || group.colours.length > 1) ? openGroupEdit(group) : openEdit(group.items[0])}><Edit2 className="w-3 h-3" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={deleteGroup}><Trash2 className="w-3 h-3" /></Button>
            </div>
          </TableCell>
        </TableRow>
        {isExpanded && sortBySizeWithOrder(group.items, (i: any) => i.size, sizeOrder).map(item => (
          <TableRow key={item.id} className="bg-muted/20 hover:bg-muted/30 group">
            <TableCell colSpan={3} className="pl-8 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                {group.colours.length > 1 && item.colour && (
                  <span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 font-medium text-blue-700">{item.colour}</span>
                )}
                <span className="px-1.5 py-0.5 rounded bg-muted border border-border font-medium text-foreground/60">{item.size || "—"}</span>
              </span>
            </TableCell>
            <TableCell className="hidden md:table-cell" />
            <TableCell colSpan={2} />
            <TableCell className="text-right">
              <WardrobeStockCell item={item} onSave={(qty) => save.mutate({ name: item.name, roleId: item.roleId, productId: item.productId, finishId: item.finishId, colour: item.colour, sleeve: item.sleeve, size: item.size, unitPrice: item.unitPrice, specialPrice: item.specialPrice, stockQuantity: qty, notes: item.notes })} />
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(item)}><Edit2 className="w-3 h-3" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Delete this size?") && del.mutate(item.id)}><Trash2 className="w-3 h-3" /></Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </>
    );
  };

  return (
    <>
      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">Pre-configured items — company-wide or specific to a role.</p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={wardrobeSearch}
              onChange={e => setWardrobeSearch(e.target.value)}
              placeholder="Search items…"
              className="pl-8 h-8 text-sm w-48"
            />
          </div>
          <Button size="sm" variant="outline" onClick={openCatalogueAdd}><ShoppingBag className="w-4 h-4 mr-1" /> Add from Catalogue</Button>
          <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Item</Button>
        </div>
      </div>

      {(roles as any[])?.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button onClick={() => setRoleFilter("all")} className={cn("px-3 py-1 rounded-full text-xs font-medium transition-colors", roleFilter === "all" ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}>All</button>
          <button onClick={() => setRoleFilter(null)} className={cn("px-3 py-1 rounded-full text-xs font-medium transition-colors", roleFilter === null ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}>Company-wide</button>
          {(roles as any[]).map((r: any) => (
            <button key={r.id} onClick={() => setRoleFilter(r.id)} className={cn("px-3 py-1 rounded-full text-xs font-medium transition-colors", roleFilter === r.id ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}>{r.name}</button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : !filteredItems.length ? (
        <EmptyState icon={ShoppingBag} label="finished items" onAdd={openAdd} />
      ) : (
        <SubTable>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Product</TableHead>
              <TableHead className="hidden md:table-cell">Finish</TableHead>
              <TableHead className="hidden md:table-cell">Colour / Size</TableHead>
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead className="text-right">Special Price</TableHead>
              <TableHead className="text-right">In Stock</TableHead>
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map(group => <WardrobeGroupRow key={group.key} group={group} />)}
          </TableBody>
        </SubTable>
      )}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); setEditingGroup(null); } }}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingGroup
                ? `Edit Group — ${editingGroup.items.length} sizes`
                : editing ? "Edit Finished Item" : "Add Finished Item"}
            </DialogTitle>
            {editingGroup && <p className="text-xs text-muted-foreground pt-1">Changes to name, role, product, finish, colour, and price will apply to all {editingGroup.items.length} sizes.</p>}
          </DialogHeader>
          <div className="grid gap-4 py-2">

            <div className="grid gap-2">
              <Label>Name <span className="text-muted-foreground font-normal text-xs">(defaults to product name)</span></Label>
              <input
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Optional — leave blank to use product name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="grid gap-2">
              <Label>Assign to Role</Label>
              <Select value={form.roleId ? form.roleId.toString() : "none"} onValueChange={v => setForm(f => ({ ...f, roleId: v === "none" ? null : Number(v) }))}>
                <SelectTrigger><SelectValue placeholder="Company-wide (no role)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Company-wide (no role)</SelectItem>
                  {(roles as any[])?.map((r: any) => <SelectItem key={r.id} value={r.id.toString()}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Company-wide items appear for all orders; role items are shown when ordering for that role.</p>
            </div>

            <div className="grid gap-2">
              <Label>Product *</Label>
              <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                    {selectedProduct ? selectedProduct.name : "Search products..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Type product name or SKU..."
                      value={productSearch}
                      onValueChange={setProductSearch}
                    />
                    <CommandList>
                      <CommandEmpty>No products found.</CommandEmpty>
                      <CommandGroup>
                        {(products ?? [])
                          .filter(p => {
                            const q = productSearch.toLowerCase();
                            if (!q) return true;
                            return (p.name ?? "").toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q);
                          })
                          .map(p => (
                            <CommandItem key={p.id} value={String(p.id)} onSelect={() => { handleProductSelect(p.id); setProductSearch(""); }}>
                              <Check className={cn("mr-2 h-4 w-4", form.productId === p.id ? "opacity-100" : "opacity-0")} />
                              <span className="flex-1">{p.name}</span>
                              {p.sku && <span className="text-xs text-muted-foreground mr-2">{p.sku}</span>}
                              <span className="text-xs font-semibold">{formatCurrency(p.unitPrice)}</span>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="grid gap-2">
              <Label className="flex items-center gap-1"><Sparkles className="w-3 h-3" /> Finish</Label>
              <Select
                value={form.finishId ? form.finishId.toString() : "none"}
                onValueChange={handleFinishChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Plain (no finish)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Plain (no finish)</SelectItem>
                  {(finishes as any[])?.map((f: any) => (
                    <SelectItem key={f.id} value={f.id.toString()}>
                      {f.name}
                      {f.totalCost > 0 && <span className="ml-2 text-xs text-muted-foreground">+{formatCurrency(f.totalCost)}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label className="flex items-center gap-1"><Palette className="w-3 h-3" /> Colour{editingGroup && <span className="font-normal text-muted-foreground text-[10px] ml-1">(select all that apply — new colours will be added)</span>}</Label>
              {editingGroup ? (
                /* Group edit — multi-select so staff can add colours in one step */
                variantColours.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {variantColours.map(col => (
                      <button key={col} type="button"
                        onClick={() => toggleColour(col)}
                        className={cn("px-2.5 py-1 rounded-full text-xs font-medium border transition-colors", selectedColours.includes(col) ? "bg-primary text-white border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary/50")}
                      >{col}</button>
                    ))}
                    {variantColours.length > 1 && (
                      <button type="button" onClick={() => setSelectedColours(selectedColours.length === variantColours.length ? [] : [...variantColours])}
                        className="px-2.5 py-1 rounded-full text-xs font-medium border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary/50 transition-colors">
                        {selectedColours.length === variantColours.length ? "None" : "All"}
                      </button>
                    )}
                  </div>
                ) : (
                  <input className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" placeholder="e.g. Navy Blue (optional)" value={form.colour} onChange={e => setForm(f => ({ ...f, colour: e.target.value }))} />
                )
              ) : editing ? (
                /* Single item edit — single-select pills */
                variantColours.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button"
                      onClick={() => setForm(f => ({ ...f, colour: "" }))}
                      className={cn("px-2.5 py-1 rounded-full text-xs font-medium border transition-colors", !form.colour ? "bg-primary text-white border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary/50")}
                    >Any colour</button>
                    {variantColours.map(col => (
                      <button key={col} type="button"
                        onClick={() => setForm(f => ({ ...f, colour: f.colour === col ? "" : col }))}
                        className={cn("px-2.5 py-1 rounded-full text-xs font-medium border transition-colors", form.colour === col ? "bg-primary text-white border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary/50")}
                      >{col}</button>
                    ))}
                  </div>
                ) : (
                  <input className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" placeholder="e.g. Navy Blue (optional)" value={form.colour} onChange={e => setForm(f => ({ ...f, colour: e.target.value }))} />
                )
              ) : (
                /* Add mode — multi-select chips (variant) or dynamic free-text rows */
                variantColours.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {variantColours.map(col => (
                      <button key={col} type="button"
                        onClick={() => toggleColour(col)}
                        className={cn("px-2.5 py-1 rounded-full text-xs font-medium border transition-colors", selectedColours.includes(col) ? "bg-primary text-white border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary/50")}
                      >{col}</button>
                    ))}
                    {variantColours.length > 1 && (
                      <button type="button" onClick={() => setSelectedColours(selectedColours.length === variantColours.length ? [] : [...variantColours])}
                        className="px-2.5 py-1 rounded-full text-xs font-medium border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary/50 transition-colors">
                        {selectedColours.length === variantColours.length ? "None" : "All"}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {freeTextColours.map((col, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          className="flex h-9 flex-1 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          placeholder="e.g. Navy Blue (optional)"
                          value={col}
                          onChange={e => {
                            const next = freeTextColours.map((c, idx) => idx === i ? e.target.value : c);
                            setFreeTextColours(next);
                          }}
                        />
                        {freeTextColours.length > 1 && (
                          <button type="button" className="h-9 w-9 shrink-0 flex items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors" onClick={() => setFreeTextColours(prev => prev.filter((_, idx) => idx !== i))}><X className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    ))}
                    <button type="button" className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors py-0.5" onClick={() => setFreeTextColours(prev => [...prev, ""])}>
                      <Plus className="w-3 h-3" /> Add another colour
                    </button>
                  </div>
                )
              )}
            </div>

            {variantSleeves.length > 0 && (
              <div className="grid gap-2">
                <Label className="flex items-center gap-1"><Ruler className="w-3 h-3" /> Fit / Length</Label>
                {editing || editingGroup ? (
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button"
                      onClick={() => setForm(f => ({ ...f, sleeve: "" }))}
                      className={cn("px-2.5 py-1 rounded-full text-xs font-medium border transition-colors", !form.sleeve ? "bg-primary text-white border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary/50")}
                    >Any</button>
                    {variantSleeves.map(sl => (
                      <button key={sl} type="button"
                        onClick={() => setForm(f => ({ ...f, sleeve: f.sleeve === sl ? "" : sl }))}
                        className={cn("px-2.5 py-1 rounded-full text-xs font-medium border transition-colors", form.sleeve === sl ? "bg-primary text-white border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary/50")}
                      >{sl}</button>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {variantSleeves.map(sl => (
                      <button key={sl} type="button"
                        onClick={() => toggleSleeve(sl)}
                        className={cn("px-2.5 py-1 rounded-full text-xs font-medium border transition-colors", selectedSleeves.includes(sl) ? "bg-primary text-white border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary/50")}
                      >{sl}</button>
                    ))}
                    {variantSleeves.length > 1 && (
                      <button type="button" onClick={() => setSelectedSleeves(selectedSleeves.length === variantSleeves.length ? [] : [...variantSleeves])}
                        className="px-2.5 py-1 rounded-full text-xs font-medium border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary/50 transition-colors">
                        {selectedSleeves.length === variantSleeves.length ? "None" : "All"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {!editingGroup && <div className="grid gap-2">
              <Label className="flex items-center gap-1"><Ruler className="w-3 h-3" /> Size</Label>
              {editing ? (
                /* Edit mode — single value */
                <Select value={form.size || "__none__"} onValueChange={v => setForm(f => ({ ...f, size: v === "__none__" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="Any size" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Any size</SelectItem>
                    {variantSizes.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : variantSizes.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Select a product to see available sizes</p>
              ) : (
                /* Add mode — multi-select chips */
                <div className="flex flex-wrap gap-1.5">
                  {variantSizes.map(sz => (
                    <button key={sz} type="button"
                      onClick={() => toggleSize(sz)}
                      className={cn("px-2.5 py-1 rounded-full text-xs font-medium border transition-colors", selectedSizes.includes(sz) ? "bg-primary text-white border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary/50")}
                    >{sz}</button>
                  ))}
                  <button type="button" onClick={() => setSelectedSizes(selectedSizes.length === variantSizes.length ? [] : [...variantSizes])}
                    className="px-2.5 py-1 rounded-full text-xs font-medium border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary/50 transition-colors">
                    {selectedSizes.length === variantSizes.length ? "None" : "All"}
                  </button>
                </div>
              )}
              {!editing && !editingGroup && (() => {
                const colCount = variantColours.length > 0 ? (selectedColours.length || 1) : (freeTextColours.filter(Boolean).length || 1);
                const slCount = variantSleeves.length > 0 ? (selectedSleeves.length || 1) : 1;
                const szCount = selectedSizes.length || 1;
                const total = colCount * slCount * szCount;
                return (total > 1) && (
                  <p className="text-xs text-muted-foreground">
                    Will create <strong>{total}</strong> wardrobe item{total > 1 ? "s" : ""}.
                  </p>
                );
              })()}
            </div>}

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="flex items-center gap-1"><PoundSterling className="w-3 h-3" /> Unit Price *</Label>
                <input
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={form.unitPrice}
                  onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value }))}
                  onWheel={e => (e.target as HTMLInputElement).blur()}
                />
                <p className="text-xs text-muted-foreground">WooCommerce price includes the first logo. Extra logos in the finish are added on top. Override manually if needed.</p>
              </div>
              <div className="grid gap-2">
                <Label className="flex items-center gap-1"><PoundSterling className="w-3 h-3" /> Special Price</Label>
                <input
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Optional override"
                  value={form.specialPrice}
                  onChange={e => setForm(f => ({ ...f, specialPrice: e.target.value }))}
                  onWheel={e => (e.target as HTMLInputElement).blur()}
                />
                <p className="text-xs text-muted-foreground">Customer-specific price override.</p>
              </div>
              {!editingGroup && <div className="grid gap-2">
                <Label className="flex items-center gap-1">Stock Qty</Label>
                <input
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={form.stockQuantity}
                  onChange={e => setForm(f => ({ ...f, stockQuantity: e.target.value }))}
                  onWheel={e => (e.target as HTMLInputElement).blur()}
                />
                <p className="text-xs text-muted-foreground">Finished (branded) units in stock.</p>
              </div>}
            </div>

            <div className="grid gap-2">
              <Label>Notes</Label>
              <Textarea rows={2} placeholder="Optional notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); setEditingGroup(null); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={save.isPending || saving || !form.productId || !form.unitPrice}>
              {(save.isPending || saving) ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={catalogueAddOpen} onOpenChange={setCatalogueAddOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Add Catalogue Products to Wardrobe</DialogTitle>
            <DialogDescription>
              Adds plain, customer-specific wardrobe entries. You can configure finishes, colours, sizes, and pricing afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Assign to role</Label>
              <Select value={catalogueRoleId?.toString() ?? "none"} onValueChange={value => setCatalogueRoleId(value === "none" ? null : Number(value))}>
                <SelectTrigger><SelectValue placeholder="Choose a role" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Company-wide (no role)</SelectItem>
                  {(roles as any[])?.map((role: any) => <SelectItem key={role.id} value={String(role.id)}>{role.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">For this customer, choose Workshop to make the items available to Workshop employees and portal users.</p>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input value={catalogueSearch} onChange={event => setCatalogueSearch(event.target.value)} placeholder="Search catalogue by product name or SKU…" className="pl-8" autoFocus />
            </div>
            <div className="max-h-72 overflow-y-auto rounded-md border">
              {catalogueProducts.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No catalogue products match your search.</p>
              ) : catalogueProducts.map(product => {
                const alreadyAdded = isCatalogueProductAlreadyAdded(product.id);
                const selected = catalogueProductIds.has(product.id);
                return (
                  <button
                    key={product.id}
                    type="button"
                    disabled={alreadyAdded}
                    onClick={() => toggleCatalogueProduct(product.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 text-left border-b last:border-b-0 transition-colors",
                      alreadyAdded ? "bg-muted/40 text-muted-foreground cursor-not-allowed" : selected ? "bg-primary/5" : "hover:bg-muted/60",
                    )}
                  >
                    <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", selected ? "bg-primary border-primary text-white" : "border-input bg-background")}>
                      {selected && <Check className="w-3 h-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{product.name}</span>
                      {product.sku && <span className="block truncate text-xs text-muted-foreground">{product.sku}</span>}
                    </span>
                    <span className="shrink-0 text-sm font-medium">{formatCurrency(product.unitPrice)}</span>
                    {alreadyAdded && <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide">Already added</span>}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{catalogueProductIds.size} selected</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatalogueAddOpen(false)} disabled={catalogueAdding}>Cancel</Button>
            <Button onClick={addCatalogueProducts} disabled={catalogueAdding || catalogueProductIds.size === 0}>
              {catalogueAdding ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Adding…</> : `Add ${catalogueProductIds.size || ""} Selected`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Payment Methods Tab ──────────────────────────────────────────────────────

let stripePromise: ReturnType<typeof loadStripe> | null = null;
async function getStripePromise() {
  if (!stripePromise) {
    const res = await fetch("/api/stripe/publishable-key");
    if (!res.ok) throw new Error("Failed to load Stripe key");
    const { publishableKey } = await res.json();
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
}

function AddCardForm({ customerId, onSuccess }: { customerId: number; onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    try {
      const { clientSecret } = await apiFetch(`/stripe/customers/${customerId}/setup-intent`, { method: "POST" });
      const card = elements.getElement(CardElement);
      if (!card) throw new Error("Card element not found");
      const result = await stripe.confirmCardSetup(clientSecret, { payment_method: { card } });
      if (result.error) throw new Error(result.error.message);
      toast({ title: "Card saved", description: "Payment method added successfully." });
      onSuccess();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-md border border-input bg-background p-3">
        <CardElement options={{ style: { base: { fontSize: "15px", color: "#1a1a1a", "::placeholder": { color: "#9ca3af" } } } }} />
      </div>
      <Button type="submit" disabled={!stripe || loading} className="w-full">
        {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : <><CreditCard className="w-4 h-4 mr-2" /> Save Card</>}
      </Button>
    </form>
  );
}

function PaymentMethodsTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [stripeReady, setStripeReady] = useState<ReturnType<typeof loadStripe> | null>(null);

  const { data, isLoading, error } = useQuery<{ paymentMethods: any[] }>({
    queryKey: ["stripe-payment-methods", customerId],
    queryFn: () => apiFetch(`/stripe/customers/${customerId}/payment-methods`),
    retry: false,
  });

  const deleteMut = useMutation({
    mutationFn: (pmId: string) => apiFetch(`/stripe/customers/${customerId}/payment-methods/${pmId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stripe-payment-methods", customerId] });
      toast({ title: "Card removed" });
    },
    onError: () => toast({ title: "Failed to remove card", variant: "destructive" }),
  });

  const openAdd = async () => {
    try {
      const sp = await getStripePromise();
      setStripeReady(sp);
      setShowAdd(true);
    } catch {
      toast({ title: "Stripe not available", description: "Could not connect to Stripe.", variant: "destructive" });
    }
  };

  const cardBrand = (brand: string) => brand.charAt(0).toUpperCase() + brand.slice(1);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-base">Saved Payment Methods</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Card details are stored securely by Stripe. The application never sees raw card numbers.</p>
        </div>
        <Button size="sm" onClick={openAdd}>
          <Plus className="w-4 h-4 mr-1" /> Add Card
        </Button>
      </div>

      {isLoading ? (
        <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : error ? (
        <div className="py-8 text-center text-muted-foreground">
          <AlertCircle className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
          <p className="text-sm">Could not load payment methods. Make sure Stripe is connected.</p>
        </div>
      ) : !data?.paymentMethods?.length ? (
        <div className="py-8 text-center text-muted-foreground">
          <CreditCard className="w-10 h-10 mx-auto mb-2 text-muted-foreground/30" />
          <p className="text-sm">No cards saved yet</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={openAdd}><Plus className="w-3 h-3 mr-1" /> Add Card</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {data.paymentMethods.map((pm: any) => (
            <div key={pm.id} className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
              <div className="flex items-center gap-3">
                <CreditCard className="w-5 h-5 text-muted-foreground" />
                <div>
                  <div className="font-medium text-sm">{cardBrand(pm.card.brand)} •••• {pm.card.last4}</div>
                  <div className="text-xs text-muted-foreground">Expires {pm.card.exp_month}/{pm.card.exp_year}</div>
                </div>
              </div>
              <Button
                variant="ghost" size="icon"
                className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                onClick={() => { if (confirm("Remove this card?")) deleteMut.mutate(pm.id); }}
                disabled={deleteMut.isPending}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CreditCard className="w-4 h-4" /> Add Payment Card</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Card details are sent directly to Stripe and never touch our servers.</p>
          {stripeReady && (
            <Elements stripe={stripeReady}>
              <AddCardForm
                customerId={customerId}
                onSuccess={() => {
                  setShowAdd(false);
                  qc.invalidateQueries({ queryKey: ["stripe-payment-methods", customerId] });
                }}
              />
            </Elements>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Bespoke Products Tab ─────────────────────────────────────────────────────

// ─── Finish Stock Tab ──────────────────────────────────────────────────────────
function FinishStockTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const blankForm = { productName: "", colour: "", size: "", sku: "", quantity: "0", notes: "" };
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState(blankForm);

  const inv = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "finish-stock"] });

  const { data: items = [], isLoading } = useQuery<any[]>({
    queryKey: ["customer", customerId, "finish-stock"],
    queryFn: () => apiFetch(`/customers/${customerId}/finish-stock`),
  });

  const save = useMutation({
    mutationFn: (data: any) => editing
      ? apiFetch(`/customers/${customerId}/finish-stock/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch(`/customers/${customerId}/finish-stock`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { inv(); toast({ title: editing ? "Item updated" : "Item added" }); setOpen(false); setEditing(null); setForm(blankForm); },
    onError: (e: any) => toast({ title: e.message || "Error saving item", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/finish-stock/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Item removed" }); },
    onError: () => toast({ title: "Error removing item", variant: "destructive" }),
  });

  const openAdd = () => { setForm(blankForm); setEditing(null); setOpen(true); };
  const openEdit = (item: any) => {
    setForm({
      productName: item.product_name || "",
      colour: item.colour || "",
      size: item.size || "",
      sku: item.sku || "",
      quantity: String(item.quantity ?? 0),
      notes: item.notes || "",
    });
    setEditing(item);
    setOpen(true);
  };

  const handleSave = () => {
    if (!form.productName.trim()) { toast({ title: "Product name is required", variant: "destructive" }); return; }
    save.mutate({
      productName: form.productName.trim(),
      colour: form.colour.trim() || null,
      size: form.size.trim() || null,
      sku: form.sku.trim() || null,
      quantity: parseInt(form.quantity, 10) || 0,
      notes: form.notes.trim() || null,
    });
  };

  const totalQty = items.reduce((s: number, i: any) => s + (i.quantity || 0), 0);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Decorated items with logo already applied, held in stock for this customer.
            {totalQty > 0 && <span className="ml-2 font-medium text-foreground">{totalQty} unit{totalQty !== 1 ? "s" : ""} total</span>}
          </p>
        </div>
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Item</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
          <Warehouse className="w-10 h-10 opacity-30" />
          <p className="text-sm">No finish stock recorded. Add items that are decorated and held ready for this customer.</p>
          <Button size="sm" variant="outline" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add first item</Button>
        </div>
      ) : (
        <div className="border border-border/50 rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Product</TableHead>
                <TableHead className="w-[120px]">Colour</TableHead>
                <TableHead className="w-[100px]">Size</TableHead>
                <TableHead className="w-[120px]">SKU</TableHead>
                <TableHead className="w-[80px] text-right">Qty</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-[80px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium text-sm">{item.product_name}</TableCell>
                  <TableCell className="text-sm">{item.colour || <span className="text-muted-foreground italic">Any</span>}</TableCell>
                  <TableCell className="text-sm">{item.size || <span className="text-muted-foreground italic">Any</span>}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{item.sku || "—"}</TableCell>
                  <TableCell className="text-right">
                    <span className={cn("font-mono text-sm font-semibold tabular-nums", item.quantity <= 5 && item.quantity > 0 && "text-amber-700", item.quantity === 0 && "text-muted-foreground")}>
                      {item.quantity <= 5 && item.quantity > 0 && <AlertCircle className="w-3 h-3 inline mr-1 text-amber-500" />}
                      {item.quantity}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{item.notes || "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(item)}><Edit2 className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => del.mutate(item.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={v => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Finish Stock Item" : "Add Finish Stock Item"}</DialogTitle>
            <DialogDescription>Decorated items held in stock ready for this customer.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Product Name <span className="text-destructive">*</span></Label>
              <Input value={form.productName} onChange={e => setForm(f => ({ ...f, productName: e.target.value }))} placeholder="e.g. Kinetic Hoodie" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Colour</Label>
                <Input value={form.colour} onChange={e => setForm(f => ({ ...f, colour: e.target.value }))} placeholder="e.g. Navy Blue" />
              </div>
              <div className="space-y-1.5">
                <Label>Size</Label>
                <Input value={form.size} onChange={e => setForm(f => ({ ...f, size: e.target.value }))} placeholder="e.g. M" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>SKU</Label>
                <Input value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} placeholder="Optional" />
              </div>
              <div className="space-y-1.5">
                <Label>Quantity</Label>
                <Input type="number" min={0} value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. Left chest embroidery, ready for dispatch" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={save.isPending}>
              {save.isPending ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Saving…</> : editing ? "Save changes" : "Add item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function BespokeProductsTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [variantForm, setVariantForm] = useState<{ colour: string; size: string; price: string }>({ colour: "", size: "", price: "" });
  const [addingVariantFor, setAddingVariantFor] = useState<number | null>(null);

  const blankForm = { name: "", sku: "", description: "", unitPrice: "", category: "", supplierCode: "", supplierPrice: "" };
  const [form, setForm] = useState(blankForm);

  const inv = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "bespoke-products"] });

  const { data: products, isLoading } = useQuery<any[]>({
    queryKey: ["customer", customerId, "bespoke-products"],
    queryFn: () => apiFetch(`/customers/${customerId}/bespoke-products`),
  });

  const variantQueries = useQuery<Record<number, any[]>>({
    queryKey: ["customer", customerId, "bespoke-product-variants", expanded],
    queryFn: async () => {
      const results: Record<number, any[]> = {};
      await Promise.all(
        [...expanded].map(async (productId) => {
          const v = await apiFetch<any[]>(`/customers/${customerId}/bespoke-products/${productId}/variants`);
          results[productId] = v;
        })
      );
      return results;
    },
    enabled: expanded.size > 0,
  });

  const save = useMutation({
    mutationFn: (data: any) => editing
      ? apiFetch(`/customers/${customerId}/bespoke-products/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch(`/customers/${customerId}/bespoke-products`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { inv(); toast({ title: "Saved" }); setOpen(false); setEditing(null); setForm(blankForm); },
    onError: () => toast({ title: "Error saving product", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/bespoke-products/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Product deleted" }); },
    onError: () => toast({ title: "Error deleting product", variant: "destructive" }),
  });

  const addVariant = useMutation({
    mutationFn: ({ productId, data }: { productId: number; data: any }) =>
      apiFetch(`/customers/${customerId}/bespoke-products/${productId}/variants`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customer", customerId, "bespoke-product-variants"] }); setAddingVariantFor(null); setVariantForm({ colour: "", size: "", price: "" }); toast({ title: "Variant added" }); },
    onError: () => toast({ title: "Error adding variant", variant: "destructive" }),
  });

  const deleteVariant = useMutation({
    mutationFn: ({ productId, variantId }: { productId: number; variantId: number }) =>
      apiFetch(`/customers/${customerId}/bespoke-products/${productId}/variants/${variantId}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customer", customerId, "bespoke-product-variants"] }); toast({ title: "Variant removed" }); },
    onError: () => toast({ title: "Error removing variant", variant: "destructive" }),
  });

  const openAdd = () => { setForm(blankForm); setEditing(null); setOpen(true); };
  const openEdit = (p: any) => {
    setForm({ name: p.name || "", sku: p.sku || "", description: p.description || "", unitPrice: String(p.unitPrice || ""), category: p.category || "", supplierCode: p.supplierCode || "", supplierPrice: p.supplierPrice != null ? String(p.supplierPrice) : "" });
    setEditing(p);
    setOpen(true);
  };

  const toggleExpand = (id: number) => setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const handleSave = () => {
    save.mutate({
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      description: form.description.trim() || null,
      unitPrice: parseFloat(form.unitPrice) || 0,
      category: form.category.trim() || null,
      supplierCode: form.supplierCode.trim() || null,
      supplierPrice: form.supplierPrice ? parseFloat(form.supplierPrice) : null,
    });
  };

  const variantData = variantQueries.data ?? {};

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-muted-foreground">Products exclusive to this customer — visible on their portal, not on WooCommerce.</p>
        </div>
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Product</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : !products?.length ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
          <Package className="w-10 h-10 opacity-30" />
          <p className="text-sm">No bespoke products yet. Add one to make it available on this customer's portal.</p>
          <Button size="sm" variant="outline" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add first product</Button>
        </div>
      ) : (
        <div className="border border-border/50 rounded-lg overflow-hidden divide-y divide-border/40">
          {products.map((p: any) => {
            const isExpanded = expanded.has(p.id);
            const variants: any[] = variantData[p.id] ?? [];
            return (
              <div key={p.id}>
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <button className="text-muted-foreground hover:text-foreground transition-colors" onClick={() => toggleExpand(p.id)}>
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{p.name}</span>
                      {p.sku && <span className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{p.sku}</span>}
                      {p.category && <Badge variant="outline" className="text-xs">{p.category}</Badge>}
                      <Badge className="text-xs bg-purple-100 text-purple-700 border-purple-200">Bespoke</Badge>
                    </div>
                    {p.description && <p className="text-xs text-muted-foreground mt-0.5 truncate"><KitDesignerText>{p.description}</KitDesignerText></p>}
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <span className="font-semibold text-sm">£{parseFloat(p.unitPrice).toFixed(2)}</span>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(p)}><Edit2 className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:bg-red-50" onClick={() => { if (confirm("Delete this bespoke product?")) del.mutate(p.id); }}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="bg-muted/20 px-6 pb-4 pt-2 border-t border-border/30">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Variants (Colours / Sizes)</p>
                      <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => setAddingVariantFor(addingVariantFor === p.id ? null : p.id)}>
                        <Plus className="w-3 h-3 mr-1" /> Add Variant
                      </Button>
                    </div>

                    {addingVariantFor === p.id && (
                      <div className="flex gap-2 mb-3 flex-wrap">
                        <Input placeholder="Colour" className="h-7 text-xs flex-1 min-w-24" value={variantForm.colour} onChange={e => setVariantForm(v => ({ ...v, colour: e.target.value }))} />
                        <Input placeholder="Size" className="h-7 text-xs flex-1 min-w-20" value={variantForm.size} onChange={e => setVariantForm(v => ({ ...v, size: e.target.value }))} />
                        <Input placeholder="Price (£)" type="number" className="h-7 text-xs flex-1 min-w-20" value={variantForm.price} onChange={e => setVariantForm(v => ({ ...v, price: e.target.value }))} />
                        <Button size="sm" className="h-7 text-xs px-3" onClick={() => addVariant.mutate({ productId: p.id, data: { colour: variantForm.colour || null, size: variantForm.size || null, price: variantForm.price ? parseFloat(variantForm.price) : null } })}>
                          {addVariant.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Add"}
                        </Button>
                      </div>
                    )}

                    {variantQueries.isLoading && expanded.has(p.id) ? (
                      <div className="py-2 text-xs text-muted-foreground">Loading...</div>
                    ) : variants.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">No variants — orders use the product's default price of £{parseFloat(p.unitPrice).toFixed(2)}</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {variants.map((v: any) => (
                          <div key={v.id} className="flex items-center gap-1.5 bg-white border border-border/50 rounded-md px-2 py-1 text-xs">
                            {v.colour && <span className="flex items-center gap-1"><Palette className="w-3 h-3 text-muted-foreground" />{v.colour}</span>}
                            {v.size && <span className="flex items-center gap-1"><Ruler className="w-3 h-3 text-muted-foreground" />{v.size}</span>}
                            {v.price != null && <span className="font-semibold">£{parseFloat(v.price).toFixed(2)}</span>}
                            <button className="text-red-400 hover:text-red-600 ml-0.5" onClick={() => deleteVariant.mutate({ productId: p.id, variantId: v.id })}><X className="w-3 h-3" /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) { setEditing(null); setForm(blankForm); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Package className="w-4 h-4" /> {editing ? "Edit Bespoke Product" : "Add Bespoke Product"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Product Name *</Label>
                <Input placeholder="e.g. Company Polo Shirt" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <Label>SKU / Code</Label>
                <Input placeholder="e.g. CUST-001" value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} />
              </div>
              <div>
                <Label>Category</Label>
                <Input placeholder="e.g. Polo Shirts" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
              </div>
              <div>
                <Label>Unit Price (£) *</Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.unitPrice} onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value }))} />
              </div>
              <div>
                <Label>Supplier Code</Label>
                <Input placeholder="Supplier's code" value={form.supplierCode} onChange={e => setForm(f => ({ ...f, supplierCode: e.target.value }))} />
              </div>
              <div>
                <Label>Supplier Cost (£)</Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.supplierPrice} onChange={e => setForm(f => ({ ...f, supplierPrice: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label>Description</Label>
                <Textarea placeholder="Optional description of the product" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || !form.unitPrice || save.isPending}>
              {save.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Saving...</> : "Save Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Logo Preview (handles non-image files gracefully) ───────────────────────

// ─── References Tab ───────────────────────────────────────────────────────────

type CustomerFile = {
  id: number;
  customerId: number;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  contentType: string | null;
  category: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type CustomerReference = {
  id: number;
  customerId: number;
  title: string | null;
  notes: string | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

function ReferencesTab({ customerId }: { customerId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerReference | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const blank = { title: "", notes: "", imageUrl: "" };
  const [form, setForm] = useState(blank);

  const { data: refs = [], isLoading } = useQuery<CustomerReference[]>({
    queryKey: ["customer-references", customerId],
    queryFn: () => apiFetch(`/customers/${customerId}/references`).then(r => r.json()),
  });

  const { uploadFile, isUploading } = useUpload({
    onSuccess: (res) => {
      const url = `/api/storage${res.objectPath}`;
      setForm(f => ({ ...f, imageUrl: url }));
    },
    onError: () => toast({ title: "Image upload failed", variant: "destructive" }),
  });

  const imageInputRef = useRef<HTMLInputElement>(null);

  const saveMutation = useMutation({
    mutationFn: async (data: typeof blank) => {
      const url = editing
        ? `/customers/${customerId}/references/${editing.id}`
        : `/customers/${customerId}/references`;
      const res = await apiFetch(url, {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({ title: data.title || null, notes: data.notes || null, imageUrl: data.imageUrl || null }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-references", customerId] });
      setDialogOpen(false);
      setEditing(null);
      setForm(blank);
      toast({ title: editing ? "Reference updated" : "Reference added" });
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/references/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-references", customerId] });
      toast({ title: "Reference deleted" });
    },
  });

  function openAdd() {
    setEditing(null);
    setForm(blank);
    setDialogOpen(true);
  }

  function openEdit(ref: CustomerReference) {
    setEditing(ref);
    setForm({ title: ref.title || "", notes: ref.notes || "", imageUrl: ref.imageUrl || "" });
    setDialogOpen(true);
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  }

  const hasContent = (r: CustomerReference) => r.title || r.notes || r.imageUrl;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-foreground">References</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Internal notes and photos for your team's reference</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openAdd}><Plus className="w-3.5 h-3.5" /> Add Reference</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : refs.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="font-medium text-sm">No references yet</p>
          <p className="text-xs mt-1">Add photos of finished garments, notes, or anything useful for future reference.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {refs.map(ref => (
            <div key={ref.id} className="group border border-border/60 rounded-lg overflow-hidden bg-background shadow-sm hover:shadow-md transition-shadow">
              {ref.imageUrl ? (
                <button
                  className="w-full block relative bg-muted aspect-video overflow-hidden"
                  onClick={() => setLightboxUrl(ref.imageUrl!)}
                  title="Click to enlarge"
                >
                  <UploadedImage
                    src={ref.imageUrl}
                    alt={ref.title || "Reference image"}
                    className="w-full h-full object-cover"
                    fallback={
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground/40">
                        <ImageIcon className="w-8 h-8" />
                        <span className="text-xs">Not previewable</span>
                      </div>
                    }
                  />
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Eye className="w-6 h-6 text-white drop-shadow" />
                  </div>
                </button>
              ) : (
                <div className="w-full aspect-video bg-gradient-to-br from-muted/60 to-muted flex items-center justify-center">
                  <FileText className="w-10 h-10 text-muted-foreground/20" />
                </div>
              )}
              <div className="p-3">
                {ref.title && <p className="font-medium text-sm text-foreground leading-tight mb-1">{ref.title}</p>}
                {ref.notes && <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{ref.notes}</p>}
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/40">
                  <span className="text-[11px] text-muted-foreground/60">{new Date(ref.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(ref)}><Edit2 className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => { if (confirm("Delete this reference?")) deleteMutation.mutate(ref.id); }}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt="Reference"
            className="max-w-full max-h-full object-contain rounded shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white bg-black/40 rounded-full p-1.5 hover:bg-black/60 transition-colors"
            onClick={() => setLightboxUrl(null)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={open => { setDialogOpen(open); if (!open) { setEditing(null); setForm(blank); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Reference" : "Add Reference"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Title <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input placeholder="e.g. Finished left chest embroidery" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea placeholder="Any details worth noting…" rows={4} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label className="flex items-center gap-1"><Camera className="w-3 h-3" /> Photo <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
              {form.imageUrl ? (
                <div className="relative group w-full">
                  <UploadedImage
                    src={form.imageUrl}
                    alt="Reference photo"
                    className="w-full h-40 object-cover rounded-md border border-border"
                    fallback={
                      <div className="w-full h-40 rounded-md border border-border bg-muted/30 flex flex-col items-center justify-center gap-1 text-muted-foreground/50">
                        <ImageIcon className="w-8 h-8" /><span className="text-xs">Not previewable</span>
                      </div>
                    }
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-md flex items-center justify-center gap-2">
                    <Button type="button" size="sm" variant="secondary" className="h-7 gap-1 text-xs" onClick={() => imageInputRef.current?.click()} disabled={isUploading}>
                      {isUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />} Replace
                    </Button>
                    <Button type="button" size="sm" variant="destructive" className="h-7 gap-1 text-xs" onClick={() => setForm(f => ({ ...f, imageUrl: "" }))}>
                      <X className="w-3 h-3" /> Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <label
                  className={cn("flex flex-col items-center justify-center h-32 rounded-md border-2 border-dashed border-border cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors", isUploading && "opacity-50 pointer-events-none")}
                  onClick={() => imageInputRef.current?.click()}
                >
                  {isUploading ? (
                    <><Loader2 className="w-6 h-6 animate-spin text-muted-foreground mb-1" /><span className="text-xs text-muted-foreground">Uploading…</span></>
                  ) : (
                    <><Camera className="w-6 h-6 text-muted-foreground mb-1" /><span className="text-xs text-muted-foreground">Click to upload a photo</span></>
                  )}
                </label>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setEditing(null); setForm(blank); }}>Cancel</Button>
            <Button
              onClick={() => saveMutation.mutate(form)}
              disabled={saveMutation.isPending || isUploading || (!form.title && !form.notes && !form.imageUrl)}
            >
              {saveMutation.isPending ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Saving…</> : editing ? "Save Changes" : "Add Reference"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Logo Preview ─────────────────────────────────────────────────────────────

function LogoPreview({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const isNonImage = /\.(pdf|eps|ai)(\?|$)/i.test(url);

  if (isNonImage || failed) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" title="Click to open file">
        <div className="h-28 w-40 rounded-xl border border-amber-200 bg-amber-50/60 p-2 shadow-sm flex flex-col items-center justify-center gap-2 hover:bg-amber-100/80 transition-colors cursor-pointer">
          <FileText className="w-8 h-8 text-amber-500" />
          <span className="text-[11px] text-amber-700 text-center font-medium px-2 break-all line-clamp-2">
            {url.split("/").pop()?.split("?")[0]}
          </span>
          <span className="text-[10px] text-amber-600/80 underline">Stored · click to open</span>
        </div>
      </a>
    );
  }

  return (
    <img
      src={url}
      alt="Logo"
      className="h-28 w-auto max-w-[220px] object-contain rounded-xl border border-border/40 bg-muted/10 p-2 shadow-sm"
      onError={() => setFailed(true)}
    />
  );
}

// ─── Files Tab ────────────────────────────────────────────────────────────────

const FILE_CATEGORY_COLOR: Record<string, string> = {
  embroidery: "bg-purple-100 text-purple-800 border-purple-200",
  print:      "bg-blue-100 text-blue-800 border-blue-200",
  other:      "bg-gray-100 text-gray-600 border-gray-200",
};
const FILE_CATEGORY_LABEL: Record<string, string> = {
  embroidery: "Embroidery",
  print:      "Print / Artwork",
  other:      "Other",
};
const EMBROIDERY_EXTS = new Set(["dst","emb","pes","jef","exp","vp3","csd","hus"]);
const PRINT_EXTS      = new Set(["ai","eps","pdf","png","svg","psd","jpg","jpeg","tif","tiff"]);

function getFileCategory(name: string): "embroidery" | "print" | "other" {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (EMBROIDERY_EXTS.has(ext)) return "embroidery";
  if (PRINT_EXTS.has(ext))      return "print";
  return "other";
}
function fileEmoji(name: string) {
  const cat = getFileCategory(name);
  if (cat === "embroidery") return "🧵";
  if (cat === "print")      return "🖨️";
  return "📄";
}
function fileSizeLabel(bytes: number | null | undefined) {
  if (!bytes) return "";
  if (bytes < 1024)            return `${bytes} B`;
  if (bytes < 1024 * 1024)     return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FilesTab({ customerId }: { customerId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<"embroidery" | "print" | "other">("other");
  const [notes, setNotes]       = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pendingMeta, setPendingMeta] = useState<{ name: string; size: number; type: string } | null>(null);

  const { data: files = [], isLoading } = useQuery<CustomerFile[]>({
    queryKey: ["customer-files", customerId],
    queryFn: () => apiFetch(`/customers/${customerId}/files`).then(r => r.json()),
  });

  const { uploadFile, isUploading } = useUpload({
    onSuccess: async (res) => {
      const fileUrl = `/api/storage${res.objectPath}`;
      await apiFetch(`/customers/${customerId}/files`, {
        method: "POST",
        body: JSON.stringify({
          fileName:    pendingMeta?.name ?? "File",
          fileUrl,
          fileSize:    pendingMeta?.size ?? null,
          contentType: pendingMeta?.type ?? null,
          category,
          notes: notes.trim() || null,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["customer-files", customerId] });
      toast({ title: "File saved" });
      setPendingMeta(null);
      setNotes("");
    },
    onError: () => toast({ title: "Upload failed", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/files/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-files", customerId] });
      toast({ title: "File removed" });
      setDeletingId(null);
    },
  });

  function handlePick(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setCategory(getFileCategory(file.name));
    setPendingMeta({ name: file.name, size: file.size, type: file.type });
    uploadFile(file);
  }

  return (
    <div>
      <div className="mb-5">
        <h3 className="font-semibold text-lg">Customer Files</h3>
        <p className="text-sm text-muted-foreground">
          Store embroidery stitch files, print artwork, and any other production assets for this customer.
        </p>
      </div>

      {/* Upload panel */}
      <div className="mb-6 border-2 border-dashed border-border rounded-lg p-5 bg-muted/30">
        <p className="text-sm font-medium mb-1">Upload a file</p>
        <p className="text-xs text-muted-foreground mb-3">
          Category is auto-detected from the extension — override below if needed.&nbsp;
          Embroidery: .dst .emb .pes .jef &nbsp;|&nbsp; Artwork: .ai .eps .pdf .png .svg
        </p>

        {/* Category picker */}
        <div className="flex flex-wrap gap-2 mb-3">
          {(["embroidery", "print", "other"] as const).map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={cn(
                "px-3 py-1 rounded-full border text-xs font-medium transition-colors",
                category === cat
                  ? FILE_CATEGORY_COLOR[cat]
                  : "border-border text-muted-foreground hover:bg-muted"
              )}
            >
              {FILE_CATEGORY_LABEL[cat]}
            </button>
          ))}
        </div>

        <Input
          placeholder="Notes (optional) — e.g. Left chest 10k stitches, approved 2024"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          className="mb-3 text-sm"
        />

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={e => handlePick(e.target.files)}
        />
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="gap-2"
        >
          {isUploading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
            : <><Upload className="w-4 h-4" /> Choose File</>}
        </Button>
      </div>

      {/* File list */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : files.length === 0 ? (
        <div className="text-center py-14 text-muted-foreground">
          <FolderOpen className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="font-medium">No files yet</p>
          <p className="text-sm">Upload embroidery and print files above to keep them organised per customer.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {files.map(file => (
            <div
              key={file.id}
              className="flex items-center gap-3 border border-border rounded-lg px-4 py-3 bg-card hover:bg-muted/20 transition-colors"
            >
              <span className="text-xl shrink-0 select-none">{fileEmoji(file.fileName)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={file.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-sm text-primary hover:underline truncate max-w-xs"
                  >
                    {file.fileName}
                  </a>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full border",
                    FILE_CATEGORY_COLOR[file.category] ?? FILE_CATEGORY_COLOR.other
                  )}>
                    {FILE_CATEGORY_LABEL[file.category] ?? file.category}
                  </span>
                  {file.fileSize && (
                    <span className="text-xs text-muted-foreground">{fileSizeLabel(file.fileSize)}</span>
                  )}
                </div>
                {file.notes && (
                  <p className="text-xs text-muted-foreground mt-0.5">{file.notes}</p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">{formatDate(file.createdAt)}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <a href={file.fileUrl} target="_blank" rel="noreferrer">
                  <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-8">
                    <Eye className="w-3.5 h-3.5" /> Open
                  </Button>
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive h-8 w-8 p-0"
                  onClick={() => setDeletingId(file.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirm */}
      <Dialog open={deletingId !== null} onOpenChange={v => { if (!v) setDeletingId(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove this file?</DialogTitle>
            <DialogDescription>
              The record will be removed from this customer. The underlying file in storage will remain intact.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => { if (deletingId !== null) deleteMutation.mutate(deletingId); }}
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main CustomerDetail Page ─────────────────────────────────────────────────

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const customerId = Number(id);
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState(() => new URLSearchParams(window.location.search).get("tab") ?? "employees");

  const createOrderMutation = useCreateOrder({
    mutation: {
      onSuccess: (newOrder: any) => {
        navigate(`/orders/${newOrder.id}`);
      },
      onError: () => toast({ title: "Failed to create order", variant: "destructive" }),
    },
  });

  const { data: customer, isLoading } = useGetCustomer(customerId);

  // Must be declared before any early returns to comply with React's Rules of Hooks.
  const xeroContactId = customer ? ((customer as any).xeroContactId as string | null) : null;
  const { data: xeroBalance, isLoading: xeroBalanceLoading } = useQuery<{
    arOutstanding: number; arOverdue: number; apOutstanding: number; apOverdue: number;
  }>({
    queryKey: ["xero-balance-customer", customerId],
    queryFn: () => apiFetch(`/xero/balance/customer/${customerId}`),
    enabled: !!xeroContactId,
    retry: false,
  });

  const [overdueCollapsed, setOverdueCollapsed] = useState(true);

  // ── Open PO ─────────────────────────────────────────────────────────────────
  const [openPoModalOpen, setOpenPoModalOpen] = useState(false);
  const [newPoNumber, setNewPoNumber] = useState("");
  const [newPoExpiry, setNewPoExpiry] = useState("");
  const [newPoValue, setNewPoValue] = useState("");

  const { data: customerOpenPos, isLoading: openPosLoading } = useQuery<any[]>({
    queryKey: ["customer-open-pos", customerId],
    queryFn: () => apiFetch(`/customers/${customerId}/open-pos`),
    staleTime: 30_000,
  });
  const activePo = customerOpenPos?.find((p: any) => p.status === "active") ?? null;
  const pastPos = customerOpenPos?.filter((p: any) => p.status !== "active") ?? [];

  const addOpenPoMutation = useMutation({
    mutationFn: (data: { poNumber: string; totalValue: number; expiryDate: string }) =>
      apiFetch(`/customers/${customerId}/open-pos`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-open-pos", customerId] });
      toast({ title: "Open PO added" });
      setOpenPoModalOpen(false);
      setNewPoNumber(""); setNewPoExpiry(""); setNewPoValue("");
    },
    onError: (err: any) => toast({ title: "Failed to add open PO", description: err?.message, variant: "destructive" }),
  });

  const { data: invoiceSummary } = useQuery<{
    balanceDue: string;
    overdueTotal: string;
    unpaidCount: number;
    overdueCount: number;
    overdueInvoices: Array<{
      id: number;
      orderNumber: string;
      amount: string;
      invoicedAt: string;
      daysOverdue: number;
      xeroInvoiceId: string | null;
      xeroInvoiceStatus: string | null;
    }>;
  }>({
    queryKey: ["customer-invoice-summary", customerId],
    queryFn: () => apiFetch(`/customers/${customerId}/invoice-summary`),
    enabled: !!customerId,
    retry: false,
  });

  const queryClient = useQueryClient();
  const [logoUrl, setLogoUrl] = useState<string>("");
  const [logoSaving, setLogoSaving] = useState(false);
  const { toast } = useToast();

  // ── Edit customer details dialog ─────────────────────────────────────────
  const [editInfoOpen, setEditInfoOpen] = useState(false);
  const [editInfoForm, setEditInfoForm] = useState({
    name: "", contactFirstName: "", contactLastName: "",
    email: "", billingEmail: "", phone: "",
    address: "", state: "", city: "", postcode: "",
    invoiceName: "", invoiceAddress: "", invoiceCity: "", invoicePostcode: "",
  });
  const openEditInfo = () => {
    setEditInfoForm({
      name: (customer as any)?.name ?? "",
      contactFirstName: (customer as any)?.contactFirstName ?? "",
      contactLastName: (customer as any)?.contactLastName ?? "",
      email: (customer as any)?.email ?? "",
      billingEmail: (customer as any)?.billingEmail ?? "",
      phone: (customer as any)?.phone ?? "",
      address: (customer as any)?.address ?? "",
      state: (customer as any)?.state ?? "",
      city: (customer as any)?.city ?? "",
      postcode: (customer as any)?.postcode ?? "",
      invoiceName: (customer as any)?.invoiceName ?? "",
      invoiceAddress: (customer as any)?.invoiceAddress ?? "",
      invoiceCity: (customer as any)?.invoiceCity ?? "",
      invoicePostcode: (customer as any)?.invoicePostcode ?? "",
    });
    setEditInfoOpen(true);
  };
  const saveInfoMutation = useMutation({
    mutationFn: (data: typeof editInfoForm) =>
      apiFetch(`/customers/${customerId}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetCustomerQueryKey(customerId) });
      setEditInfoOpen(false);
      toast({ title: "Customer details updated" });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });
  const logoFileInputRef = useRef<HTMLInputElement>(null);

  const { uploadFile: uploadLogoFile, isUploading: isLogoUploading } = useUpload({
    onSuccess: async (res) => {
      const url = `/api/storage/objects${res.objectPath.replace(/^\/objects/, "")}`;
      setLogoUrl(url);
      try {
        await apiFetch(`/customers/${customerId}`, {
          method: "PATCH",
          body: JSON.stringify({ logoUrl: url }),
        });
        queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
        toast({ title: "Logo uploaded and saved" });
      } catch {
        toast({ title: "Uploaded but failed to save", variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Upload failed", description: "Could not upload logo", variant: "destructive" }),
  });

  useEffect(() => {
    setLogoUrl((customer as any)?.logoUrl || "");
  }, [customer]);

  const saveLogo = async () => {
    setLogoSaving(true);
    try {
      await apiFetch(`/customers/${customerId}`, {
        method: "PATCH",
        body: JSON.stringify({ logoUrl: logoUrl.trim() || null }),
      });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      toast({ title: "Logo saved" });
    } catch {
      toast({ title: "Failed to save logo", variant: "destructive" });
    } finally {
      setLogoSaving(false);
    }
  };

  const [prepayToggling, setPrepayToggling] = useState(false);
  const togglePrepayment = async (checked: boolean) => {
    setPrepayToggling(true);
    try {
      await apiFetch(`/customers/${customerId}`, {
        method: "PATCH",
        body: JSON.stringify({ requiresPrepayment: checked }),
      });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
    } catch {
      toast({ title: "Failed to update prepayment setting", variant: "destructive" });
    } finally {
      setPrepayToggling(false);
    }
  };

  const [zeroVatToggling, setZeroVatToggling] = useState(false);
  const toggleZeroVat = async (checked: boolean) => {
    setZeroVatToggling(true);
    try {
      await apiFetch(`/customers/${customerId}`, {
        method: "PATCH",
        body: JSON.stringify({ zeroVat: checked }),
      });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      toast({ title: checked ? "Zero-rated VAT enabled" : "Zero-rated VAT disabled", description: checked ? "All new order items will be 0% VAT." : "VAT will apply at standard rates." });
    } catch {
      toast({ title: "Failed to update VAT setting", variant: "destructive" });
    } finally {
      setZeroVatToggling(false);
    }
  };

  const [poRequiredToggling, setPoRequiredToggling] = useState(false);
  const togglePoRequired = async (checked: boolean) => {
    setPoRequiredToggling(true);
    try {
      await apiFetch(`/customers/${customerId}`, {
        method: "PATCH",
        body: JSON.stringify({ poNumberRequired: checked }),
      });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      toast({ title: checked ? "PO number required" : "PO number not required", description: checked ? "Invoices cannot be sent until a PO number is added to the order." : "Invoices can be sent without a PO number." });
    } catch {
      toast({ title: "Failed to update PO number setting", variant: "destructive" });
    } finally {
      setPoRequiredToggling(false);
    }
  };

  const [hasReviewedToggling, setHasReviewedToggling] = useState(false);
  const toggleHasReviewed = async (checked: boolean) => {
    setHasReviewedToggling(true);
    try {
      await apiFetch(`/customers/${customerId}`, {
        method: "PATCH",
        body: JSON.stringify({ hasReviewed: checked }),
      });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      toast({ title: checked ? "Marked as reviewed" : "Review mark removed", description: checked ? "Review follow-up emails will no longer be sent to this customer." : "This customer will receive review follow-up emails again." });
    } catch {
      toast({ title: "Failed to update review status", variant: "destructive" });
    } finally {
      setHasReviewedToggling(false);
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!customer) {
    return (
      <Layout>
        <div className="text-center py-20">
          <p className="text-muted-foreground">Customer not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/customers")}>Back to Customers</Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" className="mt-1 shrink-0" onClick={() => navigate("/customers")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 flex items-start justify-between gap-6">
            {/* Left: name + contact info + logo URL input */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                {!(customer as any).logoUrl && <Building2 className="w-6 h-6 text-muted-foreground shrink-0" />}
                <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">{toTitleCase(customer.name)}</h1>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={openEditInfo} title="Edit customer details">
                  <Edit2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm text-muted-foreground">
                {(customer.contactFirstName || customer.contactLastName) && (
                  <span>Contact: {toTitleCase([customer.contactFirstName, customer.contactLastName].filter(Boolean).join(' '))}</span>
                )}
                {customer.email && <span>{customer.email.toLowerCase()}</span>}
                {customer.phone && (
                  <a href={`tel:${customer.phone.replace(/\s/g, "")}`} className="flex items-center gap-1 font-medium text-foreground hover:text-primary transition-colors">
                    <Phone className="w-3.5 h-3.5 shrink-0" /> {formatUKPhone(customer.phone)}
                  </a>
                )}
                {(customer as any).address && <span>{(customer as any).address}</span>}
                {customer.state && <span>{customer.state}</span>}
                {(customer.city || (customer as any).postcode) && (
                  <span>
                    {customer.city}{(customer as any).postcode ? ` ${(customer as any).postcode}` : ''}
                  </span>
                )}
                {(customer as any).defaultShippingService && <span className="inline-flex items-center gap-1">📦 {(customer as any).defaultShippingService}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id="requires-prepayment"
                    checked={(customer as any).requiresPrepayment ?? false}
                    onCheckedChange={togglePrepayment}
                    disabled={prepayToggling}
                    className="scale-90"
                  />
                  <Label htmlFor="requires-prepayment" className="text-xs text-muted-foreground cursor-pointer select-none">
                    Requires prepayment
                  </Label>
                  {(customer as any).requiresPrepayment && (
                    <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 bg-amber-50">Prepayment required</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="zero-vat"
                    checked={(customer as any).zeroVat ?? false}
                    onCheckedChange={toggleZeroVat}
                    disabled={zeroVatToggling}
                    className="scale-90"
                  />
                  <Label htmlFor="zero-vat" className="text-xs text-muted-foreground cursor-pointer select-none">
                    Zero-rated VAT (Channel Islands)
                  </Label>
                  {(customer as any).zeroVat && (
                    <Badge variant="outline" className="text-xs border-blue-300 text-blue-700 bg-blue-50">0% VAT</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="po-number-required"
                    checked={(customer as any).poNumberRequired ?? false}
                    onCheckedChange={togglePoRequired}
                    disabled={poRequiredToggling}
                    className="scale-90"
                  />
                  <Label htmlFor="po-number-required" className="text-xs text-muted-foreground cursor-pointer select-none">
                    Requires PO number
                  </Label>
                  {(customer as any).poNumberRequired && (
                    <Badge variant="outline" className="text-xs border-orange-300 text-orange-700 bg-orange-50">PO required</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="has-reviewed"
                    checked={(customer as any).hasReviewed ?? false}
                    onCheckedChange={toggleHasReviewed}
                    disabled={hasReviewedToggling}
                    className="scale-90"
                  />
                  <Label htmlFor="has-reviewed" className="text-xs text-muted-foreground cursor-pointer select-none">
                    Has left a review
                  </Label>
                  {(customer as any).hasReviewed && (
                    <Badge variant="outline" className="text-xs border-green-300 text-green-700 bg-green-50">Reviewed ✓</Badge>
                  )}
                </div>
              </div>
              {(customer as any)?.invoiceName && (
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="text-xs text-muted-foreground">Invoiced to:</span>
                  <Badge variant="outline" className="text-xs border-purple-300 text-purple-700 bg-purple-50 gap-1">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                    {(customer as any).invoiceName}
                  </Badge>
                </div>
              )}
              <div className="flex items-center gap-2 mt-3">
                <ImageIcon className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                <Input
                  value={logoUrl}
                  onChange={e => setLogoUrl(e.target.value)}
                  placeholder="Customer logo URL (https://...)"
                  className="h-7 text-xs w-56"
                />
                <input
                  ref={logoFileInputRef}
                  type="file"
                  accept="image/*,.pdf,.eps,.ai"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogoFile(f); e.target.value = ""; }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 shrink-0"
                  disabled={isLogoUploading}
                  onClick={() => logoFileInputRef.current?.click()}
                  title="Upload a logo file from your computer"
                >
                  {isLogoUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                  {isLogoUploading ? "Uploading…" : "Upload"}
                </Button>
                {logoUrl !== ((customer as any).logoUrl || "") && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={saveLogo} disabled={logoSaving}>
                    {logoSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Save
                  </Button>
                )}
                {logoUrl && logoUrl === ((customer as any).logoUrl || "") && (
                  <span className="text-xs text-muted-foreground/60">Saved · shows on portal</span>
                )}
              </div>
            </div>

            {/* Centre: New Order button */}
            <div className="shrink-0 flex flex-col items-center justify-center self-center px-4">
              <Button
                className="gap-2 shadow-md shadow-primary/20 hover:shadow-primary/30 transition-shadow"
                disabled={createOrderMutation.isPending}
                onClick={() => createOrderMutation.mutate({ data: { customerId, orderDate: new Date().toISOString() } })}
              >
                {createOrderMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                New Order
              </Button>
            </div>

            {/* Right: large logo preview */}
            <div className="shrink-0 flex flex-col items-center gap-1.5">
              {logoUrl ? (
                <LogoPreview url={logoUrl} />
              ) : (
                <div className="h-28 w-40 rounded-xl border-2 border-dashed border-border/40 flex flex-col items-center justify-center gap-2 bg-muted/20">
                  <ImageIcon className="w-8 h-8 text-muted-foreground/25" />
                  <span className="text-xs text-muted-foreground/40">No logo</span>
                </div>
              )}
              <span className="text-[10px] text-muted-foreground/40">Portal preview</span>
            </div>
          </div>
        </div>

        {/* Invoice balance summary */}
        {(invoiceSummary || xeroContactId) && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              {/* Balance Due chip */}
              {invoiceSummary && (
                <div className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-lg border text-sm",
                  parseFloat(invoiceSummary.balanceDue) > 0 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"
                )}>
                  <TrendingUp className={cn("w-4 h-4", parseFloat(invoiceSummary.balanceDue) > 0 ? "text-amber-600" : "text-green-600")} />
                  <div>
                    <div className="font-semibold text-foreground">{formatCurrency(parseFloat(invoiceSummary.balanceDue))} balance due</div>
                    <div className="text-xs text-muted-foreground">{invoiceSummary.unpaidCount} unpaid invoice{invoiceSummary.unpaidCount !== 1 ? "s" : ""}</div>
                  </div>
                </div>
              )}
              {/* Overdue chip */}
              {invoiceSummary && invoiceSummary.overdueCount > 0 && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-red-50 border-red-200 text-sm">
                  <AlertCircle className="w-4 h-4 text-red-600" />
                  <div>
                    <div className="font-semibold text-red-700">{formatCurrency(parseFloat(invoiceSummary.overdueTotal))} overdue</div>
                    <div className="text-xs text-red-500">{invoiceSummary.overdueCount} invoice{invoiceSummary.overdueCount !== 1 ? "s" : ""} past 14 days</div>
                  </div>
                </div>
              )}
              {/* Xero live balance chip */}
              {xeroContactId && (
                xeroBalanceLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground px-3 py-3">
                    <Loader2 className="w-4 h-4 animate-spin" /> Xero balance…
                  </div>
                ) : xeroBalance ? (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-muted/30 border-border/50 text-sm">
                    <TrendingUp className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <div className="font-semibold text-foreground">{formatCurrency(xeroBalance.arOutstanding)} AR (Xero)</div>
                      <div className="text-xs text-muted-foreground">Live from Xero</div>
                    </div>
                  </div>
                ) : null
              )}
            </div>

            {/* Overdue invoices list */}
            {invoiceSummary && invoiceSummary.overdueInvoices.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50/50 overflow-hidden">
                <button
                  className="w-full flex items-center gap-2 px-4 py-2.5 bg-red-50 hover:bg-red-100/70 transition-colors text-left"
                  onClick={() => setOverdueCollapsed(c => !c)}
                >
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span className="text-sm font-semibold text-red-700 flex-1">Overdue Invoices</span>
                  <ChevronDown className={cn("w-4 h-4 text-red-500 transition-transform duration-200", overdueCollapsed && "-rotate-90")} />
                </button>
                {!overdueCollapsed && (
                  <div className="divide-y divide-red-100 border-t border-red-200">
                    {invoiceSummary.overdueInvoices.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center justify-between px-4 py-2.5 hover:bg-red-50 cursor-pointer transition-colors"
                        onClick={() => navigate(`/orders/${inv.id}`)}
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm font-medium text-foreground">{inv.orderNumber}</span>
                          <span className="text-xs text-red-600 font-medium">
                            {inv.daysOverdue} day{inv.daysOverdue !== 1 ? "s" : ""} overdue
                          </span>
                          {inv.xeroInvoiceStatus && (
                            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{inv.xeroInvoiceStatus}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-red-700">{formatCurrency(parseFloat(inv.amount))}</span>
                          <span className="text-xs text-muted-foreground">{formatDate(inv.invoicedAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Open Purchase Order ──────────────────────────────────────────── */}
        <div className="rounded-lg border border-border/60 bg-card shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-muted-foreground" /> Open Purchase Order
            </h3>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setOpenPoModalOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> Add Open PO
            </Button>
          </div>

          {openPosLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
          ) : activePo ? (
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="font-mono text-sm font-semibold">{activePo.poNumber}</span>
                <Badge variant="outline" className="text-xs border-green-300 text-green-700 bg-green-50">Active</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><span className="text-muted-foreground">Total</span><div className="font-medium mt-0.5">{formatCurrency(activePo.totalValue)}</div></div>
                <div><span className="text-muted-foreground">Used</span><div className="font-medium mt-0.5">{formatCurrency(activePo.usedValue)}</div></div>
                <div>
                  <span className="text-muted-foreground">Remaining</span>
                  <div className={cn("font-medium mt-0.5", activePo.remainingValue / activePo.totalValue < 0.2 ? "text-amber-600" : "text-green-600")}>
                    {formatCurrency(activePo.remainingValue)}
                  </div>
                </div>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full", activePo.remainingValue / activePo.totalValue < 0.2 ? "bg-amber-400" : "bg-green-500")}
                  style={{ width: `${Math.min(100, (activePo.usedValue / activePo.totalValue) * 100).toFixed(1)}%` }}
                />
              </div>
              <div className="text-xs text-muted-foreground">Expires {activePo.expiryDate}</div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground py-1">No active open PO for this customer.</div>
          )}

          {pastPos.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground py-1">
                {pastPos.length} past PO{pastPos.length !== 1 ? "s" : ""}
              </summary>
              <div className="mt-2 space-y-1.5">
                {pastPos.map((po: any) => (
                  <div key={po.id} className="flex items-center justify-between px-3 py-2 rounded border bg-muted/20">
                    <span className="font-mono font-medium">{po.poNumber}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{formatCurrency(po.totalValue)}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 capitalize">{po.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* Add Open PO modal */}
        <Dialog open={openPoModalOpen} onOpenChange={(v) => { if (!v) { setOpenPoModalOpen(false); setNewPoNumber(""); setNewPoExpiry(""); setNewPoValue(""); } }}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader><DialogTitle>Add Open Purchase Order</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">An open PO allows this customer to submit portal orders against a pre-authorised spend limit. Any existing active PO will be superseded.</p>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label>PO number</Label>
                <Input value={newPoNumber} onChange={e => setNewPoNumber(e.target.value)} placeholder="e.g. PO-2026-0043" className="font-mono" />
              </div>
              <div className="grid gap-2">
                <Label>Authorised value (£, ex VAT)</Label>
                <Input type="number" min={1} step={1} value={newPoValue} onChange={e => setNewPoValue(e.target.value)} placeholder="e.g. 25000" />
              </div>
              <div className="grid gap-2">
                <Label>Expiry date</Label>
                <Input type="date" value={newPoExpiry} min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)} onChange={e => setNewPoExpiry(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenPoModalOpen(false)}>Cancel</Button>
              <Button
                disabled={!newPoNumber || !newPoExpiry || !newPoValue || addOpenPoMutation.isPending}
                onClick={() => {
                  const val = parseFloat(newPoValue);
                  if (isNaN(val) || val <= 0) { toast({ title: "Invalid value", variant: "destructive" }); return; }
                  addOpenPoMutation.mutate({ poNumber: newPoNumber, totalValue: val, expiryDate: newPoExpiry });
                }}
              >
                {addOpenPoMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Add open PO
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full justify-start overflow-x-auto h-auto flex-wrap gap-1 bg-muted/50 p-1">
            <TabsTrigger value="employees" className="flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5" /> Employees</TabsTrigger>
            <TabsTrigger value="roles" className="flex items-center gap-1.5"><Boxes className="w-3.5 h-3.5" /> Roles</TabsTrigger>
            <TabsTrigger value="teams" className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Teams</TabsTrigger>
            <TabsTrigger value="wardrobe" className="flex items-center gap-1.5"><ShoppingBag className="w-3.5 h-3.5" /> Wardrobe</TabsTrigger>
            <TabsTrigger value="addresses" className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Delivery Addresses</TabsTrigger>
            <TabsTrigger value="invoice-addresses" className="flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Invoice Addresses</TabsTrigger>
            <TabsTrigger value="contacts" className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Contacts</TabsTrigger>
            <TabsTrigger value="orders" className="flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Order History</TabsTrigger>
            <TabsTrigger value="processes" className="flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" /> Processes</TabsTrigger>
            <TabsTrigger value="finishes" className="flex items-center gap-1.5"><Shirt className="w-3.5 h-3.5" /> Finishes</TabsTrigger>
            <TabsTrigger value="bespoke" className="flex items-center gap-1.5"><Package className="w-3.5 h-3.5" /> Bespoke Products</TabsTrigger>
            <TabsTrigger value="portal" className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Portal Access</TabsTrigger>
            <TabsTrigger value="payments" className="flex items-center gap-1.5"><CreditCard className="w-3.5 h-3.5" /> Payment Methods</TabsTrigger>
            <TabsTrigger value="references" className="flex items-center gap-1.5"><BookOpen className="w-3.5 h-3.5" /> References</TabsTrigger>
            <TabsTrigger value="finish-stock" className="flex items-center gap-1.5"><Warehouse className="w-3.5 h-3.5" /> Finish Stock</TabsTrigger>
            <TabsTrigger value="files" className="flex items-center gap-1.5"><FolderOpen className="w-3.5 h-3.5" /> Files</TabsTrigger>
          </TabsList>

          <div className="mt-4 bg-card border border-border/50 rounded-lg p-6 shadow-sm">
            <TabsContent value="employees" className="mt-0"><EmployeesTab customerId={customerId} /></TabsContent>
            <TabsContent value="roles" className="mt-0"><RolesTab customerId={customerId} /></TabsContent>
            <TabsContent value="teams" className="mt-0"><TeamsTab customerId={customerId} /></TabsContent>
            <TabsContent value="wardrobe" className="mt-0"><WardrobeTab customerId={customerId} /></TabsContent>
            <TabsContent value="addresses" className="mt-0"><AddressesTab customerId={customerId} customer={customer} /></TabsContent>
            <TabsContent value="invoice-addresses" className="mt-0"><InvoiceAddressesTab customerId={customerId} customer={customer} /></TabsContent>
            <TabsContent value="contacts" className="mt-0"><ContactsTab customerId={customerId} customer={customer} /></TabsContent>
            <TabsContent value="orders" className="mt-0"><OrderHistoryTab customerId={customerId} /></TabsContent>
            <TabsContent value="processes" className="mt-0"><ProcessesTab customerId={customerId} /></TabsContent>
            <TabsContent value="finishes" className="mt-0"><FinishesTab customerId={customerId} /></TabsContent>
            <TabsContent value="bespoke" className="mt-0"><BespokeProductsTab customerId={customerId} /></TabsContent>
            <TabsContent value="portal" className="mt-0"><PortalAccessTab customerId={customerId} /></TabsContent>
            <TabsContent value="payments" className="mt-0"><PaymentMethodsTab customerId={customerId} /></TabsContent>
            <TabsContent value="references" className="mt-0"><ReferencesTab customerId={customerId} /></TabsContent>
            <TabsContent value="finish-stock" className="mt-0"><FinishStockTab customerId={customerId} /></TabsContent>
            <TabsContent value="files" className="mt-0"><FilesTab customerId={customerId} /></TabsContent>
          </div>
        </Tabs>
      </div>

      {/* ── Edit customer details dialog ──────────────────────────────────── */}
      <Dialog open={editInfoOpen} onOpenChange={(v) => { if (!v) setEditInfoOpen(false); }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader><DialogTitle>Edit Customer Details</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Company Name</Label>
              <Input value={editInfoForm.name} onChange={e => setEditInfoForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Contact First Name</Label>
                <Input value={editInfoForm.contactFirstName} onChange={e => setEditInfoForm(f => ({ ...f, contactFirstName: e.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label>Contact Last Name</Label>
                <Input value={editInfoForm.contactLastName} onChange={e => setEditInfoForm(f => ({ ...f, contactLastName: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Email</Label>
                <Input type="email" value={editInfoForm.email} onChange={e => setEditInfoForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label>Phone</Label>
                <Input value={editInfoForm.phone} onChange={e => setEditInfoForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Billing / Invoice Email</Label>
              <Input type="email" placeholder="Leave blank to use the email above" value={editInfoForm.billingEmail} onChange={e => setEditInfoForm(f => ({ ...f, billingEmail: e.target.value }))} />
              <p className="text-xs text-muted-foreground">When set, all invoices go here instead — use this for a shared finance inbox.</p>
            </div>
            <div className="border-t pt-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Billing Address — shown on invoices</p>
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label>Street Address</Label>
                  <Input placeholder="e.g. 10 High Street" value={editInfoForm.address} onChange={e => setEditInfoForm(f => ({ ...f, address: e.target.value }))} />
                </div>
                <div className="grid gap-2">
                  <Label>Address Line 2</Label>
                  <Input placeholder="Estate, district, etc." value={editInfoForm.state} onChange={e => setEditInfoForm(f => ({ ...f, state: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>City / Town</Label>
                    <Input value={editInfoForm.city} onChange={e => setEditInfoForm(f => ({ ...f, city: e.target.value }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Postcode</Label>
                    <Input value={editInfoForm.postcode} onChange={e => setEditInfoForm(f => ({ ...f, postcode: e.target.value }))} />
                  </div>
                </div>
              </div>
            </div>
            <div className="border-t pt-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Centralised Invoice Contact</p>
              <p className="text-xs text-muted-foreground mb-3">For group companies — overrides the name and address printed on invoices. Leave blank to use the fields above.</p>
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label>Invoice Company Name</Label>
                  <Input placeholder="e.g. Group Trading Ltd" value={editInfoForm.invoiceName} onChange={e => setEditInfoForm(f => ({ ...f, invoiceName: e.target.value }))} />
                </div>
                <div className="grid gap-2">
                  <Label>Invoice Street Address</Label>
                  <Input placeholder="e.g. 1 Example Street, Example City" value={editInfoForm.invoiceAddress} onChange={e => setEditInfoForm(f => ({ ...f, invoiceAddress: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Invoice City</Label>
                    <Input value={editInfoForm.invoiceCity} onChange={e => setEditInfoForm(f => ({ ...f, invoiceCity: e.target.value }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Invoice Postcode</Label>
                    <Input value={editInfoForm.invoicePostcode} onChange={e => setEditInfoForm(f => ({ ...f, invoicePostcode: e.target.value }))} />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditInfoOpen(false)}>Cancel</Button>
            <Button onClick={() => saveInfoMutation.mutate(editInfoForm)} disabled={saveInfoMutation.isPending || !editInfoForm.name}>
              {saveInfoMutation.isPending ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Saving…</> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
